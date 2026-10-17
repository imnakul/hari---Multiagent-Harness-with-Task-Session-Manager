// Diagnostic reference only: Orca's node-pty/bundled ConPTY backend.
import { createRequire } from "node:module";
import { createInterface } from "node:readline";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
const require = createRequire(import.meta.url);
const pty = require(
  join(
    process.env.MONOCODE_INTERACTIVE_TEST_NODE_PTY_ROOT,
    "node_modules/node-pty",
  ),
);
let live;
const emit = (value) => process.stdout.write(JSON.stringify(value) + "\n");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const frame = (text) => `\x1b[200~${text}\x1b[201~`;
function paste(text) {
  if (text !== "/compact") {
    let offset = 0;
    for (const letter of text) {
      if (/[\p{L}\p{N}]/u.test(letter)) {
        const end = offset + letter.length;
        return (
          (offset ? frame(text.slice(0, offset)) : "") +
          letter +
          (end < text.length ? frame(text.slice(end)) : "")
        );
      }
      offset += letter.length;
    }
  }
  return frame(text);
}
async function stop() {
  const old = live;
  live = undefined;
  if (!old) return;
  spawnSync("taskkill.exe", ["/PID", String(old.proc.pid), "/T", "/F"], {
    windowsHide: true,
    stdio: "ignore",
  });
  try {
    old.proc.kill();
  } catch {}
  await Promise.race([old.exited, sleep(2000)]);
}
async function dispatch(request) {
  try {
    switch (request.command) {
      case "start": {
        await stop();
        const env = {
          ...process.env,
          ...request.env,
          TERM_PROGRAM: "MonoCode",
        };
        for (const key of [
          "CLAUDECODE",
          "ANTHROPIC_AUTH_TOKEN",
          "CLAUDE_CODE_OAUTH_TOKEN",
        ])
          delete env[key];
        const proc = pty.spawn(request.argv[0], request.argv.slice(1), {
          cols: 120,
          rows: 40,
          cwd: request.cwd,
          env,
          name: "xterm-256color",
          useConptyDll: true,
          conptyInheritCursor: true,
        });
        let exited;
        const value = {
          proc,
          total: 0,
          at: Date.now(),
          baseline: 0,
          size: 0,
          exited: new Promise((resolve) => {
            exited = resolve;
          }),
        };
        live = value;
        proc.onData((data) => {
          if (live !== value) return;
          const bytes = Buffer.from(data, "utf8");
          value.total += bytes.length;
          value.at = Date.now();
          emit({ event: "data", data: bytes.toString("base64") });
        });
        proc.onExit((event) => {
          if (live === value) emit({ event: "exit", code: event.exitCode });
          exited();
        });
        // Same inherited-cursor pre-answer as production; its echoed query is
        // consumed by the existing frontend handler.
        proc.write("\x1b[1;1R");
        break;
      }
      case "write":
      case "paste": {
        if (!live) throw Error("No native PTY");
        const data =
          request.command === "paste" ? paste(request.data) : request.data;
        if (request.command === "paste") {
          live.baseline = live.total;
          live.size = Buffer.byteLength(data);
        }
        live.proc.write(data);
        live.at = Date.now();
        break;
      }
      case "paste-settle": {
        const current = live;
        if (!current) throw Error("No native PTY");
        const started = Date.now();
        const minimum = 500 + Math.ceil(current.size / 64);
        while (true) {
          if (live !== current) throw Error("Native PTY changed");
          if (
            Date.now() - started >= minimum &&
            current.total > current.baseline &&
            Date.now() - current.at >= 1500
          )
            break;
          if (Date.now() - started >= minimum + 8000)
            throw Error("Native paste output did not settle");
          await sleep(20);
        }
        break;
      }
      case "resize":
        if (!live) throw Error("No native PTY");
        else live.proc.resize(request.cols, request.rows);
        break;
      case "stop":
        await stop();
        break;
      default:
        throw Error("Unknown reference host command");
    }
    emit({ id: request.id });
  } catch (error) {
    emit({ id: request.id, error: String(error) });
  }
}
const lines = createInterface({ input: process.stdin });
lines.on("line", (line) => {
  void dispatch(JSON.parse(line));
});
lines.on("close", () => {
  void stop().finally(() => process.exit(0));
});

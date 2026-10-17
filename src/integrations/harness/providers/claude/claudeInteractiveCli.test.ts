import { createServer, type ServerResponse } from "node:http";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { expect, it, vi } from "vitest";
import type { HarnessEvent, SendTurnInput } from "../../core/types";

const ipc = vi.hoisted(() => ({
  invoke: vi.fn(),
  listeners: new Map<string, (event: { payload: unknown }) => void>(),
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: ipc.invoke,
  isTauri: () => true,
}));
vi.mock("../../../../platform/tauri/platform", () => ({
  IS_WIN: process.platform === "win32",
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: async (
    name: string,
    listener: (event: { payload: unknown }) => void,
  ) => {
    ipc.listeners.set(name, listener);
    return (): void => {
      ipc.listeners.delete(name);
    };
  },
}));
vi.mock("../../core/child", () => ({
  hasHeadlessChildBackend: () => false,
  resolveClaudeBinary: async () => ({
    path: process.env.MONOCODE_INTERACTIVE_TEST_CLI!,
  }),
}));
import {
  forgetInteractiveClaude,
  sendInteractiveClaude,
  stopInteractiveClaude,
  interactiveClaudeDiagnostics,
} from "./claudeInteractive";
import { interactiveTerminalFor } from "./claudeInteractiveTerminal";

function reply(response: ServerResponse, body: unknown): void {
  response.writeHead(200, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

// Explicit opt-in: starts the real installed CLI with a temporary fake account
// and a loopback response server. The production frontend/VT/PTY path stays real;
// Desktop IPC is replaced. On Windows the opt-in host reuses the production
// managed spawn, vendored ConPTY and output pump; it does not drive a Tauri view.
it
  .runIf(
    !!process.env.MONOCODE_INTERACTIVE_TEST_CLI &&
      (process.platform !== "win32" ||
        !!process.env.MONOCODE_INTERACTIVE_TEST_PTY_HOST),
  )
  .each(["supervised", "full-access"] as const)(
  "real interactive CLI: two GUI turns before and after native resume (%s)",
  async (runtimeMode) => {
    const root = await realpath(
      await mkdtemp(join(tmpdir(), "monocode-interactive-test-")),
    );
    const config = join(root, "config");
    const cwd = join(root, "project");
    await Promise.all([mkdir(config), mkdir(cwd)]);
    const key = "monocode-loopback-fixture-key";
    await writeFile(
      join(config, ".claude.json"),
      JSON.stringify({
        hasCompletedOnboarding: true,
        theme: "dark",
        bypassPermissionsModeAccepted: true,
        customApiKeyResponses: { approved: [key.slice(-20)], rejected: [] },
        projects: Object.fromEntries(
          [...new Set([cwd, cwd.replaceAll("\\", "/")])].map((path) => [
            path,
            {
              hasTrustDialogAccepted: true,
              hasCompletedProjectOnboarding: true,
            },
          ]),
        ),
      }),
    );
    const id = randomUUID();
    let phase = "ready";
    let sequence = 0;
    let transcriptPath: string | undefined;
    let transcriptOffset = 0;
    const hooks: Record<string, unknown>[] = [];
    const acceptedPrompts: string[] = [];
    const requests: string[] = [];
    let output = Buffer.alloc(0);
    const server = createServer(async (request, response) => {
      try {
        const chunks: Buffer[] = [];
        for await (const chunk of request)
          chunks.push(Buffer.from(chunk as Uint8Array));
        const body = JSON.parse(
          Buffer.concat(chunks).toString() || "{}",
        ) as Record<string, unknown>;
        if (request.url === "/hook") {
          const row = { ...body, bridgeId: ++sequence };
          hooks.push(row);
          if (typeof body.transcript_path === "string")
            transcriptPath = body.transcript_path;
          if (body.hook_event_name === "UserPromptSubmit") {
            phase = "busy";
            acceptedPrompts.push(String(body.prompt));
          }
          if (body.hook_event_name === "Stop") phase = "ready";
          reply(response, {});
          return;
        }
        if (!request.url?.includes("/messages")) {
          reply(response, {});
          return;
        }
        if (request.url.includes("count_tokens")) {
          reply(response, { input_tokens: 12 });
          return;
        }
        requests.push(request.url);
        const message = {
          id: `msg_fixture_${requests.length}`,
          type: "message",
          role: "assistant",
          model: body.model,
          content: [{ type: "text", text: "Reply from the local fixture." }],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 12, output_tokens: 9 },
        };
        if (!body.stream) {
          reply(response, message);
          return;
        }
        response.writeHead(200, { "Content-Type": "text/event-stream" });
        const stream = [
          {
            type: "message_start",
            message: {
              ...message,
              content: [],
              stop_reason: null,
              usage: { input_tokens: 12, output_tokens: 0 },
            },
          },
          {
            type: "content_block_start",
            index: 0,
            content_block: { type: "text", text: "" },
          },
          {
            type: "content_block_delta",
            index: 0,
            delta: { type: "text_delta", text: message.content[0].text },
          },
          { type: "content_block_stop", index: 0 },
          {
            type: "message_delta",
            delta: { stop_reason: "end_turn", stop_sequence: null },
            usage: { output_tokens: 9 },
          },
          { type: "message_stop" },
        ];
        for (const event of stream)
          response.write(
            `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
          );
        response.end();
      } catch (error) {
        response.destroy(error instanceof Error ? error : undefined);
      }
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("No fixture address");
    const url = `http://127.0.0.1:${address.port}`;
    const nativeHost = process.env.MONOCODE_INTERACTIVE_TEST_PTY_HOST;
    const driver = spawn(
      nativeHost ?? "python3",
      nativeHost
        ? []
        : [
            fileURLToPath(
              new URL("./fixtures/interactive-pty-host.py", import.meta.url),
            ),
          ],
      { stdio: ["pipe", "pipe", "inherit"] },
    );
    const pending = new Map<
      number,
      { resolve: () => void; reject: (error: Error) => void }
    >();
    let requestId = 0;
    const lines = createInterface({ input: driver.stdout });
    lines.on("line", (line) => {
      const value = JSON.parse(line) as {
        id?: number;
        event?: string;
        data?: string;
        code?: number;
        error?: string;
      };
      if (value.event === "data") {
        const chunk = Buffer.from(value.data!, "base64");
        output = Buffer.concat([output, chunk]);
        ipc.listeners.get("pty-data")?.({
          payload: { id: `claude-interactive:${id}`, data: value.data },
        });
      } else if (value.event === "exit") {
        ipc.listeners.get("pty-exit")?.({
          payload: { id: `claude-interactive:${id}`, code: value.code },
        });
      } else if (value.id != null) {
        const waiter = pending.get(value.id);
        pending.delete(value.id);
        if (value.error) waiter?.reject(new Error(value.error));
        else waiter?.resolve();
      }
    });
    const rpc = async (
      command: string,
      args: Record<string, unknown> = {},
    ): Promise<void> => {
      const serial = ++requestId;
      await new Promise<void>((resolve, reject) => {
        pending.set(serial, { resolve, reject });
        driver.stdin.write(
          `${JSON.stringify({ id: serial, command, ...args })}\n`,
        );
      });
    };
    const starts: Record<string, unknown>[] = [];
    const sends: string[] = [];
    const nativeInput: string[] = [];
    const passiveReplies: string[] = [];
    ipc.invoke
      .mockReset()
      .mockImplementation(
        async (command: string, args: Record<string, unknown>) => {
          if (command === "claude_interactive_start") {
            const input = args.input as Record<string, unknown>;
            starts.push(input);
            phase = "ready";
            output = Buffer.alloc(0);
            transcriptOffset =
              input.resume && transcriptPath
                ? (await stat(transcriptPath)).size
                : 0;
            const settings = {
              hooks: Object.fromEntries(
                ["SessionStart", "UserPromptSubmit", "Stop"].map((name) => [
                  name,
                  [
                    {
                      matcher: "*",
                      hooks: [
                        { type: "http", url: `${url}/hook`, timeout: 10 },
                      ],
                    },
                  ],
                ]),
              ),
              fastMode: input.fast,
            };
            await rpc("start", {
              argv: [
                process.env.MONOCODE_INTERACTIVE_TEST_CLI,
                input.resume ? "--resume" : "--session-id",
                input.nativeId,
                "--model",
                input.model,
                "--permission-mode",
                input.permissionMode,
                "--effort",
                input.effort,
                "--settings",
                JSON.stringify(settings),
              ],
              cwd,
              env: {
                CLAUDE_CONFIG_DIR: config,
                CLAUDE_SECURESTORAGE_CONFIG_DIR: config,
                ANTHROPIC_API_KEY: key,
                ANTHROPIC_BASE_URL: url,
                TERM: "xterm-256color",
                COLORTERM: "truecolor",
                NO_PROXY: "127.0.0.1,localhost",
                CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
              },
            });
            // Fixture-owned approval only: native Windows may canonicalize its
            // project key differently from Node. Never type into an unknown menu.
            if (process.platform === "win32") {
              const deadline = Date.now() + 8000;
              const screen = (): string => {
                const terminal = interactiveTerminalFor(id)?.term;
                if (!terminal) return "";
                const buffer = terminal.buffer.active;
                return Array.from(
                  { length: terminal.rows },
                  (_, row) =>
                    buffer
                      .getLine(buffer.baseY + row)
                      ?.translateToString(true) ?? "",
                ).join("\n");
              };
              while (Date.now() < deadline) {
                const text = screen();
                if (
                  text.includes(cwd) &&
                  text.includes("Quick safety check") &&
                  text.includes("Yes, I trust this folder")
                ) {
                  if (text.includes("❯ No, exit")) {
                    await rpc("write", { data: "\x1b[B" });
                    await new Promise((resolve) => setTimeout(resolve, 150));
                  }
                  if (!screen().includes("❯ Yes, I trust this folder"))
                    throw new Error("Fixture trust selection did not settle");
                  await rpc("write", { data: "\r" });
                  break;
                }
                if (interactiveTerminalFor(id)?.ready()) break;
                await new Promise((resolve) => setTimeout(resolve, 25));
              }
            }
            return;
          }
          if (command === "pty_write") {
            passiveReplies.push(String(args.data));
            return rpc("write", { data: args.data });
          }
          if (command === "pty_resize")
            return rpc("resize", { cols: args.cols, rows: args.rows });
          if (command === "pty_replay") {
            const offset = Number(args.offset);
            return {
              start: offset,
              total: output.length,
              data: output.subarray(offset).toString("base64"),
            };
          }
          if (command === "claude_interactive_poll") {
            let rows: string[] = [];
            if (transcriptPath) {
              // UserPromptSubmit can name the transcript before its first write.
              // The native backend's safe_transcript canonicalization also skips it then.
              const contents = await readFile(transcriptPath).catch(
                (error: unknown) => {
                  if (
                    error instanceof Error &&
                    "code" in error &&
                    error.code === "ENOENT"
                  )
                    return Buffer.alloc(0);
                  throw error;
                },
              );
              const end = contents.lastIndexOf(10);
              if (end >= transcriptOffset) {
                rows = contents
                  .subarray(transcriptOffset, end)
                  .toString()
                  .split("\n");
                transcriptOffset = end + 1;
              }
            }
            return {
              phase,
              terminalOwner: false,
              sequence,
              events: hooks.splice(0),
              lines: rows,
              more: false,
            };
          }
          if (command === "claude_interactive_send") {
            sends.push(String(args.text));
            await rpc("write", {
              data: `\x1b[200~${String(args.text)}\x1b[201~`,
            });
            await new Promise((resolve) => setTimeout(resolve, 120));
            return rpc("write", { data: "\r" });
          }
          if (command === "claude_interactive_terminal") {
            nativeInput.push(String(args.data));
            return rpc("write", { data: args.data });
          }
          if (command === "claude_interactive_stop") return rpc("stop");
          throw new Error(`Unexpected IPC: ${command}`);
        },
      );
    try {
      const events: HarnessEvent[] = [];
      const accepted = vi.fn();
      const messages = [
        "Radhe Radhe",
        "Line one\nLine two",
        "After Stop and native resume",
        "One more resumed turn",
      ];
      for (const text of messages) {
        if (text === messages[2]) await stopInteractiveClaude(id);
        const input: SendTurnInput = {
          sessionId: id,
          cwd,
          model: "claude:sonnet-5-5",
          runtimeMode,
          modelSettings: { claudeExecution: "interactive", effort: "low" },
          text,
          onEvent: (event): void => {
            events.push(event);
          },
          onAccepted: accepted,
        };
        await sendInteractiveClaude(input);
        expect(interactiveTerminalFor(id)?.owner).toBe(false);
        expect(interactiveTerminalFor(id)?.term.element).toBeUndefined();
      }
      expect(sends).toEqual(messages);
      expect(acceptedPrompts).toEqual(messages);
      expect(accepted).toHaveBeenCalledTimes(messages.length);
      expect(nativeInput).toEqual([]);
      expect(events.filter((event) => event.type === "message.delta")).toEqual(
        messages.map(() => ({
          type: "message.delta",
          text: "Reply from the local fixture.",
        })),
      );
      expect(starts).toHaveLength(2);
      expect(starts[1]).toMatchObject({
        nativeId: starts[0].nativeId,
        resume: true,
      });
      expect(requests.length).toBeGreaterThanOrEqual(messages.length);
    } finally {
      const capture = process.env.MONOCODE_INTERACTIVE_TEST_CAPTURE_DIR;
      if (capture) {
        await mkdir(capture, { recursive: true });
        await Promise.all([
          writeFile(join(capture, `${runtimeMode}.vt`), output),
          writeFile(
            join(capture, `${runtimeMode}.json`),
            JSON.stringify(
              {
                readiness: interactiveClaudeDiagnostics(id),
                passiveReplies,
                nativeInput,
                acceptedPrompts,
              },
              null,
              2,
            ),
          ),
        ]);
      }
      await forgetInteractiveClaude(id);
      lines.close();
      driver.stdin.end();
      await new Promise<void>((resolve) =>
        driver.once("exit", () => resolve()),
      );
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(root, { recursive: true, force: true });
    }
  },
  60000,
);

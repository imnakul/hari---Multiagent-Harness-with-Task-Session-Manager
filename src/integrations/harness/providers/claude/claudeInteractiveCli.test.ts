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
  compactInteractiveClaude,
} from "./claudeInteractive";
import { interactiveTerminalFor } from "./claudeInteractiveTerminal";
import { interactivePromptMatches } from "./claudeInteractivePrompt";

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
  "real interactive CLI: messages, resume, fork, compact, attachments and background continuation (%s)",
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
        // Native suggestions can block a hidden input. The per-launch override
        // below must win without altering this temporary user's preference.
        promptSuggestionEnabled: true,
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
    let skipForkHistory = false;
    const observedHooks: string[] = [];
    const observedHookRows: Record<string, unknown>[] = [];
    const backgroundCommand = 'node -e "setTimeout(()=>console.log(123),2500)"';
    const requests: string[] = [];
    const requestPrefixes: string[] = [];
    const requestMessages: string[] = [];
    const attachmentPaths: string[] = [];
    let sawAttachedImage = false;
    let output = Buffer.alloc(0);
    const server = createServer(async (request, response) => {
      try {
        const chunks: Buffer[] = [];
        for await (const chunk of request)
          chunks.push(Buffer.from(chunk as Uint8Array));
        const body = JSON.parse(
          Buffer.concat(chunks).toString() || "{}",
        ) as Record<string, unknown>;
        if (request.url?.startsWith("/hook/")) {
          observedHooks.push(String(body.hook_event_name));
          observedHookRows.push(body);
          const row = { ...body, bridgeId: ++sequence };
          hooks.push(row);
          if (typeof body.transcript_path === "string")
            transcriptPath = body.transcript_path;
          if (body.hook_event_name === "UserPromptSubmit") {
            if (skipForkHistory && transcriptPath) {
              transcriptOffset = (
                await stat(transcriptPath).catch(() => ({ size: 0 }))
              ).size;
              skipForkHistory = false;
            }
            phase = "busy";
            if (!String(body.prompt).startsWith("<task-notification>"))
              acceptedPrompts.push(String(body.prompt));
          }
          if (body.hook_event_name === "PreCompact") phase = "busy";
          if (
            body.hook_event_name === "Stop" ||
            body.hook_event_name === "PostCompact"
          )
            phase = "ready";
          const tool = body.tool_input as
            { command?: string; file_path?: string } | undefined;
          reply(
            response,
            body.hook_event_name === "PreToolUse" &&
              ((body.tool_name === "Bash" &&
                tool?.command === backgroundCommand) ||
                (body.tool_name === "Read" &&
                  attachmentPaths.includes(tool?.file_path ?? "")))
              ? {
                  hookSpecificOutput: {
                    hookEventName: "PreToolUse",
                    permissionDecision: "allow",
                  },
                }
              : {},
          );
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
        if (Array.isArray(body.tools) && body.tools.length)
          requestPrefixes.push(JSON.stringify([body.system, body.tools]));
        if (Array.isArray(body.tools) && body.tools.length)
          requestMessages.push(JSON.stringify(body.messages));
        sawAttachedImage ||= JSON.stringify(body.messages).includes(
          '"type":"image"',
        );
        const hasTools = Array.isArray(body.tools) && body.tools.length > 0;
        const background =
          hasTools &&
          JSON.stringify(body.messages).includes(
            "Run background fixture command",
          ) &&
          !JSON.stringify(body.messages).includes("toolu_fixture_background");
        const readFiles =
          hasTools &&
          JSON.stringify(body.messages).includes("Read fixture attachments");
        const tool = background
          ? {
              id: "toolu_fixture_background",
              name: "Bash",
              input: {
                command: backgroundCommand,
                description: "Fixture-only background command",
                run_in_background: true,
              },
            }
          : readFiles &&
              !JSON.stringify(body.messages).includes("toolu_fixture_file")
            ? {
                id: "toolu_fixture_file",
                name: "Read",
                input: { file_path: attachmentPaths[0] },
              }
            : readFiles &&
                !JSON.stringify(body.messages).includes("toolu_fixture_image")
              ? {
                  id: "toolu_fixture_image",
                  name: "Read",
                  input: { file_path: attachmentPaths[1] },
                }
              : undefined;
        const message = {
          id: `msg_fixture_${requests.length}`,
          type: "message",
          role: "assistant",
          model: body.model,
          content: tool
            ? [{ type: "tool_use", ...tool }]
            : [{ type: "text", text: "Reply from the local fixture." }],
          stop_reason: tool ? "tool_use" : "end_turn",
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
            content_block: tool
              ? { type: "tool_use", id: tool.id, name: tool.name, input: {} }
              : { type: "text", text: "" },
          },
          {
            type: "content_block_delta",
            index: 0,
            delta: tool
              ? {
                  type: "input_json_delta",
                  partial_json: JSON.stringify(tool.input),
                }
              : { type: "text_delta", text: message.content[0].text },
          },
          { type: "content_block_stop", index: 0 },
          {
            type: "message_delta",
            delta: { stop_reason: message.stop_reason, stop_sequence: null },
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
    const referenceHost = process.env.MONOCODE_INTERACTIVE_TEST_NODE_PTY_ROOT;
    const driver = spawn(
      referenceHost ? process.execPath : (nativeHost ?? "python3"),
      referenceHost
        ? [
            fileURLToPath(
              new URL(
                "./fixtures/interactive-node-pty-host.mjs",
                import.meta.url,
              ),
            ),
          ]
        : nativeHost
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
      { resolve: (delay?: number) => void; reject: (error: Error) => void }
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
        delayMs?: number;
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
        else waiter?.resolve(value.delayMs);
      }
    });
    const rpc = async (
      command: string,
      args: Record<string, unknown> = {},
    ): Promise<number | undefined> => {
      const serial = ++requestId;
      return new Promise<number | undefined>((resolve, reject) => {
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
    const repaintProbes: unknown[] = [];
    ipc.invoke
      .mockReset()
      .mockImplementation(
        async (command: string, args: Record<string, unknown>) => {
          if (command === "claude_interactive_start") {
            const input = args.input as Record<string, unknown>;
            starts.push(input);
            phase = "ready";
            skipForkHistory = !!input.fork;
            output = Buffer.alloc(0);
            transcriptOffset =
              input.resume && transcriptPath
                ? (await stat(transcriptPath)).size
                : 0;
            const settings = {
              hooks: Object.fromEntries(
                [
                  "SessionStart",
                  "UserPromptSubmit",
                  "Stop",
                  "PreCompact",
                  "PostCompact",
                  "SubagentStart",
                  "SubagentStop",
                  "TaskCreated",
                  "TaskCompleted",
                  "PreToolUse",
                  "PostToolUse",
                  "Notification",
                ].map((name) => [
                  name,
                  [
                    {
                      matcher: "*",
                      hooks: [
                        {
                          type: "http",
                          url: `${url}/hook/${starts.length}-${String(input.nativeId)}`,
                          timeout: 10,
                        },
                      ],
                    },
                  ],
                ]),
              ),
              fastMode: input.fast,
              promptSuggestionEnabled: false,
            };
            const fork = input.fork as
              { sourceProviderSessionId: string } | undefined;
            if (
              referenceHost ||
              process.env.MONOCODE_CONPTY_PROBE_FLAGS === "0"
            ) {
              const terminal = interactiveTerminalFor(id)!.term;
              // Non-inheriting consoles have no Rust-preanswered cursor query.
              terminal.parser.registerCsiHandler({ final: "n" }, (params) => {
                if (params.length === 1 && params[0] === 6) {
                  const buffer = terminal.buffer.active;
                  const data = `\x1b[${buffer.cursorY + 1};${buffer.cursorX + 1}R`;
                  passiveReplies.push(data);
                  void rpc("write", { data });
                  return true;
                }
                return false;
              });
            }
            if (referenceHost) {
              // Orca's native-ConPTY primary device response, owned once here.
              interactiveTerminalFor(id)?.term.parser.registerCsiHandler(
                { final: "c" },
                (params) => {
                  if (
                    params.length === 0 ||
                    (params.length === 1 && params[0] === 0)
                  ) {
                    passiveReplies.push("\x1b[?61;4c");
                    void rpc("write", { data: "\x1b[?61;4c" });
                    return true;
                  }
                  return false;
                },
              );
            }
            await rpc("start", {
              argv: [
                process.env.MONOCODE_INTERACTIVE_TEST_CLI,
                input.resume || fork ? "--resume" : "--session-id",
                fork?.sourceProviderSessionId ?? input.nativeId,
                ...(fork
                  ? ["--fork-session", "--session-id", input.nativeId]
                  : []),
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
            if (transcriptPath && !skipForkHistory) {
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
          if (command === "claude_interactive_attachments") {
            const files = args.attachments as { data: string; kind: string }[];
            const dir = join(root, "attachments");
            await mkdir(dir, { recursive: true });
            attachmentPaths.length = 0;
            for (const [index, file] of files.entries()) {
              const path = join(
                dir,
                `fixture-${index}.${file.kind === "image" ? "png" : "txt"}`,
              );
              await writeFile(path, Buffer.from(file.data, "base64"));
              attachmentPaths.push(path);
            }
            return [...attachmentPaths];
          }
          if (command === "claude_interactive_send") {
            sends.push(String(args.text));
            await rpc("paste", { data: String(args.text) });
            return rpc("paste-settle");
          }
          if (command === "claude_interactive_submit") {
            if (args.action === "enter") return rpc("write", { data: "\r" });
            if (args.action === "repaste") {
              await rpc("paste", { data: sends.at(-1)! });
              return rpc("paste-settle");
            }
            return undefined;
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
        "Dense single-line request " + "context ".repeat(300).trimEnd(),
        "Long Unicode request 你好 नमस्ते\nLine 2\nLine 3\nLine 4\nLine 5",
        "\n\t!नमस्ते\nLine 2\nLine 3\nLine 4\nLine 5",
        "create a new branch in the current checkout\n" +
          Array.from(
            { length: 12 },
            (_, index) =>
              `Paragraph ${index + 1}: discuss the animated onboarding walkthrough, reusable dashboard styles and implementation choices before changing code.`,
          ).join("\n"),
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
      const nativeMessages = messages.map((text) =>
        text.replaceAll("\t", "    "),
      );
      expect(sends).toEqual(nativeMessages);
      expect(acceptedPrompts).toHaveLength(nativeMessages.length);
      expect(
        acceptedPrompts.every((text, index) =>
          interactivePromptMatches(nativeMessages[index], text),
        ),
      ).toBe(true);
      expect(accepted).toHaveBeenCalledTimes(messages.length);
      expect(nativeInput).toEqual([]);
      expect(
        events.filter((event) => event.type === "externalTurn.started"),
      ).toEqual([]);
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
      // Native resume reuses the recorded system/tool prefix; no summary or
      // added system instructions are introduced by our idle-stop path.
      expect(requestPrefixes[2] === requestPrefixes[0]).toBe(true);
      const savedUserConfig = JSON.parse(
        await readFile(join(config, ".claude.json"), "utf8"),
      ) as { promptSuggestionEnabled?: boolean };
      expect(savedUserConfig.promptSuggestionEnabled).toBe(true);
      if (process.env.MONOCODE_INTERACTIVE_TEST_MESSAGES_ONLY === "1") return;
      const compactInput: SendTurnInput = {
        sessionId: id,
        cwd,
        model: "claude:sonnet-5-5",
        runtimeMode,
        modelSettings: { claudeExecution: "interactive", effort: "low" },
        text: "/compact",
        onEvent: (event): void => {
          events.push(event);
        },
      };
      const sourceId = String(starts[0].nativeId);
      await forgetInteractiveClaude(id);
      await sendInteractiveClaude({
        ...compactInput,
        text: "After native fork",
        fork: {
          sourceProviderSessionId: sourceId,
        },
      });
      expect(starts[2].nativeId).not.toBe(sourceId);
      expect(
        observedHookRows.find(
          (row) =>
            row.hook_event_name === "UserPromptSubmit" &&
            row.prompt === "After native fork",
        )?.session_id,
      ).toBe(starts[2].nativeId);
      expect(acceptedPrompts.at(-1)).toBe("After native fork");
      expect(
        events.filter((event) => event.type === "message.delta").at(-1),
      ).toMatchObject({ text: "Reply from the local fixture." });
      const forkMessages = requestMessages.at(-1)!;
      expect(forkMessages).toContain("Radhe Radhe");
      expect(forkMessages).toContain("Line one");
      expect(forkMessages).toContain("One more resumed turn");
      await compactInteractiveClaude(compactInput);
      expect(observedHooks).toContain("PreCompact");
      expect(observedHooks).toContain("PostCompact");

      const image = await readFile(
        fileURLToPath(
          new URL("../../../../../src-tauri/icons/32x32.png", import.meta.url),
        ),
      );
      await sendInteractiveClaude({
        ...compactInput,
        text: "Read fixture attachments",
        attachments: [
          {
            id: "text",
            name: "notes.md",
            kind: "file",
            mimeType: "text/markdown",
            size: 23,
            data: Buffer.from("fixture attachment body").toString("base64"),
          },
          {
            id: "image",
            name: "icon.png",
            kind: "image",
            mimeType: "image/png",
            size: image.length,
            data: image.toString("base64"),
          },
        ],
      });
      expect(
        requestMessages.some((text) =>
          text.includes("fixture attachment body"),
        ),
      ).toBe(true);
      expect(sawAttachedImage).toBe(true);
      const externalBefore = events.filter(
        (event) => event.type === "externalTurn.finished",
      ).length;
      await sendInteractiveClaude({
        ...compactInput,
        text: "Run background fixture command",
      });
      const acceptedBefore = acceptedPrompts.length;
      const deadline = Date.now() + 20000;
      while (
        Date.now() < deadline &&
        events.filter((event) => event.type === "externalTurn.finished")
          .length === externalBefore
      )
        await new Promise((resolve) => setTimeout(resolve, 100));
      expect(acceptedPrompts.length).toBe(acceptedBefore);
      const ordinarySends = sends.filter((text) => text !== "/compact");
      expect(acceptedPrompts).toHaveLength(ordinarySends.length);
      expect(
        acceptedPrompts.every((text, index) =>
          interactivePromptMatches(ordinarySends[index], text),
        ),
      ).toBe(true);
      expect(
        events.filter((event) => event.type === "externalTurn.finished").length,
      ).toBeGreaterThan(externalBefore);
    } catch (error) {
      if (process.platform === "win32") {
        const terminal = interactiveTerminalFor(id);
        if (terminal && !terminal.stopped) {
          for (const [cols, rows] of [
            [82, 22],
            [120, 39],
            [80, 24],
            [160, 50],
            [120, 40],
          ]) {
            await terminal.resize(cols, rows);
            await new Promise((resolve) => setTimeout(resolve, 1500));
            const buffer = terminal.term.buffer.active;
            repaintProbes.push({
              cols,
              rows,
              readiness: terminal.inspect(),
              screen: Array.from(
                { length: rows },
                (_, y) =>
                  buffer.getLine(buffer.baseY + y)?.translateToString(true) ??
                  "",
              ),
            });
          }
        }
      }
      throw error;
    } finally {
      const capture = process.env.MONOCODE_INTERACTIVE_TEST_CAPTURE_DIR;
      if (capture) {
        await mkdir(capture, { recursive: true });
        await Promise.all([
          writeFile(join(capture, `${runtimeMode}.vt`), output),
          writeFile(
            join(capture, `${runtimeMode}.jsonl`),
            transcriptPath
              ? await readFile(transcriptPath).catch(() => Buffer.alloc(0))
              : Buffer.alloc(0),
          ),
          writeFile(
            join(capture, `${runtimeMode}.json`),
            JSON.stringify(
              {
                readiness: interactiveClaudeDiagnostics(id),
                passiveReplies,
                nativeInput,
                acceptedPrompts,
                observedHooks,
                observedHookRows,
                starts,
                requestPrefixes,
                apiRequests: requests.length,
                primaryRequests: requestPrefixes.length,
                repaintProbes,
                referenceBackend: referenceHost
                  ? "node-pty-bundled"
                  : undefined,
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
  120000,
);

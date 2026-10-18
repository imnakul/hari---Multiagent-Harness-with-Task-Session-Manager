import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  HarnessNeedsAttentionError,
  type SendTurnInput,
  type HarnessEvent,
} from "../../core/types";
import { appendUser, applyHarnessEvent, stopStreaming } from "../../core/apply";
import { newSession } from "../../../../features/sessions/model/session";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  isTauri: vi.fn(() => true),
  headless: vi.fn(() => false),
  resolve: vi.fn(async () => ({ path: "/fake/claude" })),
  ready: vi.fn(() => true),
  owner: false,
  inputAge: null as number | null,
  starts: [] as Record<string, unknown>[],
  hooks: [] as Record<string, unknown>[],
  lines: [] as string[],
  parked: false,
  sends: [] as string[],
  sendError: false,
  seq: 0,
  exit: undefined as ((code: number | null) => void) | undefined,
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
  isTauri: mocks.isTauri,
}));
vi.mock("../../core/child", () => ({
  hasHeadlessChildBackend: mocks.headless,
  resolveClaudeBinary: mocks.resolve,
}));
vi.mock("./claudeInteractiveTerminal", () => ({
  createInteractiveTerminal: async (
    _id: string,
    onExit: (code: number | null) => void,
  ) => {
    mocks.exit = onExit;
    return {
      get owner(): boolean {
        return mocks.owner;
      },
      set owner(value: boolean) {
        mocks.owner = value;
      },
      ready: mocks.ready,
      inspect: () => ({
        reason: mocks.ready() ? "ready" : "prompt-mismatch",
        receivedBytes: 20,
        outputAgeMs: 1000,
        inputAgeMs: mocks.inputAge,
        inputOwner: mocks.owner,
      }),
      reclaim: vi.fn(async (): Promise<void> => {
        mocks.owner = false;
      }),
      dispose: vi.fn(),
      writing: false,
      stopped: false,
      started: vi.fn(),
    };
  },
}));
const {
  sendInteractiveClaude,
  stopInteractiveClaude,
  forgetInteractiveClaude,
  bindInteractiveClaude,
  replyInteractiveClaude,
  hasInteractiveClaude,
  interactiveClaudeDiagnostics,
  parkInteractiveClaude,
} = await import("./claudeInteractive");

let events: HarnessEvent[];
let onAccepted: ReturnType<typeof vi.fn>;
function input(overrides: Partial<SendTurnInput> = {}): SendTurnInput {
  return {
    sessionId: "interactive-test",
    cwd: "/repo",
    model: "claude:sonnet-5",
    modelSettings: { claudeExecution: "interactive", effort: "medium" },
    runtimeMode: "supervised",
    text: "first line\nsecond line",
    onEvent: (event): void => {
      events.push(event);
    },
    onAccepted,
    ...overrides,
  };
}
async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(250);
}
async function waitFor(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 12 && !predicate(); i++) await settle();
  expect(predicate()).toBe(true);
}
function hook(
  hook_event_name: string,
  extra: Record<string, unknown> = {},
): void {
  mocks.hooks.push({ hook_event_name, bridgeId: ++mocks.seq, ...extra });
}
function finish(): void {
  hook("Stop", { background_tasks: [], session_crons: [] });
}

beforeEach(() => {
  vi.useFakeTimers();
  events = [];
  onAccepted = vi.fn();
  mocks.owner = false;
  mocks.inputAge = null;
  mocks.sendError = false;
  mocks.seq = 0;
  mocks.starts = [];
  mocks.hooks = [];
  mocks.lines = [];
  mocks.parked = false;
  mocks.sends = [];
  mocks.ready.mockReturnValue(true);
  mocks.isTauri.mockReturnValue(true);
  mocks.headless.mockReturnValue(false);
  mocks.resolve.mockReset().mockResolvedValue({ path: "/fake/claude" });
  mocks.invoke.mockReset();
  mocks.invoke.mockImplementation(
    async (command: string, args: Record<string, unknown>) => {
      if (command === "claude_interactive_start") {
        mocks.starts.push(args.input as Record<string, unknown>);
        // Real CLI 2.1.301 does not emit an HTTP SessionStart hook.
      }
      if (command === "claude_interactive_poll") {
        const rows = mocks.hooks.splice(0);
        const last = rows.at(-1)?.hook_event_name;
        return {
          phase: last === "UserPromptSubmit" ? "busy" : "ready",
          terminalOwner: mocks.owner,
          events: rows,
          sequence: mocks.seq,
          lines: mocks.lines.splice(0),
          more: false,
        };
      }
      if (command === "claude_interactive_send") {
        mocks.sends.push(String(args.text));
        if (mocks.sendError) throw new Error("IPC disconnected after write");
        hook("UserPromptSubmit", { prompt: args.text });
      }
      if (command === "claude_interactive_park") return mocks.parked;
      if (command === "claude_interactive_attachments")
        return ["/saved/one.txt"];
      return undefined;
    },
  );
});
afterEach(async () => {
  await forgetInteractiveClaude("interactive-test");
  vi.useRealTimers();
});

describe("interactive turn delivery", () => {
  it("honors Stop while binary discovery is still pending", async () => {
    let release: (value: { path: string }) => void = () => undefined;
    mocks.resolve.mockImplementationOnce(
      () =>
        new Promise<{ path: string }>((resolve) => {
          release = resolve;
        }),
    );
    const turn = sendInteractiveClaude(input()).catch(
      (error: unknown) => error,
    );
    await waitFor(() => mocks.resolve.mock.calls.length === 1);
    await stopInteractiveClaude("interactive-test");
    release({ path: "/fake/claude" });
    expect(String(await turn)).toContain("cancelled");
    expect(mocks.starts).toHaveLength(0);
    expect(mocks.sends).toHaveLength(0);
  });

  it("does not send if Stop races the backend spawn acknowledgement", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const original = mocks.invoke.getMockImplementation()!;
    mocks.invoke.mockImplementation(
      async (command: string, args: Record<string, unknown>) => {
        if (command === "claude_interactive_start") await gate;
        return original(command, args);
      },
    );
    const turn = sendInteractiveClaude(input()).catch(
      (error: unknown) => error,
    );
    await waitFor(() =>
      mocks.invoke.mock.calls.some(
        ([command]) => command === "claude_interactive_start",
      ),
    );
    await stopInteractiveClaude("interactive-test");
    release();
    expect(String(await turn)).toContain("cancelled");
    expect(mocks.sends).toHaveLength(0);
  });

  it.each(["first line\nsecond line", "Tabbed\tline\n\tIndented"])(
    "submits multiline input once and confirms native tab expansion (%s)",
    async (text) => {
      const turn = sendInteractiveClaude(input({ text }));
      await waitFor(() => mocks.sends.length === 1);
      await settle();
      expect(onAccepted).toHaveBeenCalledTimes(1);
      finish();
      await vi.advanceTimersByTimeAsync(1000);
      await turn;
      expect(mocks.sends).toEqual([text.replaceAll("\t", "    ")]);
      expect(mocks.starts[0]).toMatchObject({
        resume: false,
        model: "claude-sonnet-5",
        effort: "medium",
        permissionMode: "default",
      });
      expect(
        events.some((event) => event.type === "session.providerBound"),
      ).toBe(true);
    },
  );
  it("does not retry an uncertain write, even when another send is attempted", async () => {
    mocks.sendError = true;
    const turn = sendInteractiveClaude(input()).catch(
      (error: unknown) => error,
    );
    await waitFor(() => mocks.sends.length === 1);
    expect(String(await turn)).toContain("unconfirmed");
    expect(await turn).toBeInstanceOf(HarnessNeedsAttentionError);
    expect(hasInteractiveClaude("interactive-test")).toBe(true);
    await expect(sendInteractiveClaude(input())).rejects.toThrow("unconfirmed");
    expect(mocks.sends).toHaveLength(1);
    expect(onAccepted).not.toHaveBeenCalled();
  });
  it.each([
    "plain",
    "native",
    "native-with-attachments",
    "native-with-text-attachment",
  ] as const)(
    "keeps a folded paste in its original GUI turn and times the complete response (%s)",
    async (format) => {
      vi.setSystemTime(1_000);
      const text =
        "Students list page\nCheck the pagination controls and ranking.\nSee the attached screenshot.";
      const attachments: SendTurnInput["attachments"] =
        format === "native-with-attachments" ||
        format === "native-with-text-attachment"
          ? [
              {
                id: "screen",
                kind: format === "native-with-attachments" ? "image" : "file",
                name:
                  format === "native-with-attachments"
                    ? "screen.png"
                    : "notes.txt",
                mimeType:
                  format === "native-with-attachments"
                    ? "image/png"
                    : "text/plain",
                size: 1,
                data: "AA==",
              },
            ]
          : undefined;
      const submitted = attachments
        ? `${text}\n\nRead these attached files using your tools:\n"${attachments[0].name}": "/saved/one.txt"`
        : text;
      let session = appendUser(
        newSession("claude", "/repo"),
        text,
        attachments,
      );
      let endedAt = 0;
      const original = mocks.invoke.getMockImplementation()!;
      mocks.invoke.mockImplementation(
        async (command: string, args: Record<string, unknown>) => {
          if (command === "claude_interactive_send") {
            mocks.sends.push(String(args.text));
            return;
          }
          return original(command, args);
        },
      );
      const turn = sendInteractiveClaude(
        input({
          text,
          attachments,
          onEvent: (event): void => {
            events.push(event);
            session = applyHarnessEvent(session, event);
          },
        }),
      ).then(
        () => {
          endedAt = Date.now();
          session = stopStreaming(session);
        },
        (error: unknown) => {
          session = stopStreaming(session);
          return error;
        },
      );
      await waitFor(() => mocks.sends.length === 1);
      await vi.advanceTimersByTimeAsync(8_000);
      hook("UserPromptSubmit", {
        prompt: `S\n\n<pasted_content id="7f52">\n${submitted.slice(1)}\n${format === "plain" ? "</pasted_content>" : '</pasted_content id="7f52">\n'}`,
      });
      await waitFor(() => onAccepted.mock.calls.length === 1);
      expect(session.blocks[0]).toMatchObject({ text, startedAt: 1_000 });
      expect(session.blocks[0].durationMs).toBeUndefined();
      mocks.lines.push(
        JSON.stringify({
          type: "assistant",
          uuid: "long-paste-reply",
          message: { content: [{ type: "text", text: "One " }] },
        }),
      );
      await settle();
      expect(session.blocks.at(-1)?.text).toBe("One ");
      expect(session.blocks[0].durationMs).toBeUndefined();
      await vi.advanceTimersByTimeAsync(8_000);
      mocks.lines.push(
        JSON.stringify({
          type: "assistant",
          uuid: "long-paste-reply",
          message: { content: [{ type: "text", text: "One complete reply" }] },
        }),
      );
      finish();
      await vi.advanceTimersByTimeAsync(1_000);
      expect(await turn).toBeUndefined();
      expect(mocks.sends).toEqual([submitted]);
      expect(onAccepted).toHaveBeenCalledTimes(1);
      expect(
        events.filter((event) => event.type === "externalTurn.started"),
      ).toEqual([]);
      expect(
        session.blocks.filter((block) => block.role === "user"),
      ).toHaveLength(1);
      expect(
        session.blocks
          .filter((block) => block.role === "assistant")
          .map((block) => block.text),
      ).toEqual(["One complete reply"]);
      expect(session.blocks[0]).toMatchObject({
        text,
        startedAt: 1_000,
        durationMs: endedAt - 1_000,
      });
      expect(session.blocks[0].durationMs).toBeGreaterThan(16_000);
      expect(session.blocks[0].attachments).toEqual(attachments);
      expect(session.busy).toBe(false);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(session.blocks[0].durationMs).toBe(endedAt - 1_000);
    },
  );
  it("still refuses a native paste whose expanded body differs from the pending prompt", async () => {
    const text = "create a branch\nDiscuss first";
    const original = mocks.invoke.getMockImplementation()!;
    mocks.invoke.mockImplementation(
      async (command: string, args: Record<string, unknown>) => {
        if (command === "claude_interactive_send") {
          mocks.sends.push(String(args.text));
          hook("UserPromptSubmit", {
            prompt:
              'c\n\n<pasted_content id="faa9">\nreate a worktree\nDiscuss first\n</pasted_content>',
          });
          return;
        }
        return original(command, args);
      },
    );
    const turn = sendInteractiveClaude(input({ text })).catch(
      (error: unknown) => error,
    );
    await waitFor(() => mocks.sends.length === 1);
    await settle();
    expect(String(await turn)).toContain("different input");
    expect(onAccepted).not.toHaveBeenCalled();
    expect(mocks.sends).toEqual([text]);
  });
  it("does not submit into a menu or terminal draft", async () => {
    mocks.ready.mockReturnValue(false);
    const turn = sendInteractiveClaude(input()).catch(
      (error: unknown) => error,
    );
    await vi.advanceTimersByTimeAsync(21000);
    expect(String(await turn)).toContain("No prompt was sent");
    expect(mocks.sends).toHaveLength(0);
    expect(await turn).toBeInstanceOf(HarnessNeedsAttentionError);
    expect(hasInteractiveClaude("interactive-test")).toBe(true);
    expect(
      interactiveClaudeDiagnostics("interactive-test")?.lastBlocked,
    ).toMatchObject({
      phase: "ready",
      terminal: { reason: "prompt-mismatch" },
    });
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "diagnostic.lifecycle",
        operation: "interactive-readiness",
      }),
    );
    expect(
      mocks.invoke.mock.calls.some(
        ([command]) => command === "claude_interactive_stop",
      ),
    ).toBe(false);
    // After setup is completed, retry reuses the existing process once.
    mocks.ready.mockReturnValue(true);
    expect(
      interactiveClaudeDiagnostics("interactive-test")?.current.terminal.reason,
    ).toBe("ready");
    expect(
      interactiveClaudeDiagnostics("interactive-test")?.lastBlocked?.terminal
        .reason,
    ).toBe("prompt-mismatch");
    const retry = sendInteractiveClaude(input());
    await waitFor(() => onAccepted.mock.calls.length === 1);
    finish();
    await vi.advanceTimersByTimeAsync(1000);
    await retry;
    expect(mocks.starts).toHaveLength(1);
    expect(mocks.sends).toHaveLength(1);
  });
  it("reports native exit immediately instead of masking it with a readiness timeout", async () => {
    mocks.ready.mockReturnValue(false);
    const turn = sendInteractiveClaude(input()).catch(
      (error: unknown) => error,
    );
    await waitFor(() => mocks.starts.length === 1);
    mocks.exit?.(7);
    await settle();
    expect(String(await turn)).toContain("exited (code 7)");
    expect(mocks.sends).toHaveLength(0);
  });
  it("takes input back from an idle, empty native prompt and sends", async () => {
    mocks.owner = true;
    const turn = sendInteractiveClaude(input());
    await waitFor(() => onAccepted.mock.calls.length === 1);
    finish();
    await vi.advanceTimersByTimeAsync(1000);
    await turn;
    expect(mocks.owner).toBe(false);
    expect(mocks.sends).toHaveLength(1);
  });
  it("does not take input back before a fresh keystroke has redrawn the prompt", async () => {
    mocks.owner = true;
    mocks.inputAge = 200;
    await expect(sendInteractiveClaude(input())).rejects.toThrow(
      "Return to chat",
    );
    expect(mocks.owner).toBe(true);
    expect(mocks.sends).toHaveLength(0);
  });
  it("still requires Return to chat while the native terminal holds a draft", async () => {
    mocks.owner = true;
    mocks.ready.mockReturnValue(false);
    await expect(sendInteractiveClaude(input())).rejects.toThrow(
      "Return to chat",
    );
    expect(mocks.owner).toBe(true);
    expect(mocks.sends).toHaveLength(0);
  });
  it("stops before native resume when model settings change", async () => {
    const first = sendInteractiveClaude(input());
    await waitFor(() => onAccepted.mock.calls.length === 1);
    finish();
    await vi.advanceTimersByTimeAsync(1000);
    await first;
    const nativeId = mocks.starts[0].nativeId;
    const second = sendInteractiveClaude(input({ model: "claude:opus-5-5" }));
    await waitFor(() => mocks.sends.length === 2);
    finish();
    await vi.advanceTimersByTimeAsync(1000);
    await second;
    expect(mocks.starts[1]).toMatchObject({
      resume: true,
      nativeId,
      model: "claude-opus-5-5",
    });
    const calls = mocks.invoke.mock.calls.map(([command]) => command);
    expect(calls.indexOf("claude_interactive_stop")).toBeLessThan(
      calls.lastIndexOf("claude_interactive_start"),
    );
  });
  it("fails remote/headless mode before launching a local process", async () => {
    mocks.headless.mockReturnValue(true);
    await expect(sendInteractiveClaude(input())).rejects.toThrow(
      "local desktop",
    );
    expect(mocks.starts).toHaveLength(0);
  });
  it("retains native identity after stop without summary transfer", async () => {
    bindInteractiveClaude("interactive-test", "saved-native", "/repo");
    const turn = sendInteractiveClaude(input());
    await waitFor(() => onAccepted.mock.calls.length === 1);
    expect(mocks.starts[0]).toMatchObject({
      resume: true,
      nativeId: "saved-native",
    });
    const failure = turn.catch((error: unknown) => error);
    await stopInteractiveClaude("interactive-test");
    expect(String(await failure)).toContain("stopped");
  });
  it("routes approvals by hook request identity and never sends chat as an answer", async () => {
    const turn = sendInteractiveClaude(input());
    await waitFor(() => onAccepted.mock.calls.length === 1);
    hook("PermissionRequest", {
      tool_name: "Bash",
      tool_use_id: "tool-1",
      tool_input: { command: "echo hello" },
    });
    await settle();
    const approval = events.find(
      (event) => event.type === "approval.requested",
    );
    if (approval?.type !== "approval.requested") throw new Error("No approval");
    await replyInteractiveClaude(
      "interactive-test",
      approval.requestId,
      "allow",
    );
    expect(mocks.invoke).toHaveBeenCalledWith(
      "claude_interactive_reply",
      expect.objectContaining({
        requestId: approval.requestId,
        behavior: "allow",
      }),
    );
    expect(mocks.sends).toHaveLength(1);
    finish();
    await vi.advanceTimersByTimeAsync(1000);
    await turn;
  });
  it("answers AskUserQuestion through its PreToolUse hook without terminal text injection", async () => {
    const turn = sendInteractiveClaude(input());
    await waitFor(() => onAccepted.mock.calls.length === 1);
    hook("PreToolUse", {
      tool_name: "AskUserQuestion",
      tool_input: {
        questions: [
          {
            question: "Which color?",
            header: "Color",
            options: [
              { label: "Blue", description: "Blue" },
              { label: "Green", description: "Green" },
            ],
            multiSelect: false,
          },
        ],
      },
    });
    await settle();
    const event = events.find((item) => item.type === "question.asked");
    if (event?.type !== "question.asked") throw new Error("No question");
    const question = event.questions[0];
    await replyInteractiveClaude("interactive-test", event.requestId, "allow", {
      kind: "answered",
      answers: { [question.id]: [question.options[0].id] },
    });
    expect(mocks.invoke).toHaveBeenCalledWith(
      "claude_interactive_reply",
      expect.objectContaining({
        updatedInput: expect.objectContaining({
          answers: { "Which color?": "Blue" },
        }),
      }),
    );
    expect(mocks.sends).toHaveLength(1);
    finish();
    await vi.advanceTimersByTimeAsync(1000);
    await turn;
  });
  it("ends a failed native turn without treating it as a successful reply", async () => {
    const turn = sendInteractiveClaude(input()).catch(
      (error: unknown) => error,
    );
    await waitFor(() => onAccepted.mock.calls.length === 1);
    hook("StopFailure", { error: "API request failed" });
    await settle();
    expect(String(await turn)).toContain("API request failed");
    expect(mocks.sends).toHaveLength(1);
  });
});

describe("interactive observation and parking", () => {
  it("waits for the Stop hook's final reply when native JSONL flushes late", async () => {
    let finished = false;
    const turn = sendInteractiveClaude(input()).then(() => {
      finished = true;
    });
    await waitFor(() => onAccepted.mock.calls.length === 1);
    hook("Stop", {
      last_assistant_message: "Late final reply",
      background_tasks: [],
      session_crons: [],
    });
    await vi.advanceTimersByTimeAsync(3000);
    expect(finished).toBe(false);
    mocks.lines.push(
      JSON.stringify({
        type: "assistant",
        uuid: "late-final",
        message: { content: [{ type: "text", text: "Late final reply" }] },
      }),
    );
    await vi.advanceTimersByTimeAsync(1000);
    await turn;
    expect(events.filter((e) => e.type === "externalTurn.started")).toEqual([]);
    expect(events).toContainEqual({
      type: "message.delta",
      text: "Late final reply",
    });
  });
  async function idle(): Promise<void> {
    const turn = sendInteractiveClaude(input());
    await waitFor(() => onAccepted.mock.calls.length === 1);
    finish();
    await vi.advanceTimersByTimeAsync(3000);
    await turn;
  }
  it("retains an autonomous Stop before its transcript without UserPromptSubmit", async () => {
    await idle();
    hook("Stop", {
      last_assistant_message: "Automatic reply",
      background_tasks: [],
      session_crons: [],
    });
    await vi.advanceTimersByTimeAsync(3000);
    mocks.lines.push(
      JSON.stringify({
        type: "assistant",
        uuid: "late-automatic",
        message: { content: [{ type: "text", text: "Automatic reply" }] },
      }),
    );
    await vi.advanceTimersByTimeAsync(1000);
    expect(events).toContainEqual(
      expect.objectContaining({ type: "externalTurn.started" }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({ type: "externalTurn.finished" }),
    );
    expect(
      interactiveClaudeDiagnostics("interactive-test")?.current.externalTurn,
    ).toBe(false);
  });
  it("suppresses ordinary idle notifications and preserves genuine attention", async () => {
    await idle();
    hook("Notification", {
      notification_type: "idle_prompt",
      message: "Claude is waiting for your input",
    });
    hook("Notification", {
      notification_type: "auth_success",
      message: "Sign-in complete",
    });
    await vi.advanceTimersByTimeAsync(1600);
    expect(events).not.toContainEqual({
      type: "status",
      text: "Claude is waiting for your input",
    });
    expect(events).toContainEqual({ type: "status", text: "Sign-in complete" });
  });
  it("slows idle polling, wakes immediately on send, and follows autonomous replies", async () => {
    await idle();
    const calls = (): number =>
      mocks.invoke.mock.calls.filter(
        ([cmd]) => cmd === "claude_interactive_poll",
      ).length;
    const before = calls();
    await vi.advanceTimersByTimeAsync(6000);
    expect(calls() - before).toBe(4);
    hook("SubagentStart", { agent_id: "agent-1" });
    await vi.advanceTimersByTimeAsync(1500);
    const active = calls();
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls() - active).toBe(5);
    hook("SubagentStop", { agent_id: "agent-1" });
    mocks.lines.push(
      JSON.stringify({
        type: "assistant",
        uuid: "automatic-1",
        message: {
          content: [{ type: "text", text: "Background work completed." }],
        },
      }),
    );
    finish();
    await vi.advanceTimersByTimeAsync(1000);
    const start = events.findIndex((e) => e.type === "externalTurn.started");
    const text = events.findIndex(
      (e) =>
        e.type === "externalTurn.event" && e.event.type === "message.delta",
    );
    expect(start).toBeGreaterThan(-1);
    expect(text).toBeGreaterThan(start);
    expect(events).toContainEqual(
      expect.objectContaining({ type: "externalTurn.finished" }),
    );
    const count = calls();
    const next = sendInteractiveClaude(input({ text: "next" }));
    await vi.advanceTimersByTimeAsync(1);
    expect(calls()).toBeGreaterThan(count);
    await waitFor(() => onAccepted.mock.calls.length === 2);
    finish();
    await vi.advanceTimersByTimeAsync(1000);
    await next;
  });
  it("keeps background completion from failing an accepted prompt during final drain", async () => {
    const turn = sendInteractiveClaude(input());
    await waitFor(() => onAccepted.mock.calls.length === 1);
    hook("Stop", {
      background_tasks: [{ id: "shell1", status: "running" }],
      session_crons: [],
    });
    const notification =
      "<task-notification>\n<task-id>shell1</task-id>\n<status>completed</status>\n</task-notification>";
    hook("UserPromptSubmit", { prompt: notification });
    hook("Stop", { background_tasks: [], session_crons: [] });
    mocks.lines.push(
      JSON.stringify({
        type: "assistant",
        uuid: "first-final",
        message: { content: [{ type: "text", text: "Initial reply" }] },
      }),
      JSON.stringify({
        type: "user",
        uuid: "notification",
        message: { content: notification },
      }),
      JSON.stringify({
        type: "assistant",
        uuid: "automatic-final",
        message: { content: [{ type: "text", text: "Background reply" }] },
      }),
    );
    await vi.advanceTimersByTimeAsync(1000);
    await turn;
    expect(events).toContainEqual({
      type: "message.delta",
      text: "Initial reply",
    });
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "externalTurn.event",
        event: { type: "message.delta", text: "Background reply" },
      }),
    );
    expect(events.some((event) => event.type === "session.error")).toBe(false);
    expect(onAccepted).toHaveBeenCalledTimes(1);
  });
  it("explicit bulk idle Stop uses all safety gates without waiting for the auto-shutdown interval", async () => {
    await idle();
    mocks.parked = true;
    expect(await parkInteractiveClaude("interactive-test", 0, true)).toBe(true);
    expect(mocks.invoke).toHaveBeenCalledWith(
      "claude_interactive_park",
      expect.objectContaining({ minutes: 0, explicitIdleStop: true }),
    );
    expect(hasInteractiveClaude("interactive-test")).toBe(false);
  });
  it("parks after the configured idle interval and resumes the same native identity", async () => {
    mocks.parked = true;
    await idle();
    await vi.advanceTimersByTimeAsync(15 * 60000 + 2000);
    expect(hasInteractiveClaude("interactive-test")).toBe(false);
    const next = sendInteractiveClaude(input({ text: "after parking" }));
    await waitFor(() => onAccepted.mock.calls.length === 2);
    finish();
    await vi.advanceTimersByTimeAsync(1000);
    await next;
    expect(mocks.starts[1]).toMatchObject({
      nativeId: mocks.starts[0].nativeId,
      resume: true,
    });
  });
  it.each([
    "subagent",
    "uncertain background",
    "draft",
    "terminal",
    "question",
  ])("does not park with %s", async (reason) => {
    mocks.parked = true;
    await idle();
    if (reason === "subagent") hook("SubagentStart", { agent_id: "busy" });
    if (reason === "uncertain background")
      hook("PreToolUse", {
        tool_name: "Bash",
        tool_input: { run_in_background: true },
      });
    if (reason === "draft") mocks.ready.mockReturnValue(false);
    if (reason === "terminal") mocks.owner = true;
    if (reason === "question")
      hook("PreToolUse", { tool_name: "AskUserQuestion", tool_input: {} });
    await vi.advanceTimersByTimeAsync(16 * 60000);
    expect(
      mocks.invoke.mock.calls.some(
        ([cmd]) => cmd === "claude_interactive_park",
      ),
    ).toBe(false);
    expect(hasInteractiveClaude("interactive-test")).toBe(true);
  });
  it("does not restart for model changes or compact while background work owns context", async () => {
    await idle();
    hook("SubagentStart", { agent_id: "still-working" });
    await vi.advanceTimersByTimeAsync(1600);
    const stops = mocks.invoke.mock.calls.filter(
      ([cmd]) => cmd === "claude_interactive_stop",
    ).length;
    await expect(
      sendInteractiveClaude(input({ model: "claude:opus-5-5" })),
    ).rejects.toThrow("idle native prompt");
    await expect(
      sendInteractiveClaude(input({ text: "/compact" })),
    ).rejects.toThrow("background work");
    expect(
      mocks.invoke.mock.calls.filter(
        ([cmd]) => cmd === "claude_interactive_stop",
      ),
    ).toHaveLength(stops);
    expect(mocks.sends).toHaveLength(1);
  });
  it("rejects a historical fork before launch so the existing copied-context fallback can run", async () => {
    await expect(
      sendInteractiveClaude(
        input({
          fork: { sourceProviderSessionId: "source", forkPoint: "historical" },
        }),
      ),
    ).rejects.toThrow("copied context");
    expect(mocks.starts).toHaveLength(0);
    expect(mocks.sends).toHaveLength(0);
  });
  it("adds persisted attachment references once, but blocks model and effort commands", async () => {
    const turn = sendInteractiveClaude(
      input({
        attachments: [
          {
            id: "a",
            name: "notes.md",
            kind: "file",
            mimeType: "text/markdown",
            size: 2,
            data: "aGk=",
          },
        ],
      }),
    );
    await waitFor(() => onAccepted.mock.calls.length === 1);
    expect(mocks.sends).toEqual([
      'first line\nsecond line\n\nRead these attached files using your tools:\n"notes.md": "/saved/one.txt"',
    ]);
    finish();
    await vi.advanceTimersByTimeAsync(1000);
    await turn;
    for (const text of [
      "/model haiku",
      "/effort low",
      "/compact extra",
      "/clear",
    ])
      await expect(sendInteractiveClaude(input({ text }))).rejects.toThrow(
        "No prompt was sent",
      );
    expect(mocks.sends).toHaveLength(1);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SendTurnInput, HarnessEvent } from "../../core/types";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  isTauri: vi.fn(() => true),
  headless: vi.fn(() => false),
  resolve: vi.fn(async () => ({ path: "/fake/claude" })),
  ready: vi.fn(() => true),
  owner: false,
  starts: [] as Record<string, unknown>[],
  hooks: [] as Record<string, unknown>[],
  sends: [] as string[],
  sendError: false,
  seq: 0,
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
  createInteractiveTerminal: async () => ({
    get owner(): boolean {
      return mocks.owner;
    },
    set owner(value: boolean) {
      mocks.owner = value;
    },
    ready: mocks.ready,
    dispose: vi.fn(),
    writing: false,
    stopped: false,
  }),
}));
const {
  sendInteractiveClaude,
  stopInteractiveClaude,
  forgetInteractiveClaude,
  bindInteractiveClaude,
  replyInteractiveClaude,
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
  hook("Stop");
}

beforeEach(() => {
  vi.useFakeTimers();
  events = [];
  onAccepted = vi.fn();
  mocks.owner = false;
  mocks.sendError = false;
  mocks.seq = 0;
  mocks.starts = [];
  mocks.hooks = [];
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
        hook("SessionStart");
      }
      if (command === "claude_interactive_poll") {
        const rows = mocks.hooks.splice(0);
        const last = rows.at(-1)?.hook_event_name;
        return {
          phase: last === "UserPromptSubmit" ? "busy" : "ready",
          terminalOwner: mocks.owner,
          events: rows,
          sequence: mocks.seq,
          lines: [],
          more: false,
        };
      }
      if (command === "claude_interactive_send") {
        mocks.sends.push(String(args.text));
        if (mocks.sendError) throw new Error("IPC disconnected after write");
        hook("UserPromptSubmit", { prompt: args.text });
      }
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

  it("submits multiline input once and only acknowledges the native UserPromptSubmit", async () => {
    const turn = sendInteractiveClaude(input());
    await waitFor(() => mocks.sends.length === 1);
    await settle();
    expect(onAccepted).toHaveBeenCalledTimes(1);
    finish();
    await vi.advanceTimersByTimeAsync(1000);
    await turn;
    expect(mocks.sends).toEqual(["first line\nsecond line"]);
    expect(mocks.starts[0]).toMatchObject({
      resume: false,
      model: "claude-sonnet-5",
      effort: "medium",
      permissionMode: "default",
    });
    expect(events.some((event) => event.type === "session.providerBound")).toBe(
      true,
    );
  });
  it("does not retry an uncertain write, even when another send is attempted", async () => {
    mocks.sendError = true;
    const turn = sendInteractiveClaude(input()).catch(
      (error: unknown) => error,
    );
    await waitFor(() => mocks.sends.length === 1);
    expect(String(await turn)).toContain("unconfirmed");
    await expect(sendInteractiveClaude(input())).rejects.toThrow("unconfirmed");
    expect(mocks.sends).toHaveLength(1);
    expect(onAccepted).not.toHaveBeenCalled();
  });
  it("does not submit into a menu or terminal draft", async () => {
    mocks.ready.mockReturnValue(false);
    const turn = sendInteractiveClaude(input()).catch(
      (error: unknown) => error,
    );
    await vi.advanceTimersByTimeAsync(21000);
    expect(String(await turn)).toContain("No prompt was sent");
    expect(mocks.sends).toHaveLength(0);
  });
  it("requires explicit Return to chat after terminal ownership", async () => {
    mocks.owner = true;
    await expect(sendInteractiveClaude(input())).rejects.toThrow(
      "Return to chat",
    );
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

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HarnessEvent, SendTurnInput } from "../../core/types";

type Spawn = { id: string; args: string[]; cwd: string };

const { spawns, writes, handlers } = vi.hoisted(() => ({
  spawns: [] as Spawn[],
  writes: [] as { line: string; close: boolean }[],
  handlers: {} as {
    line?: (value: string) => void;
    exit?: (code: number | null) => void;
    stderr?: (value: string) => void;
  },
}));

vi.mock("../../core/child", () => ({
  resolveCommandCodeBinary: async () => ({ path: "/fake/cmdc" }),
  spawnChild: async (id: string, _path: string, args: string[], cwd: string) => {
    spawns.push({ id, args, cwd });
  },
  killChild: async () => undefined,
  unwatchChild: () => undefined,
  watchChild: (
    _id: string,
    line: (value: string) => void,
    exit: (code: number | null) => void,
    stderr?: (value: string) => void,
  ) => {
    handlers.line = line;
    handlers.exit = exit;
    handlers.stderr = stderr;
  },
  writeChild: async (_id: string, line: string, close = false) => {
    writes.push({ line, close });
  },
}));

const { forgetCommandCodeSession, sendCommandCodeTurn } = await import(
  "./commandCode"
);
const { setHarnessModels } = await import(
  "../../../../features/sessions/model/models"
);

const event = (value: Record<string, unknown>) =>
  handlers.line!(JSON.stringify({ type: "event", event: value }));
const result = (value: Record<string, unknown>) =>
  handlers.line!(JSON.stringify({ type: "result", ...value }));

async function waitFor(predicate: () => boolean, label: string) {
  for (let index = 0; index < 200; index += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`timed out waiting for ${label}`);
}

function turn(
  overrides: Partial<SendTurnInput> = {},
): { input: SendTurnInput; events: HarnessEvent[] } {
  const events: HarnessEvent[] = [];
  return {
    events,
    input: {
      sessionId: "chat-1",
      cwd: "/repo",
      model: "command-code:default",
      runtimeMode: "full-access",
      text: "Fix the bug",
      onEvent: (value) => events.push(value),
      ...overrides,
    },
  };
}

/**
 * Starts a turn and waits until its prompt went over stdin. The turn is
 * wrapped so awaiting this helper doesn't also await the whole turn.
 */
async function start(input: SendTurnInput): Promise<{ running: Promise<void> }> {
  const before = writes.length;
  const running = sendCommandCodeTurn(input);
  running.catch(() => undefined);
  await waitFor(() => writes.length > before, "prompt write");
  return { running };
}

beforeEach(async () => {
  await forgetCommandCodeSession("chat-1");
  spawns.length = 0;
  writes.length = 0;
});

describe("Command Code headless turns", () => {
  it("sends the prompt over stdin, streams the reply and binds the session", async () => {
    const { input, events } = turn();
    const { running } = await start(input);
    expect(spawns[0]!.args).toContain("--yolo");
    expect(spawns[0]!.args).not.toContain("--resume");
    expect(writes[0]).toEqual({ line: "Fix the bug", close: true });

    event({ type: "run_start", sessionId: "cc-1" });
    event({ type: "thinking_delta", delta: "Looking" });
    event({
      type: "tool_running",
      toolCallId: "t1",
      toolName: "read_file",
      input: { file_path: "src/a.ts" },
    });
    event({
      type: "tool_completed",
      toolCallId: "t1",
      result: [{ type: "text", text: "contents" }],
    });
    event({ type: "text_delta", delta: "Fixed." });
    result({
      subtype: "success",
      sessionId: "cc-1",
      finalText: "Fixed.",
      usage: { inputTokens: 10, outputTokens: 5 },
    });
    handlers.exit!(0);
    await running;

    expect(events).toContainEqual({
      type: "session.providerBound",
      providerSessionId: "cc-1",
    });
    expect(events).toContainEqual({ type: "reasoning.completed" });
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool.started",
        callId: "t1",
        title: "Read src/a.ts",
        kind: "read",
      }),
    );
    expect(events).toContainEqual({
      type: "tool.updated",
      callId: "t1",
      status: "completed",
      detail: "contents",
    });
    expect(events.filter((value) => value.type === "message.delta")).toEqual([
      { type: "message.delta", text: "Fixed." },
    ]);
    expect(events).toContainEqual({ type: "message.completed" });
    expect(events).toContainEqual(expect.objectContaining({ type: "usage" }));

    // The next turn continues the same Command Code conversation.
    const { running: second } = await start(turn({ text: "Thanks" }).input);
    expect(spawns[1]!.args).toEqual(expect.arrayContaining(["--resume", "cc-1"]));
    result({ subtype: "success", sessionId: "cc-1", finalText: "Welcome" });
    handlers.exit!(0);
    await second;
  });

  it("starts fresh when Command Code never saved the session", async () => {
    const { input, events } = turn({
      nativeResume: { providerSessionId: "gone" },
    } as Partial<SendTurnInput>);
    const running = sendCommandCodeTurn(input);
    await waitFor(() => writes.length === 1, "first write");
    expect(spawns[0]!.args).toEqual(expect.arrayContaining(["--resume", "gone"]));
    handlers.stderr!("error: No session gone found to resume");
    handlers.exit!(1);
    await waitFor(() => writes.length === 2, "retry write");
    expect(spawns[1]!.args).not.toContain("--resume");
    expect(events).toContainEqual(
      expect.objectContaining({ type: "status", text: expect.stringMatching(/starts fresh/) }),
    );
    result({ subtype: "success", sessionId: "cc-2", finalText: "Hi" });
    handlers.exit!(0);
    await running;
  });

  it("explains Read only blocks instead of failing the turn", async () => {
    const { input, events } = turn({ runtimeMode: "supervised" });
    const { running } = await start(input);
    expect(spawns[0]!.args).not.toContain("--yolo");
    event({
      type: "tool_errored",
      toolCallId: "t1",
      toolName: "edit_file",
      error: "This tool requires permissions. Use --yolo to allow it.",
    });
    result({ subtype: "success", sessionId: "cc-3", finalText: "I can't edit." });
    handlers.exit!(0);
    await running;
    expect(events).toContainEqual(
      expect.objectContaining({ type: "status", key: "command-code-access" }),
    );
  });

  it("fails with a readable message when the run errors", async () => {
    const { running } = await start(turn().input);
    handlers.exit!(5);
    await expect(running).rejects.toThrow(/rate limited/);
  });

  it("refuses a model the plan can't run before starting Command Code", async () => {
    setHarnessModels("command-code", [
      { id: "command-code:default", harness: "command-code", name: "Account default", nativeId: "" },
      {
        id: "command-code:claude-opus-5-5",
        harness: "command-code",
        name: "Claude Opus 5.5",
        nativeId: "claude-opus-5-5",
        locked: { reason: "Pay per use" },
      },
    ]);
    await expect(
      sendCommandCodeTurn(turn({ model: "command-code:claude-opus-5-5" }).input),
    ).rejects.toThrow(/Pay per use/);
    expect(spawns).toHaveLength(0);
  });
});

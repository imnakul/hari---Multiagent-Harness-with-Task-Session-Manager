import { beforeEach, expect, it, vi } from "vitest";
import type { HarnessEvent, SendTurnInput } from "../../core/types";

const mocks = vi.hoisted(() => ({
  watch: vi.fn(),
  unwatch: vi.fn(),
  spawn: vi.fn(),
  kill: vi.fn(),
  write: vi.fn(),
  exec: vi.fn(),
  binary: vi.fn(),
  probe: vi.fn(),
  agents: vi.fn(),
}));
vi.mock("../../core/child", () => ({
  watchChild: mocks.watch,
  unwatchChild: mocks.unwatch,
  spawnChild: mocks.spawn,
  killChild: mocks.kill,
  writeChild: mocks.write,
  execChild: mocks.exec,
  resolveAntigravityCliBinary: mocks.binary,
  probeHarnessBinary: mocks.probe,
  readAntigravityCliAgents: mocks.agents,
}));
const nativeId = "055a398f-db14-4c5f-abbb-1bf03f8120a7";
const otherId = "155a398f-db14-4c5f-abbb-1bf03f8120a7";
let listeners: Map<
  string,
  { line: (line: string) => void; exit: (code: number) => void }
>;
let events: HarnessEvent[];
let input: SendTurnInput;
function emit(id: string, event: unknown): void {
  listeners.get(id)!.line(JSON.stringify(event));
}
function result(
  text = "hello",
  turns = 1,
  usage = { input_tokens: 100, output_tokens: 10 },
): unknown {
  return {
    event: "result",
    result: {
      conversation_id: nativeId,
      status: "SUCCESS",
      response: text,
      num_turns: turns,
      usage,
    },
  };
}
async function written(): Promise<void> {
  await vi.waitFor(() => expect(mocks.write).toHaveBeenCalled());
}

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  listeners = new Map();
  events = [];
  input = {
    sessionId: "one",
    cwd: "/repo",
    model: "antigravity-cli:default",
    runtimeMode: "supervised",
    text: "hello",
    onEvent: (event): void => {
      events.push(event);
    },
  };
  mocks.binary.mockResolvedValue({ path: "/bin/agy" });
  mocks.probe.mockResolvedValue({ path: "/bin/agy" });
  mocks.agents.mockResolvedValue([{ id: "reviewer", scope: "project" }]);
  mocks.kill.mockResolvedValue(undefined);
  mocks.write.mockResolvedValue(undefined);
  mocks.exec.mockResolvedValue("quota report");
  mocks.watch.mockImplementation((id, line, exit) =>
    listeners.set(id, { line, exit }),
  );
  mocks.spawn.mockImplementation(async (id) => {
    emit(id, { event: "init", conversation_id: nativeId, init: {} });
  });
});

it("streams text and tools without duplicating the final response, keeps a warmed-up process", async () => {
  const cli = await import("./antigravityCli");
  const turn = cli.sendCliTurn(input);
  await written();
  emit("one", {
    event: "step_update",
    step_update: {
      step_index: 2,
      step_type: "agent_response",
      state: "ACTIVE",
      text_delta: "hel",
    },
  });
  emit("one", {
    event: "step_update",
    step_update: {
      step_index: 2,
      step_type: "agent_response",
      state: "DONE",
      text_delta: "lo",
    },
  });
  emit("one", {
    event: "step_update",
    step_update: {
      step_index: 3,
      step_type: "tool",
      state: "DONE",
      tool_info: { name: "run_command", output: "ok" },
    },
  });
  emit("one", result());
  await turn;
  expect(
    events
      .filter((e) => e.type === "message.delta")
      .map((e) => (e.type === "message.delta" ? e.text : ""))
      .join(""),
  ).toBe("hello");
  expect(events.some((e) => e.type === "tool.started")).toBe(true);
  expect(events).toContainEqual({ type: "session.configChanged", modelSettings: { antigravityAgent: "default" } });
  mocks.write.mockClear();
  events = [];
  const next = cli.sendCliTurn({ ...input, text: "next" });
  await written();
  emit("one", result("hello", 1)); // delayed duplicate result of the first turn
  emit("one", result("second", 2, { input_tokens: 120, output_tokens: 15 }));
  await next;
  expect(mocks.spawn).toHaveBeenCalledTimes(1);
  expect(events.find((e) => e.type === "usage")).toMatchObject({
    turn: { input: 20, output: 5 },
  });
  await cli.forgetCliSession("one");
});

it("retains exact native resume through Stop, drops late output and isolates other sessions", async () => {
  const cli = await import("./antigravityCli");
  const turn = cli.sendCliTurn(input);
  await written();
  emit("one", result());
  await turn;
  const old = listeners.get("one")!;
  await cli.stopCliSession("one");
  events = [];
  mocks.write.mockClear();
  const resumed = cli.sendCliTurn(input);
  await written();
  expect(mocks.spawn.mock.calls.at(-1)?.[2]).toContain(nativeId);
  old.line(JSON.stringify(result("stale", 99)));
  emit("one", result("resumed", 5));
  await resumed;
  expect(events.filter((e) => e.type === "message.delta")).toEqual([
    { type: "message.delta", text: "resumed" },
  ]);
  await cli.forgetCliSession("one");
});

it("fails closed on a changed resume ID before sending a message", async () => {
  const cli = await import("./antigravityCli");
  cli.bindCliSession("one", otherId, "/repo");
  await expect(cli.sendCliTurn(input)).rejects.toThrow(
    "different conversation",
  );
  expect(mocks.write).not.toHaveBeenCalled();
});

it("Stop during startup prevents the pending prompt from reaching the provider", async () => {
  const cli = await import("./antigravityCli");
  let complete: (() => void) | undefined;
  mocks.spawn.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        complete = resolve;
      }),
  );
  const turn = cli.sendCliTurn(input);
  await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalled());
  await cli.stopCliSession("one");
  complete!();
  await turn;
  expect(mocks.write).not.toHaveBeenCalled();
});

it("reports provider errors and process exit instead of inventing a successful turn", async () => {
  const cli = await import("./antigravityCli");
  const turn = cli.sendCliTurn(input);
  const check = expect(turn).rejects.toThrow("failed");
  await written();
  emit("one", {
    event: "result",
    result: {
      conversation_id: nativeId,
      status: "ERROR",
      error: "failed",
      num_turns: 0,
    },
  });
  await check;
  mocks.write.mockClear();
  const next = cli.sendCliTurn(input);
  const exited = expect(next).rejects.toThrow("exited");
  await written();
  listeners.get("one")!.exit(1);
  await exited;
});

it("counts only newly resumed step usage, and never treats historical tokens as a new turn", async () => {
  const cli = await import("./antigravityCli");
  cli.bindCliSession("one", nativeId, "/repo");
  const turn = cli.sendCliTurn(input);
  await written();
  const step = {
    event: "step_update",
    step_update: {
      step_index: 20,
      step_type: "agent_response",
      state: "DONE",
      text_delta: "hello",
      usage: { input_tokens: 20, output_tokens: 5 },
    },
  };
  emit("one", step);
  emit("one", step);
  emit("one", result("hello", 10, { input_tokens: 2000, output_tokens: 500 }));
  await turn;
  expect(events.filter((e) => e.type === "message.delta")).toEqual([
    { type: "message.delta", text: "hello" },
  ]);
  expect(events.find((e) => e.type === "usage")).toMatchObject({
    turn: { total: 25, input: 20, output: 5 },
  });
  await cli.forgetCliSession("one");
});

it("runs read-only usage reports without starting a conversation or writing stream input", async () => {
  const cli = await import("./antigravityCli");
  await cli.sendCliTurn({ ...input, text: "/usage" });
  expect(mocks.exec).toHaveBeenCalledWith(
    "/bin/agy",
    ["--print", "/usage", "--print-timeout", "30s"],
    "/repo",
    "antigravity-cli",
  );
  expect(mocks.spawn).not.toHaveBeenCalled();
  expect(mocks.write).not.toHaveBeenCalled();
});

it("rejects attachments and forking without starting any child", async () => {
  const cli = await import("./antigravityCli");
  await expect(
    cli.sendCliTurn({ ...input, intent: "plan", runtimeMode: "full-access" }),
  ).rejects.toThrow("Plan mode");
  await expect(
    cli.sendCliTurn({
      ...input,
      attachments: [
        { id: "file", name: "x", kind: "file" },
      ] as SendTurnInput["attachments"],
    }),
  ).rejects.toThrow("text only");
  await expect(
    cli.sendCliTurn({ ...input, fork: { sourceProviderSessionId: nativeId } }),
  ).rejects.toThrow("forking");
  expect(mocks.spawn).not.toHaveBeenCalled();
});

it("rejects legacy launchers and malformed resume IDs before sending or spawning", async () => {
  const cli = await import("./antigravityCli");
  mocks.probe.mockRejectedValue(new Error("stream-json not supported"));
  await expect(cli.sendCliTurn(input)).rejects.toThrow("stream-json");
  await expect(cli.sendCliTurn({ ...input, text: "/usage" })).rejects.toThrow(
    "stream-json",
  );
  await expect(
    cli.sendCliTurn({
      ...input,
      nativeResume: { providerSessionId: "acp-session" },
    }),
  ).rejects.toThrow("not an Antigravity CLI session");
  expect(mocks.spawn).not.toHaveBeenCalled();
  expect(mocks.exec).not.toHaveBeenCalled();
  expect(mocks.write).not.toHaveBeenCalled();
});

it("waits for the native identity before writing, and Stop cancels the wait", async () => {
  const cli = await import("./antigravityCli");
  mocks.spawn.mockResolvedValue(undefined);
  const turn = cli.sendCliTurn(input);
  await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalled());
  expect(mocks.write).not.toHaveBeenCalled();
  emit("one", { event: "init", conversation_id: nativeId });
  await written();
  emit("one", result());
  await turn;
  await cli.stopCliSession("one");
  mocks.write.mockClear();
  mocks.spawn.mockClear();
  const next = cli.sendCliTurn(input);
  await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalled());
  await cli.stopCliSession("one");
  await next;
  expect(mocks.write).not.toHaveBeenCalled();
});

it("finishes parallel tool steps even when their updates arrive out of order", async () => {
  const cli = await import("./antigravityCli");
  const turn = cli.sendCliTurn(input);
  await written();
  for (const [index, state] of [
    [1, "ACTIVE"],
    [2, "DONE"],
    [1, "DONE"],
  ] as const)
    emit("one", {
      event: "step_update",
      step_update: {
        step_index: index,
        step_type: "tool",
        state,
        tool_info: { name: "read_file" },
      },
    });
  emit("one", result());
  await turn;
  expect(
    events.filter((e) => e.type === "tool.updated" && e.status === "completed"),
  ).toHaveLength(2);
  await cli.forgetCliSession("one");
});

it("never sends into a mismatched native ID received after the child starts", async () => {
  const cli = await import("./antigravityCli");
  cli.bindCliSession("one", nativeId, "/repo");
  mocks.spawn.mockResolvedValue(undefined);
  const turn = cli.sendCliTurn(input);
  const rejected = expect(turn).rejects.toThrow("different conversation");
  await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalled());
  emit("one", { event: "init", conversation_id: otherId });
  await rejected;
  expect(mocks.write).not.toHaveBeenCalled();
  expect(mocks.kill).toHaveBeenCalled();
});

it("rejects changing the conversation of a warmed-up chat without touching its native context", async () => {
  const cli = await import("./antigravityCli");
  const first = cli.sendCliTurn(input);
  await written();
  emit("one", result());
  await first;
  mocks.write.mockClear();
  await expect(
    cli.sendCliTurn({ ...input, nativeResume: { providerSessionId: otherId } }),
  ).rejects.toThrow("different Antigravity CLI conversation");
  expect(mocks.write).not.toHaveBeenCalled();
  const next = cli.sendCliTurn(input);
  await written();
  emit("one", result("still original", 2));
  await next;
  expect(mocks.spawn).toHaveBeenCalledTimes(1);
  await cli.forgetCliSession("one");
});

it("retains the selected agent on Stop/resume and rejects switching before spawning or writing", async () => {
  const cli = await import("./antigravityCli");
  const custom = { ...input, modelSettings: { antigravityAgent: "reviewer" } };
  const first = cli.sendCliTurn(custom);
  await written();
  emit("one", result());
  await first;
  await cli.stopCliSession("one");
  mocks.write.mockClear();
  const resumed = cli.sendCliTurn({ ...custom, nativeResume: { providerSessionId: nativeId } });
  await written();
  const args = mocks.spawn.mock.calls.at(-1)![2];
  expect(args).toContain("--agent");
  expect(args).toContain("reviewer");
  expect(args).toContain(nativeId);
  emit("one", result("resumed", 2));
  await resumed;
  mocks.write.mockClear();
  mocks.spawn.mockClear();
  mocks.kill.mockClear();
  await expect(cli.sendCliTurn({ ...input, modelSettings: { antigravityAgent: "builder" }, nativeResume: { providerSessionId: nativeId } })).rejects.toThrow("fixed");
  expect(mocks.write).not.toHaveBeenCalled();
  expect(mocks.spawn).not.toHaveBeenCalled();
  expect(mocks.kill).not.toHaveBeenCalled();
  await cli.forgetCliSession("one");
});

it("fails before spawning or sending if a selected custom agent disappeared", async () => {
  const cli = await import("./antigravityCli");
  mocks.agents.mockResolvedValue([]);
  await expect(cli.sendCliTurn({ ...input, modelSettings: { antigravityAgent: "reviewer" } })).rejects.toThrow("unavailable in this project");
  expect(mocks.spawn).not.toHaveBeenCalled();
  expect(mocks.write).not.toHaveBeenCalled();
});

it("shows agy's own reason when it exits before the first turn", async () => {
  const reason =
    'invalid model selection (--model "gemini-3.8-flash-high" --effort "medium"): --model gemini-3.8-flash-high conflicts with --effort=medium';
  mocks.spawn.mockImplementation(async (id) => {
    emit(id, {
      event: "result",
      result: { conversation_id: "", status: "ERROR", error: reason, num_turns: 0 },
    });
    listeners.get(id)!.exit(1);
  });
  const cli = await import("./antigravityCli");
  await expect(cli.sendCliTurn(input)).rejects.toThrow(
    `Antigravity CLI stopped (1): ${reason}`,
  );
  expect(mocks.write).not.toHaveBeenCalled();
});

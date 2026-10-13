import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  registerHarness,
  resetHarnessIdlePark,
  sendHarnessTurn,
  type HarnessAdapter,
} from "../../../integrations/harness/core/registry";
import { spawnChild } from "../../../integrations/harness/core/child";
import { clearTrace, getTrace, setCapture } from "./trace";
const invoke = vi.fn(async (..._args: unknown[]) => 42);
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
  isTauri: () => false,
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => undefined),
}));
beforeEach(() => {
  clearTrace();
  setCapture(true);
  invoke.mockClear();
  vi.useFakeTimers();
});
afterEach(() => {
  resetHarnessIdlePark();
  clearTrace();
  setCapture(true);
  vi.useRealTimers();
});
for (const enabled of [true, false])
  it(`capture=${enabled} preserves provider send count, launches, payloads and regular events`, async () => {
    setCapture(enabled);
    const send = vi.fn(
      async (input: Parameters<HarnessAdapter["sendTurn"]>[0]) => {
        await spawnChild(
          input.sessionId,
          "claude",
          ["--resume", "native-1"],
          input.cwd,
          undefined,
          "claude",
        );
        input.onAccepted?.();
        input.onEvent({ type: "message.delta", text: "private output" });
        input.onEvent({
          type: "diagnostic.measurement",
          measurement: { identity: "msg", scope: "message", output: 3 },
        });
      },
    );
    registerHarness({
      id: "claude",
      live: true,
      sendTurn: send,
      steerTurn: async () => undefined,
      cancelTurn: async () => undefined,
      respondApproval: () => undefined,
      stopSession: async () => undefined,
      forgetSession: async () => undefined,
      bindSession: () => undefined,
    });
    const events = vi.fn();
    const accepted = vi.fn();
    await sendHarnessTurn({
      harness: "claude",
      sessionId: "chat",
      cwd: "C:/project",
      model: "claude-model",
      runtimeMode: "supervised",
      text: "private user prompt",
      nativeResume: { providerSessionId: "native-1" },
      onEvent: events,
      onAccepted: accepted,
      humanAuthored: true,
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(accepted).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].text).toBe("private user prompt");
    expect(invoke.mock.calls).toEqual([
      [
        "harness_spawn",
        expect.objectContaining({
          sessionId: "chat",
          command: "claude",
          args: ["--resume", "native-1"],
        }),
      ],
    ]);
    expect(events.mock.calls).toEqual([
      [{ type: "turn.ready" }],
      [{ type: "message.delta", text: "private output" }],
    ]);
    if (enabled) {
      const process = getTrace().events.find(
        (event) => event.kind === "process-launch",
      );
      const resume = getTrace().events.find(
        (event) => event.kind === "native-resume",
      );
      expect(process?.processId).toBe(resume?.processId);
      expect(process?.attemptId).toBe(resume?.attemptId);
      expect(JSON.stringify(getTrace())).not.toContain("private");
    } else expect(getTrace().events).toHaveLength(0);
  });

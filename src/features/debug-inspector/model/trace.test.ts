import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  claudeMeasurement,
  clearTrace,
  diagnosticOnly,
  getTrace,
  nextSubmissionIdentity,
  observeHarnessEvent,
  observeQuota,
  recordTrace,
  sanitizedReport,
  setCapture,
  subscribeTrace,
  TRACE_LIMIT,
  traceOperation,
  type TraceContext,
} from "./trace";
import {
  compareQuota,
  intervalEvents,
  totalUsage,
  turnMeasurements,
} from "./analysis";
import { idleRateLimits } from "../../providers/model/rateLimits";

const context: TraceContext = {
  provider: "claude",
  sessionId: "chat-1",
  nativeId: "native-1",
  accountId: "profile-1",
  submissionId: "submission-1",
  attemptId: "attempt-1",
  turnId: "turn-1",
  purpose: "chat",
  activity: "local",
};
beforeEach(() => {
  clearTrace();
  setCapture(true);
});
afterEach(() => {
  clearTrace();
  setCapture(true);
  vi.useRealTimers();
});

describe("diagnostic counting and provenance", () => {
  it("counts a submission once across queued and dispatched states and separates attempts", async () => {
    const firstIdentity = nextSubmissionIdentity();
    clearTrace();
    expect(nextSubmissionIdentity()).not.toBe(firstIdentity);
    recordTrace(context, "submission", "user-1", {
      source: "app",
      state: "queued",
    });
    recordTrace({ ...context, turnId: "new-turn" }, "submission", "user-1", {
      source: "app",
      state: "dispatching",
    });
    for (let attempt = 0; attempt < 2; attempt++)
      await traceOperation(context, "dispatch", async () => undefined);
    expect(
      getTrace().events.filter((event) => event.kind === "submission"),
    ).toHaveLength(1);
    expect(
      getTrace().events.filter((event) => event.kind === "dispatch"),
    ).toHaveLength(2);
  });
  it("ignores streaming and reconciles completed message IDs even after replay on a resumed turn", () => {
    for (let index = 0; index < 1000; index++)
      observeHarnessEvent(context, {
        type: "message.delta",
        text: "private prompt fragment",
      });
    observeHarnessEvent(context, { type: "message.completed" });
    expect(getTrace().events).toHaveLength(0);
    const event = {
      type: "diagnostic.measurement",
      measurement: claudeMeasurement(
        { input_tokens: 3, output_tokens: 1 },
        "msg-1",
        "message",
      ),
    } as const;
    observeHarnessEvent(context, event);
    observeHarnessEvent(
      { ...context, turnId: "resumed-turn", attemptId: "attempt-2" },
      { ...event, measurement: { ...event.measurement, output: 20 } },
    );
    expect(getTrace().events).toHaveLength(1);
    expect(getTrace().events[0].usage?.output).toBe(20);
    expect(getTrace().events[0].responseId).toBe("msg-1");
    expect(getTrace().events[0].requestId).toBeUndefined();
    observeHarnessEvent(context, {
      type: "turn.started",
      providerTurnId: "native-turn-1",
    });
    expect(getTrace().events[1].providerTurnId).toBe("native-turn-1");
    expect(getTrace().events[1].requestId).toBeUndefined();
  });
  it("reconciles tool lifecycle without retaining titles, arguments or results", () => {
    observeHarnessEvent(context, {
      type: "tool.started",
      callId: "tool-1",
      title: "Secret command",
      kind: "shell",
      status: "pending",
    });
    observeHarnessEvent(context, {
      type: "tool.updated",
      callId: "tool-1",
      detail: "secret result",
      status: "completed",
    });
    expect(getTrace().events).toHaveLength(1);
    expect(getTrace().events[0].state).toBe("completed");
    expect(JSON.stringify(getTrace())).not.toContain("secret");
  });
  it("replaces turn and cumulative snapshots rather than adding their overlapping numbers", () => {
    for (const output of [10, 15, 15])
      observeHarnessEvent(
        { ...context, provider: "codex" },
        {
          type: "usage",
          turn: { total: 100 + output, input: 100, output },
          session: { total: 1000 + output, input: 1000, output },
        },
      );
    expect(getTrace().events).toHaveLength(2);
    expect(totalUsage(turnMeasurements(getTrace().events))).toEqual({
      input: 100,
      output: 15,
    });
    expect(
      getTrace().events.find(
        (event) => event.usage?.scope === "session-cumulative",
      )?.usage?.input,
    ).toBe(1000);
  });
  it("keeps SDK-result aggregates separate from message measurements", () => {
    for (const scope of ["message", "sdk-result"] as const)
      observeHarnessEvent(context, {
        type: "diagnostic.measurement",
        measurement: claudeMeasurement({ input_tokens: 20 }, scope, scope),
      });
    expect(turnMeasurements(getTrace().events)).toEqual([
      expect.objectContaining({ scope: "sdk-result", uncachedInput: 20 }),
    ]);
    expect(getTrace().events.map((event) => event.usage?.scope)).toEqual([
      "message",
      "sdk-result",
    ]);
  });
  it("preserves missing, unsupported and invalid raw fields as unknown", () => {
    expect(
      claudeMeasurement(
        {
          input_tokens: -4,
          output_tokens: "10",
          cache_read_input_tokens: Infinity,
        },
        "msg",
        "message",
      ),
    ).toMatchObject({
      uncachedInput: undefined,
      output: undefined,
      cacheRead: undefined,
    });
    expect(
      totalUsage([
        claudeMeasurement({ input_tokens: 10 }, "a", "message"),
        claudeMeasurement({}, "b", "message"),
      ]).uncachedInput,
    ).toBeUndefined();
    expect(
      claudeMeasurement(
        { input_tokens: 0, cache_read_input_tokens: 0 },
        "zero",
        "message",
      ),
    ).toMatchObject({ uncachedInput: 0, cacheRead: 0, output: undefined });
  });
  it("records cache TTL partitions without adding them to total cache creation", () => {
    const usage = claudeMeasurement(
      {
        cache_creation_input_tokens: 100,
        cache_creation: {
          ephemeral_5m_input_tokens: 40,
          ephemeral_1h_input_tokens: 60,
        },
      },
      "a",
      "message",
    );
    expect(usage).toMatchObject({
      cacheWrite: 100,
      cacheWrite5m: 40,
      cacheWrite1h: 60,
    });
  });
  it("attributes RC events to their external turn beside a local submission", () => {
    observeHarnessEvent(context, {
      type: "externalTurn.started",
      turnId: "phone-1",
      text: "private phone prompt",
    });
    observeHarnessEvent(context, {
      type: "externalTurn.event",
      turnId: "phone-1",
      event: {
        type: "tool.started",
        callId: "phone-tool",
        title: "private",
        kind: "read",
      },
    });
    observeHarnessEvent(context, {
      type: "tool.started",
      callId: "local-tool",
      title: "private",
      kind: "read",
    });
    const phone = getTrace().events.find(
      (event) => event.identity === "phone-tool",
    );
    expect(phone).toMatchObject({
      turnId: "phone-1",
      activity: "remote-control",
      submissionId: undefined,
      attemptId: undefined,
    });
    expect(
      getTrace().events.find((event) => event.identity === "local-tool")
        ?.activity,
    ).toBe("local");
    expect(JSON.stringify(getTrace())).not.toContain("private");
  });
  it("correlates native binding with process and attempt metadata", async () => {
    await traceOperation(context, "dispatch", async (active) => {
      observeHarnessEvent(active, {
        type: "session.providerBound",
        providerSessionId: "resumed-native",
      });
      recordTrace(
        { ...active, processId: "process-42" },
        "process-launch",
        "42",
        { source: "PID" },
      );
      recordTrace(
        { ...active, processId: "process-42" },
        "native-resume",
        "42",
        { source: "observed flag", state: "requested" },
      );
    });
    const process = getTrace().events.find(
      (event) => event.kind === "process-launch",
    );
    expect(process).toMatchObject({
      nativeId: "resumed-native",
      submissionId: "submission-1",
      processId: "process-42",
    });
    expect(
      getTrace().events.find((event) => event.kind === "dispatch")?.attemptId,
    ).toBe(process?.attemptId);
  });
  it("deduplicates mirrored subagent tools using parent/step identity without collecting labels or results", () => {
    for (const status of ["in_progress", "completed", "completed"])
      observeHarnessEvent(context, {
        type: "agent.step",
        kind: "tool",
        callId: "parent-agent",
        stepId: "child-tool",
        text: "private tool arguments",
        detail: "private results",
        toolKind: "read",
        status,
      });
    expect(getTrace().events).toHaveLength(1);
    expect(getTrace().events[0]).toMatchObject({
      kind: "subagent-tool",
      purpose: "subagent",
      state: "completed",
      toolName: "read",
    });
    expect(JSON.stringify(getTrace())).not.toContain("private");
  });
  it("retains the observed RC model/settings on its own turn without inheriting local effort", () => {
    const local = { ...context, model: "local-model", effort: "max" };
    observeHarnessEvent(local, {
      type: "externalTurn.started",
      turnId: "phone-model",
    });
    expect(getTrace().events[0].model).toBeUndefined();
    observeHarnessEvent(local, {
      type: "externalTurn.event",
      turnId: "phone-model",
      event: {
        type: "turn.model",
        turnModel: {
          harness: "claude",
          id: "phone-model",
          name: "Phone model",
          settings: { effort: "low", fast: "true" },
        },
      },
    });
    observeHarnessEvent(local, {
      type: "externalTurn.event",
      turnId: "phone-model",
      event: {
        type: "tool.started",
        callId: "phone-model-tool",
        title: "private",
      },
    });
    expect(
      getTrace().events.find((event) => event.identity === "phone-model-tool"),
    ).toMatchObject({
      model: "phone-model",
      effort: "low",
      settings: { effort: "low", fast: "true" },
    });
    expect(local.model).toBe("local-model");
  });
  it("keeps defaulted normalized zero counters unknown while preserving raw reported zero", () => {
    observeHarnessEvent(
      { ...context, provider: "codex" },
      {
        type: "usage",
        turn: { input: 0, output: 0, total: 0, cachedInput: 0 },
      },
    );
    expect(getTrace().events[0].usage).toMatchObject({
      input: undefined,
      output: undefined,
      cacheRead: undefined,
    });
    expect(
      claudeMeasurement(
        { input_tokens: 0, output_tokens: 0 },
        "raw-zero",
        "message",
      ),
    ).toMatchObject({ uncachedInput: 0, output: 0 });
  });
  it("bounds retention and remembers evicted replay identities within a bounded horizon", () => {
    for (let index = 0; index < TRACE_LIMIT + 100; index++)
      recordTrace(context, "response", `msg-${index}`, { source: "provider" });
    const before = getTrace();
    recordTrace(context, "response", "msg-0", { source: "replay" });
    expect(getTrace().events).toHaveLength(TRACE_LIMIT);
    expect(getTrace().dropped).toBe(100);
    expect(getTrace()).toBe(before);
  });
  it("throttles notifications and isolates failing observers", async () => {
    vi.useFakeTimers();
    const notified = vi.fn();
    const unsubscribe = subscribeTrace(() => {
      notified();
      throw new Error("observer failed");
    });
    for (let index = 0; index < 50; index++)
      recordTrace(context, "response", `${index}`, { source: "provider" });
    expect(notified).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(250);
    expect(notified).toHaveBeenCalledTimes(1);
    unsubscribe();
    expect(() =>
      diagnosticOnly(() => {
        throw new Error("fail");
      }),
    ).not.toThrow();
  });
  it("sanitizes identifiers and excludes prompts, errors, labels, paths and native IDs", () => {
    recordTrace(
      {
        ...context,
        sessionId: "C:/Users/private",
        nativeId: "private-native",
        accountId: "private@email.com",
      },
      "response",
      "private-id",
      {
        source: "sensitive-source",
        state: "private-state",
        usage: claudeMeasurement(
          { input_tokens: 1 },
          "private-usage",
          "message",
        ),
      },
    );
    const report = sanitizedReport(getTrace());
    for (const secret of ["private", "sensitive-source", "C:/Users"])
      expect(report).not.toContain(secret);
    expect(report).toContain("id-1");
  });
  it("pause and clear only affect diagnostic records", async () => {
    const run = vi.fn(async () => "result");
    setCapture(false);
    expect(await traceOperation(context, "dispatch", run)).toBe("result");
    expect(run).toHaveBeenCalledTimes(1);
    expect(getTrace().events).toHaveLength(0);
    clearTrace();
    expect(getTrace().enabled).toBe(false);
  });
});

describe("observed account quota", () => {
  const reading = (at: number, usedPercent: number) => ({
    ...idleRateLimits("claude"),
    status: "ok" as const,
    updatedAt: at,
    session: { usedPercent, resetsAt: 999, windowMinutes: 300 },
  });
  it("deduplicates successful observations and ignores fetching/error copies", () => {
    observeQuota("claude", "profile-1", reading(100, 20));
    observeQuota("claude", "profile-1", reading(100, 20));
    observeQuota("claude", "profile-1", {
      ...reading(200, 20),
      status: "error",
    });
    expect(getTrace().quotas).toHaveLength(1);
  });
  it("compares matching accounts/windows without asserting per-session billing", () => {
    observeQuota("claude", "profile-1", reading(100, 20));
    observeQuota("claude", "profile-1", reading(300, 25));
    const [before, after] = getTrace().quotas;
    expect(compareQuota(before, after)).toMatchObject([
      { beforeRemaining: 80, afterRemaining: 75, usedChange: 5 },
    ]);
    expect(compareQuota(before, { ...after, accountId: "other" })).toEqual([]);
    expect(
      compareQuota(before, {
        ...after,
        windows: [{ ...after.windows[0], resetsAt: null }],
      })[0].usedChange,
    ).toBeUndefined();
    recordTrace(context, "submission", "inside", { source: "test" });
    expect(intervalEvents(getTrace().events, before, after)).toHaveLength(0);
  });
});

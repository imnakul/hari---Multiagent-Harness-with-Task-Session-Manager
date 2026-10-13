import { expect, it } from "vitest";
import {
  intervalTurnMeasurements,
  localIntervalMeasurements,
} from "./analysis";
import type { LocalEvidence } from "./evidence";
import type { QuotaObservation, TraceEvent } from "./trace";
const before: QuotaObservation = {
  provider: "claude",
  accountId: "default",
  at: 1000,
  windows: [],
};
const after = { ...before, at: 3000 };
it("excludes aggregate usage with missing or cross-boundary lifecycle even when completion was captured after Clear", () => {
  const lifecycle: TraceEvent = {
    id: "dispatch",
    kind: "dispatch",
    identity: "attempt",
    provider: "claude",
    accountId: "default",
    sessionId: "chat",
    attemptId: "attempt",
    purpose: "chat",
    activity: "local",
    source: "harness boundary",
    state: "completed",
    at: 1500,
    updatedAt: 2500,
    durationMs: 1000,
  };
  const usage: TraceEvent = {
    ...lifecycle,
    id: "usage",
    kind: "usage",
    at: 2500,
    durationMs: undefined,
    usage: { identity: "result", scope: "sdk-result", uncachedInput: 5 },
  };
  expect(intervalTurnMeasurements([lifecycle, usage], before, after)).toEqual([
    usage.usage,
  ]);
  expect(intervalTurnMeasurements([usage], before, after)).toEqual([]);
  expect(
    intervalTurnMeasurements(
      [{ ...lifecycle, at: 2500, durationMs: 2000 }, usage],
      before,
      after,
    ),
  ).toEqual([]);
  expect(
    intervalTurnMeasurements(
      [{ ...lifecycle, state: "failed" }, usage],
      before,
      after,
    ),
  ).toEqual([usage.usage]);
});
const local: LocalEvidence = {
  provider: "claude",
  nativeId: "native",
  accountId: "default",
  observedAt: 100000,
  source: "Claude Code JSONL",
  fileBytes: 20,
  readBytes: 20,
  truncated: false,
  changedDuringRead: false,
  malformedLines: 0,
  partialLines: 0,
  limitations: [],
  measurements: [
    {
      identity: "inside",
      scope: "message",
      timestamp: new Date(2000).toISOString(),
      uncachedInput: 5,
    },
    {
      identity: "outside",
      scope: "message",
      timestamp: new Date(500).toISOString(),
      uncachedInput: 20,
    },
    { identity: "untimed", scope: "message", uncachedInput: 10 },
    {
      identity: "aggregate",
      scope: "sdk-result",
      timestamp: new Date(2000).toISOString(),
      uncachedInput: 35,
    },
  ],
};
it("places historical usage by provider timestamp and excludes overlapping aggregates and unknown times", () => {
  expect(
    localIntervalMeasurements(local, before, after).map((row) => row.identity),
  ).toEqual(["inside"]);
});
it("rejects account/provider mismatches and backwards quota intervals", () => {
  expect(
    localIntervalMeasurements({ ...local, accountId: "other" }, before, after),
  ).toEqual([]);
  expect(
    localIntervalMeasurements(local, before, { ...after, provider: "codex" }),
  ).toEqual([]);
  expect(localIntervalMeasurements(local, after, before)).toEqual([]);
});
it("keeps Codex historical cumulative readings as snapshots instead of adding last-response counters", () => {
  const codex = {
    ...local,
    provider: "codex" as const,
    measurements: [
      {
        identity: "total",
        scope: "session-cumulative" as const,
        timestamp: new Date(2000).toISOString(),
        input: 30,
      },
      {
        identity: "last",
        scope: "last-response" as const,
        timestamp: new Date(2000).toISOString(),
        input: 5,
      },
    ],
  };
  expect(
    localIntervalMeasurements(
      codex,
      { ...before, provider: "codex" },
      { ...after, provider: "codex" },
    ),
  ).toEqual([codex.measurements[0]]);
});

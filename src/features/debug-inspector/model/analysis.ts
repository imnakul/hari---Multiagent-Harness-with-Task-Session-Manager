import type { QuotaObservation, TraceEvent, UsageMeasurement } from "./trace";
import type { LocalEvidence } from "./evidence";

const FIELDS = [
  "uncachedInput",
  "input",
  "output",
  "cacheRead",
  "cacheWrite",
  "cacheWrite5m",
  "cacheWrite1h",
  "reasoning",
  "costUsd",
] as const;
export type UsageTotals = Partial<Record<(typeof FIELDS)[number], number>>;
/** Only callers selecting ONE non-overlapping scope may total measurements. Missing counters stay unknown. */
export function totalUsage(
  measurements: readonly UsageMeasurement[],
): UsageTotals {
  const totals: UsageTotals = {};
  for (const field of FIELDS) {
    if (
      measurements.length &&
      measurements.every((item) => item[field] !== undefined)
    ) {
      totals[field] = measurements.reduce(
        (sum, item) => sum + (item[field] ?? 0),
        0,
      );
    }
  }
  return totals;
}
export function turnMeasurements(
  events: readonly TraceEvent[],
): UsageMeasurement[] {
  const aggregates = new Map<string, UsageMeasurement>();
  for (const event of events) {
    const operation =
      event.attemptId ??
      (event.activity === "remote-control" ? event.turnId : undefined);
    if (!operation || !event.usage) continue;
    if (
      event.usage.scope === "turn" ||
      (event.provider === "claude" &&
        event.purpose !== "subagent" &&
        event.usage.scope === "sdk-result")
    ) {
      aggregates.set(
        `${event.provider}:${event.accountId}:${event.sessionId}:${operation}`,
        event.usage,
      );
    }
  }
  return [...aggregates.values()];
}
export function compareQuota(
  before: QuotaObservation,
  after: QuotaObservation,
): {
  name: string;
  beforeRemaining: number;
  afterRemaining: number;
  usedChange?: number;
  limitation?: string;
}[] {
  if (
    before.provider !== after.provider ||
    before.accountId !== after.accountId ||
    before.at >= after.at
  )
    return [];
  return before.windows.flatMap((start) => {
    const end = after.windows.find((window) => window.name === start.name);
    if (!end) return [];
    const comparable =
      start.resetsAt !== null &&
      end.resetsAt === start.resetsAt &&
      start.windowMinutes === end.windowMinutes;
    return [
      {
        name: start.name,
        beforeRemaining: 100 - start.usedPercent,
        afterRemaining: 100 - end.usedPercent,
        ...(comparable
          ? { usedChange: end.usedPercent - start.usedPercent }
          : {
              limitation:
                "Window reset identity changed or is unknown; percentage delta is not comparable.",
            }),
      },
    ];
  });
}
export function intervalEvents(
  events: readonly TraceEvent[],
  before: QuotaObservation,
  after: QuotaObservation,
): TraceEvent[] {
  if (
    before.provider !== after.provider ||
    before.accountId !== after.accountId ||
    before.at >= after.at
  )
    return [];
  return events.filter(
    (event) =>
      event.provider === before.provider &&
      event.accountId === before.accountId &&
      event.at >= before.at &&
      event.updatedAt <= after.at,
  );
}

/** A completed aggregate belongs to an interval only when its operation's
 * observed start and end are covered. Recreated completion rows after Clear
 * still use the full duration to detect a start before the interval. */
export function intervalTurnMeasurements(
  events: readonly TraceEvent[],
  before: QuotaObservation,
  after: QuotaObservation,
): UsageMeasurement[] {
  const observations = intervalEvents(events, before, after);
  const operations = new Set(
    observations.flatMap((event) => {
      if (
        !["dispatch", "helper", "external-turn"].includes(event.kind) ||
        !["completed", "failed", "cancelled"].includes(event.state ?? "") ||
        event.durationMs === undefined ||
        event.updatedAt - event.durationMs < before.at
      )
        return [];
      const identity =
        event.attemptId ??
        (event.activity === "remote-control" ? event.turnId : undefined);
      return identity ? [identity] : [];
    }),
  );
  return turnMeasurements(
    observations.filter((event) =>
      operations.has(event.attemptId ?? event.turnId ?? ""),
    ),
  );
}

/** Historical measurements use provider timestamps, never the time the file was read. */
export function localIntervalMeasurements(
  local: LocalEvidence,
  before: QuotaObservation,
  after: QuotaObservation,
): UsageMeasurement[] {
  if (
    before.at >= after.at ||
    local.provider !== before.provider ||
    local.accountId !== before.accountId ||
    before.provider !== after.provider ||
    before.accountId !== after.accountId
  )
    return [];
  const scope = local.provider === "claude" ? "message" : "session-cumulative";
  return local.measurements.filter((row) => {
    const timestamp = row.timestamp ? Date.parse(row.timestamp) : NaN;
    return (
      row.scope === scope && timestamp >= before.at && timestamp <= after.at
    );
  });
}

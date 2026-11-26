import { describe, expect, it } from "vitest";
import type { ActivityLog, AwSummary } from "./activity";
import {
  RANGE_ERROR,
  activityAskContext,
  buildActivityReadResult,
  localIso,
  parseActivityReadInput,
} from "./activityRead";

const IST = 330;

function aw(overrides: Partial<AwSummary> = {}): AwSummary {
  return {
    available: true,
    hasAfk: true,
    activeMs: 0,
    activeSpans: [],
    apps: [],
    hasWeb: true,
    sites: [],
    meetings: [],
    meetingMs: 0,
    ...overrides,
  };
}

const EMPTY: ActivityLog = { events: [], notes: [] };

describe("parseActivityReadInput", () => {
  it("reads local dates and makes a date-only end cover that day", () => {
    const request = parseActivityReadInput({ start: "2026-10-07", end: "2026-10-07" }, IST);
    expect(request.range.end - request.range.start).toBe(24 * 60 * 60_000);
    expect(request.include.size).toBe(6);
  });

  it("reads ISO with an offset exactly", () => {
    const request = parseActivityReadInput(
      { start: "2026-10-07T00:00:00+05:30", end: "2026-10-07T12:00:00+05:30" },
      IST,
    );
    expect(request.range.end - request.range.start).toBe(12 * 60 * 60_000);
  });

  it("rejects missing, unreadable, reversed and over-32-day ranges", () => {
    expect(() => parseActivityReadInput({}, IST)).toThrow(/start and end/);
    expect(() => parseActivityReadInput({ start: "tomorrow", end: "2026-10-07" }, IST)).toThrow(/start and end/);
    expect(() => parseActivityReadInput({ start: "2026-10-08", end: "2026-10-07T00:00" }, IST)).toThrow(RANGE_ERROR);
    expect(() => parseActivityReadInput({ start: "2026-01-01", end: "2026-03-01" }, IST)).toThrow(RANGE_ERROR);
    expect(() => parseActivityReadInput({ start: "2026-02-30", end: "2026-03-01" }, IST)).toThrow(/start and end/);
  });

  it("narrows include and rejects an include with no known section", () => {
    const request = parseActivityReadInput({ start: "2026-10-07", end: "2026-10-08", include: ["notes", "x"] }, IST);
    expect([...request.include]).toEqual(["notes"]);
    expect(() => parseActivityReadInput({ start: "2026-10-07", end: "2026-10-08", include: ["x"] }, IST)).toThrow(
      /include may list/,
    );
  });
});

describe("buildActivityReadResult", () => {
  const day = parseActivityReadInput({ start: "2026-10-07", end: "2026-10-07" }, IST);
  const ts = day.range.start + 3_600_000;

  it("returns domains and minutes only, never tab titles", () => {
    const result = buildActivityReadResult(
      EMPTY,
      aw({ sites: [{ domain: "github.com", ms: 5 * 60_000, titles: ["Secret PR title"] }] }),
      null,
      day,
    );
    expect(result.sites).toEqual([{ domain: "github.com", minutes: 5 }]);
    expect(JSON.stringify(result)).not.toContain("Secret PR title");
  });

  it("marks hourly notes and uses local ISO times", () => {
    const log: ActivityLog = {
      events: [],
      notes: [{ id: 1, ts, firstEventId: 0, lastEventId: 0, body: "Read docs", kind: "hourly" }],
    };
    const result = buildActivityReadResult(log, null, null, day);
    expect(result.notes?.[0]).toMatchObject({ kind: "hourly", text: "Read docs", time: localIso(ts, IST) });
    expect(result.notes?.[0]?.time).toMatch(/\+05:30$/);
  });

  it("caps long lists and flags truncation", () => {
    const apps = Array.from({ length: 45 }, (_, i) => ({ app: `app${i}`, ms: (i + 1) * 60_000 }));
    const result = buildActivityReadResult(EMPTY, aw({ apps }), null, day);
    expect(result.apps).toHaveLength(30);
    expect(result.apps?.[0]?.app).toBe("app44");
    expect(result.truncated).toBe(true);
  });

  it("leaves events out of a long range unless they are asked for", () => {
    const log: ActivityLog = {
      events: [
        { id: 1, ts, kind: "prompt", sessionId: "s", harness: "codex", model: "m", cwd: "/p/app", title: "t", text: "hello" },
      ],
      notes: [],
    };
    const long = parseActivityReadInput({ start: "2026-10-01", end: "2026-10-10" }, IST);
    expect(buildActivityReadResult(log, null, null, long).events).toBeUndefined();
    const asked = parseActivityReadInput({ start: "2026-10-01", end: "2026-10-10", include: ["events"] }, IST);
    expect(buildActivityReadResult(log, null, null, asked).events?.[0]).toMatchObject({ project: "app", text: "hello" });
  });

  it("says plainly when ActivityWatch and the phone are unavailable", () => {
    const result = buildActivityReadResult(EMPTY, aw({ available: false }), { available: false, apps: [] }, day);
    expect(result.note).toMatch(/ActivityWatch is not available/);
    expect(result.phone).toEqual({ available: false, apps: [] });
    expect(result.apps).toBeUndefined();
  });
});

describe("activityAskContext", () => {
  it("names today with the weekday and tells the agent how to read", () => {
    const text = activityAskContext("hari app", new Date("2026-11-26T08:00:00Z"), IST);
    expect(text).toContain("Thursday 2026-11-26 13:30 (UTC+05:30)");
    expect(text).toContain("hari app activity.read");
    expect(text).toContain("<monocode_activity>");
  });
});

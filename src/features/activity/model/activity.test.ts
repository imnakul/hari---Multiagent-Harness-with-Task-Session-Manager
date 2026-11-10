import { describe, expect, it } from "vitest";
import {
  FRESH_MS,
  activityTotals,
  agentSpans,
  buildLogItems,
  collectActivityEvents,
  createRecorderState,
  dayRange,
  formatDuration,
  replyExcerpt,
  shiftDay,
  summarizeProjects,
  timelineWindow,
  tzOffsetMinutes,
  type ActivityEvent,
} from "./activity";
import type { Block, Session } from "../../sessions/model/session";

const NOW = 1_794_312_896_789;

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: "s1",
    harness: "claude",
    model: "opus",
    modelSettings: {},
    runtimeMode: "supervised",
    title: "Fix tabs",
    cwd: "/code/hari",
    blocks: [],
    ...overrides,
  };
}

function user(id: string, startedAt?: number, extra: Partial<Block> = {}): Block {
  return { id, role: "user", text: `prompt ${id}`, startedAt, ...extra };
}

function event(overrides: Partial<ActivityEvent>): ActivityEvent {
  return {
    id: 1,
    ts: NOW,
    kind: "prompt",
    sessionId: "s1",
    harness: "claude",
    model: "opus",
    cwd: "/code/hari",
    title: "t",
    text: "x",
    ...overrides,
  };
}

describe("collectActivityEvents", () => {
  it("records a fresh prompt once, even for a brand-new session", () => {
    const state = createRecorderState();
    const s = session({ busy: true, blocks: [user("b1", NOW - 1000)] });
    const first = collectActivityEvents(state, [s], NOW, 330);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({
      kind: "prompt",
      blockId: "b1",
      text: "prompt b1",
      at: NOW - 1000,
      tzOffsetMin: 330,
    });
    // Same object again: nothing new.
    expect(collectActivityEvents(state, [s], NOW, 330)).toEqual([]);
    // New object, same block: still nothing new.
    expect(collectActivityEvents(state, [{ ...s }], NOW, 330)).toEqual([]);
  });

  it("does not replay history when an old chat is opened", () => {
    const state = createRecorderState();
    const old = session({ blocks: [user("old", NOW - FRESH_MS - 1)] });
    expect(collectActivityEvents(state, [old], NOW, 0)).toEqual([]);
  });

  it("records steers only for sessions already being watched", () => {
    const state = createRecorderState();
    const steerOnFirstSight = session({ busy: true, blocks: [user("steer")] });
    expect(collectActivityEvents(state, [steerOnFirstSight], NOW, 0)).toEqual([]);

    const later = { ...steerOnFirstSight, blocks: [...steerOnFirstSight.blocks, user("steer2")] };
    const events = collectActivityEvents(state, [later], NOW, 0);
    expect(events.map((e) => [e.kind, e.blockId, e.at])).toEqual([["prompt", "steer2", NOW]]);
  });

  it("records a turn when busy goes from true to false, with a code-free reply", () => {
    const state = createRecorderState();
    const running = session({ busy: true, blocks: [user("b1", NOW - 60_000)] });
    collectActivityEvents(state, [running], NOW - 59_000, 0);

    const done = session({
      busy: false,
      blocks: [
        user("b1", NOW - 60_000, { durationMs: 42_000 }),
        { id: "a1", role: "assistant", text: "Draft" },
        { id: "t1", role: "tool", text: "ran tests" },
        { id: "a2", role: "assistant", text: "Fixed it.\n```ts\nconst secret = 1;\n```\nDone." },
      ],
    });
    const events = collectActivityEvents(state, [done], NOW, 0);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "turn", blockId: "b1", durationMs: 42_000, at: NOW });
    expect(events[0].text).toBe("Fixed it. [code] Done.");
    expect(events[0].text).not.toContain("secret");
    // A second idle observation does not double-record.
    expect(collectActivityEvents(state, [{ ...done }], NOW, 0)).toEqual([]);
  });

  it("falls back to elapsed time when the turn has no duration stamp", () => {
    const state = createRecorderState();
    collectActivityEvents(state, [session({ busy: true, blocks: [user("b1", NOW - 5_000)] })], NOW, 0);
    const events = collectActivityEvents(
      state,
      [session({ busy: false, blocks: [user("b1", NOW - 5_000)] })],
      NOW,
      0,
    );
    expect(events[0]).toMatchObject({ kind: "turn", durationMs: 5_000 });
  });

  it("skips sessions without a project folder and blank prompts", () => {
    const state = createRecorderState();
    const noCwd = session({ cwd: "", blocks: [user("a", NOW)] });
    const blank = session({ id: "s2", blocks: [user("b", NOW, { text: "   " })] });
    expect(collectActivityEvents(state, [noCwd, blank], NOW, 0)).toEqual([]);
  });
});

describe("replyExcerpt", () => {
  it("stops at the next user turn and clips long replies", () => {
    const blocks: Block[] = [
      user("u1", NOW),
      { id: "a1", role: "assistant", text: "word ".repeat(400) },
      user("u2", NOW),
      { id: "a2", role: "assistant", text: "later" },
    ];
    const excerpt = replyExcerpt(blocks, 0);
    expect(excerpt.endsWith("…")).toBe(true);
    expect(excerpt.length).toBeLessThanOrEqual(601);
    expect(excerpt).not.toContain("later");
  });
});

describe("view model", () => {
  const events: ActivityEvent[] = [
    event({ id: 1, kind: "prompt", cwd: "/code/hari", branch: "main", ts: NOW - 300_000 }),
    event({ id: 2, kind: "turn", cwd: "/code/hari", branch: "main", durationMs: 120_000, ts: NOW - 180_000 }),
    event({ id: 3, kind: "prompt", cwd: "/code/site", sessionId: "s2", ts: NOW - 60_000 }),
  ];

  it("summarizes projects busiest first", () => {
    expect(summarizeProjects(events)).toEqual([
      { cwd: "/code/hari", name: "hari", prompts: 1, agentMs: 120_000, branches: ["main"], lastTs: NOW - 180_000 },
      { cwd: "/code/site", name: "site", prompts: 1, agentMs: 0, branches: [], lastTs: NOW - 60_000 },
    ]);
  });

  it("totals prompts, agent time, and sessions", () => {
    expect(activityTotals(events)).toEqual({ prompts: 2, agentMs: 120_000, sessions: 2 });
  });

  it("turns finished turns into timeline spans", () => {
    expect(agentSpans(events)).toEqual([{ start: NOW - 300_000, end: NOW - 180_000 }]);
  });

  it("interleaves notes above the events they follow, newest first", () => {
    const items = buildLogItems({
      events,
      notes: [{ id: 9, ts: NOW - 180_000, firstEventId: 1, lastEventId: 2, body: "- did it" }],
    });
    expect(items.map((item) => item.key)).toEqual(["e3", "n9", "e2", "e1"]);
  });
});

describe("time helpers", () => {
  it("formats durations", () => {
    expect(formatDuration(-1)).toBe("0s");
    expect(formatDuration(59_000)).toBe("59s");
    expect(formatDuration(61 * 60_000)).toBe("1h 01m");
  });

  it("builds local day ranges and shifts days", () => {
    const day = new Date(2026, 10, 10, 15, 30);
    const range = dayRange(day);
    expect(new Date(range.start).getHours()).toBe(0);
    expect(new Date(range.end).getDate()).toBe(11);
    expect(shiftDay(day, -1).getDate()).toBe(9);
    expect(shiftDay(day, -1).getHours()).toBe(0);
  });

  it("reports the UTC offset with the ISO sign", () => {
    expect(tzOffsetMinutes({ getTimezoneOffset: () => -330 })).toBe(330);
    expect(Object.is(tzOffsetMinutes({ getTimezoneOffset: () => 0 }), 0)).toBe(true);
  });

  it("fits the timeline window to the activity", () => {
    const hour = 3_600_000;
    const day = { start: 0, end: 24 * hour };
    expect(timelineWindow(day, [])).toEqual({ start: 8 * hour, end: 20 * hour });
    // One short burst widens to the minimum six-hour window, centred.
    expect(timelineWindow(day, [{ start: 10 * hour + 5, end: 10 * hour + 600_000 }])).toEqual({
      start: 8 * hour,
      end: 14 * hour,
    });
    // Near midnight it clamps to the day instead of spilling over.
    expect(timelineWindow(day, [{ start: 23 * hour, end: 23.5 * hour }])).toEqual({
      start: 18 * hour,
      end: 24 * hour,
    });
  });
});

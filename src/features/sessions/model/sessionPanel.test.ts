import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  addBookmark,
  applyPointsReply,
  blockTimes,
  buildPointsPrompt,
  clampPanelWidth,
  editBookmark,
  editPoint,
  EMPTY_SESSION_PANEL,
  loadSessionPanel,
  loadSessionPanelView,
  openSessionOverview,
  parseSessionPanelData,
  parseSessionPanelView,
  panelBlocksAfter,
  panelTextMatches,
  parsePointsReply,
  removeBookmark,
  removePoint,
  resetSessionPanelStoreForTests,
  saveSessionPanelView,
  serializeSessionPanelData,
  sessionFileTouches,
  taggedTranscript,
  timelineDayLabel,
  timelineDays,
  updateSessionPanel,
  type SessionPanelData,
  type SessionPoint,
} from "./sessionPanel";
import type { Block } from "./session";

const { mockInvoke } = vi.hoisted(() => ({ mockInvoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mockInvoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));

function block(id: string, role: Block["role"], text: string, extra: Partial<Block> = {}): Block {
  return { id, role, text, ...extra } as Block;
}

function edit(id: string, path: string, status = "completed"): Block {
  return block(id, "tool", "", { tool: { kind: "edit", title: `Edit ${path}`, status, paths: [path] } });
}

const withQuote: SessionPanelData = {
  version: 1,
  points: [{ id: "p1", kind: "found", text: "Race in save", blockId: "a1", at: 1, source: "ai" }],
  bookmarks: [{ id: "k1", blockId: "a1", text: "Why", at: 1, quote: "Use SQLite" }],
};

describe("panel data", () => {
  it("reads stored JSON and drops broken entries", () => {
    const data = parseSessionPanelData(
      JSON.stringify({
        bookmarks: [
          { id: "k1", blockId: "b2", text: "  Here  ", at: 2 },
          { id: "k2" },
          { id: "k3", blockId: "b3", text: "", at: 3, quote: "  the   quote " },
        ],
      }),
    );
    expect(data.bookmarks).toEqual([
      { id: "k1", blockId: "b2", text: "Here", at: 2 },
      { id: "k3", blockId: "b3", text: "", at: 3, quote: "the quote" },
    ]);
  });

  // Panels saved by L-191 also hold a Left off; it now lives in the Summary
  // and is ignored, while the points come back for the Timeline.
  it("keeps the points and bookmarks of a panel saved with the old timeline", () => {
    const data = parseSessionPanelData(
      JSON.stringify({
        points: [{ id: "p1", kind: "decision", text: "Use SQLite", blockId: "u1", at: 1, source: "ai" }],
        bookmarks: [{ id: "k1", blockId: "b2", text: "Here", at: 2 }],
        leftOff: { text: "Wiring the panel", at: 9 },
        after: "b9",
      }),
    );
    expect(data).toEqual({
      version: 1,
      points: [{ id: "p1", kind: "decision", text: "Use SQLite", blockId: "u1", at: 1, source: "ai" }],
      bookmarks: [{ id: "k1", blockId: "b2", text: "Here", at: 2 }],
      after: "b9",
    });
  });

  it("treats unreadable data as empty", () => {
    expect(parseSessionPanelData("{oops")).toEqual(EMPTY_SESSION_PANEL);
    expect(parseSessionPanelData(null)).toEqual(EMPTY_SESSION_PANEL);
  });

  it("stores nothing for an empty panel and round-trips the rest", () => {
    expect(serializeSessionPanelData(EMPTY_SESSION_PANEL)).toBe("");
    expect(parseSessionPanelData(serializeSessionPanelData(withQuote))).toEqual(withQuote);
  });
});

describe("edits", () => {
  it("keeps quotes from one reply apart from its whole-reply bookmark", () => {
    let data = addBookmark(EMPTY_SESSION_PANEL, "a1", "Reply", 1);
    data = addBookmark(data, "a1", "", 2, "first quote");
    data = addBookmark(data, "a1", "", 3, "second quote");
    expect(data.bookmarks.map((b) => b.quote ?? null)).toEqual([null, "first quote", "second quote"]);
    // Saving the same quote again moves it to the end instead of doubling it.
    data = addBookmark(data, "a1", "", 4, "first quote");
    expect(data.bookmarks.map((b) => b.quote ?? null)).toEqual([null, "second quote", "first quote"]);
  });

  it("keeps one bookmark per message", () => {
    let data = addBookmark(EMPTY_SESSION_PANEL, "u1", "First", 1);
    data = addBookmark(data, "u1", "Again", 2);
    expect(data.bookmarks).toHaveLength(1);
    expect(data.bookmarks[0]).toMatchObject({ blockId: "u1", text: "Again" });
    const id = data.bookmarks[0]!.id;
    expect(editBookmark(data, id, "Renamed").bookmarks[0]!.text).toBe("Renamed");
    expect(removeBookmark(data, id).bookmarks).toEqual([]);
  });
});

describe("timeline points (L-192)", () => {
  const blocks = [
    block("u1", "user", "Store it in SQLite?"),
    block("a1", "assistant", "Yes, SQLite."),
    block("t1", "tool", "", { tool: { kind: "edit", title: "Edit db.rs", status: "completed", paths: ["db.rs"] } }),
    block("a2", "assistant", "Working", { streaming: true }),
  ];

  it("tags messages and builds a prompt without Left off", () => {
    const transcript = taggedTranscript(blocks);
    expect(transcript.text).toContain("[m1] User: Store it in SQLite?");
    expect(transcript.text).toContain("[m3] Tool: Edit db.rs");
    expect(transcript.ids.get("m2")).toBe("a1");
    const prompt = buildPointsPrompt({ transcript: transcript.text, data: withQuote, scope: "update" });
    expect(prompt).toContain("- found: Race in save");
    expect(prompt).toContain("since the timeline was last updated");
    expect(prompt.toLowerCase()).not.toContain("leftoff");
  });

  it("reads a points reply, skipping Left off lines", () => {
    const ids = new Map([["m1", "u1"], ["m2", "a1"]]);
    const reply = "decision | m1 | Use SQLite.\n- found | m9 | Lock order\nleftoff | m2 | x";
    expect(parsePointsReply(reply, ids)).toEqual({
      kind: "add",
      points: [
        { kind: "decision", text: "Use SQLite", blockId: "u1" },
        { kind: "found", text: "Lock order" },
      ],
    });
    expect(parsePointsReply("NOTHING_NEW", ids)).toEqual({ kind: "none" });
    expect(parsePointsReply("leftoff | m2 | only this", ids)).toEqual({ kind: "none" });
    expect(parsePointsReply("Sure, here you go", ids)).toBeNull();
  });

  it("adds points, records the marker, and edits or removes them", () => {
    let data = applyPointsReply(
      EMPTY_SESSION_PANEL,
      { kind: "add", points: [{ kind: "event", text: "Built the store", blockId: "t1" }] },
      "t1",
      5,
    );
    expect(data.after).toBe("t1");
    expect(data.points).toMatchObject([{ kind: "event", text: "Built the store", blockId: "t1", at: 5, source: "ai" }]);
    const id = data.points[0]!.id;
    data = editPoint(data, id, "Built the SQLite store");
    expect(data.points[0]).toMatchObject({ text: "Built the SQLite store", edited: true });
    expect(removePoint(data, id).points).toEqual([]);
    expect(applyPointsReply(data, { kind: "none" }, "u9").after).toBe("u9");
  });

  it("reads only finished messages after the marker", () => {
    expect(panelBlocksAfter(blocks, "a1").map((b) => b.id)).toEqual(["t1"]);
    expect(panelBlocksAfter(blocks, "gone").map((b) => b.id)).toEqual(["u1", "a1", "t1"]);
  });

  it("times each message by its turn, and groups points by day, newest first", () => {
    const day1 = new Date(2026, 9, 21, 11, 47).getTime();
    const day2 = new Date(2026, 9, 22, 9, 5).getTime();
    const times = blockTimes([
      block("x0", "assistant", "before any turn"),
      block("u1", "user", "a", { startedAt: day1 }),
      block("a1", "assistant", "b"),
      block("u2", "user", "c", { startedAt: day2 }),
      block("u3", "user", "joined", { sentAt: day2 + 60_000 }),
      block("a3", "assistant", "d"),
    ]);
    expect(times.has("x0")).toBe(false);
    expect(times.get("a1")).toBe(day1);
    expect(times.get("a3")).toBe(day2 + 60_000);
    const point = (id: string, blockId: string | undefined, at: number): SessionPoint => ({
      id, kind: "event", text: id, at, source: "ai", ...(blockId ? { blockId } : {}),
    });
    const days = timelineDays(
      [point("p1", "a1", day2 + 999), point("p2", "a3", 1), point("p3", undefined, day1 - 60_000), point("p4", "u2", 1)],
      times,
    );
    expect(days.map((day) => day.entries.map((entry) => entry.point.id))).toEqual([["p2", "p4"], ["p1", "p3"]]);
    expect(days[1]!.entries[0]!.time).toBe(day1);
  });

  it("labels days as Today, Yesterday, or a date", () => {
    const now = new Date(2026, 9, 29, 10).getTime();
    expect(timelineDayLabel(new Date(2026, 9, 29, 1).getTime(), now)).toBe("Today");
    expect(timelineDayLabel(new Date(2026, 9, 28, 23).getTime(), now)).toBe("Yesterday");
    expect(timelineDayLabel(new Date(2026, 9, 21, 9).getTime(), now)).toBe(
      new Date(2026, 9, 21).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }),
    );
    expect(timelineDayLabel(new Date(2025, 0, 2).getTime(), now)).toContain("2025");
  });
});

describe("sessionFileTouches", () => {
  it("lists successful edits, most recent first, counting repeats", () => {
    const touches = sessionFileTouches([
      edit("t1", "src/a.ts"),
      edit("t2", "src/b.ts"),
      edit("t3", "src/a.ts"),
      edit("t4", "src/c.ts", "failed"),
      block("t5", "tool", "", { tool: { kind: "read", title: "Read src/d.ts", status: "completed", paths: ["src/d.ts"] } }),
    ]);
    expect(touches).toEqual([
      { path: "src/a.ts", firstBlockId: "t1", lastBlockId: "t3", edits: 2 },
      { path: "src/b.ts", firstBlockId: "t2", lastBlockId: "t2", edits: 1 },
    ]);
  });
});

describe("store", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    resetSessionPanelStoreForTests();
  });

  it("runs one chat's changes in order so none is lost", async () => {
    let saved = "";
    mockInvoke.mockImplementation(async (command: string, args?: { panel?: { data: string } }) => {
      if (command === "session_panel_get") return saved ? { sessionId: "s1", data: saved, updatedAt: 1 } : null;
      if (command === "session_panel_save") saved = args!.panel!.data;
      return null;
    });
    await Promise.all([
      updateSessionPanel("s1", (data) => addBookmark(data, "u1", "One", 1)),
      updateSessionPanel("s1", (data) => addBookmark(data, "u2", "Two", 2)),
    ]);
    const data = await loadSessionPanel("s1");
    expect(data.bookmarks.map((b) => b.blockId)).toEqual(["u1", "u2"]);
    expect(parseSessionPanelData(saved).bookmarks).toHaveLength(2);
  });
});

describe("view settings", () => {
  it("clamps width and falls back on bad values", () => {
    expect(clampPanelWidth(10)).toBe(260);
    expect(clampPanelWidth(9999)).toBe(520);
    expect(clampPanelWidth(Number.NaN)).toBe(320);
    expect(parseSessionPanelView({ open: true, width: 400, tab: "files" })).toEqual({
      open: true,
      width: 400,
      tab: "files",
    });
    expect(parseSessionPanelView({ open: "yes", tab: "graph" })).toEqual({
      open: false,
      width: 320,
      tab: "summary",
    });
  });

  it("opens on Summary when the saved tab was removed, and keeps Timeline", () => {
    expect(parseSessionPanelView({ open: true, width: 300, tab: "decisions" }).tab).toBe("summary");
    expect(parseSessionPanelView({ open: true, width: 300, tab: "timeline" }).tab).toBe("timeline");
  });

  it("Open Session overview opens the panel on Summary and keeps the width", () => {
    const stored = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => void stored.set(key, value),
    });
    try {
      saveSessionPanelView({ open: false, width: 400, tab: "files" });
      openSessionOverview();
      expect(loadSessionPanelView()).toEqual({ open: true, width: 400, tab: "summary" });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("panelTextMatches (L-192)", () => {
  it("matches any text, ignoring case and outer spaces", () => {
    expect(panelTextMatches(" Panel ", "other", "Fix the panel width")).toBe(true);
    expect(panelTextMatches("panel", "other", undefined)).toBe(false);
  });

  it("matches everything when the query is blank", () => {
    expect(panelTextMatches("  ", undefined)).toBe(true);
  });
});

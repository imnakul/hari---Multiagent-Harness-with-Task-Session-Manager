import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  addBookmark,
  applyPointsReply,
  clampPanelWidth,
  editBookmark,
  editPoint,
  EMPTY_SESSION_PANEL,
  loadSessionPanel,
  panelBlocksAfter,
  parsePointsReply,
  parseSessionPanelData,
  parseSessionPanelView,
  removeBookmark,
  removePoint,
  resetSessionPanelStoreForTests,
  serializeSessionPanelData,
  sessionFileTouches,
  taggedTranscript,
  updateSessionPanel,
  type SessionPanelData,
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

const withPoint: SessionPanelData = {
  version: 1,
  points: [{ id: "p1", kind: "decision", text: "Use SQLite", blockId: "u1", at: 1, source: "ai" }],
  bookmarks: [],
};

describe("panel data", () => {
  it("reads stored JSON and drops broken entries", () => {
    const data = parseSessionPanelData(
      JSON.stringify({
        points: [
          { id: "p1", kind: "found", text: "  Race   in save ", blockId: "b1", at: 5, source: "user" },
          { id: "p2", kind: "nonsense", text: "x" },
          { id: "p3", kind: "event", text: "" },
        ],
        bookmarks: [{ id: "k1", blockId: "b2", text: "Here", at: 2 }, { id: "k2" }],
        leftOff: { text: "Wiring the panel", blockId: "b3", at: 9 },
        after: "b9",
      }),
    );
    expect(data.points).toEqual([
      { id: "p1", kind: "found", text: "Race in save", blockId: "b1", at: 5, source: "user" },
    ]);
    expect(data.bookmarks).toHaveLength(1);
    expect(data.leftOff).toEqual({ text: "Wiring the panel", blockId: "b3", at: 9 });
    expect(data.after).toBe("b9");
  });

  it("treats unreadable data as empty", () => {
    expect(parseSessionPanelData("{oops")).toEqual(EMPTY_SESSION_PANEL);
    expect(parseSessionPanelData(null)).toEqual(EMPTY_SESSION_PANEL);
  });

  it("stores nothing for an empty panel and round-trips the rest", () => {
    expect(serializeSessionPanelData(EMPTY_SESSION_PANEL)).toBe("");
    expect(parseSessionPanelData(serializeSessionPanelData(withPoint))).toEqual(withPoint);
  });
});

describe("edits", () => {
  it("marks edited AI points and removes emptied ones", () => {
    const edited = editPoint(withPoint, "p1", "Use SQLite, not JSON files");
    expect(edited.points[0]).toMatchObject({ text: "Use SQLite, not JSON files", edited: true });
    expect(editPoint(withPoint, "p1", "   ").points).toEqual([]);
    expect(removePoint(withPoint, "p1").points).toEqual([]);
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

describe("AI points", () => {
  const blocks = [
    block("u1", "user", "Let's store it in SQLite"),
    block("a1", "assistant", "Done, added the table."),
    block("x1", "system" as Block["role"], "ignored"),
    edit("t1", "src/a.ts"),
  ];

  it("tags each readable message with a short id", () => {
    const tagged = taggedTranscript(blocks);
    expect(tagged.text).toContain("[m1] User: Let's store it in SQLite");
    expect(tagged.text).toContain("[m2] Assistant: Done, added the table.");
    expect(tagged.text).toContain("[m3] Tool: Edit src/a.ts");
    expect(tagged.text).not.toContain("ignored");
    expect(tagged.ids.get("m1")).toBe("u1");
    expect(tagged.ids.get("m3")).toBe("t1");
  });

  it("parses points and links only known ids", () => {
    const { ids } = taggedTranscript(blocks);
    const reply = parsePointsReply(
      [
        "decision | m1 | Store panel data in SQLite.",
        "found | m99 | Unknown id keeps the point",
        "chatter that is not a point",
        "leftoff | m2 | Table added; next the UI",
      ].join("\n"),
      ids,
    );
    expect(reply).toEqual({
      kind: "add",
      points: [
        { kind: "decision", text: "Store panel data in SQLite", blockId: "u1" },
        { kind: "found", text: "Unknown id keeps the point" },
      ],
      leftOff: { text: "Table added; next the UI", blockId: "a1" },
    });
  });

  it("accepts NOTHING_NEW and rejects unusable replies", () => {
    expect(parsePointsReply("NOTHING_NEW.", new Map())).toEqual({ kind: "none" });
    expect(parsePointsReply("Sure! Here is a summary.", new Map())).toBeNull();
    expect(parsePointsReply("", new Map())).toBeNull();
  });

  it("adds AI points and moves the read marker", () => {
    const next = applyPointsReply(
      withPoint,
      { kind: "add", points: [{ kind: "event", text: "Added table", blockId: "a1" }], leftOff: { text: "UI next" } },
      "a1",
      7,
    );
    expect(next.points).toHaveLength(2);
    expect(next.points[1]).toMatchObject({ kind: "event", text: "Added table", blockId: "a1", at: 7, source: "ai" });
    expect(next.leftOff).toEqual({ text: "UI next", at: 7 });
    expect(next.after).toBe("a1");
    expect(applyPointsReply(withPoint, { kind: "none" }, "t1").after).toBe("t1");
  });

  it("reads only finished blocks after the marker, or all when it is gone", () => {
    const list = [...blocks, block("a2", "assistant", "typing", { streaming: true } as Partial<Block>)];
    expect(panelBlocksAfter(list, "a1").map((b) => b.id)).toEqual(["x1", "t1"]);
    expect(panelBlocksAfter(list, "gone").map((b) => b.id)).toEqual(["u1", "a1", "x1", "t1"]);
    expect(panelBlocksAfter(list, undefined)).toHaveLength(4);
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
      tab: "timeline",
    });
  });
});

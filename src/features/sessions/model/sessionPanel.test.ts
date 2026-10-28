import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  addBookmark,
  clampPanelWidth,
  editBookmark,
  EMPTY_SESSION_PANEL,
  loadSessionPanel,
  loadSessionPanelView,
  openSessionOverview,
  parseSessionPanelData,
  parseSessionPanelView,
  removeBookmark,
  resetSessionPanelStoreForTests,
  saveSessionPanelView,
  serializeSessionPanelData,
  sessionFileTouches,
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

const withQuote: SessionPanelData = {
  version: 1,
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

  // Panels saved before L-192 also hold AI points and a Left off; they are
  // ignored rather than failing the bookmarks.
  it("keeps the bookmarks of a panel saved with the old timeline", () => {
    const data = parseSessionPanelData(
      JSON.stringify({
        points: [{ id: "p1", kind: "decision", text: "Use SQLite", blockId: "u1", at: 1, source: "ai" }],
        bookmarks: [{ id: "k1", blockId: "b2", text: "Here", at: 2 }],
        leftOff: { text: "Wiring the panel", at: 9 },
        after: "b9",
      }),
    );
    expect(data).toEqual({ version: 1, bookmarks: [{ id: "k1", blockId: "b2", text: "Here", at: 2 }] });
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

  it("opens on Summary when the saved tab was removed", () => {
    expect(parseSessionPanelView({ open: true, width: 300, tab: "timeline" }).tab).toBe("summary");
    expect(parseSessionPanelView({ open: true, width: 300, tab: "decisions" }).tab).toBe("summary");
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

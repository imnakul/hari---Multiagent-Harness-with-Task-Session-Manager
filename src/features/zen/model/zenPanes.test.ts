import { describe, expect, it } from "vitest";
import {
  clampZenSplit,
  EMPTY_ZEN_GRID,
  zenCanPlace,
  zenClose,
  zenEntryGrid,
  zenGridOf,
  zenGridOfRows,
  zenHasColumns,
  zenIds,
  zenNextChat,
  zenNormalize,
  zenPlace,
  zenPut,
  zenRows,
  zenShow,
  zenSplitPlace,
} from "./zenPanes";
import {
  narrowedZenBounds,
  parseZenBounds,
  parseZenRestore,
  parseZenWiden,
} from "./zenWindow";

describe("Zen panes (L-230)", () => {
  it("holds at most two rows of two chats", () => {
    expect(zenGridOf(["a", "b", "c"])).toEqual({
      columns: [["a"], ["b"]],
      overflow: [],
    });
    expect(zenGridOf(["a", "a"])).toEqual({ columns: [["a"]], overflow: [] });
    expect(zenGridOf([])).toEqual(EMPTY_ZEN_GRID);
    expect(
      zenRows({ columns: [["a", "b", "c"], [], ["a", "d"], ["e"]], overflow: [] }),
    ).toEqual([["a", "b"], ["d"]]);
  });

  it("reads rows in order and ignores the overflow", () => {
    expect(
      zenIds({ columns: [["a", "b"], ["c"]], overflow: ["d"] }),
    ).toEqual(["a", "b", "c"]);
  });

  it("tidying keeps a tidy grid as it is", () => {
    const grid = zenGridOfRows([["a", "b"], ["c"]]);
    expect(zenNormalize(grid)).toBe(grid);
    expect(
      zenNormalize({ columns: [[], ["a"]], overflow: ["b"] }),
    ).toEqual({ columns: [["a"]], overflow: [] });
  });

  it("knows when chats sit side by side", () => {
    expect(zenHasColumns(zenGridOfRows([["a"], ["b"]]))).toBe(false);
    expect(zenHasColumns(zenGridOfRows([["a"], ["b", "c"]]))).toBe(true);
  });

  it("shows a chat in a pane, trading places with the other pane", () => {
    const two = zenGridOf(["a", "b"]);
    expect(zenIds(zenShow(two, 0, "c"))).toEqual(["c", "b"]);
    expect(zenIds(zenShow(two, 0, "b"))).toEqual(["b", "a"]);
    expect(zenShow(two, 1, "b")).toBe(two);
  });

  it("adds a pane when the slot is past the last one", () => {
    expect(zenRows(zenShow(zenGridOf(["a"]), 1, "b"))).toEqual([["a"], ["b"]]);
    expect(zenIds(zenShow(zenGridOf(["a"]), 1, "a"))).toEqual(["a"]);
    expect(zenIds(zenShow(EMPTY_ZEN_GRID, 0, "a"))).toEqual(["a"]);
    // Both rows used: it goes beside the first chat alone in its row.
    expect(zenRows(zenShow(zenGridOfRows([["a", "b"], ["c"]]), 3, "d"))).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
    const full = zenGridOfRows([["a", "b"], ["c", "d"]]);
    expect(zenShow(full, 4, "e")).toBe(full);
  });

  it("places a chat beside or below another while there is room", () => {
    const one = zenGridOf(["a"]);
    expect(zenRows(zenPlace(one, "b", "a", "beside"))).toEqual([["a", "b"]]);
    expect(zenRows(zenPlace(one, "b", "a", "below"))).toEqual([["a"], ["b"]]);
    const twoRows = zenGridOfRows([["a"], ["b"]]);
    expect(zenCanPlace(twoRows, "a", "below")).toBe(false);
    expect(zenPlace(twoRows, "c", "a", "below")).toBe(twoRows);
    expect(zenRows(zenPlace(twoRows, "c", "b", "beside"))).toEqual([
      ["a"],
      ["b", "c"],
    ]);
  });

  it("moves a chat that already shows instead of showing it twice", () => {
    const grid = zenGridOfRows([["a", "b"], ["c"]]);
    expect(zenCanPlace(grid, "c", "beside", "b")).toBe(true);
    expect(zenRows(zenPlace(grid, "b", "c", "beside"))).toEqual([["a"], ["c", "b"]]);
    expect(zenCanPlace(grid, "a", "beside", "a")).toBe(false);
  });

  it("Split adds below with one row, else beside", () => {
    expect(zenSplitPlace(zenGridOf(["a"]), "a")).toBe("below");
    expect(zenSplitPlace(zenGridOfRows([["a"], ["b"]]), "a")).toBe("beside");
    expect(zenSplitPlace(zenGridOfRows([["a", "b"]]), "a")).toBe("below");
    expect(
      zenSplitPlace(zenGridOfRows([["a", "b"], ["c", "d"]]), "a"),
    ).toBeUndefined();
  });

  it("puts a chat in a slot or next to a chat", () => {
    const one = zenGridOf(["a"]);
    expect(zenIds(zenPut(one, 0, "b"))).toEqual(["b"]);
    expect(zenRows(zenPut(one, { target: "a", where: "beside" }, "b"))).toEqual([
      ["a", "b"],
    ]);
  });

  it("closing a chat reflows the others", () => {
    expect(zenIds(zenClose(zenGridOf(["a", "b"]), "a"))).toEqual(["b"]);
    expect(zenClose(zenGridOf(["a"]), "a")).toEqual(EMPTY_ZEN_GRID);
    const one = zenGridOf(["a"]);
    expect(zenClose(one, "x")).toBe(one);
    // A lone chat spans its row; an emptied row goes.
    expect(zenRows(zenClose(zenGridOfRows([["a", "b"], ["c"]]), "b"))).toEqual([
      ["a"],
      ["c"],
    ]);
    expect(zenRows(zenClose(zenGridOfRows([["a", "b"], ["c"]]), "c"))).toEqual([
      ["a", "b"],
    ]);
  });

  it("opens with the chat in use, else the first running one", () => {
    expect(zenIds(zenEntryGrid("a", ["b"]))).toEqual(["a"]);
    expect(zenIds(zenEntryGrid(undefined, ["b", "c"]))).toEqual(["b"]);
    expect(zenEntryGrid(undefined, [])).toEqual(EMPTY_ZEN_GRID);
  });

  it("picks the next chat that is not showing", () => {
    expect(zenNextChat(["a", "b", "c"], ["a"])).toBe("b");
    expect(zenNextChat(["a"], ["a"])).toBeUndefined();
  });

  it("keeps both halves of a split usable", () => {
    expect(clampZenSplit(0.05)).toBe(0.2);
    expect(clampZenSplit(0.95)).toBe(0.8);
    expect(clampZenSplit(Number.NaN)).toBe(0.5);
    expect(clampZenSplit(0.6)).toBe(0.6);
  });
});

describe("Zen window records (L-230)", () => {
  const box = { x: -10, y: 0, width: 480, height: 1040 };

  it("reads saved bounds and ignores broken ones", () => {
    expect(parseZenBounds(JSON.stringify(box))).toEqual(box);
    expect(parseZenBounds(JSON.stringify({ ...box, width: 0 }))).toBeNull();
    expect(parseZenBounds(JSON.stringify({ ...box, x: 1.5 }))).toBeNull();
    expect(parseZenBounds("{")).toBeNull();
    expect(parseZenBounds(null)).toBeNull();
  });

  it("reads the size to restore after a close in Zen", () => {
    const restore = { bounds: box, maximized: true };
    expect(parseZenRestore(JSON.stringify(restore))).toEqual(restore);
    expect(parseZenRestore(JSON.stringify({ bounds: box }))).toBeNull();
    expect(parseZenRestore("null")).toBeNull();
  });

  it("reads a widening and ignores broken ones", () => {
    const widen = { before: 480, after: 720 };
    expect(parseZenWiden(JSON.stringify(widen))).toEqual(widen);
    expect(parseZenWiden(JSON.stringify({ before: 720, after: 480 }))).toBeNull();
    expect(parseZenWiden(JSON.stringify({ before: 0, after: 480 }))).toBeNull();
    expect(parseZenWiden(JSON.stringify({ before: 1.5, after: 480 }))).toBeNull();
    expect(parseZenWiden(null)).toBeNull();
  });

  it("saves a widened panel at its one-column width, right edge kept", () => {
    const widen = { before: 480, after: 720 };
    const wide = { x: 1200, y: 0, width: 720, height: 1040 };
    expect(narrowedZenBounds(wide, widen)).toEqual({
      x: 1440,
      y: 0,
      width: 480,
      height: 1040,
    });
    // Resized since: kept as it is.
    const resized = { ...wide, width: 900 };
    expect(narrowedZenBounds(resized, widen)).toBe(resized);
    expect(narrowedZenBounds(wide, null)).toBe(wide);
  });
});

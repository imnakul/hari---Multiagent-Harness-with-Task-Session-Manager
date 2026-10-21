import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EMPTY_FOCUS_GRID,
  addToFocusGrid,
  focusColumnCap,
  focusGridIds,
  loadFocusGrid,
  moveInFocusGrid,
  moveListItem,
  parseFocusGrid,
  pruneFocusGrid,
  removeFromFocusGrid,
  reorderFocusGrid,
  saveFocusGrid,
  swapInFocusGrid,
  visibleFocusGrid,
  type FocusGrid,
} from "./focusGrid";

const gridOf = (count: number): FocusGrid =>
  Array.from({ length: count }, (_, i) => `s${i + 1}`).reduce(
    addToFocusGrid,
    EMPTY_FOCUS_GRID,
  );

describe("addToFocusGrid", () => {
  it("fills columns first, then splits columns from the left", () => {
    expect(gridOf(4).columns).toEqual([["s1"], ["s2"], ["s3"], ["s4"]]);
    expect(gridOf(5).columns).toEqual([["s1", "s5"], ["s2"], ["s3"], ["s4"]]);
    expect(gridOf(8).columns).toEqual([
      ["s1", "s5"],
      ["s2", "s6"],
      ["s3", "s7"],
      ["s4", "s8"],
    ]);
  });

  it("sends the 9th chat to overflow and ignores a chat already there", () => {
    const grid = gridOf(9);
    expect(grid.overflow).toEqual(["s9"]);
    expect(addToFocusGrid(grid, "s3")).toBe(grid);
  });
});

describe("removeFromFocusGrid", () => {
  it("collapses an emptied column without moving the others", () => {
    const grid = removeFromFocusGrid(gridOf(5), "s2");
    expect(grid.columns).toEqual([["s1", "s5"], ["s3"], ["s4"]]);
  });

  it("closes the gap in a split column", () => {
    expect(removeFromFocusGrid(gridOf(5), "s1").columns).toEqual([
      ["s5"],
      ["s2"],
      ["s3"],
      ["s4"],
    ]);
  });

  it("moves the oldest waiting chat into the freed place", () => {
    const grid = removeFromFocusGrid(gridOf(10), "s6");
    expect(grid.columns[1]).toEqual(["s2", "s9"]);
    expect(grid.overflow).toEqual(["s10"]);
  });
});

describe("pruneFocusGrid", () => {
  it("drops chats that no longer exist and keeps the grid when nothing goes", () => {
    const grid = gridOf(3);
    expect(pruneFocusGrid(grid, () => true)).toBe(grid);
    expect(pruneFocusGrid(grid, (id) => id !== "s2").columns).toEqual([
      ["s1"],
      ["s3"],
    ]);
  });
});

describe("moveInFocusGrid", () => {
  it("swaps on a centre drop", () => {
    expect(moveInFocusGrid(gridOf(3), "s1", "s3", "center")?.columns).toEqual([
      ["s3"],
      ["s2"],
      ["s1"],
    ]);
  });

  it("makes a column beside the target on a side drop", () => {
    expect(moveInFocusGrid(gridOf(3), "s1", "s2", "right")?.columns).toEqual([
      ["s2"],
      ["s1"],
      ["s3"],
    ]);
  });

  it("shares the target's column on a top or bottom drop", () => {
    expect(moveInFocusGrid(gridOf(3), "s3", "s1", "top")?.columns).toEqual([
      ["s3", "s1"],
      ["s2"],
    ]);
    expect(moveInFocusGrid(gridOf(5), "s5", "s1", "top")?.columns).toEqual([
      ["s5", "s1"],
      ["s2"],
      ["s3"],
      ["s4"],
    ]);
  });

  it("refuses a 5th column, a 3rd row, and a drop on itself", () => {
    expect(moveInFocusGrid(gridOf(5), "s5", "s3", "right")).toBeNull();
    expect(moveInFocusGrid(gridOf(6), "s3", "s2", "bottom")).toBeNull();
    expect(moveInFocusGrid(gridOf(2), "s1", "s1", "left")).toBeNull();
  });

  it("allows a side drop when leaving a column frees one", () => {
    expect(moveInFocusGrid(gridOf(4), "s4", "s1", "left")?.columns).toEqual([
      ["s4"],
      ["s1"],
      ["s2"],
      ["s3"],
    ]);
  });
});

describe("swapInFocusGrid", () => {
  it("trades a waiting chat with a placed one", () => {
    const grid = swapInFocusGrid(gridOf(9), "s9", "s2");
    expect(grid.columns[1]).toEqual(["s9", "s6"]);
    expect(grid.overflow).toEqual(["s2"]);
  });
});

describe("visibleFocusGrid", () => {
  it("lists columns past the cap with overflow, without moving them", () => {
    const grid = gridOf(9);
    expect(focusColumnCap(600)).toBe(1);
    expect(focusColumnCap(900)).toBe(2);
    expect(focusColumnCap(1400)).toBe(4);
    expect(visibleFocusGrid(grid, 2)).toEqual({
      columns: [
        ["s1", "s5"],
        ["s2", "s6"],
      ],
      hidden: ["s3", "s7", "s4", "s8", "s9"],
    });
  });
});

describe("parseFocusGrid", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("ignores malformed data", () => {
    expect(parseFocusGrid(null)).toEqual(EMPTY_FOCUS_GRID);
    expect(parseFocusGrid({ columns: "x" })).toEqual(EMPTY_FOCUS_GRID);
    expect(parseFocusGrid({ columns: [[1]] })).toEqual(EMPTY_FOCUS_GRID);
  });

  it("re-places duplicates and over-full columns by the normal rules", () => {
    const grid = parseFocusGrid({ columns: [["a", "b", "c"], ["a"]] });
    expect(focusGridIds(grid)).toEqual(["a", "b", "c"]);
    expect(grid.columns).toEqual([["a"], ["b"], ["c"]]);
  });

  it("round-trips through storage", () => {
    const grid = gridOf(6);
    saveFocusGrid(grid);
    expect(loadFocusGrid()).toEqual(grid);
  });
});

describe("reorderFocusGrid (L-159)", () => {
  const grid = { columns: [["a1", "b1"], ["a2"], ["b2"]], overflow: ["a3"] };

  it("moves the listed chats through their own places only", () => {
    expect(reorderFocusGrid(grid, ["a3", "a1", "a2"])).toEqual({
      columns: [["a3", "b1"], ["a1"], ["b2"]],
      overflow: ["a2"],
    });
  });

  it("can reorder every chat while the grid keeps its shape", () => {
    expect(
      reorderFocusGrid(grid, ["b1", "b2", "a1", "a2", "a3"]),
    ).toEqual({ columns: [["b1", "b2"], ["a1"], ["a2"]], overflow: ["a3"] });
  });

  it("ignores an order with unknown or repeated chats", () => {
    expect(reorderFocusGrid(grid, ["a1", "zz"])).toBe(grid);
    expect(reorderFocusGrid(grid, ["a1", "a1"])).toBe(grid);
  });

  it("moves a list entry to a new index", () => {
    expect(moveListItem(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
    expect(moveListItem(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
  });
});

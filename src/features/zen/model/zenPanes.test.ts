import { describe, expect, it } from "vitest";
import {
  clampZenSplit,
  EMPTY_ZEN_GRID,
  zenClose,
  zenEntryGrid,
  zenGridOf,
  zenIds,
  zenNextChat,
  zenShow,
} from "./zenPanes";
import { parseZenBounds, parseZenRestore } from "./zenWindow";

describe("Zen panes (L-230)", () => {
  it("holds at most two chats in one column", () => {
    expect(zenGridOf(["a", "b", "c"])).toEqual({
      columns: [["a", "b"]],
      overflow: [],
    });
    expect(zenGridOf(["a", "a"])).toEqual({ columns: [["a"]], overflow: [] });
    expect(zenGridOf([])).toEqual(EMPTY_ZEN_GRID);
  });

  it("reads only the first column of a Focus grid", () => {
    expect(
      zenIds({ columns: [["a", "b"], ["c"]], overflow: ["d"] }),
    ).toEqual(["a", "b"]);
  });

  it("shows a chat in a pane, trading places with the other pane", () => {
    const two = zenGridOf(["a", "b"]);
    expect(zenIds(zenShow(two, 0, "c"))).toEqual(["c", "b"]);
    expect(zenIds(zenShow(two, 0, "b"))).toEqual(["b", "a"]);
    expect(zenShow(two, 1, "b")).toBe(two);
  });

  it("adds a pane when the slot is past the last one", () => {
    expect(zenIds(zenShow(zenGridOf(["a"]), 1, "b"))).toEqual(["a", "b"]);
    expect(zenIds(zenShow(zenGridOf(["a"]), 1, "a"))).toEqual(["a"]);
    expect(zenIds(zenShow(EMPTY_ZEN_GRID, 0, "a"))).toEqual(["a"]);
  });

  it("closing a chat lets the other fill the panel", () => {
    expect(zenIds(zenClose(zenGridOf(["a", "b"]), "a"))).toEqual(["b"]);
    expect(zenClose(zenGridOf(["a"]), "a")).toEqual(EMPTY_ZEN_GRID);
    const one = zenGridOf(["a"]);
    expect(zenClose(one, "x")).toBe(one);
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
});

import { describe, expect, it } from "vitest";
import {
  EMPTY_FOCUS_LAYOUT,
  focusColumnShares,
  focusRowSplit,
  parseFocusLayout,
  resetFocusLayout,
  resizeFocusColumns,
  setFocusRowSplit,
} from "./focusLayout";

const columns = [["a"], ["b", "c"], ["d"]];

describe("focus layout (L-143)", () => {
  it("shares the width equally by default", () => {
    expect(focusColumnShares(columns, EMPTY_FOCUS_LAYOUT)).toEqual([
      1 / 3,
      1 / 3,
      1 / 3,
    ]);
  });

  it("moves one edge and leaves the other columns alone", () => {
    const next = resizeFocusColumns(EMPTY_FOCUS_LAYOUT, columns, 0, 0.5, 0.1);
    const shares = focusColumnShares(columns, next);
    expect(shares[0]).toBeCloseTo(0.5);
    expect(shares[1]).toBeCloseTo(1 / 6);
    expect(shares[2]).toBeCloseTo(1 / 3);
  });

  it("keeps both columns at the minimum share", () => {
    const next = resizeFocusColumns(EMPTY_FOCUS_LAYOUT, columns, 1, 0.99, 0.1);
    const shares = focusColumnShares(columns, next);
    expect(shares[2]).toBeCloseTo(0.1);
    expect(shares[1]).toBeCloseTo(2 / 3 - 0.1);
  });

  it("keeps a column's width when it moves, keyed by its first chat", () => {
    const next = resizeFocusColumns(EMPTY_FOCUS_LAYOUT, columns, 0, 0.5, 0.1);
    const moved = [["d"], ["a"], ["b", "c"]];
    expect(focusColumnShares(moved, next)[1]).toBeCloseTo(0.5);
  });

  it("splits a column in half until moved, and clamps the split", () => {
    expect(focusRowSplit(["b", "c"], EMPTY_FOCUS_LAYOUT)).toBe(0.5);
    const next = setFocusRowSplit(EMPTY_FOCUS_LAYOUT, ["b", "c"], 0.95, 0.2);
    expect(focusRowSplit(["b", "c"], next)).toBeCloseTo(0.8);
  });

  it("resets only the shown columns", () => {
    let layout = resizeFocusColumns(EMPTY_FOCUS_LAYOUT, columns, 0, 0.5, 0.1);
    layout = setFocusRowSplit(layout, ["x", "y"], 0.3, 0.1);
    const reset = resetFocusLayout(layout, columns);
    expect(focusColumnShares(columns, reset)).toEqual([1 / 3, 1 / 3, 1 / 3]);
    expect(focusRowSplit(["x", "y"], reset)).toBeCloseTo(0.3);
  });

  it("drops invalid stored values", () => {
    expect(
      parseFocusLayout({
        widths: { a: 2, b: -1, c: "x" },
        splits: { a: 0.4, b: 1.5 },
      }),
    ).toEqual({ widths: { a: 2 }, splits: { a: 0.4 } });
    expect(parseFocusLayout("nope")).toEqual(EMPTY_FOCUS_LAYOUT);
  });
});

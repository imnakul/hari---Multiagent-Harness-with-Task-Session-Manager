import { describe, expect, it } from "vitest";
import { swapInFocusGrid, visibleFocusGrid, type FocusGrid } from "./focusGrid";
import {
  focusAfterClose,
  focusProjectGroups,
  projectFocusGrid,
} from "./focusGroups";

const CWD: Record<string, string> = {
  a1: "C:/work/alpha",
  a2: "C:/work/alpha",
  a3: "C:/work/alpha",
  b1: "C:/work/beta",
  b2: "C:/work/beta",
};
const cwdOf = (id: string) => CWD[id];

const FULL: FocusGrid = {
  columns: [["b1", "a1"], ["a2"], ["b2"], ["x"]],
  overflow: ["a3"],
};

describe("focusProjectGroups (L-128)", () => {
  it("groups by project in the order each first appears, unknown project in its own group", () => {
    const groups = focusProjectGroups(FULL, cwdOf);
    expect(groups.map((g) => [g.cwd, g.ids])).toEqual([
      ["C:/work/beta", ["b1", "b2"]],
      ["C:/work/alpha", ["a1", "a2", "a3"]],
      [undefined, ["x"]],
    ]);
    expect(groups[2].key).toBe("");
  });

  it("puts paths that differ only by case or slashes in one project", () => {
    const groups = focusProjectGroups(
      { columns: [["p"], ["q"]], overflow: [] },
      (id) => (id === "p" ? "C:/Work/Alpha" : "c:\\work\\alpha"),
    );
    expect(groups).toHaveLength(1);
  });
});

describe("projectFocusGrid (L-128)", () => {
  const alpha = () => focusProjectGroups(FULL, cwdOf)[1];

  it("keeps the project's chats in order and fills freed places from its waiting ones", () => {
    expect(projectFocusGrid(FULL, alpha())).toEqual({
      columns: [["a1"], ["a2"], ["a3"]],
      overflow: [],
    });
  });

  it("leaves the full grid untouched", () => {
    const before = structuredClone(FULL);
    projectFocusGrid(FULL, alpha());
    expect(FULL).toEqual(before);
  });

  it("shows a swap made in the full grid as the same swap in the project view", () => {
    const swapped = swapInFocusGrid(FULL, "a3", "a1");
    const group = focusProjectGroups(swapped, cwdOf)[1];
    expect(projectFocusGrid(swapped, group).columns).toEqual([
      ["a3"],
      ["a2"],
      ["a1"],
    ]);
  });

  it("brings an off-screen chat into a narrow view by swapping", () => {
    const view = visibleFocusGrid(projectFocusGrid(FULL, alpha()), 2);
    expect(view.hidden).toEqual(["a3"]);
    const swapped = swapInFocusGrid(FULL, "a3", "a2");
    const after = visibleFocusGrid(
      projectFocusGrid(swapped, focusProjectGroups(swapped, cwdOf)[1]),
      2,
    );
    expect(after.columns.flat()).toContain("a3");
    expect(after.hidden).toEqual(["a2"]);
  });
});

describe("focusAfterClose (L-146)", () => {
  const cwds: Record<string, string> = {
    p1: "C:/work/portfolio",
    f1: "C:/work/fph",
    f2: "C:/work/fph",
    t1: "C:/work/teacher",
  };
  const grid = { columns: [["p1"], ["f1"], ["t1"], ["f2"]], overflow: [] };
  const cwdOf = (id: string) => cwds[id];

  it("stays in the closed chat's project", () => {
    expect(focusAfterClose(grid, "f2", cwdOf)).toBe("f1");
    expect(focusAfterClose(grid, "f1", cwdOf)).toBe("f2");
  });

  it("falls back to the nearest chat when the project has no other", () => {
    expect(focusAfterClose(grid, "t1", cwdOf)).toBe("f1");
  });

  it("returns nothing for a chat not in the grid", () => {
    expect(focusAfterClose(grid, "zz", cwdOf)).toBeUndefined();
  });
});

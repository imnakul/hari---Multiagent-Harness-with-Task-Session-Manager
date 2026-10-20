import { afterEach, describe, expect, it, vi } from "vitest";
import {
  closeProjectTab,
  loadProjectTabs,
  saveProjectTabs,
  toggleProjectTab,
  visibleProjectTabs,
} from "./projectTabs";

const A = "C:/work/alpha";
const B = "C:/work/beta";
const C = "C:/work/gamma";

describe("toggleProjectTab (L-130)", () => {
  it("adds the project and the current one, so switching back is one click", () => {
    expect(toggleProjectTab([], B, A)).toEqual([A, B]);
  });

  it("does not add the current project twice", () => {
    expect(toggleProjectTab([A, B], C, A)).toEqual([A, B, C]);
  });

  it("removes a project that is already a tab, matching case and slashes", () => {
    expect(toggleProjectTab([A, B], "c:\\work\\BETA", A)).toEqual([A]);
  });

  it("leaves the tabs alone for the current project", () => {
    expect(toggleProjectTab([B], A, A)).toEqual([B]);
  });
});

describe("visibleProjectTabs (L-130)", () => {
  it("keeps added order, skipping removed projects and duplicates", () => {
    expect(
      visibleProjectTabs([A, C, B, "C:/Work/Gamma"], [A, B, C]),
    ).toEqual([A, C, B]);
    expect(visibleProjectTabs([A, B], [A])).toEqual([A]);
  });

  it("closes one tab", () => {
    expect(closeProjectTab([A, B, C], B)).toEqual([A, C]);
  });
});

describe("project tab storage (L-130)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("round-trips and ignores bad data", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
    });
    expect(loadProjectTabs()).toEqual([]);
    saveProjectTabs([A, B]);
    expect(loadProjectTabs()).toEqual([A, B]);
    store.set("monocode.insetProjectTabs.v1", '[1, "x", null]');
    expect(loadProjectTabs()).toEqual(["x"]);
    store.set("monocode.insetProjectTabs.v1", "{nope");
    expect(loadProjectTabs()).toEqual([]);
  });
});

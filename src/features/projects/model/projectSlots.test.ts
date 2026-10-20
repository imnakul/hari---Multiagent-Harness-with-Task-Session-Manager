import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_PROJECT_SLOTS,
  addProjectSlot,
  closeProjectSlot,
  loadProjectSlots,
  pruneProjectSlots,
  saveProjectSlots,
  slotAfterClosing,
  syncProjectSlots,
} from "./projectSlots";

const A = "C:/work/alpha";
const B = "C:/work/beta";
const C = "C:/work/gamma";
const D = "C:/work/delta";
const E = "C:/work/epsilon";

describe("project slots (L-132)", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("starts with the current project as the only slot", () => {
    expect(syncProjectSlots({ paths: [], active: 0 }, A)).toEqual({
      paths: [A],
      active: 0,
    });
  });

  it("activates a project's own slot, matching paths loosely", () => {
    expect(
      syncProjectSlots({ paths: [A, B], active: 0 }, "c:\\work\\BETA"),
    ).toEqual({
      paths: [A, B],
      active: 1,
    });
  });

  it("puts a project switched to elsewhere in the active slot", () => {
    expect(syncProjectSlots({ paths: [A, B, C], active: 1 }, D)).toEqual({
      paths: [A, D, C],
      active: 1,
    });
  });

  it("adds a slot at the end and makes it active", () => {
    expect(addProjectSlot({ paths: [A], active: 0 }, B)).toEqual({
      paths: [A, B],
      active: 1,
    });
  });

  it("activates a project that already has a slot instead of repeating it", () => {
    expect(addProjectSlot({ paths: [A, B], active: 1 }, A)).toEqual({
      paths: [A, B],
      active: 0,
    });
  });

  it(`stops at ${MAX_PROJECT_SLOTS} slots`, () => {
    const full = { paths: [A, B, C, D], active: 0 };
    expect(addProjectSlot(full, E)).toBe(full);
  });

  it("never closes the last slot", () => {
    const one = { paths: [A], active: 0 };
    expect(closeProjectSlot(one, A)).toBe(one);
    expect(slotAfterClosing(one, A)).toBeUndefined();
  });

  it("moves to the right neighbour when the active slot closes, else the left", () => {
    expect(closeProjectSlot({ paths: [A, B, C], active: 1 }, B)).toEqual({
      paths: [A, C],
      active: 1,
    });
    expect(slotAfterClosing({ paths: [A, B, C], active: 1 }, B)).toBe(C);
    expect(closeProjectSlot({ paths: [A, B, C], active: 2 }, C)).toEqual({
      paths: [A, B],
      active: 1,
    });
    expect(slotAfterClosing({ paths: [A, B, C], active: 2 }, C)).toBe(B);
  });

  it("keeps the active slot on its project when an earlier one closes", () => {
    expect(closeProjectSlot({ paths: [A, B, C], active: 2 }, A)).toEqual({
      paths: [B, C],
      active: 1,
    });
  });

  it("drops removed projects and repeats, keeping the active project", () => {
    expect(
      pruneProjectSlots(
        { paths: [A, B, A, C], active: 3 },
        (path) => path !== B,
      ),
    ).toEqual({ paths: [A, C], active: 1 });
  });

  it("persists slots and ignores malformed storage", () => {
    saveProjectSlots({ paths: [A, B], active: 1 });
    expect(loadProjectSlots()).toEqual({ paths: [A, B], active: 1 });
    localStorage.setItem(
      "monocode.insetProjectSlots.v1",
      JSON.stringify({ paths: [A, 3, B], active: 9 }),
    );
    expect(loadProjectSlots()).toEqual({ paths: [A, B], active: 1 });
    localStorage.setItem("monocode.insetProjectSlots.v1", "{");
    expect(loadProjectSlots()).toEqual({ paths: [], active: 0 });
  });
});

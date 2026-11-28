import { describe, expect, it, vi } from "vitest";

vi.mock("expo-sqlite/kv-store", () => ({
  default: { getItemSync: vi.fn(() => null), setItem: vi.fn(() => Promise.resolve()) },
}));

import {
  arcWithSelection,
  emptyMemory,
  nextSelection,
  parseTabsMemory,
  pruneArc,
  pruneRecent,
  pushRecent,
  selectInArc,
} from "@/features/tabs/tabsMemory";

describe("pushRecent (AC-12)", () => {
  it("puts the newest first and drops the oldest past five", () => {
    expect(pushRecent(["A", "B", "C", "D", "E"], "F")).toEqual(["F", "A", "B", "C", "D"]);
  });
  it("moves an id already there to the front without duplicates", () => {
    expect(pushRecent(["A", "B", "C"], "C")).toEqual(["C", "A", "B"]);
  });
});

describe("arcWithSelection", () => {
  it("keeps a place already on the arc where it is, so circles don't jump", () => {
    expect(arcWithSelection({ recent: ["A", "B", "C"], selected: "A" }, "C")).toEqual({
      recent: ["A", "B", "C"],
      selected: "C",
    });
  });
  it("adds a new place next to All and drops the oldest past five", () => {
    expect(arcWithSelection({ recent: ["A", "B", "C", "D", "E"], selected: "all" }, "F")).toEqual({
      recent: ["F", "A", "B", "C", "D"],
      selected: "F",
    });
  });
  it("selects All without touching the recent places", () => {
    expect(arcWithSelection({ recent: ["A"], selected: "A" }, "all")).toEqual({ recent: ["A"], selected: "all" });
  });
});

describe("pruneRecent and nextSelection (AC-15)", () => {
  it("keeps only places that exist", () => {
    expect(pruneRecent(["A", "B", "C"], new Set(["A", "C"]))).toEqual(["A", "C"]);
  });
  it("falls back to all when the selected place is gone", () => {
    expect(nextSelection("B", ["A", "C"])).toBe("all");
    expect(nextSelection("A", ["A", "C"])).toBe("A");
    expect(nextSelection("all", ["A"])).toBe("all");
  });
  it("prunes the stored arc, returns what went, and selects all if it was selected", () => {
    selectInArc("d1", "sessions", "A");
    selectInArc("d1", "sessions", "B");
    expect(pruneArc("d1", "sessions", new Set(["A"]))).toEqual(["B"]);
    expect(pruneArc("d1", "sessions", new Set(["A"]))).toEqual([]);
  });
});

describe("parseTabsMemory", () => {
  it("gives defaults for nothing, corrupt JSON and non-objects", () => {
    expect(parseTabsMemory(null)).toEqual(emptyMemory());
    expect(parseTabsMemory("{nope")).toEqual(emptyMemory());
    expect(parseTabsMemory("5")).toEqual(emptyMemory());
  });
  it("defaults an unknown tab and a non-array recent list", () => {
    const memory = parseTabsMemory(
      JSON.stringify({ tab: "weather", arcs: { sessions: { recent: "A", selected: "A" } } }),
    );
    expect(memory.tab).toBe("sessions");
    expect(memory.arcs.sessions).toEqual({ recent: [], selected: "all" });
  });
  it("restores a saved tab and arc, dropping duplicates and a stale selection", () => {
    const memory = parseTabsMemory(
      JSON.stringify({
        tab: "running",
        arcs: { monos: { recent: ["m1", "m1", 3, "m2"], selected: "gone" } },
      }),
    );
    expect(memory.tab).toBe("running");
    expect(memory.arcs.monos).toEqual({ recent: ["m1", "m2"], selected: "all" });
  });
});

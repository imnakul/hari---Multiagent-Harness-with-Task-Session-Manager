import { describe, expect, it, vi } from "vitest";

vi.mock("expo-sqlite/kv-store", () => ({ default: { getItemSync: () => null, setItem: async () => {} } }));

const { pinnedFirst } = await import("../src/features/sessions/sessionPins");

describe("pinnedFirst", () => {
  const sessions = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];

  it("keeps the list as it is with no pins", () => {
    expect(pinnedFirst(sessions, []).map((s) => s.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("puts pinned sessions first, latest pin first, and the rest in order", () => {
    expect(pinnedFirst(sessions, ["d", "b"]).map((s) => s.id)).toEqual(["d", "b", "a", "c"]);
  });

  it("ignores pins for sessions not in the list", () => {
    expect(pinnedFirst(sessions, ["zz", "c"]).map((s) => s.id)).toEqual(["c", "a", "b", "d"]);
  });
});

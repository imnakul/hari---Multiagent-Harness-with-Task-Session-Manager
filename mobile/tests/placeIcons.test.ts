import { describe, expect, it, vi } from "vitest";

vi.mock("expo-sqlite/kv-store", () => ({
  default: { getItemSync: vi.fn(() => null), setItem: vi.fn(() => Promise.resolve()) },
}));

import {
  firstGrapheme,
  parsePlaceIcons,
  PLACE_ICON_NAMES,
  withoutIcons,
} from "@/features/tabs/placeIcons";

describe("placeIcons (AC-16)", () => {
  it("offers 24 icons", () => {
    expect(new Set(PLACE_ICON_NAMES).size).toBe(24);
  });
  it("drops unknown icon names and malformed entries", () => {
    const icons = parsePlaceIcons(
      JSON.stringify({
        a: { kind: "icon", name: "folder" },
        b: { kind: "icon", name: "not-an-icon" },
        c: { kind: "emoji", text: "" },
        d: 4,
      }),
    );
    expect(icons).toEqual({ a: { kind: "icon", name: "folder" } });
  });
  it("keeps one grapheme of an emoji", () => {
    expect(firstGrapheme("  🚀🚀 ")).toBe("🚀");
    expect(firstGrapheme("")).toBe("");
    expect(parsePlaceIcons(JSON.stringify({ a: { kind: "emoji", text: "🎉x" } })).a).toEqual({
      kind: "emoji",
      text: "🎉",
    });
  });
  it("returns nothing for corrupt JSON", () => {
    expect(parsePlaceIcons("{bad")).toEqual({});
    expect(parsePlaceIcons(null)).toEqual({});
  });
  it("removes keys, and returns the same map when none was there", () => {
    const icons = { a: { kind: "emoji", text: "x" } as const };
    expect(withoutIcons(icons, ["a"])).toEqual({});
    expect(withoutIcons(icons, ["z"])).toBe(icons);
  });
});

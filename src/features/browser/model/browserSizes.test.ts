import { describe, expect, it } from "vitest";
import {
  BUILT_IN_SIZES,
  withBuiltInHeight,
  fitScale,
  MAX_CUSTOM_SIZES,
  newCustomSize,
  parseSize,
  sameSize,
  sizeLabel,
  type SizePreset,
} from "./browserSizes";

describe("parseSize", () => {
  it("reads a saved size and a bare width from before L-216", () => {
    expect(parseSize({ width: 390, height: 844 })).toEqual({ width: 390, height: 844 });
    expect(parseSize(1280)).toEqual({ width: 1280 });
    expect(parseSize({ width: 390, height: 12 })).toEqual({ width: 390 });
  });

  it("rejects missing or out-of-range sizes", () => {
    expect(parseSize("fit")).toBeNull();
    expect(parseSize(null)).toBeNull();
    expect(parseSize({ width: 50 })).toBeNull();
    expect(parseSize({ width: 390.5 })).toBeNull();
    expect(parseSize(99999)).toBeNull();
  });
});

describe("sameSize and sizeLabel", () => {
  it("treats no height as its own size", () => {
    expect(sameSize({ width: 375 }, { width: 375 })).toBe(true);
    expect(sameSize({ width: 375 }, { width: 375, height: 812 })).toBe(false);
    expect(sameSize(null, null)).toBe(true);
    expect(sameSize(null, { width: 375 })).toBe(false);
    expect(sizeLabel({ width: 390, height: 844 })).toBe("390 × 844");
    expect(sizeLabel({ width: 768 })).toBe("768");
  });
});

describe("fitScale", () => {
  it("shrinks on whichever side is short, never grows", () => {
    expect(fitScale(null, { width: 500, height: 500 })).toBe(1);
    expect(fitScale({ width: 400 }, { width: 800, height: 300 })).toBe(1);
    expect(fitScale({ width: 1600 }, { width: 800, height: 600 })).toBe(0.5);
    expect(fitScale({ width: 400, height: 1200 }, { width: 800, height: 600 })).toBe(0.5);
    expect(fitScale({ width: 1600 }, { width: 0, height: 0 })).toBe(1);
  });
});

describe("newCustomSize", () => {
  const empty: SizePreset[] = [];

  it("makes a named preset, or names it by its size", () => {
    expect(newCustomSize(empty, { name: " iPhone 15 ", width: "393", height: "852" }, "a")).toEqual({
      preset: { id: "a", name: "iPhone 15", width: 393, height: 852, custom: true },
    });
    expect(newCustomSize(empty, { name: "", width: "1440", height: "" }, "b")).toEqual({
      preset: { id: "b", name: "1440", width: 1440, custom: true },
    });
  });

  it("gives built-in sizes a device height (L-222)", () => {
    expect(BUILT_IN_SIZES.every((preset) => typeof preset.height === "number")).toBe(true);
    expect(withBuiltInHeight({ width: 375 })).toEqual({ width: 375, height: 812 });
    expect(withBuiltInHeight({ width: 500 })).toEqual({ width: 500 });
    expect(withBuiltInHeight({ width: 375, height: 600 })).toEqual({ width: 375, height: 600 });
    expect(withBuiltInHeight(null)).toBeNull();
  });

  it("explains what is wrong", () => {
    expect(newCustomSize(empty, { name: "", width: "abc", height: "" })).toHaveProperty("error");
    expect(newCustomSize(empty, { name: "", width: "100", height: "" })).toHaveProperty("error");
    expect(newCustomSize(empty, { name: "", width: "800", height: "5000" })).toHaveProperty("error");
    const phone = BUILT_IN_SIZES[0]!;
    expect(newCustomSize(empty, { name: "", width: String(phone.width), height: String(phone.height) })).toEqual({
      error: "That size is already in the list",
    });
    const full = Array.from({ length: MAX_CUSTOM_SIZES }, (_, index) => ({
      id: `s${index}`,
      name: `S${index}`,
      width: 300 + index,
      custom: true,
    }));
    expect(newCustomSize(full, { name: "", width: "999", height: "" })).toEqual({
      error: `Up to ${MAX_CUSTOM_SIZES} sizes`,
    });
  });
});

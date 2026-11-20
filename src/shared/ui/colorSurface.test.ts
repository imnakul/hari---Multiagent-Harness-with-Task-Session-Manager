import { afterEach, describe, expect, it, vi } from "vitest";
import {
  COLOR_SURFACE_STYLES,
  colorSurfaceStyle,
  createColorSurfaceSetting,
} from "./colorSurface";

describe("colour surfaces (L-374)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows nothing when off or without a colour", () => {
    expect(colorSurfaceStyle("#f00", "off")).toBeUndefined();
    expect(colorSurfaceStyle(undefined, "background")).toBeUndefined();
  });

  it("gives every other style something to draw", () => {
    for (const { value } of COLOR_SURFACE_STYLES) {
      if (value === "off") continue;
      expect(Object.keys(colorSurfaceStyle("#f00", value) ?? {}).length).toBeGreaterThan(0);
    }
    expect(colorSurfaceStyle("#f00", "border")).toEqual({
      boxShadow: "inset 0 0 0 1px color-mix(in srgb, #f00 45%, transparent)",
    });
  });

  it("reads saved choices, maps legacy values and falls back", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    });
    const setting = createColorSurfaceSetting("test.style", "tint", { both: "tint-bar" });
    expect(setting.load()).toBe("tint");
    store.set("test.style", "both");
    expect(setting.load()).toBe("tint-bar");
    store.set("test.style", "nonsense");
    expect(setting.load()).toBe("tint");
    setting.save("fade");
    expect(setting.load()).toBe("fade");
  });
});

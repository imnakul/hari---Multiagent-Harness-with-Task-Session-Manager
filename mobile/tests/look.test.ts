import { describe, expect, it, vi } from "vitest";

vi.mock("expo-sqlite/kv-store", () => ({
  default: { getItemSync: () => null, setItem: () => Promise.resolve() },
}));
vi.mock("react-native", () => ({
  StyleSheet: { create: (styles: unknown) => styles },
  useColorScheme: () => "dark",
}));
vi.mock("expo-file-system", () => {
  class Directory {
    exists = false;
  }
  class File {
    exists = false;
    uri = "file:///photo.jpg";
  }
  return { Directory, File, Paths: { document: "doc", cache: "cache" } };
});
vi.mock("expo-image-manipulator", () => ({ ImageManipulator: {}, SaveFormat: {} }));
vi.mock("expo-image-picker", () => ({ launchImageLibraryAsync: vi.fn() }));
vi.mock("jpeg-js", () => ({ decode: vi.fn() }));
vi.mock("@/features/background/render", () => ({ prepareImage: vi.fn() }));
vi.mock("@/features/background/dither", () => ({ encodePng: vi.fn() }));

const { accentColor, lookFromTheme, paletteFor, parseLook, withAlpha } = await import("@/ui/theme");
const { parseWallpaper } = await import("@/features/wallpaper/wallpaper");

describe("look", () => {
  it("carries an old theme over as its accent with a light tint", () => {
    expect(lookFromTheme("grove", null)).toMatchObject({ accent: "green", tint: true, strength: 0.25 });
    expect(lookFromTheme("graphite", null)).toMatchObject({ accent: "default", tint: false });
    // An accent picked over a theme wins.
    expect(lookFromTheme("ember", "violet")).toMatchObject({ accent: "violet", tint: true });
  });

  it("checks a saved look field by field", () => {
    expect(parseLook('{"accent":"hue:400","tint":"yes","strength":7}')).toEqual({
      accent: "default",
      tint: false,
      strength: 1,
      glass: null,
    });
    expect(parseLook('{"accent":"hue:12","tint":true,"strength":0.33,"glass":0.1}')).toEqual({
      accent: "hue:12",
      tint: true,
      strength: 0.35,
      glass: 0.3,
    });
  });

  it("puts readable ink on every accent", () => {
    for (const hue of [0, 60, 120, 200, 280]) {
      const palette = paletteFor("dark", { accent: `hue:${hue}`, tint: false, strength: 0.5, glass: null });
      expect(palette.accent).toBe(accentColor(`hue:${hue}`, "dark"));
      expect(["#ffffff", "#0c0c0c"]).toContain(palette.onAccent);
    }
  });

  it("makes cards see-through only with a wallpaper", () => {
    const solid = paletteFor("dark", { accent: "default", tint: false, strength: 0.5, glass: null });
    const glass = paletteFor("dark", { accent: "default", tint: false, strength: 0.5, glass: 0.6 });
    expect(solid.page).toBe(solid.background);
    expect(glass.page).not.toBe(solid.page);
    expect(glass.surface).not.toBe(solid.surface);
  });

  it("multiplies alpha on a colour that already has some", () => {
    expect(withAlpha("#ff0000", 0.5)).toBe("rgba(255, 0, 0, 0.5)");
    expect(withAlpha("rgba(255, 0, 0, 0.5)", 0.5)).toBe("rgba(255, 0, 0, 0.25)");
  });
});

describe("wallpaper", () => {
  it("keeps a saved photo's name inside the wallpapers folder", () => {
    expect(parseWallpaper('{"source":{"kind":"photo","file":"../../secret","hue":10}}').source).toEqual({
      kind: "none",
    });
    expect(parseWallpaper('{"source":{"kind":"photo","file":"wallpaper-1.jpg","hue":370}}').source).toEqual({
      kind: "photo",
      file: "wallpaper-1.jpg",
      hue: 10,
    });
  });

  it("clamps the dim, blur and glass it reads back", () => {
    const wallpaper = parseWallpaper('{"source":{"kind":"preset","id":"dusk"},"dimDark":5,"blur":-1,"glass":"x"}');
    expect(wallpaper).toMatchObject({ source: { kind: "preset", id: "dusk" }, dimDark: 0.9, blur: 0, glass: 0.6 });
    expect(parseWallpaper('{"source":{"kind":"preset","id":"nope"}}').source).toEqual({ kind: "none" });
  });
});

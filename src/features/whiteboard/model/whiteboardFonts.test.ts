import { describe, expect, it } from "vitest";
import {
  extraFontLoadQueries,
  registerWhiteboardFonts,
  whiteboardFont,
  WHITEBOARD_FONTS,
} from "./whiteboardFonts";

describe("whiteboard fonts", () => {
  it("adds the extra families to Excalidraw's map without touching its own", () => {
    const map: Record<string, number> = { Virgil: 1, Helvetica: 2, Cascadia: 3, Excalifont: 5 };
    registerWhiteboardFonts(map);
    expect(map).toMatchObject({
      Virgil: 1,
      Kalam: 101,
      "Shantell Sans": 102,
      Caveat: 103,
      "Geist Sans": 104,
      "Geist Mono": 105,
    });
    const again = { ...map };
    registerWhiteboardFonts(map);
    expect(map).toEqual(again);
  });

  it("skips an id Excalidraw already uses", () => {
    const map: Record<string, number> = { Future: 101 };
    registerWhiteboardFonts(map);
    expect(map.Kalam).toBeUndefined();
    expect(map.Future).toBe(101);
  });

  it("has unique ids and load queries for the extras", () => {
    const ids = WHITEBOARD_FONTS.map((font) => font.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(whiteboardFont(104)?.label).toBe("Geist");
    expect(extraFontLoadQueries()).toContain('20px "Shantell Sans"');
  });
});

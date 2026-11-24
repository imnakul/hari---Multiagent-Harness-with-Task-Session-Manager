import { describe, expect, it } from "vitest";
import {
  DEFAULT_SHEET_BACKGROUND,
  fillCss,
  parseSheetBackground,
  patternStep,
  patternStyle,
  themeForBackground,
} from "./sheetBackground";
import { createSheet, emptyWhiteboardIndex, parseWhiteboardIndex, serializeWhiteboardIndex, setSheetBackground } from "./sheets";

describe("sheet background (L-393)", () => {
  it("reads only usable values and treats the default as no setting", () => {
    expect(parseSheetBackground(undefined)).toBeUndefined();
    expect(parseSheetBackground({ pattern: "none", color: null })).toBeUndefined();
    expect(parseSheetBackground({ pattern: "dots" })).toEqual({ pattern: "dots", color: null, opacity: 1 });
    expect(parseSheetBackground({ pattern: "zigzag", color: "#ABCDEF", opacity: 7 })).toEqual({
      pattern: "none",
      color: "#abcdef",
      opacity: 1,
    });
    expect(parseSheetBackground({ pattern: "grid", color: "red", opacity: -1 })).toEqual({
      pattern: "grid",
      color: null,
      opacity: 0,
    });
  });

  it("fills with the chosen colour and opacity, or not at all", () => {
    expect(fillCss(DEFAULT_SHEET_BACKGROUND)).toBeNull();
    expect(fillCss({ pattern: "none", color: "#ff8000", opacity: 0.456 })).toBe("rgba(255, 128, 0, 0.46)");
    expect(fillCss({ pattern: "none", color: "#ff8000", opacity: 0 })).toBeNull();
  });

  it("pins the pattern to the drawing while panning and zooming", () => {
    expect(patternStyle(DEFAULT_SHEET_BACKGROUND, { scrollX: 0, scrollY: 0, zoom: 1 })).toBeNull();
    const dots = patternStyle({ pattern: "dots", color: null, opacity: 1 }, { scrollX: 45, scrollY: -5, zoom: 2 });
    expect(dots?.backgroundSize).toBe("40px 40px");
    expect(dots?.backgroundPosition).toBe("10px -10px");
    const graph = patternStyle({ pattern: "graph", color: null, opacity: 1 }, { scrollX: 0, scrollY: 0, zoom: 1 });
    expect(graph?.backgroundSize.split(", ")).toEqual(["100px 100px", "100px 100px", "20px 20px", "20px 20px"]);
  });

  it("keeps lines readable when zoomed far out", () => {
    expect(patternStep("grid", 0.1)).toBe(16);
    expect(patternStep("lines", 1)).toBe(28);
  });

  it("matches the editor theme to an opaque fill so ink stays visible", () => {
    expect(themeForBackground(undefined)).toBeNull();
    expect(themeForBackground({ pattern: "none", color: "#ffffff", opacity: 1 })).toBe("light");
    expect(themeForBackground({ pattern: "none", color: "#0f172a", opacity: 0.9 })).toBe("dark");
    expect(themeForBackground({ pattern: "none", color: "#ffffff", opacity: 0.2 })).toBeNull();
  });

  it("saves the background in the sheet index and drops it when reset", () => {
    const { index, sheet } = createSheet(emptyWhiteboardIndex(), "wb-a", 1);
    const dotted = setSheetBackground(index, sheet.id, { pattern: "dots", color: "#ffffff", opacity: 0.8 });
    const reread = parseWhiteboardIndex(serializeWhiteboardIndex(dotted));
    expect(reread.sheets[0]?.background).toEqual({ pattern: "dots", color: "#ffffff", opacity: 0.8 });
    const reset = setSheetBackground(dotted, sheet.id, DEFAULT_SHEET_BACKGROUND);
    expect(reset.sheets[0]).not.toHaveProperty("background");
    expect(setSheetBackground(index, sheet.id, DEFAULT_SHEET_BACKGROUND)).toBe(index);
  });
});

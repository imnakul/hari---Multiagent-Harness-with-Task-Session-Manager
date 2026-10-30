/**
 * Whiteboard fonts (fork, L-194). Excalidraw draws text by looking up a
 * family name for each numeric id in its exported `FONT_FAMILY` map; the
 * extra fonts are added there under ids it does not use, and their faces
 * come from the bundled `@fontsource` packages.
 */
export type WhiteboardFont = {
  id: number;
  /** CSS family name, also the key in Excalidraw's map. */
  family: string;
  label: string;
  /** Added by MonoCode rather than shipped with Excalidraw. */
  extra: boolean;
};

export const WHITEBOARD_FONTS: readonly WhiteboardFont[] = [
  { id: 5, family: "Excalifont", label: "Excalifont", extra: false },
  { id: 101, family: "Kalam", label: "Kalam", extra: true },
  { id: 102, family: "Shantell Sans", label: "Shantell Sans", extra: true },
  { id: 103, family: "Caveat", label: "Caveat", extra: true },
  { id: 104, family: "Geist Sans", label: "Geist", extra: true },
  { id: 105, family: "Geist Mono", label: "Geist Mono", extra: true },
  { id: 6, family: "Nunito", label: "Nunito", extra: false },
  { id: 8, family: "Comic Shanns", label: "Comic Shanns", extra: false },
  { id: 7, family: "Lilita One", label: "Lilita One", extra: false },
  { id: 9, family: "Liberation Sans", label: "Liberation Sans", extra: false },
  { id: 3, family: "Cascadia", label: "Cascadia", extra: false },
  { id: 1, family: "Virgil", label: "Virgil", extra: false },
];

export const DEFAULT_WHITEBOARD_FONT_ID = 5;

export function whiteboardFont(id: number | undefined): WhiteboardFont | undefined {
  return WHITEBOARD_FONTS.find((font) => font.id === id);
}

/** Adds the extra families to Excalidraw's map once; keeps its own entries. */
export function registerWhiteboardFonts(map: Record<string, number>): void {
  const used = new Set(Object.values(map));
  for (const font of WHITEBOARD_FONTS) {
    if (!font.extra || font.family in map || used.has(font.id)) continue;
    map[font.family] = font.id;
    used.add(font.id);
  }
}

/** Faces to load before the canvas draws, so first paint uses the right font. */
export function extraFontLoadQueries(): string[] {
  return WHITEBOARD_FONTS.filter((font) => font.extra).map(
    (font) => `20px "${font.family}"`,
  );
}

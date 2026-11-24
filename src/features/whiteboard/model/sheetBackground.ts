/**
 * Fork (L-393): a sheet's own background, drawn behind the transparent
 * Excalidraw canvas. "Default" is no fill and no pattern: the wallpaper shows
 * through, as before. Patterns move and scale with the canvas.
 */

export const SHEET_PATTERNS = ["none", "dots", "grid", "lines", "graph"] as const;
export type SheetPattern = (typeof SHEET_PATTERNS)[number];

export const SHEET_PATTERN_LABELS: Record<SheetPattern, string> = {
  none: "None",
  dots: "Dots",
  grid: "Grid",
  lines: "Lines",
  graph: "Graph",
};

export type SheetBackground = {
  pattern: SheetPattern;
  /** `#rrggbb`, or null for no fill (the wallpaper shows through). */
  color: string | null;
  /** Fill opacity, 0 to 1. */
  opacity: number;
};

export const DEFAULT_SHEET_BACKGROUND: SheetBackground = { pattern: "none", color: null, opacity: 1 };

/** Fills offered beside the colour picker. */
export const SHEET_FILL_SWATCHES = ["#ffffff", "#f8f1e3", "#1e1e1e", "#0f172a", "#12263a", "#1f2d1f"] as const;

const HEX = /^#[0-9a-f]{6}$/i;

export function isDefaultBackground(background: SheetBackground | undefined): boolean {
  return !background || (background.pattern === "none" && background.color === null);
}

/** Reads a saved background; anything unusable reads as the default (undefined). */
export function parseSheetBackground(value: unknown): SheetBackground | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const pattern = SHEET_PATTERNS.includes(raw.pattern as SheetPattern) ? (raw.pattern as SheetPattern) : "none";
  const color = typeof raw.color === "string" && HEX.test(raw.color) ? raw.color.toLowerCase() : null;
  const opacity =
    typeof raw.opacity === "number" && Number.isFinite(raw.opacity) ? Math.min(1, Math.max(0, raw.opacity)) : 1;
  const background = { pattern, color, opacity };
  return isDefaultBackground(background) ? undefined : background;
}

function channels(hex: string): [number, number, number] {
  return [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16)) as [number, number, number];
}

/** The fill as a CSS colour, or null when there is none. */
export function fillCss(background: SheetBackground): string | null {
  if (!background.color || background.opacity <= 0) return null;
  const [r, g, b] = channels(background.color);
  return `rgba(${r}, ${g}, ${b}, ${Math.round(background.opacity * 100) / 100})`;
}

/**
 * Pattern ink that reads on the fill: dark on a light fill, light on a dark
 * one, and the theme's text colour when the wallpaper mostly shows through.
 */
export function patternInk(background: SheetBackground, strength = 1): string {
  const alpha = (light: boolean) => Math.round((light ? 0.16 : 0.2) * strength * 100) / 100;
  if (background.color && background.opacity >= 0.5) {
    const [r, g, b] = channels(background.color);
    const light = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.55;
    return light ? `rgba(0, 0, 0, ${alpha(true)})` : `rgba(255, 255, 255, ${alpha(false)})`;
  }
  return `color-mix(in srgb, var(--color-content) ${Math.round(18 * strength)}%, transparent)`;
}

/** Scene units between pattern lines at 100% zoom. */
const SPACING: Record<Exclude<SheetPattern, "none">, number> = { dots: 20, grid: 20, lines: 28, graph: 20 };
const GRAPH_MAJOR = 5;
/** Below this many screen pixels apart, lines double their spacing so the pattern stays readable. */
const MIN_STEP = 10;

export type CanvasView = { scrollX: number; scrollY: number; zoom: number };

export type PatternStyle = {
  backgroundImage: string;
  backgroundSize: string;
  backgroundPosition: string;
};

/** On-screen distance between lines at this zoom. */
export function patternStep(pattern: Exclude<SheetPattern, "none">, zoom: number): number {
  let step = SPACING[pattern] * zoom;
  while (step < MIN_STEP) step *= 2;
  return step;
}

/**
 * CSS for the pattern at the canvas's current scroll and zoom. Excalidraw
 * draws scene point p at (p + scroll) * zoom, so the pattern is shifted by
 * scroll * zoom to stay pinned to the drawing while panning.
 */
export function patternStyle(background: SheetBackground, view: CanvasView): PatternStyle | null {
  if (background.pattern === "none") return null;
  const step = patternStep(background.pattern, view.zoom);
  const ink = patternInk(background);
  const offset = (scroll: number, size: number) => {
    const value = (scroll * view.zoom) % size;
    return `${Math.round(value * 100) / 100}px`;
  };
  const at = (size: number) => `${offset(view.scrollX, size)} ${offset(view.scrollY, size)}`;
  const tile = (size: number) => `${size}px ${size}px`;
  const vertical = (color: string) => `linear-gradient(to right, ${color} 1px, transparent 1px)`;
  const horizontal = (color: string) => `linear-gradient(to bottom, ${color} 1px, transparent 1px)`;
  switch (background.pattern) {
    case "dots": {
      const dot = `radial-gradient(circle at 1px 1px, ${patternInk(background, 1.8)} 1px, transparent 1.6px)`;
      return { backgroundImage: dot, backgroundSize: tile(step), backgroundPosition: at(step) };
    }
    case "grid":
      return {
        backgroundImage: `${vertical(ink)}, ${horizontal(ink)}`,
        backgroundSize: `${tile(step)}, ${tile(step)}`,
        backgroundPosition: `${at(step)}, ${at(step)}`,
      };
    case "lines":
      return { backgroundImage: horizontal(ink), backgroundSize: tile(step), backgroundPosition: at(step) };
    case "graph": {
      const major = step * GRAPH_MAJOR;
      const strong = patternInk(background, 1.6);
      const faint = patternInk(background, 0.6);
      return {
        backgroundImage: [vertical(strong), horizontal(strong), vertical(faint), horizontal(faint)].join(", "),
        backgroundSize: [tile(major), tile(major), tile(step), tile(step)].join(", "),
        backgroundPosition: [at(major), at(major), at(step), at(step)].join(", "),
      };
    }
  }
}

/**
 * A mostly opaque fill decides the editor's theme: Excalidraw's dark theme
 * inverts the drawing, so dark ink on a white sheet would turn white and vanish.
 * Returns null when the app theme should stay.
 */
export function themeForBackground(background: SheetBackground | undefined): "light" | "dark" | null {
  if (!background?.color || background.opacity < 0.5) return null;
  const [r, g, b] = channels(background.color);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.55 ? "light" : "dark";
}

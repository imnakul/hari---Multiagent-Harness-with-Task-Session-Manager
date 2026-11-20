import type { CSSProperties } from "react";

/**
 * Fork (L-374): how a coloured group (a session group, a project group, a
 * repository in the Explorer) shows its colour. One vocabulary for all of
 * them, so the Settings choices read the same everywhere.
 */
export type ColorSurfaceStyle =
  | "off"
  | "tint"
  | "background"
  | "border"
  | "background-border"
  | "bar"
  | "tint-bar"
  | "fade";

export const COLOR_SURFACE_STYLES = [
  { value: "off", label: "Off" },
  { value: "tint", label: "Tint" },
  { value: "background", label: "Background" },
  { value: "border", label: "Border" },
  { value: "background-border", label: "Background + border" },
  { value: "bar", label: "Side bar" },
  { value: "tint-bar", label: "Tint + side bar" },
  { value: "fade", label: "Fade" },
] as const satisfies readonly { value: ColorSurfaceStyle; label: string }[];

export function isColorSurfaceStyle(value: unknown): value is ColorSurfaceStyle {
  return COLOR_SURFACE_STYLES.some((option) => option.value === value);
}

/* Strengths, kept faint enough that text stays readable over the glass. */
const TINT = 12;
const BACKGROUND = 22;
const BORDER = 45;
const PAIRED_FILL = 14;
const PAIRED_BORDER = 38;
const FADE = 26;

const mix = (color: string, percent: number): string =>
  `color-mix(in srgb, ${color} ${percent}%, transparent)`;

/** The style for a coloured surface; `undefined` when it shows no colour. */
export function colorSurfaceStyle(
  color: string | undefined,
  style: ColorSurfaceStyle,
): CSSProperties | undefined {
  if (!color) return undefined;
  switch (style) {
    case "off":
      return undefined;
    case "tint":
      return { backgroundColor: mix(color, TINT) };
    case "background":
      return { backgroundColor: mix(color, BACKGROUND) };
    case "border":
      return { boxShadow: `inset 0 0 0 1px ${mix(color, BORDER)}` };
    case "background-border":
      return {
        backgroundColor: mix(color, PAIRED_FILL),
        boxShadow: `inset 0 0 0 1px ${mix(color, PAIRED_BORDER)}`,
      };
    case "bar":
      return { boxShadow: `inset 2px 0 0 ${color}` };
    case "tint-bar":
      return { backgroundColor: mix(color, TINT), boxShadow: `inset 2px 0 0 ${color}` };
    case "fade":
      return { backgroundImage: `linear-gradient(90deg, ${mix(color, FADE)}, transparent 85%)` };
  }
}

/**
 * A remembered colour-style choice: saved in localStorage, announced to every
 * open view through a window event. `legacy` maps values saved by older
 * builds onto current ones.
 */
export function createColorSurfaceSetting(
  key: string,
  fallback: ColorSurfaceStyle,
  legacy: Readonly<Record<string, ColorSurfaceStyle>> = {},
): {
  load: () => ColorSurfaceStyle;
  save: (style: ColorSurfaceStyle) => void;
  subscribe: (onChange: () => void) => () => void;
} {
  const event = `monocode:${key}`;
  return {
    load: () => {
      try {
        const saved = localStorage.getItem(key);
        if (isColorSurfaceStyle(saved)) return saved;
        return (saved && legacy[saved]) || fallback;
      } catch {
        return fallback;
      }
    },
    save: (style) => {
      try {
        localStorage.setItem(key, style);
      } catch {
        // Kept for this run only when storage is full or blocked.
      }
      if (typeof window !== "undefined") window.dispatchEvent(new Event(event));
    },
    subscribe: (onChange) => {
      if (typeof window === "undefined") return () => {};
      window.addEventListener(event, onChange);
      return () => window.removeEventListener(event, onChange);
    },
  };
}

const groupSetting = createColorSurfaceSetting("monocode.groupColorStyle", "tint");

/** Session groups and project groups in the sidebars. */
export const loadGroupColorStyle = groupSetting.load;
export const saveGroupColorStyle = groupSetting.save;
export const subscribeGroupColorStyle = groupSetting.subscribe;

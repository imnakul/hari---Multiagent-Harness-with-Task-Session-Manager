import Storage from "expo-sqlite/kv-store";
import { createContext, use, useSyncExternalStore } from "react";
import { StyleSheet, useColorScheme } from "react-native";

export type Scheme = "light" | "dark";

// The desktop dark theme in src/styles/index.css (neutral hue, blue accent), on a
// darker base for mobile: hsl(0 0% 7.5%) rather than desktop's 9%. The drawer shares
// the base, and the scene lightens as it slides aside to set itself apart; bottom
// sheets sit a step above, like raised iOS sheets.
const dark = {
  background: "#131313",
  drawer: "#131313",
  sheet: "#181818",
  /**
   * Fork (Hari, L-245): what a page or the drawer paints itself in. The
   * background's colour, or clear over a wallpaper, which then shows. Keep
   * `background` for what needs a solid colour: edge fades, cut-out rings.
   */
  page: "#131313",
  /** As `page`, for the screens of a modal, which sit on the sheet's colour. */
  sheetPage: "#181818",
  surface: "#202020",
  surfaceRaised: "#2a2a2a",
  stroke: "rgba(235, 235, 235, 0.08)",
  selection: "rgba(235, 235, 235, 0.10)",
  content: "#ebebeb",
  muted: "#8c8c8c",
  faint: "#5c5c5c",
  accent: "#4c9ef5",
  /** Fork (Hari, L-245): icons and labels on an accent fill. */
  onAccent: "#0c0c0c",
  additions: "#6ee7b7",
  deletions: "#f87171",
  /** Amber, for warnings and full access. */
  caution: "#fbbf24",
  /** A file named in a transcript, apart from prose, code and links. */
  fileRef: "#c4b5fd",
  inverse: "#0c0c0c",
  inverseSurface: "#f2f2f2",
  /** Round buttons and pills over glass, as the composer's. */
  fill: "rgba(255, 255, 255, 0.08)",
  /** A segmented switch's thumb, inside the glass. */
  thumb: "rgba(255, 255, 255, 0.14)",
  /** Laid over the Monocode mark, which is drawn white. */
  mark: "#ffffff",
  /** A transcript's fold rails and connectors. */
  rail: "#323232",
  /** The user's message bubble. */
  bubble: "#292929",
  /** The file list's card, and the lines between its rows. */
  listCard: "#1e1e1e",
  listDivider: "#2f2f2f",
};

export type Palette = typeof dark;

// The desktop's `html.theme-light`: an hsl(0 0% 97%) base under 18% ink, with
// gentler fills and darker diff and accent hues to hold their contrast. Sheets
// and raised surfaces go white, as iOS lifts them in light mode.
const light: Palette = {
  background: "#f7f7f7",
  drawer: "#f7f7f7",
  sheet: "#ffffff",
  page: "#f7f7f7",
  sheetPage: "#ffffff",
  surface: "#ededed",
  surfaceRaised: "#e3e3e3",
  stroke: "rgba(46, 46, 46, 0.10)",
  selection: "rgba(46, 46, 46, 0.06)",
  content: "#2e2e2e",
  muted: "#737373",
  faint: "#a6a6a6",
  accent: "#1f7ae0",
  onAccent: "#ffffff",
  additions: "#047857",
  deletions: "#be123c",
  caution: "#b45309",
  fileRef: "#6d28d9",
  inverse: "#fafafa",
  inverseSurface: "#262626",
  // Light glass washes faint ink out, so these are heavier than dark's.
  fill: "rgba(46, 46, 46, 0.09)",
  thumb: "rgba(46, 46, 46, 0.10)",
  mark: "#2e2e2e",
  rail: "#dadada",
  bubble: "#e9e9e9",
  listCard: "#ffffff",
  listDivider: "#e6e6e6",
};

export const palettes: Record<Scheme, Palette> = { dark, light };

/** `hsl()` as `#rrggbb`, so tinted colours still take `withAlpha`. */
export function hsl(hue: number, saturation: number, lightness: number): string {
  const s = saturation / 100;
  const l = lightness / 100;
  const k = (n: number) => (n + hue / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const channel = (n: number) =>
    Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))))
      .toString(16)
      .padStart(2, "0");
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}

/** A colour's red, green, blue (0–255) and alpha (0–1), from `#rrggbb` or `rgba()`. */
function channels(color: string): [number, number, number, number] {
  if (color.startsWith("#")) {
    const n = parseInt(color.slice(1, 7), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  const parts = color.match(/[\d.]+/g)?.map(Number) ?? [];
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0, parts[3] ?? 1];
}

/** A colour's hue, 0–359, from `#rrggbb`. */
export function hueOf(hex: string): number {
  const [r, g, b] = channels(hex).map((value) => value / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  if (delta === 0) return 0;
  const sector =
    max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return Math.round((sector * 60 + 360) % 360) % 360;
}

/** WCAG relative luminance of `#rrggbb`. */
function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((value) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * The ink drawn on an accent fill: white where it holds the 3:1 that icons
 * and bold labels need (WCAG 1.4.11), near-black otherwise, as Material's
 * dark scheme draws on its light primaries.
 */
function inkOn(accent: string): string {
  return 1.05 / (luminance(accent) + 0.05) >= 3 ? "#ffffff" : "#0c0c0c";
}

/**
 * Accents the app can be drawn in, each in both schemes: light's deeper, so
 * it holds its contrast on a pale background. The labels carry the old
 * themes' names, which became these (L-245).
 */
export const ACCENTS = {
  blue: { label: "Blue", dark: "#4c9ef5", light: "#1f7ae0" },
  teal: { label: "Teal", dark: "#3cc4c4", light: "#0f7f86" },
  green: { label: "Jade", dark: "#4cc38a", light: "#13804f" },
  orange: { label: "Copper", dark: "#f0884a", light: "#c2531a" },
  red: { label: "Red", dark: "#f06a6a", light: "#c9302c" },
  pink: { label: "Blush", dark: "#ec6fa3", light: "#c42a6c" },
  violet: { label: "Violet", dark: "#9d87f5", light: "#6a4fd6" },
} satisfies Record<string, { label: string } & Record<Scheme, string>>;

export type AccentPreset = keyof typeof ACCENTS;

/**
 * The app's accent: "default" is Blue as the app comes, which leaves a Mono's
 * chat in its own colour and the user's bubbles in ink; then a preset, or any
 * hue picked (`hue:0`–`hue:359`).
 */
export type AccentChoice = "default" | AccentPreset | `hue:${number}`;

/** How the app is drawn on this phone, past light or dark. */
export type Look = {
  accent: AccentChoice;
  /** Backgrounds, cards and sheets washed in the accent's hue. */
  tint: boolean;
  /** How strongly, 0–1, in steps of 0.05. */
  strength: number;
  /** With a wallpaper, how opaque cards and lists are over it, 0.3–0.95;
   *  null without one. */
  glass: number | null;
};

export const TINT_STRENGTH = { min: 0, max: 1, default: 0.5 } as const;
export const GLASS_RANGE = { min: 0.3, max: 0.95, default: 0.6 } as const;

const isPreset = (value: string): value is AccentPreset => value in ACCENTS;

function parseAccent(value: unknown): AccentChoice | null {
  if (typeof value !== "string") return null;
  if (value === "default" || isPreset(value)) return value;
  const hue = /^hue:(\d{1,3})$/.exec(value)?.[1];
  return hue !== undefined && Number(hue) < 360 ? `hue:${Number(hue)}` : null;
}

/** The accent's colour in a scheme. */
export function accentColor(choice: AccentChoice, scheme: Scheme): string {
  if (choice === "default") return ACCENTS.blue[scheme];
  if (isPreset(choice)) return ACCENTS[choice][scheme];
  const hue = Number(choice.slice(4));
  return scheme === "dark" ? hsl(hue, 78, 66) : hsl(hue, 72, 40);
}

/** The accent's name, as settings lists it. */
export function accentLabel(choice: AccentChoice): string {
  if (choice === "default") return "Blue";
  if (isPreset(choice)) return ACCENTS[choice].label;
  return "Custom";
}

const snap = (value: number, min: number, max: number) =>
  Math.round(Math.min(max, Math.max(min, value)) * 20) / 20;

const LOOK_KEY = "look";
// Before the look (L-245): a theme, and an accent over it.
const OLD_THEME_KEY = "theme";
const OLD_ACCENT_KEY = "accent";
const OLD_THEME_ACCENTS: Record<string, AccentPreset> = {
  ocean: "blue",
  grove: "green",
  ember: "orange",
  iris: "violet",
  rose: "pink",
};

const DEFAULT_LOOK: Look = {
  accent: "default",
  tint: false,
  strength: TINT_STRENGTH.default,
  glass: null,
};

/** A saved look, checked field by field: storage is outside the app's types. */
export function parseLook(raw: string): Look {
  const saved: unknown = JSON.parse(raw);
  if (typeof saved !== "object" || saved === null) return DEFAULT_LOOK;
  const fields = new Map(Object.entries(saved));
  const strength = fields.get("strength");
  const glass = fields.get("glass");
  return {
    accent: parseAccent(fields.get("accent")) ?? DEFAULT_LOOK.accent,
    tint: fields.get("tint") === true,
    strength:
      typeof strength === "number"
        ? snap(strength, TINT_STRENGTH.min, TINT_STRENGTH.max)
        : DEFAULT_LOOK.strength,
    glass: typeof glass === "number" ? snap(glass, GLASS_RANGE.min, GLASS_RANGE.max) : null,
  };
}

/** The look a theme and accent from before L-245 carry over to. */
export function lookFromTheme(theme: string | null, accent: string | null): Look {
  const themeAccent = theme ? OLD_THEME_ACCENTS[theme] : undefined;
  const picked = accent && isPreset(accent) ? accent : themeAccent;
  return {
    ...DEFAULT_LOOK,
    accent: picked ?? "default",
    // A tinted theme keeps its wash, at about the strength it had.
    tint: !!themeAccent,
    strength: themeAccent ? 0.25 : DEFAULT_LOOK.strength,
  };
}

function loadLook(): Look {
  try {
    const raw = Storage.getItemSync(LOOK_KEY);
    if (raw) return parseLook(raw);
    return lookFromTheme(Storage.getItemSync(OLD_THEME_KEY), Storage.getItemSync(OLD_ACCENT_KEY));
  } catch {
    return DEFAULT_LOOK;
  }
}

// The look in use, held here so every screen redraws in it together.
let look = loadLook();
const lookListeners = new Set<() => void>();
const subscribeLook = (listener: () => void) => {
  lookListeners.add(listener);
  return () => {
    lookListeners.delete(listener);
  };
};

/** Changes how the app is drawn, and remembers it on this phone. */
export function setLook(patch: Partial<Look>): void {
  const next: Look = {
    accent: patch.accent ?? look.accent,
    tint: patch.tint ?? look.tint,
    strength:
      patch.strength === undefined
        ? look.strength
        : snap(patch.strength, TINT_STRENGTH.min, TINT_STRENGTH.max),
    glass:
      patch.glass === undefined
        ? look.glass
        : patch.glass === null
          ? null
          : snap(patch.glass, GLASS_RANGE.min, GLASS_RANGE.max),
  };
  if (lookKey("dark", next) === lookKey("dark", look)) return;
  look = next;
  void Storage.setItem(LOOK_KEY, JSON.stringify(next));
  lookListeners.forEach((listener) => listener());
}

/** How the app is drawn. */
export function useLook(): Look {
  return useSyncExternalStore(subscribeLook, () => look);
}

/** The accent picked for the app. */
export function useAccent(): AccentChoice {
  return useLook().accent;
}

/** The look in a phrase, for the settings row that opens it. */
export function lookLabel(value: Look): string {
  return value.tint ? `${accentLabel(value.accent)}, tinted` : accentLabel(value.accent);
}

/**
 * The neutral palette washed in `hue` at `strength` (0–1). At full strength
 * body text still holds 4.5:1: dark surfaces stay under 20% lightness and
 * light ones over 85%.
 */
function tinted(base: Palette, scheme: Scheme, hue: number, strength: number): Palette {
  if (scheme === "dark") {
    const sat = 10 + 40 * strength;
    const lift = 1.5 * strength;
    return {
      ...base,
      background: hsl(hue, sat, 7 + lift),
      drawer: hsl(hue, sat, 7 + lift),
      sheet: hsl(hue, sat * 0.9, 9 + lift),
      surface: hsl(hue, sat * 0.75, 12.5 + lift),
      surfaceRaised: hsl(hue, sat * 0.65, 16.5 + lift),
      rail: hsl(hue, sat * 0.55, 19 + lift),
      bubble: hsl(hue, sat * 0.75, 16 + lift),
      listCard: hsl(hue, sat * 0.8, 11 + lift),
      listDivider: hsl(hue, sat * 0.6, 18 + lift),
    };
  }
  const sat = 25 + 50 * strength;
  const sink = 3 * strength;
  return {
    ...base,
    background: hsl(hue, sat, 96.5 - sink),
    drawer: hsl(hue, sat, 96.5 - sink),
    sheet: hsl(hue, sat, 99 - sink / 2),
    surface: hsl(hue, sat * 0.8, 92.5 - sink),
    surfaceRaised: hsl(hue, sat * 0.7, 88.5 - sink),
    rail: hsl(hue, sat * 0.6, 85 - sink),
    bubble: hsl(hue, sat * 0.8, 91 - sink),
    listCard: hsl(hue, sat, 99.2 - sink / 2),
    listDivider: hsl(hue, sat * 0.6, 89.5 - sink),
  };
}

/**
 * Over a wallpaper: pages clear, so it shows, and cards and lists at `glass`
 * opacity over it. The solid colours stay for what needs one: edge fades,
 * cut-out rings, ink on the accent.
 */
function glassed(base: Palette, scheme: Scheme, glass: number): Palette {
  return {
    ...base,
    // Secondary text sits on a photo, not a flat page: a step nearer the ink.
    muted: scheme === "dark" ? "#a6a6a6" : "#575757",
    faint: scheme === "dark" ? "#7a7a7a" : "#808080",
    page: "transparent",
    sheetPage: "transparent",
    surface: withAlpha(base.surface, glass),
    surfaceRaised: withAlpha(base.surfaceRaised, Math.min(1, glass + 0.1)),
    listCard: withAlpha(base.listCard, glass),
    bubble: withAlpha(base.bubble, Math.min(1, glass + 0.1)),
  };
}

// One object per scheme and look, so memos keyed on a palette hold.
const built = new Map<string, Palette>();

function lookKey(scheme: Scheme, value: Look): string {
  return `${scheme}.${value.accent}.${value.tint ? value.strength : "-"}.${value.glass ?? "-"}`;
}

/** The palette of a scheme and look: the app's, unless another is given. */
export function paletteFor(scheme: Scheme, value: Look = look): Palette {
  const key = lookKey(scheme, value);
  const cached = built.get(key);
  if (cached) return cached;
  const accent = accentColor(value.accent, scheme);
  let palette: Palette = { ...palettes[scheme], accent, onAccent: inkOn(accent) };
  if (value.tint) {
    palette = tinted(palette, scheme, hueOf(accent), value.strength);
    // Selections over the wash pick up its hue too.
    palette.selection = withAlpha(accent, scheme === "dark" ? 0.16 : 0.1);
  }
  palette.page = palette.background;
  palette.sheetPage = palette.sheet;
  if (value.glass !== null) palette = glassed(palette, scheme, value.glass);
  built.set(key, palette);
  return palette;
}

export const radii = {
  pill: 999,
  card: 22,
  row: 12,
} as const;

/** The scheme the app is drawn in: the phone's, unless overridden in settings. */
export function useScheme(): Scheme {
  return useColorScheme() === "light" ? "light" : "dark";
}

/** The palette of the scheme and look the app is drawn in. */
export function useColors(): Palette {
  const palette = paletteFor(useScheme(), useLook());
  const over = use(AccentOverride);
  if (!over || over === palette.accent) return palette;
  // One object per palette and accent, so memos keyed on it hold.
  let byAccent = overridden.get(palette);
  if (!byAccent) overridden.set(palette, (byAccent = new Map()));
  let shown = byAccent.get(over);
  if (!shown) byAccent.set(over, (shown = { ...palette, accent: over, onAccent: inkOn(over) }));
  return shown;
}

/**
 * An accent for everything inside, over the app's: a Mono's chat drawn in
 * the colour picked for it. `#rrggbb`, or null for the app's own.
 */
export const AccentOverride = createContext<string | null>(null);
const overridden = new WeakMap<Palette, Map<string, Palette>>();

/**
 * A style sheet for each scheme and look, built from its palette, as a hook
 * returning the one in use. Each is built the first time it is drawn and
 * kept, so switching back costs nothing.
 */
export function themedStyles<T extends StyleSheet.NamedStyles<T>>(
  build: (colors: Palette) => T,
) {
  const sheets = new Map<string, T>();
  return function useStyles() {
    const scheme = useScheme();
    const value = useLook();
    const key = lookKey(scheme, value);
    let sheet = sheets.get(key);
    if (!sheet) {
      sheet = StyleSheet.create(build(paletteFor(scheme, value)));
      sheets.set(key, sheet);
    }
    return sheet;
  };
}

/** A colour blended `amount` of the way towards `to`, as `#rrggbb`. Alpha is
 *  dropped: a glass surface mixes as its solid colour. */
export function mix(color: string, to: string, amount: number): string {
  const a = channels(color);
  const b = channels(to);
  const channel = (index: number) =>
    Math.round(a[index] + (b[index] - a[index]) * amount)
      .toString(16)
      .padStart(2, "0");
  return `#${channel(0)}${channel(1)}${channel(2)}`;
}

/** A colour, `#rrggbb` or `rgba()`, at `alpha` of its own opacity. */
export function withAlpha(color: string, alpha: number): string {
  const [r, g, b, a] = channels(color);
  return `rgba(${r}, ${g}, ${b}, ${Math.round(a * alpha * 1000) / 1000})`;
}

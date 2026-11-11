import { Directory, File, Paths } from "expo-file-system";

import { encodePng } from "@/features/background/dither";
import { hsl } from "@/ui/theme";

/**
 * Fork (Hari, L-245): wallpapers that come with the app, drawn here rather
 * than shipped as images. Each is a few soft glows over a gradient, drawn
 * small, as they hold no detail to lose; the image view scales and softens
 * them to the screen. Drawn once per phone and kept in the cache.
 */

type Rgb = readonly [number, number, number];

type Glow = {
  /** Centre, 0–1 across and down. */
  x: number;
  y: number;
  /** Reach, as a share of the width. */
  radius: number;
  color: Rgb;
  strength: number;
};

type Recipe = {
  label: string;
  /** The hue an accent matched to it takes. */
  hue: number;
  top: Rgb;
  bottom: Rgb;
  glows: Glow[];
};

const rgb = (hex: string): Rgb => {
  const n = parseInt(hex.slice(1, 7), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

const RECIPES = {
  peacock: {
    label: "Peacock",
    hue: 178,
    top: rgb("#04161c"),
    bottom: rgb("#021012"),
    glows: [
      { x: 0.15, y: 0.2, radius: 0.75, color: rgb("#0d8a8a"), strength: 0.75 },
      { x: 0.9, y: 0.45, radius: 0.7, color: rgb("#1446a8"), strength: 0.7 },
      { x: 0.35, y: 0.85, radius: 0.8, color: rgb("#0f7a52"), strength: 0.65 },
      { x: 0.8, y: 0.95, radius: 0.45, color: rgb("#b88a1a"), strength: 0.35 },
    ],
  },
  aurora: {
    label: "Aurora",
    hue: 152,
    top: rgb("#050a1a"),
    bottom: rgb("#08061a"),
    glows: [
      { x: 0.2, y: 0.3, radius: 0.7, color: rgb("#1fbf8a"), strength: 0.6 },
      { x: 0.75, y: 0.2, radius: 0.6, color: rgb("#2a7ad6"), strength: 0.55 },
      { x: 0.6, y: 0.75, radius: 0.85, color: rgb("#6a3cc8"), strength: 0.6 },
    ],
  },
  dusk: {
    label: "Dusk",
    hue: 330,
    top: rgb("#1a1238"),
    bottom: rgb("#3a1430"),
    glows: [
      { x: 0.5, y: 1.05, radius: 0.95, color: rgb("#f07a3c"), strength: 0.8 },
      { x: 0.1, y: 0.7, radius: 0.6, color: rgb("#d63c78"), strength: 0.6 },
      { x: 0.85, y: 0.25, radius: 0.6, color: rgb("#5a3cb8"), strength: 0.5 },
    ],
  },
  mist: {
    label: "Mist",
    hue: 205,
    top: rgb("#dfe6ee"),
    bottom: rgb("#eef0f4"),
    glows: [
      { x: 0.2, y: 0.2, radius: 0.7, color: rgb("#b9d3ec"), strength: 0.7 },
      { x: 0.85, y: 0.6, radius: 0.7, color: rgb("#e6d6ec"), strength: 0.6 },
      { x: 0.3, y: 0.95, radius: 0.6, color: rgb("#cfe6dc"), strength: 0.55 },
    ],
  },
  ink: {
    label: "Ink",
    hue: 232,
    top: rgb("#06070c"),
    bottom: rgb("#030305"),
    glows: [
      { x: 0.8, y: 0.15, radius: 0.8, color: rgb("#1c2a6e"), strength: 0.55 },
      { x: 0.1, y: 0.8, radius: 0.7, color: rgb("#3a1c5e"), strength: 0.45 },
    ],
  },
} satisfies Record<string, Recipe>;

export type PresetId = keyof typeof RECIPES | "glow";

export const PRESET_IDS: readonly PresetId[] = ["glow", "peacock", "aurora", "dusk", "mist", "ink"];

export function isPresetId(value: unknown): value is PresetId {
  return typeof value === "string" && (value === "glow" || value in RECIPES);
}

export function presetLabel(id: PresetId): string {
  return id === "glow" ? "Accent glow" : RECIPES[id].label;
}

/** The glow that follows the accent: a dark wash of its hue, lit at two corners. */
function glowRecipe(hue: number): Recipe {
  return {
    label: "Accent glow",
    hue,
    top: rgb(hsl(hue, 45, 9)),
    bottom: rgb(hsl(hue, 40, 5)),
    glows: [
      { x: 0.85, y: 0.1, radius: 0.85, color: rgb(hsl(hue, 70, 42)), strength: 0.7 },
      { x: 0.1, y: 0.9, radius: 0.75, color: rgb(hsl((hue + 30) % 360, 60, 32)), strength: 0.6 },
    ],
  };
}

/** The hue an accent matched to a preset takes. `accentHue` is the glow's own. */
export function presetHue(id: PresetId, accentHue: number): number {
  return id === "glow" ? accentHue : RECIPES[id].hue;
}

// Small: the image view scales it up smoothly, and a gradient holds no detail.
const WIDTH = 120;
const HEIGHT = 260;

function draw(recipe: Recipe): Uint8Array {
  const pixels = new Uint8Array(WIDTH * HEIGHT * 4);
  const aspect = HEIGHT / WIDTH;
  // A fixed seed, so a preset draws alike every time.
  let seed = 0x2545f491;
  const noise = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return ((seed >>> 0) / 0xffffffff - 0.5) * 3;
  };
  for (let y = 0; y < HEIGHT; y += 1) {
    const v = y / (HEIGHT - 1);
    for (let x = 0; x < WIDTH; x += 1) {
      const u = x / (WIDTH - 1);
      let r = recipe.top[0] + (recipe.bottom[0] - recipe.top[0]) * v;
      let g = recipe.top[1] + (recipe.bottom[1] - recipe.top[1]) * v;
      let b = recipe.top[2] + (recipe.bottom[2] - recipe.top[2]) * v;
      for (const glow of recipe.glows) {
        const dx = u - glow.x;
        const dy = (v - glow.y) * aspect;
        const weight = glow.strength * Math.exp(-(dx * dx + dy * dy) / (glow.radius * glow.radius));
        r += (glow.color[0] - r) * weight;
        g += (glow.color[1] - g) * weight;
        b += (glow.color[2] - b) * weight;
      }
      // A little grain, so the gradient doesn't band once scaled up.
      const grain = noise();
      const index = (y * WIDTH + x) * 4;
      pixels[index] = Math.max(0, Math.min(255, Math.round(r + grain)));
      pixels[index + 1] = Math.max(0, Math.min(255, Math.round(g + grain)));
      pixels[index + 2] = Math.max(0, Math.min(255, Math.round(b + grain)));
      pixels[index + 3] = 255;
    }
  }
  return pixels;
}

const PRESETS = new Directory(Paths.cache, "wallpaper-presets");

/** A preset's file name: named for its look and version, so a redrawn
 *  recipe is never shown from an old file. */
function presetFile(id: PresetId, accentHue: number): File {
  const name = id === "glow" ? `glow-${accentHue}` : id;
  return new File(PRESETS, `${name}.v1.png`);
}

/** The preset's file URI if it is already drawn; null until then. */
export function drawnPreset(id: PresetId, accentHue: number): string | null {
  const file = presetFile(id, accentHue);
  return file.exists ? file.uri : null;
}

/**
 * The preset as a PNG file URI, drawn and kept the first time it is asked
 * for. Drawing takes the JS thread for a few tens of milliseconds.
 */
export function drawPreset(id: PresetId, accentHue: number): string {
  const file = presetFile(id, accentHue);
  if (file.exists) return file.uri;
  if (!PRESETS.exists) PRESETS.create({ intermediates: true, idempotent: true });
  const recipe = id === "glow" ? glowRecipe(accentHue) : RECIPES[id];
  file.create({ overwrite: true });
  file.write(encodePng(WIDTH, HEIGHT, draw(recipe)));
  return file.uri;
}

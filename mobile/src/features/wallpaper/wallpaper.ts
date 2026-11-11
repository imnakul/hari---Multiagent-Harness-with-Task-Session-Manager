import { Directory, File, Paths } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { launchImageLibraryAsync } from "expo-image-picker";
import Storage from "expo-sqlite/kv-store";
import { decode } from "jpeg-js";
import { useSyncExternalStore } from "react";

import { prepareImage } from "@/features/background/render";
import { GLASS_RANGE, setLook } from "@/ui/theme";

import { isPresetId, type PresetId } from "./presets";

/**
 * Fork (Hari, L-245): the picture behind the whole app, as set on this
 * phone. Pages are clear over it and cards are glass (see `glassed` in
 * ui/theme); each screen draws it once, softened and dimmed, in `Backdrop`.
 */

export type WallpaperSource =
  | { kind: "none" }
  | { kind: "preset"; id: PresetId }
  /** A picked photo, its file name in WALLPAPERS, and its main hue if it has one. */
  | { kind: "photo"; file: string; hue: number | null };

export type Wallpaper = {
  source: WallpaperSource;
  /** How much of the page's colour is laid over it, per scheme, 0.2–0.9. */
  dimDark: number;
  dimLight: number;
  /** How soft it is drawn, 0–30 (an image blur radius). */
  blur: number;
  /** Cards' opacity over it, kept while it is off so it returns as it was. */
  glass: number;
};

export const DIM_RANGE = { min: 0.2, max: 0.9 } as const;
export const BLUR_RANGE = { min: 0, max: 30 } as const;
/** Laid over the dim behind a conversation's messages, so they read easily. */
export const READING_DIM = 0.15;

const DEFAULT_WALLPAPER: Wallpaper = {
  source: { kind: "none" },
  dimDark: 0.6,
  dimLight: 0.7,
  blur: 6,
  glass: GLASS_RANGE.default,
};

const KEY = "wallpaper";
// Saved with the record from local36 on: older ones were saved under weaker
// default dims that left light-mode text hard to read, so they come up to
// the new defaults once (a dim set lower after that is kept).
const VERSION = 2;
/** Where picked wallpapers are kept, cropped and scaled for the screen. */
const WALLPAPERS = new Directory(Paths.document, "wallpapers");

const clamp = (value: unknown, min: number, max: number, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;

function parseSource(value: unknown): WallpaperSource {
  if (typeof value !== "object" || value === null) return DEFAULT_WALLPAPER.source;
  const fields = new Map(Object.entries(value));
  const kind = fields.get("kind");
  const id = fields.get("id");
  if (kind === "preset" && isPresetId(id)) return { kind, id };
  const file = fields.get("file");
  const hue = fields.get("hue");
  // A bare file name: storage is outside the app's types, so no path escapes WALLPAPERS.
  if (kind === "photo" && typeof file === "string" && /^[\w.-]+$/.test(file))
    return { kind, file, hue: typeof hue === "number" ? Math.round(hue) % 360 : null };
  return DEFAULT_WALLPAPER.source;
}

/** A saved wallpaper, checked field by field. */
export function parseWallpaper(raw: string): Wallpaper {
  const saved: unknown = JSON.parse(raw);
  if (typeof saved !== "object" || saved === null) return DEFAULT_WALLPAPER;
  const fields = new Map(Object.entries(saved));
  const d = DEFAULT_WALLPAPER;
  const dim = (key: "dimDark" | "dimLight") => {
    const value = clamp(fields.get(key), DIM_RANGE.min, DIM_RANGE.max, d[key]);
    return fields.get("v") === VERSION ? value : Math.max(value, d[key]);
  };
  return {
    source: parseSource(fields.get("source")),
    dimDark: dim("dimDark"),
    dimLight: dim("dimLight"),
    blur: clamp(fields.get("blur"), BLUR_RANGE.min, BLUR_RANGE.max, d.blur),
    glass: clamp(fields.get("glass"), GLASS_RANGE.min, GLASS_RANGE.max, d.glass),
  };
}

function load(): Wallpaper {
  try {
    const raw = Storage.getItemSync(KEY);
    return raw ? parseWallpaper(raw) : DEFAULT_WALLPAPER;
  } catch {
    return DEFAULT_WALLPAPER;
  }
}

let wallpaper = load();
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Glass only while there is something behind it. */
const syncGlass = () =>
  setLook({ glass: wallpaper.source.kind === "none" ? null : wallpaper.glass });
syncGlass();

/** Changes the wallpaper or how it is drawn, and remembers it on this phone. */
export function setWallpaper(patch: Partial<Wallpaper>): void {
  const previous = wallpaper.source;
  wallpaper = { ...wallpaper, ...patch };
  if (previous.kind === "photo" && wallpaper.source !== previous) removePhoto(previous.file);
  void Storage.setItem(KEY, JSON.stringify({ ...wallpaper, v: VERSION }));
  syncGlass();
  listeners.forEach((listener) => listener());
}

export function useWallpaper(): Wallpaper {
  return useSyncExternalStore(subscribe, () => wallpaper);
}

/** A photo's file URI. */
export const photoUri = (file: string): string => new File(WALLPAPERS, file).uri;

function removePhoto(file: string) {
  const photo = new File(WALLPAPERS, file);
  if (photo.exists) photo.delete();
}

/**
 * A photo's main hue, for an accent to match: each pixel of a small copy
 * votes for its hue by how vivid it is. Null for a photo with little colour.
 */
async function mainHue(uri: string): Promise<number | null> {
  const small = await (
    await ImageManipulator.manipulate(uri).resize({ width: 24, height: 48 }).renderAsync()
  ).saveAsync({ format: SaveFormat.JPEG, compress: 0.9 });
  const file = new File(small.uri);
  try {
    const { data } = decode(await file.bytes(), { useTArray: true, formatAsRGBA: true });
    let x = 0;
    let y = 0;
    let total = 0;
    for (let index = 0; index < data.length; index += 4) {
      const r = data[index] / 255;
      const g = data[index + 1] / 255;
      const b = data[index + 2] / 255;
      const max = Math.max(r, g, b);
      const delta = max - Math.min(r, g, b);
      if (delta === 0 || max < 0.15) continue;
      const sector =
        max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
      const angle = (sector * Math.PI) / 3;
      // Saturation times value: grey and dark pixels hardly count.
      const weight = delta;
      x += Math.cos(angle) * weight;
      y += Math.sin(angle) * weight;
      total += weight;
    }
    // Colours that cancel out, or too little of any: no main hue.
    if (total === 0 || Math.hypot(x, y) / (data.length / 4) < 0.05) return null;
    return Math.round(((Math.atan2(y, x) * 180) / Math.PI + 360) % 360) % 360;
  } finally {
    if (file.exists) file.delete();
  }
}

/** Lets the user pick a photo, then uses it as the wallpaper. False if they cancelled. */
export async function pickWallpaperPhoto(): Promise<boolean> {
  const result = await launchImageLibraryAsync({ mediaTypes: "images", quality: 1 });
  const picked = result.assets?.[0];
  if (result.canceled || !picked) return false;
  const file = `wallpaper-${Date.now()}.jpg`;
  const destination = new File(WALLPAPERS, file);
  await prepareImage(picked.uri, destination);
  const hue = await mainHue(destination.uri).catch(() => null);
  setWallpaper({ source: { kind: "photo", file, hue } });
  return true;
}

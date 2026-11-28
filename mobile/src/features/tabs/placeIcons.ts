// Fork (Hari, L-412): the icon a project or Mono has on the arc, chosen on
// the phone and kept per desktop. None means its first letter.
import Storage from "expo-sqlite/kv-store";
import { useSyncExternalStore } from "react";

import type { IconName } from "@/ui/Icon";

export type PlaceIcon = { kind: "icon"; name: IconName } | { kind: "emoji"; text: string };
export type PlaceIcons = Record<string, PlaceIcon>;

/** The icons the picker offers, all from `ui/Icon.tsx`'s set. */
export const PLACE_ICON_NAMES = [
  "chat", "folder", "file", "sparkle", "terminal", "robot",
  "wrench", "bot", "computer", "phone", "monitor", "music",
  "leaf", "bookmark", "pin", "automation", "people", "layers",
  "note", "tasks", "notifications", "shield", "lock", "camera",
] as const satisfies readonly IconName[];

const NAMES: ReadonlySet<string> = new Set(PLACE_ICON_NAMES);
const FALLBACK_EMOJI_UNITS = 8;

/** At most one grapheme: the first, by `Intl.Segmenter` when there is one. */
export function firstGrapheme(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    for (const part of segmenter.segment(trimmed)) return part.segment;
  }
  return trimmed.slice(0, FALLBACK_EMOJI_UNITS);
}

/** What is stored, with unknown icon names and empty emoji dropped. */
export function parsePlaceIcons(raw: string | null): PlaceIcons {
  if (!raw) return {};
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
    const icons: PlaceIcons = {};
    for (const [id, entry] of Object.entries(value)) {
      if (typeof entry !== "object" || entry === null) continue;
      const { kind, name, text } = entry as { kind?: unknown; name?: unknown; text?: unknown };
      if (kind === "icon" && typeof name === "string" && NAMES.has(name)) {
        icons[id] = { kind: "icon", name: name as IconName }; // checked against the list above
      } else if (kind === "emoji" && typeof text === "string") {
        const grapheme = firstGrapheme(text);
        if (grapheme) icons[id] = { kind: "emoji", text: grapheme };
      }
    }
    return icons;
  } catch {
    return {};
  }
}

/** The map without `ids`; the same map when none was in it. */
export function withoutIcons(icons: PlaceIcons, ids: readonly string[]): PlaceIcons {
  if (!ids.some((id) => id in icons)) return icons;
  const next = { ...icons };
  for (const id of ids) delete next[id];
  return next;
}

const keyFor = (fingerprint: string) => `hari.placeIcons.${fingerprint}`;
const cache = new Map<string, PlaceIcons>();
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

function read(fingerprint: string): PlaceIcons {
  let icons = cache.get(fingerprint);
  if (!icons) {
    try {
      icons = parsePlaceIcons(Storage.getItemSync(keyFor(fingerprint)));
    } catch {
      icons = {};
    }
    cache.set(fingerprint, icons);
  }
  return icons;
}

function write(fingerprint: string, next: PlaceIcons) {
  cache.set(fingerprint, next);
  listeners.forEach((listener) => listener());
  void Storage.setItem(keyFor(fingerprint), JSON.stringify(next)).catch(() => undefined);
}

/** Every icon for this desktop; changes as one is set or removed. */
export function usePlaceIcons(fingerprint: string): PlaceIcons {
  return useSyncExternalStore(subscribe, () => read(fingerprint));
}

export function setPlaceIcon(fingerprint: string, id: string, icon: PlaceIcon) {
  write(fingerprint, { ...read(fingerprint), [id]: icon });
}

/** Removes the icons of `ids` in one write, so the circle shows its letter. */
export function removePlaceIcons(fingerprint: string, ids: readonly string[]) {
  const current = read(fingerprint);
  const next = withoutIcons(current, ids);
  if (next !== current) write(fingerprint, next);
}

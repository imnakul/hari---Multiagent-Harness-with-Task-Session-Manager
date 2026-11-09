import Storage from "expo-sqlite/kv-store";
import { useSyncExternalStore } from "react";

import type { LiveMode } from "@/features/liveUpdates/liveCards";

/**
 * Fork (Hari, L-239): whether running sessions show as a Live Update (off
 * until turned on), and as one card for all or one card each.
 */
export type LivePreferences = { enabled: boolean; mode: LiveMode };

const STORAGE_KEY = "liveUpdates";
const DEFAULTS: LivePreferences = { enabled: false, mode: "combined" };

function load(): LivePreferences {
  try {
    const parsed = JSON.parse(Storage.getItemSync(STORAGE_KEY) ?? "{}") as
      | Partial<LivePreferences>
      | null;
    return {
      enabled: parsed?.enabled === true,
      mode: parsed?.mode === "each" ? "each" : "combined",
    };
  } catch {
    return DEFAULTS;
  }
}

// Held here, so the settings screen and the Live Update see one value.
let current: LivePreferences | null = null;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export function useLivePreferences(): [
  LivePreferences,
  (change: Partial<LivePreferences>) => void,
] {
  const value = useSyncExternalStore(subscribe, () => (current ??= load()));
  const set = (change: Partial<LivePreferences>) => {
    current = { ...value, ...change };
    void Storage.setItem(STORAGE_KEY, JSON.stringify(current));
    listeners.forEach((listener) => listener());
  };
  return [value, set];
}

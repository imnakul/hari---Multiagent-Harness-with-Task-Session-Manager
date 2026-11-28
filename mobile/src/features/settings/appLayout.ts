// Fork (Hari, L-412): how the phone is laid out. One stored value of three,
// so "Tabs and Monos only" can't both be on.
import Storage from "expo-sqlite/kv-store";
import { useSyncExternalStore } from "react";

export type AppLayout = "classic" | "tabs" | "monos";
export type TabBarStyle = "floating" | "fixed";

const LAYOUT_KEY = "layout.app";
/** Before the three-way choice, "Monos only" was a switch under this key. */
const LEGACY_MONO_ONLY_KEY = "layout.monoOnly";
const TAB_BAR_KEY = "layout.tabBar";

/**
 * What the stored values mean. `layout.app` wins when it is there (a value
 * that isn't one of the three reads as classic); without it, the old
 * "Monos only" switch carries over; with neither, classic.
 */
export function resolveLayout(app: string | null, legacyMonoOnly: string | null): AppLayout {
  if (app !== null) return app === "tabs" || app === "monos" ? app : "classic";
  return legacyMonoOnly === "true" ? "monos" : "classic";
}

export function resolveTabBarStyle(stored: string | null): TabBarStyle {
  return stored === "fixed" ? "fixed" : "floating";
}

function readStored(key: string): string | null {
  try {
    return Storage.getItemSync(key);
  } catch {
    return null;
  }
}

function createStore<T>(read: () => T, write: (next: T) => void) {
  let value: T | undefined;
  let loaded = false;
  const listeners = new Set<() => void>();
  return {
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    get: (): T => {
      if (!loaded) {
        value = read();
        loaded = true;
      }
      return value as T; // set on the line above
    },
    set: (next: T) => {
      value = next;
      loaded = true;
      write(next);
      listeners.forEach((listener) => listener());
    },
  };
}

const layoutStore = createStore<AppLayout>(
  () => resolveLayout(readStored(LAYOUT_KEY), readStored(LEGACY_MONO_ONLY_KEY)),
  (next) => void Storage.setItem(LAYOUT_KEY, next),
);

const tabBarStore = createStore<TabBarStyle>(
  () => resolveTabBarStyle(readStored(TAB_BAR_KEY)),
  (next) => void Storage.setItem(TAB_BAR_KEY, next),
);

export const readAppLayout = (): AppLayout => layoutStore.get();

export function useAppLayout() {
  const value = useSyncExternalStore(layoutStore.subscribe, layoutStore.get);
  return [value, layoutStore.set] as const;
}

/** Floating glass pill, or a bar across the bottom. Applies at once. */
export function useTabBarStyle() {
  const value = useSyncExternalStore(tabBarStore.subscribe, tabBarStore.get);
  return [value, tabBarStore.set] as const;
}

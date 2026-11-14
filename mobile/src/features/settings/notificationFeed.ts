import Storage from "expo-sqlite/kv-store";
import { useSyncExternalStore } from "react";

/**
 * Fork (Hari, L-275): how the computer's notifications reach this phone.
 * `watch` keeps a quiet background service running so they arrive with Hari
 * out of view; `seenOnDesktop` includes the ones for chats that were open on
 * the computer as they happened (the desktop's bell hides those);
 * `automations` posts automation runs. Each is on until turned off.
 */
export type FeedPreferences = {
  watch: boolean;
  seenOnDesktop: boolean;
  automations: boolean;
};

const STORAGE_KEY = "notifications.feed";
const DEFAULTS: FeedPreferences = {
  watch: true,
  seenOnDesktop: true,
  automations: true,
};

function load(): FeedPreferences {
  try {
    const parsed: unknown = JSON.parse(Storage.getItemSync(STORAGE_KEY) ?? "{}");
    const saved = typeof parsed === "object" && parsed !== null ? parsed : {};
    const flag = (name: keyof FeedPreferences) =>
      Reflect.get(saved, name) !== false;
    return {
      watch: flag("watch"),
      seenOnDesktop: flag("seenOnDesktop"),
      automations: flag("automations"),
    };
  } catch {
    return DEFAULTS;
  }
}

// Held here, so the settings screen and the feed see one value.
let current: FeedPreferences | null = null;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export function readFeedPreferences(): FeedPreferences {
  return (current ??= load());
}

export function useFeedPreferences(): [
  FeedPreferences,
  (change: Partial<FeedPreferences>) => void,
] {
  const value = useSyncExternalStore(subscribe, readFeedPreferences);
  const set = (change: Partial<FeedPreferences>) => {
    current = { ...value, ...change };
    void Storage.setItem(STORAGE_KEY, JSON.stringify(current));
    listeners.forEach((listener) => listener());
  };
  return [value, set];
}

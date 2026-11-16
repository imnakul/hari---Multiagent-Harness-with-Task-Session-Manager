import Storage from "expo-sqlite/kv-store";
import { useSyncExternalStore } from "react";

import { DEFAULT_SKIPPED_APPS } from "./noticeModel";

/**
 * Fork (Hari, L-325): whether the phone's notifications go to the computer
 * (off until turned on), and the apps whose notifications never do.
 */
export type PhoneNoticePreferences = { enabled: boolean; skipped: string[] };

const STORAGE_KEY = "phoneNotifications";

function load(): PhoneNoticePreferences {
  try {
    const parsed: unknown = JSON.parse(Storage.getItemSync(STORAGE_KEY) ?? "{}");
    const enabled = typeof parsed === "object" && parsed !== null && Reflect.get(parsed, "enabled") === true;
    const skipped = typeof parsed === "object" && parsed !== null ? Reflect.get(parsed, "skipped") : undefined;
    return {
      enabled,
      skipped: Array.isArray(skipped)
        ? skipped.filter((pkg): pkg is string => typeof pkg === "string")
        : [...DEFAULT_SKIPPED_APPS],
    };
  } catch {
    return { enabled: false, skipped: [...DEFAULT_SKIPPED_APPS] };
  }
}

// Held here, so the settings screen and the sync see one value.
let current: PhoneNoticePreferences | null = null;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const read = () => (current ??= load());

export function usePhoneNoticePreferences(): [
  PhoneNoticePreferences,
  (change: Partial<PhoneNoticePreferences>) => void,
] {
  const value = useSyncExternalStore(subscribe, read);
  const set = (change: Partial<PhoneNoticePreferences>) => {
    current = { ...read(), ...change };
    void Storage.setItem(STORAGE_KEY, JSON.stringify(current));
    listeners.forEach((listener) => listener());
  };
  return [value, set];
}

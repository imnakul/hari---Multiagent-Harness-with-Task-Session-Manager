import Storage from "expo-sqlite/kv-store";
import { useSyncExternalStore } from "react";

import { setHapticsEnabled } from "@/ui/haptics";

// Fork (Hari, L-288): whether buttons and switches vibrate when tapped.

const STORAGE_KEY = "feel.haptics";

function load(): boolean {
  try {
    return Storage.getItemSync(STORAGE_KEY) !== "false";
  } catch {
    return true;
  }
}

let on: boolean | null = null;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** On until turned off. */
function hapticsOn(): boolean {
  return (on ??= load());
}

export function useHaptics() {
  const value = useSyncExternalStore(subscribe, hapticsOn);
  const set = (next: boolean) => {
    on = next;
    setHapticsEnabled(next);
    void Storage.setItem(STORAGE_KEY, String(next));
    listeners.forEach((listener) => listener());
  };
  return [value, set] as const;
}

/** Read once as the app starts (root layout), so the first taps already obey it. */
export function loadHapticsSetting() {
  setHapticsEnabled(hapticsOn());
}

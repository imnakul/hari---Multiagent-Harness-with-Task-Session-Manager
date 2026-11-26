import Storage from "expo-sqlite/kv-store";
import { useSyncExternalStore } from "react";

import { newDeviceId } from "./usageModel";

/** Fork (Hari, L-398): whether the phone's screen time goes to the computer (off until turned on). */
const ENABLED_KEY = "hari.phoneUsage.enabled";
const DEVICE_KEY = "hari.phoneUsage.deviceId";

let enabled: boolean | null = null;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const read = (): boolean => (enabled ??= Storage.getItemSync(ENABLED_KEY) === "true");

export function usePhoneUsageEnabled(): [boolean, (on: boolean) => void] {
  const value = useSyncExternalStore(subscribe, read);
  const set = (on: boolean) => {
    enabled = on;
    void Storage.setItem(ENABLED_KEY, String(on));
    listeners.forEach((listener) => listener());
  };
  return [value, set];
}

/** This phone's id for the computer, made once and kept. */
export function phoneUsageDeviceId(): string {
  const stored = Storage.getItemSync(DEVICE_KEY);
  if (stored && /^[A-Za-z0-9-]{8,64}$/.test(stored)) return stored;
  const made = newDeviceId();
  void Storage.setItem(DEVICE_KEY, made);
  return made;
}

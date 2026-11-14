import * as Native from "expo-haptics";

// Fork (Hari, L-288): expo-haptics, quiet while Settings › Haptics is off.
// Every tap feedback in the app goes through here. The setting
// (features/settings/haptics) tells this module; on until it does.

export { ImpactFeedbackStyle, NotificationFeedbackType } from "expo-haptics";

let enabled = true;

export function setHapticsEnabled(on: boolean) {
  enabled = on;
}

const quiet = () => Promise.resolve();

export function selectionAsync(): Promise<void> {
  return enabled ? Native.selectionAsync() : quiet();
}

export function impactAsync(style?: Native.ImpactFeedbackStyle): Promise<void> {
  return enabled ? Native.impactAsync(style) : quiet();
}

export function notificationAsync(type?: Native.NotificationFeedbackType): Promise<void> {
  return enabled ? Native.notificationAsync(type) : quiet();
}

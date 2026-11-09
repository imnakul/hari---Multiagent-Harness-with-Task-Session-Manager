import { requireOptionalNativeModule } from "expo";
import { useEffect, useState } from "react";
import { AppState, Platform } from "react-native";

import type { LiveCard } from "./liveCards";

// Fork (Hari, L-239): the Android module (modules/hari-live) that draws the
// Live Update and runs the service that keeps it current with the phone locked.

export type LiveEvent =
  | { action: "tick" }
  | { action: "stop"; sessionId: string }
  | { action: "approve" | "deny"; sessionId: string; requestId: number }
  | { action: "dismiss"; sessionIds?: string[] };

type HariLiveModule = {
  update(cards: string): void;
  supported(): boolean;
  canPostPromoted(): boolean;
  openPromotedSettings(): boolean;
  openBatterySettings(): boolean;
  addListener(
    event: "onAction",
    listener: (event: LiveEvent) => void,
  ): { remove(): void };
};

const native =
  Platform.OS === "android"
    ? requireOptionalNativeModule<HariLiveModule>("HariLive")
    : null;

/** Whether this build can show Live Updates (Android, with the module). */
export const liveAvailable = native !== null;

/** Android 16 draws Live Updates; older Android shows a pinned notification. */
export const livePromotable = native?.supported() ?? false;

let last = "[]";
/** Shows these cards in place of the last; none closes the Live Update. */
export function showLiveCards(cards: LiveCard[]) {
  const json = JSON.stringify(cards);
  // The app re-renders often; Android only hears of a change.
  if (!native || json === last) return;
  last = json;
  native.update(json);
}

export function onLiveEvent(listener: (event: LiveEvent) => void) {
  return native?.addListener("onAction", listener);
}

export const openPromotedSettings = () => native?.openPromotedSettings();
export const openBatterySettings = () => native?.openBatterySettings();

/** Whether Android lets Hari show Live Updates; checked again on returning
 *  from system settings. */
export function usePromotedAllowed() {
  const [allowed, setAllowed] = useState(
    () => native?.canPostPromoted() ?? false,
  );
  useEffect(() => {
    if (!native) return;
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") setAllowed(native.canPostPromoted());
    });
    return () => subscription.remove();
  }, []);
  return allowed;
}

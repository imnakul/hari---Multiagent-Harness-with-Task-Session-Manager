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
  | { action: "dismiss"; sessionIds?: string[] }
  /** Android or the phone maker rejected a card; none show for this run. */
  | { action: "failed"; message?: string }
  /** Fork (L-279): the share sheet or the tile left something to send. */
  | { action: "shared" };

type HariLiveModule = {
  update(cards: string): void;
  setWatching(on: boolean): void;
  /** Fork (L-277); missing in builds before it. */
  setStreamLive?(on: boolean): void;
  /** Fork (L-279); missing in builds before it. */
  takeShared?(): string;
  saveToDownloads?(source: string, name: string, mimeType: string): Promise<string>;
  openFile?(uri: string, mimeType: string): boolean;
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

// Null until the first call, so a new run always tells Android once, even
// "none": that clears cards an earlier, killed run left on screen.
let last: string | null = null;
/** Shows these cards in place of the last; none closes the Live Update.
 *  `color` (`#rrggbb`, the app's accent; L-245) tints its icon and progress. */
export function showLiveCards(cards: LiveCard[], color?: string) {
  const json = JSON.stringify(color ? cards.map((card) => ({ ...card, color })) : cards);
  // The app re-renders often; Android only hears of a change.
  if (!native || json === last) return;
  last = json;
  try {
    native.update(json);
  } catch (error) {
    // Called from an effect: a throw here would close the app.
    console.warn("Live Update: could not update the cards", error);
  }
}

/**
 * Fork (Hari, L-275): keeps the service (and its 15-second tick) running with
 * no session card, so the app can check the computer for notifications while
 * it is out of view. Must be turned on while the app is open: Android won't
 * start the service from the background.
 */
export function setLiveWatching(on: boolean) {
  try {
    native?.setWatching(on);
  } catch (error) {
    console.warn("Background watching: could not change it", error);
  }
}

/**
 * Fork (Hari, L-277): the event stream to the computer is open, so news
 * arrives on it and the service's tick only needs to run rarely (every two
 * minutes instead of 15 seconds, while no Live Update card shows).
 */
export function setLiveStreamLive(on: boolean) {
  try {
    native?.setStreamLive?.(on);
  } catch (error) {
    console.warn("Background watching: could not change the tick", error);
  }
}

export function onLiveEvent(listener: (event: LiveEvent) => void) {
  return native?.addListener("onAction", listener);
}

export const openPromotedSettings = () => native?.openPromotedSettings();

/** Fork (L-279): what the share sheet and the tile left (JSON text), emptied; null without the module. */
export function takeNativeShared(): string | null {
  try {
    return native?.takeShared?.() ?? null;
  } catch (error) {
    console.warn("Share: could not read what was shared to Hari", error);
    return null;
  }
}

/** Fork (L-279): whether this build can save to Downloads (Android with the new module). */
export const canSaveToDownloads = typeof native?.saveToDownloads === "function";

/** Fork (L-279): moves a file from Hari's cache into Download/Hari; the saved file's URI. */
export async function saveToDownloads(source: string, name: string, mimeType: string): Promise<string> {
  if (!native?.saveToDownloads) throw new Error("Update Hari to save files to Downloads");
  return native.saveToDownloads(source, name, mimeType);
}

/** Fork (L-279): opens a saved file in the app the user picks. */
export function openNativeFile(uri: string, mimeType: string): boolean {
  try {
    return native?.openFile?.(uri, mimeType) ?? false;
  } catch {
    return false;
  }
}
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

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
  | { action: "shared" }
  /** Fork (L-325): the phone's notifications changed. */
  | { action: "notifications" };

type HariLiveModule = {
  update(cards: string): void;
  setWatching(on: boolean): void;
  /** Fork (L-277); missing in builds before it. */
  setStreamLive?(on: boolean): void;
  /** Fork (L-313); missing in builds before it. */
  quit?(): void;
  /** Fork (L-279); missing in builds before it. */
  takeShared?(): string;
  saveToDownloads?(source: string, name: string, mimeType: string): Promise<string>;
  openFile?(uri: string, mimeType: string): boolean;
  /** Fork (L-290, L-297); missing in builds before it. */
  deleteSaved?(uris: string[]): number;
  keepAwake?(on: boolean): void;
  hasAllFiles?(): boolean;
  openAllFilesSettings?(): boolean;
  listFiles?(path: string, offset: number): string;
  describeFile?(path: string): string;
  /** Fork (L-375); missing in builds before it. */
  displayName?(uri: string): string | null;
  /** Fork (L-321); missing in builds before it. */
  bubbleState?(): { enabled: boolean; permitted: boolean };
  setBubble?(on: boolean, color: string | null): boolean;
  openOverlaySettings?(): boolean;
  /** Fork (L-325); missing in builds before it. */
  notificationAccess?(): boolean;
  openNotificationAccess?(): boolean;
  activeNotifications?(): string;
  dismissNotification?(key: string): boolean;
  appIcons?(packages: string[]): Record<string, string>;
  appLabels?(packages: string[]): Record<string, string>;
  /** Fork (L-398); missing in builds before it. */
  usageAccess?(): boolean;
  openUsageAccess?(): boolean;
  usageIntervals?(since: number, until: number): string;
  /** Fork (L-280); missing in builds before it. */
  phoneStats?(): Record<string, unknown>;
  wake?(macs: string[], broadcasts: string[]): Promise<number>;
  ring?(start: boolean): void;
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

/** Fork (Hari, L-313): whether this build can quit itself (Android). */
export const canQuit = typeof native?.quit === "function";

/**
 * Fork (Hari, L-313): closes Hari: the always-on notification, the session
 * cards and the link to the computer stop, until Hari is opened again.
 */
export function quitHari() {
  try {
    native?.quit?.();
  } catch (error) {
    console.warn("Quit: could not close Hari", error);
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
/** Fork (L-290): deletes files Hari saved to Download/Hari; how many went (0 without the module). */
export function deleteSavedFiles(uris: string[]): number {
  if (!uris.length) return 0;
  try {
    return native?.deleteSaved?.(uris) ?? 0;
  } catch (error) {
    console.warn("Share: could not delete saved files", error);
    return 0;
  }
}

/** Fork (L-290): keeps the screen on while a big file moves. */
export function keepScreenAwake(on: boolean) {
  try {
    native?.keepAwake?.(on);
  } catch {
    // Older builds: the screen may sleep; the transfer resumes.
  }
}

/** Fork (L-297): the phone storage the computer can browse; null without the module. */
export const phoneFiles = native?.listFiles
  ? {
      allowed: () => native?.hasAllFiles?.() ?? false,
      openSettings: () => native?.openAllFilesSettings?.() ?? false,
      list: (path: string, offset: number): string => native?.listFiles?.(path, offset) ?? "{}",
      describe: (path: string): string => native?.describeFile?.(path) ?? "{}",
    }
  : null;

export const openBatterySettings = () => native?.openBatterySettings();

/**
 * Fork (Hari, L-375): a picked file's name as the phone shows it. Expo's
 * `File.name` is the last part of the address, which for a picked file is
 * often a number ("1565"); `fallback` is used on builds without the module.
 */
export function pickedFileName(uri: string, fallback: string): string {
  try {
    return native?.displayName?.(uri)?.trim() || fallback;
  } catch {
    return fallback;
  }
}

/** Fork (Hari, L-321): the Share bubble over other apps; null without the module. */
export type ShareBubbleState = { enabled: boolean; permitted: boolean };
export const shareBubble = native?.setBubble
  ? {
      state: (): ShareBubbleState => {
        try {
          return native?.bubbleState?.() ?? { enabled: false, permitted: false };
        } catch {
          return { enabled: false, permitted: false };
        }
      },
      /** False when Android needs "Display over other apps" first. */
      set: (on: boolean, color: string): boolean => {
        try {
          return native?.setBubble?.(on, color) ?? false;
        } catch (error) {
          console.warn("Share bubble: could not change it", error);
          return false;
        }
      },
      openSettings: (): boolean => native?.openOverlaySettings?.() ?? false,
    }
  : null;

/**
 * Fork (Hari, L-325): the phone's notifications for the computer; null
 * without the module (or a build from before it). A failed native call reads
 * as nothing, so a broken listener never stops the app.
 */
export const phoneNotices = native?.activeNotifications
  ? {
      allowed: (): boolean => {
        try {
          return native?.notificationAccess?.() ?? false;
        } catch {
          return false;
        }
      },
      openSettings: (): boolean => native?.openNotificationAccess?.() ?? false,
      /** JSON: `{ listening, items }` (see HariNotifications.active). */
      active: (): string => {
        try {
          return native?.activeNotifications?.() ?? "{}";
        } catch (error) {
          console.warn("Notifications: could not read the phone's list", error);
          return "{}";
        }
      },
      dismiss: (key: string): boolean => {
        try {
          return native?.dismissNotification?.(key) ?? false;
        } catch {
          return false;
        }
      },
      icons: (packages: string[]): Record<string, string> => {
        try {
          return native?.appIcons?.(packages) ?? {};
        } catch {
          return {};
        }
      },
      labels: (packages: string[]): Record<string, string> => {
        try {
          return native?.appLabels?.(packages) ?? {};
        } catch {
          return {};
        }
      },
    }
  : null;

/**
 * Fork (Hari, L-398): the phone's screen time for the computer's Activity
 * page; null without the module (or a build from before it). A failed native
 * call reads as no access and no intervals.
 */
export const phoneUsage = native?.usageIntervals
  ? {
      allowed: (): boolean => {
        try {
          return native?.usageAccess?.() ?? false;
        } catch {
          return false;
        }
      },
      openSettings: (): boolean => native?.openUsageAccess?.() ?? false,
      /** JSON `[{ package, label, start, end }]`: closed intervals only (see HariUsage). */
      intervals: (since: number, until: number): string => {
        try {
          return native?.usageIntervals?.(since, until) ?? "[]";
        } catch (error) {
          console.warn("Screen time: could not read the phone's usage", error);
          return "[]";
        }
      },
    }
  : null;

/** Fork (L-280): this phone's battery, temperature, storage and network; null without the module. */
export function nativePhoneStats(): Record<string, unknown> | null {
  try {
    return native?.phoneStats?.() ?? null;
  } catch (error) {
    console.warn("Computer: could not read the phone's stats", error);
    return null;
  }
}

/** Fork (L-280): whether this build can send Wake-on-LAN packets. */
export const canWake = typeof native?.wake === "function";

/** Fork (L-280): Wake-on-LAN magic packets to these cards; how many went out. */
export async function sendWake(macs: string[], broadcasts: string[]): Promise<number> {
  if (!native?.wake) throw new Error("Update Hari to wake your computer");
  return native.wake(macs, broadcasts);
}

/** Fork (L-280): Find my phone; rings at full alarm volume for up to 2 minutes. */
export function setNativeRinging(start: boolean) {
  try {
    native?.ring?.(start);
  } catch (error) {
    console.warn("Find my phone: could not ring", error);
  }
}

/** Whether Android lets Hari show Live Updates; checked again on returning
 *  from system settings. */
/** Fork (Hari, L-297): whether All files access is on; checked again on return to Hari. */
export function useAllFilesAllowed() {
  const [allowed, setAllowed] = useState(() => phoneFiles?.allowed() ?? false);
  useEffect(() => {
    if (!phoneFiles) return;
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") setAllowed(phoneFiles?.allowed() ?? false);
    });
    return () => subscription.remove();
  }, []);
  return allowed;
}

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

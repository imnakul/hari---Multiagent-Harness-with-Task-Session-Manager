import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect } from "react";
import {
  centerNotificationsSnapshot,
  subscribeCenterNotifications,
} from "../../notifications/model/notificationCenter";
import {
  applyMobileNotificationAction,
  mobileNotificationFeed,
  parseMobileNotificationAction,
} from "../model/mobileNotifications";

/** Event the desktop sends every workspace window when the phone changes the history. */
const PHONE_CHANGE_EVENT = "monocode-mobile-notifications";

/**
 * Fork (Hari, L-275): keeps the phone's copy of the bell's history current.
 * Publishes the list on every change (any window's: they share storage), and
 * applies the phone's dismiss, read and clear. Applying is idempotent, so it
 * doesn't matter that every window gets the same change.
 */
export function useMobileNotificationFeed(): void {
  useEffect(() => {
    let disposed = false;
    const publish = () => {
      const items = mobileNotificationFeed(centerNotificationsSnapshot());
      void invoke("mobile_notifications_publish", { items }).catch((error: unknown) => {
        if (!disposed) console.error("Phone notification publish failed", error);
      });
    };
    publish();
    const stop = subscribeCenterNotifications(publish);
    const listening = listen<unknown>(PHONE_CHANGE_EVENT, ({ payload }) => {
      const change = parseMobileNotificationAction(payload);
      if (change) applyMobileNotificationAction(change);
    });
    return () => {
      disposed = true;
      stop();
      void listening.then((unlisten) => unlisten());
    };
  }, []);
}

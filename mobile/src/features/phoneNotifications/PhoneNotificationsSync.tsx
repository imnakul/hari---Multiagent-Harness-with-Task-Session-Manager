import { useEffect, useRef } from "react";
import { AppState } from "react-native";

import { useConnection } from "@/features/connection/ConnectionProvider";
import { onLinkItem } from "@/features/link/linkStream";
import { onLiveEvent, phoneNotices } from "@/features/liveUpdates/nativeLive";

import { iconsNeeded, noticesToSend, parseActiveNotices } from "./noticeModel";
import { usePhoneNoticePreferences } from "./preferences";

/** Bursts of changes (a chat filling in) go as one send. */
const SEND_DELAY_MS = 1200;

/**
 * Fork (Hari, L-325): sends the phone's notifications to the computer's Share
 * panel. While on, allowed and connected: the whole list (minus skipped apps)
 * on connect and after each change, with the app icons the computer hasn't
 * had on this connection. Nothing waits for an absent computer: the next
 * connect sends what the phone shows then. Turned off, it tells the computer
 * once per connect so its list empties. Also clears the notifications the
 * computer dismisses.
 */
export function PhoneNotificationsSync(): null {
  const { pairing, connected, command } = useConnection();
  const [{ enabled, skipped }] = usePhoneNoticePreferences();
  const fingerprint = pairing?.desktop.fingerprint ?? null;
  const sentIcons = useRef(new Set<string>());
  const skipKey = skipped.join("\n");

  useEffect(() => {
    if (!fingerprint || !phoneNotices) return;
    return onLinkItem("notifications.dismiss", (item) => {
      const key = typeof item.payload === "object" && item.payload !== null ? Reflect.get(item.payload, "key") : null;
      if (typeof key === "string") phoneNotices?.dismiss(key);
    });
  }, [fingerprint]);

  // A new connection (or computer) starts without our icons.
  useEffect(() => {
    sentIcons.current = new Set();
  }, [fingerprint, connected]);

  useEffect(() => {
    const native = phoneNotices;
    if (!fingerprint || !connected || !native) return;
    if (!enabled) {
      command("phone.notifications", { enabled: false, items: [] }).catch(() => {
        // An older computer, or the link dropped: nothing to empty there.
      });
      return;
    }
    const skip = skipKey ? skipKey.split("\n") : [];
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let sending = false;
    let again = false;

    const send = async () => {
      if (sending) {
        again = true;
        return;
      }
      sending = true;
      try {
        const { listening, items } = parseActiveNotices(native.active());
        // Access is off or Android hasn't bound the listener yet: say nothing,
        // rather than tell the computer the phone has no notifications.
        if (!listening) return;
        const shown = noticesToSend(items, skip);
        const need = iconsNeeded(shown, sentIcons.current);
        const icons = need.length > 0 ? native.icons(need) : {};
        await command("phone.notifications", { enabled: true, items: shown, icons });
        for (const pkg of need) sentIcons.current.add(pkg);
      } catch (error: unknown) {
        // The next change or connect sends the list again.
        console.warn("Notifications: could not send them to the computer", error);
      } finally {
        sending = false;
        if (again && !stopped) {
          again = false;
          schedule();
        }
      }
    };
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        if (!stopped) void send();
      }, SEND_DELAY_MS);
    };

    void send();
    const changes = onLiveEvent((event) => {
      if (event.action === "notifications") schedule();
    });
    const appState = AppState.addEventListener("change", (state) => {
      if (state === "active") schedule();
    });
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      changes?.remove();
      appState.remove();
    };
  }, [fingerprint, connected, enabled, skipKey, command]);

  return null;
}

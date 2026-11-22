import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect } from "react";
import { loadNotificationsEnabled } from "../../notifications/model/notifications";
import {
  flushPhoneBanners,
  initialPhoneBannerState,
  loadPhoneBanners,
  planPhoneBanners,
  type PhoneBanner,
  type PhoneBannerState,
} from "../model/phoneBanners";
import { parsePhoneNotices, PHONE_NOTIFICATIONS_EVENT } from "../model/phoneNotifications";
import { readSharePanelOpen, readShareView } from "../model/shareView";

/** Click identifier prefix; Rust routes it to Share's Notifications view. */
const BANNER_ID_PREFIX = "hari-phone:";

/** Share already shows the list while it is open on Notifications and the window is focused. */
function shareIsShowingNotifications(): boolean {
  return readSharePanelOpen() && readShareView() === "notifications" && document.hasFocus();
}

function showBanner(banner: PhoneBanner): void {
  invoke("show_notification", {
    sessionId: `${BANNER_ID_PREFIX}${banner.key}`,
    title: banner.title,
    subtitle: banner.subtitle,
    body: banner.body,
    sound: false,
  }).catch(() => {
    // The OS refused the banner; the notice stays in Share.
  });
}

/**
 * Fork (Hari, L-384): shows the phone's new notifications as desktop banners
 * when "Show as desktop notifications" and the app's notifications are both on.
 * Mount once, in the main window.
 */
export function usePhoneNotificationBanners(): void {
  useEffect(() => {
    let state: PhoneBannerState = initialPhoneBannerState();
    let ask = 0;
    let disposed = false;
    const timers = new Map<string, number>();

    const deliver = (shown: PhoneBanner[]): void => {
      if (!loadPhoneBanners() || !loadNotificationsEnabled() || shareIsShowingNotifications()) return;
      shown.forEach(showBanner);
    };

    const refresh = (): void => {
      const mine = ++ask;
      invoke<unknown>("mobile_phone_notifications_list")
        .then((raw) => {
          if (disposed || mine !== ask) return;
          const list = parsePhoneNotices(raw);
          if (!list) return;
          const plan = planPhoneBanners(state, list, Date.now());
          state = plan.state;
          deliver(plan.show);
          for (const [pkg, at] of plan.flushAt) {
            if (timers.has(pkg)) continue;
            const timer = window.setTimeout(() => {
              timers.delete(pkg);
              if (disposed) return;
              const flushed = flushPhoneBanners(state, pkg, Date.now());
              state = flushed.state;
              deliver(flushed.show);
            }, Math.max(0, at - Date.now()));
            timers.set(pkg, timer);
          }
        })
        .catch(() => {
          // The list is unreadable right now; the next event tries again.
        });
    };

    refresh();
    const unlisten = listen(PHONE_NOTIFICATIONS_EVENT, refresh);
    return () => {
      disposed = true;
      for (const timer of timers.values()) window.clearTimeout(timer);
      void unlisten.then((stop) => stop()).catch(() => {});
    };
  }, []);
}

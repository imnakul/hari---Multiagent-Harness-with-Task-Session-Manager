import { useEffect } from "react";

import { useConnection } from "@/features/connection/ConnectionProvider";
import { onLinkItem, useLinkStream } from "@/features/link/linkStream";
import { nativePhoneStats, setNativeRinging } from "@/features/liveUpdates/nativeLive";

import { parseRing, parseWakeCards, PHONE_STATS_EVERY_MS, statsWantUntil } from "./pcModel";
import { saveWakeCards } from "./wakeStore";

/**
 * Fork (Hari, L-280): Computer's background half. Rings for the computer's
 * Find my phone, sends this phone's stats while the computer asks
 * (`stats.want`), and learns the computer's network cards each time the
 * stream comes up, for Wake-on-LAN. Mounted after LinkStreamSync.
 */
export function PcSync(): null {
  const { pairing, command } = useConnection();
  const fingerprint = pairing?.desktop.fingerprint ?? null;
  const live = useLinkStream().phase === "live";

  useEffect(() => {
    if (!fingerprint) return;
    let until = 0;
    let timer: ReturnType<typeof setInterval> | null = null;
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    const send = () => {
      if (Date.now() >= until) {
        stop();
        return;
      }
      const stats = nativePhoneStats();
      if (!stats) {
        stop();
        return;
      }
      command("phone.stats", stats).catch((reason: unknown) => {
        console.warn("Computer: could not send the phone's stats", reason);
      });
    };
    const ring = onLinkItem("ring", (item) => {
      const action = parseRing(item.payload, Date.now());
      if (action) setNativeRinging(action === "start");
    });
    const want = onLinkItem("stats.want", (item) => {
      const next = statsWantUntil(item.payload, Date.now());
      if (next === null) return;
      until = Math.max(until, next);
      if (!timer) {
        send();
        timer = setInterval(send, PHONE_STATS_EVERY_MS);
      }
    });
    return () => {
      ring();
      want();
      stop();
    };
  }, [fingerprint, command]);

  useEffect(() => {
    if (!fingerprint || !live) return;
    let disposed = false;
    command<unknown>("pc.wakeInfo")
      .then((raw) => {
        if (!disposed) saveWakeCards(fingerprint, parseWakeCards(raw));
      })
      .catch((reason: unknown) => {
        // An older MonoCode doesn't know it; Wake stays unavailable.
        console.warn("Computer: could not learn the network cards", reason);
      });
    return () => {
      disposed = true;
    };
  }, [fingerprint, live, command]);

  return null;
}

import { useEffect, useRef } from "react";
import { Platform } from "react-native";

import { useConnection } from "@/features/connection/ConnectionProvider";
import { readFeedPreferences } from "@/features/settings/notificationFeed";

import { runLinkStream } from "./linkStream";

/**
 * Fork (Hari, L-277): holds the event stream to the paired computer open: in
 * view always, and out of view while "Keep watching in the background" keeps
 * the app running (Android only; iOS suspends the app).
 */
export function LinkStreamSync(): null {
  const { pairing, command } = useConnection();
  const latest = useRef(pairing);
  useEffect(() => {
    latest.current = pairing;
  });
  const fingerprint = pairing?.desktop.fingerprint ?? null;
  useEffect(() => {
    if (!fingerprint) return;
    return runLinkStream({
      fingerprint,
      pairing: () => latest.current,
      command,
      keepInBackground: () => Platform.OS === "android" && readFeedPreferences().watch,
    });
  }, [fingerprint, command]);
  return null;
}

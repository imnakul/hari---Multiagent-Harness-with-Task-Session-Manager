import Constants from "expo-constants";
import { useEffect } from "react";
import { AppState, Platform } from "react-native";

import { useConnection } from "@/features/connection/ConnectionProvider";
import { phoneUsage } from "@/features/liveUpdates/nativeLive";

import { phoneUsageDeviceId, usePhoneUsageEnabled } from "./preferences";
import { chunk, parseCursor, parseIntervals, readSince } from "./usageModel";

const SYNC_EVERY_MS = 15 * 60 * 1000;

/**
 * Fork (Hari, L-398): sends the phone's screen time to the computer's
 * Activity page. While on, allowed and connected: asks the computer where it
 * left off, reads the closed intervals since then, and sends them in chunks.
 * Runs on connect, when the app comes to the front, and every 15 minutes
 * while it is. The first error stops the run; the next trigger retries, and
 * the computer stores a repeated interval once.
 */
export function PhoneUsageSync(): null {
  const { pairing, connected, command } = useConnection();
  const [enabled] = usePhoneUsageEnabled();
  const fingerprint = pairing?.desktop.fingerprint ?? null;

  useEffect(() => {
    const native = phoneUsage;
    if (Platform.OS !== "android" || !fingerprint || !connected || !enabled || !native) return;
    let stopped = false;
    let running = false;
    const device = phoneUsageDeviceId();
    const name = (Constants.deviceName?.trim() || "Phone").slice(0, 80);

    const sync = async () => {
      if (running || stopped || !native.allowed()) return;
      running = true;
      try {
        const now = Date.now();
        const cursor = parseCursor(await command("phone.usageCursor", { device }));
        const intervals = parseIntervals(native.intervals(readSince(cursor, now), now));
        for (const part of chunk(intervals)) {
          if (stopped) return;
          await command("phone.usage", { device, name, intervals: part });
        }
        if (intervals.length === 0 && !stopped) await command("phone.usage", { device, name, intervals: [] });
      } catch (error: unknown) {
        // An older computer, or the link dropped: the next trigger tries again.
        console.warn("Screen time: could not send it to the computer", error);
      } finally {
        running = false;
      }
    };

    void sync();
    const timer = setInterval(() => {
      if (AppState.currentState === "active") void sync();
    }, SYNC_EVERY_MS);
    const appState = AppState.addEventListener("change", (state) => {
      if (state === "active") void sync();
    });
    return () => {
      stopped = true;
      clearInterval(timer);
      appState.remove();
    };
  }, [fingerprint, connected, enabled, command]);

  return null;
}

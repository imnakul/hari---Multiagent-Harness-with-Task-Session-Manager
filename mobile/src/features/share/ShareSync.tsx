import { useEffect } from "react";
import { AppState } from "react-native";

import { useConnection } from "@/features/connection/ConnectionProvider";
import { onLinkItem, onLinkOutboxSettled } from "@/features/link/linkStream";
import { onLiveEvent } from "@/features/liveUpdates/nativeLive";

import {
  fillShareHistoryFromComputer,
  receiveShare,
  sendPendingShares,
  settleSentShares,
} from "./shareTransfers";

/**
 * Fork (Hari, L-279): Share's background half. Takes the computer's `share`
 * items off the event stream, marks sent texts done as the computer takes
 * them, and sends what the share sheet or the Quick Settings tile left
 * (at once while Hari runs, else when it opens). Mounted after
 * LinkStreamSync, so the stream is set up before it sends.
 */
export function ShareSync(): null {
  const { pairing, connected, command } = useConnection();
  const fingerprint = pairing?.desktop.fingerprint ?? null;
  useEffect(() => {
    if (!fingerprint) return;
    const items = onLinkItem("share", (item) => receiveShare(item.payload, command));
    const settled = onLinkOutboxSettled(settleSentShares);
    const take = () => sendPendingShares(command);
    take();
    const shared = onLiveEvent((event) => {
      if (event.action === "shared") take();
    });
    const appState = AppState.addEventListener("change", (state) => {
      if (state === "active") take();
    });
    return () => {
      items();
      settled();
      shared?.remove();
      appState.remove();
    };
  }, [fingerprint, command]);
  // Fork (Hari, L-317): on each connect, fill in what the computer has and
  // this phone lacks (everything after a reinstall).
  useEffect(() => {
    if (fingerprint && connected) void fillShareHistoryFromComputer(command);
  }, [fingerprint, connected, command]);
  return null;
}

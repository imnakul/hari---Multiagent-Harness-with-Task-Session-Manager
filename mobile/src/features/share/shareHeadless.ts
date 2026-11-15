import * as SecureStore from "expo-secure-store";
import Storage from "expo-sqlite/kv-store";
import { ToastAndroid } from "react-native";

import { request, type Pairing } from "@/features/connection/nativeLink";
import { bindLinkFor, flushLink } from "@/features/link/linkStream";

import { sendPendingShares, shareTransfersIdle } from "./shareTransfers";

// Fork (Hari, L-303): what the share sheet runs when Hari's code isn't
// running: Android starts this task with no window (Headless JS). It reads
// the pairing, checks the computer answers, sends what was shared and ends.
// Hari never comes to the front. When the computer doesn't answer, the items
// stay where the share sheet left them and go when Hari next opens.

export const SHARE_TASK = "HariShareSend";

// As ConnectionProvider keeps them.
const PAIRING = "monocode.mobile.pairing";
const IDENTITY = "monocode.mobile.identity";

let running: Promise<void> | null = null;

async function readPairing(): Promise<Pairing | null> {
  const [desktop, identity] = await Promise.all([
    Storage.getItem(PAIRING),
    SecureStore.getItemAsync(IDENTITY),
  ]);
  if (!desktop || !identity) return null;
  return { desktop: JSON.parse(desktop), identity: JSON.parse(identity) };
}

async function send(): Promise<void> {
  let pairing: Pairing | null = null;
  try {
    pairing = await readPairing();
  } catch (error) {
    console.warn("Share: could not read the pairing", error);
  }
  if (!pairing) {
    ToastAndroid.show("Open Hari and pair with your computer first", ToastAndroid.LONG);
    return;
  }
  const paired = pairing;
  const command = <T,>(method: string, params: object = {}, id?: string) =>
    request<T>(paired, method, params, id);
  try {
    // An empty send: cheap, and answered by every computer with the stream.
    await command("events.send", { items: [] });
  } catch (error) {
    if (!String(error).includes("Unsupported mobile operation")) {
      ToastAndroid.show("Sends when your computer is reachable", ToastAndroid.LONG);
      return;
    }
  }
  // Text waits in the outbox, which needs a computer to queue for.
  const release = bindLinkFor(paired.desktop.fingerprint, command);
  try {
    sendPendingShares(command);
    await shareTransfersIdle();
    await flushLink();
  } finally {
    release();
  }
}

/** The Headless JS task. Overlapping starts share one run, then run again. */
export async function runShareTask(): Promise<void> {
  while (running) await running;
  running = send().catch((error) => console.warn("Share: background send failed", error));
  try {
    await running;
  } finally {
    running = null;
  }
}

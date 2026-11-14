import Storage from "expo-sqlite/kv-store";

import { parseWakeCards, type WakeCard } from "./pcModel";

// Fork (Hari, L-280): the computer's network cards, learned while connected,
// so Hari can wake it when it's off. Kept per paired computer.

const key = (fingerprint: string) => `hari.pc.wake.${fingerprint}`;

export function readWakeCards(fingerprint: string): WakeCard[] {
  try {
    return parseWakeCards(JSON.parse(Storage.getItemSync(key(fingerprint)) ?? "[]"));
  } catch {
    return [];
  }
}

/** Keeps the latest cards; an empty answer (all cards down) keeps the old ones. */
export function saveWakeCards(fingerprint: string, cards: WakeCard[]) {
  if (cards.length === 0) return;
  Storage.setItemSync(key(fingerprint), JSON.stringify(cards));
}

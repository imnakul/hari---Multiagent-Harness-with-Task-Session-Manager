import { Alert } from "react-native";

import { sendWake } from "@/features/liveUpdates/nativeLive";
import { readWakeCards } from "./wakeStore";

/**
 * Fork (Hari, L-280, L-288): Wake-on-LAN to the paired computer's network
 * cards, from the Computer screen or the side menu. False when Hari hasn't
 * learned the computer's cards yet (it says how, in an alert). Throws when
 * the packets couldn't go out.
 */
export async function wakeComputer(fingerprint: string): Promise<boolean> {
  const cards = readWakeCards(fingerprint);
  if (cards.length === 0) {
    Alert.alert(
      "Hari hasn’t learned this computer yet",
      "Open Hari once while the computer is on, and turn on Wake-on-LAN in its network card and BIOS settings.",
    );
    return false;
  }
  await sendWake(
    cards.map((card) => card.mac),
    cards.map((card) => card.broadcast),
  );
  return true;
}

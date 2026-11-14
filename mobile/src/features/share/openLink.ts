import { Alert, Linking } from "react-native";

import { openOnComputer } from "./shareTransfers";

/**
 * Fork (Hari, L-286): a web link from a chat opens where the reader picks:
 * this phone's browser, or the computer's default browser (a dev server on
 * `localhost` only opens there). The computer's side goes as a Share link.
 */
export function chooseLinkOpen(url: string): void {
  Alert.alert(
    "Open link",
    url,
    [
      { text: "Cancel", style: "cancel" },
      { text: "On computer", onPress: () => openThere(url) },
      { text: "On phone", onPress: () => openHere(url) },
    ],
    { cancelable: true },
  );
}

function openHere(url: string) {
  Linking.openURL(url).catch(() =>
    Alert.alert("Couldn’t open the link", "No app on this phone opens it."),
  );
}

function openThere(url: string) {
  try {
    openOnComputer(url);
  } catch (reason) {
    Alert.alert(
      "Couldn’t open on the computer",
      reason instanceof Error ? reason.message : String(reason),
    );
  }
}

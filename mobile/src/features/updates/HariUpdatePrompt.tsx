// Fork (Hari, L-235): on launch, asks once per new release whether to install it.
import { useEffect, useRef } from "react";
import { Alert } from "react-native";

import {
  checkForHariUpdate,
  clearInstalledUpdate,
  installHariUpdate,
  updatesSupported,
} from "./useHariUpdate";
import { isDevVariant } from "./appVariant";

export function HariUpdatePrompt() {
  const asked = useRef(false);
  useEffect(() => {
    // Hari Dev is a debug build; release APKs are a different app (L-413).
    if (!updatesSupported || isDevVariant() || asked.current) return;
    asked.current = true;
    clearInstalledUpdate();
    void checkForHariUpdate(true).then((release) => {
      if (!release) return;
      Alert.alert(
        `Hari ${release.version} is ready`,
        release.notes ?? "Install it now? Your pairing and chats stay as they are.",
        [
          { text: "Later", style: "cancel" },
          { text: "Update", onPress: () => void installHariUpdate(release) },
        ],
      );
    });
  }, []);
  return null;
}

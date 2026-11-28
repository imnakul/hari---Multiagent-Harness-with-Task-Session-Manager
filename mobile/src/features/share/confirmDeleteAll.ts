import { Alert } from "react-native";

import { formatShareSize } from "@/features/share/shareModel";
import { shareHistory } from "@/features/share/shareStore";
import { clearAllShares, shareStorage } from "@/features/share/shareTransfers";
import * as Haptics from "@/ui/haptics";

/**
 * Fork (Hari, L-290, L-415): asks before Delete all, saying what goes (the
 * messages on both devices and the files received here) and what stays
 * (pinned and saved). Lives in Settings, under Share.
 */
export function confirmDeleteAllShares(): void {
  const storage = shareStorage();
  const kept = shareHistory().filter((entry) => entry.pinned || entry.saved).length;
  Alert.alert(
    "Delete all?",
    `Deletes the messages on this phone and your computer${
      storage.files ? `, and ${storage.files} received file${storage.files === 1 ? "" : "s"} (${formatShareSize(storage.filesBytes)})` : ""
    }.${kept ? ` ${kept} pinned or saved stay.` : ""}`,
    [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete all",
        style: "destructive",
        onPress: () => {
          clearAllShares();
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        },
      },
    ],
  );
}

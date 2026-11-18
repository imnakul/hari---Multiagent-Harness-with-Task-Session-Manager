import { Stack } from "expo-router";

import {
  modalStackOptions,
  sheetScreenLayout,
} from "@/features/files/codeScreen";
import { PlaceCloseButton } from "@/features/workspace/PlaceHeader";
import { androidBackHeader } from "@/ui/AndroidHeader";
import { useColors } from "@/ui/theme";

// Fork (Hari, L-236, L-346): the desktop's Notes, a place with its own
// stack: the list, and a note pushed inside it.
export default function NotesLayout() {
  const colors = useColors();
  return (
    <Stack
      screenOptions={modalStackOptions(colors)}
      screenLayout={sheetScreenLayout(colors.sheet)}
    >
      <Stack.Screen
        name="index"
        options={{
          title: "Notes",
          // Fork (Hari, L-346): a place of its own; Close only when opened over another screen.
          headerLeft: () => <PlaceCloseButton />,
        }}
      />
      <Stack.Screen name="[noteId]" options={{ title: "", ...androidBackHeader("Notes") }} />
    </Stack>
  );
}

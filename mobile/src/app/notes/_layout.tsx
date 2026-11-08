import { router, Stack } from "expo-router";

import {
  HeaderButton,
  modalStackOptions,
  sheetScreenLayout,
} from "@/features/files/codeScreen";
import { androidBackHeader } from "@/ui/AndroidHeader";
import { useColors } from "@/ui/theme";

// Fork (Hari, L-236): the desktop's Notes, as a native modal with its own
// stack: the list, and a note pushed inside the sheet.
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
          headerLeft: () => (
            <HeaderButton icon="close" label="Close" onPress={() => router.back()} />
          ),
        }}
      />
      <Stack.Screen name="[noteId]" options={{ title: "", ...androidBackHeader("Notes") }} />
    </Stack>
  );
}

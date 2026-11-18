import { Stack } from "expo-router";

import {
  modalStackOptions,
  sheetScreenLayout,
} from "@/features/files/codeScreen";
import { PlaceCloseButton, SidebarButton } from "@/features/workspace/PlaceHeader";
import { useColors } from "@/ui/theme";

// Fork (Hari, L-236): the desktop's Tasks, a place (L-346) with its own
// stack and header, as settings is.
export default function TasksLayout() {
  const colors = useColors();
  return (
    <Stack
      screenOptions={modalStackOptions(colors)}
      screenLayout={sheetScreenLayout(colors.sheet)}
    >
      <Stack.Screen
        name="index"
        options={{
          title: "Tasks",
          // Fork (Hari, L-346): a place of its own, opened and left from the side menu.
          headerLeft: () => <PlaceCloseButton />,
          headerRight: () => <SidebarButton />,
        }}
      />
    </Stack>
  );
}

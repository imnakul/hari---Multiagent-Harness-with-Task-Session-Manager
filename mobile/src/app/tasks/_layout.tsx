import { router, Stack } from "expo-router";

import {
  HeaderButton,
  modalStackOptions,
  sheetScreenLayout,
} from "@/features/files/codeScreen";
import { useColors } from "@/ui/theme";

// Fork (Hari, L-236): the desktop's Tasks, as a native modal with its own
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
          headerLeft: () => (
            <HeaderButton icon="close" label="Close" onPress={() => router.back()} />
          ),
        }}
      />
    </Stack>
  );
}

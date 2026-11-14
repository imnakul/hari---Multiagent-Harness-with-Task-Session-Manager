import { Stack } from "expo-router";

import {
  modalStackOptions,
  sheetScreenLayout,
} from "@/features/files/codeScreen";
import { computerHubOptions, hubTabOf } from "@/features/pc/ComputerHub";
import { androidBackHeader } from "@/ui/AndroidHeader";
import { useColors } from "@/ui/theme";

// Fork (Hari, L-279, L-280, L-290): the Computer hub (Share and Control), as
// a native modal with its own stack. Its header is set here, once: Close and
// the Share | Control toggle.
export default function ComputerHubLayout() {
  const colors = useColors();
  return (
    <Stack
      screenOptions={modalStackOptions(colors)}
      screenLayout={sheetScreenLayout(colors.sheet)}
    >
      <Stack.Screen
        name="index"
        options={({ route }) => computerHubOptions(hubTabOf(route.params))}
      />
      <Stack.Screen name="files" options={{ title: "Computer files", ...androidBackHeader("Computer files") }} />
    </Stack>
  );
}

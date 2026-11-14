import { Stack } from "expo-router";

import {
  modalStackOptions,
  sheetScreenLayout,
} from "@/features/files/codeScreen";
import { computerHubOptions } from "@/features/pc/ComputerHub";
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
      <Stack.Screen name="index" options={computerHubOptions("share")} />
    </Stack>
  );
}

import { router, Stack, useNavigation, type NativeStackNavigationOptions } from "expo-router";
import { Platform } from "react-native";

import { HeaderButton, modalStackOptions, sheetScreenLayout } from "@/features/files/codeScreen";
import { ModalSheet } from "@/ui/ModalSheet";
import { useColors } from "@/ui/theme";

// In Android's sheet the header starts at the sheet's top edge, under its
// handle, as the Mono profile sheet's does.
const SHEET_HEADER: NativeStackNavigationOptions =
  Platform.OS === "android"
    ? {
        unstable_nativeProps: { headerConfig: { disableTopInsetApplication: true } },
        headerTitleAlign: "center",
        headerBackVisible: false,
      }
    : {};

// Fork (Hari, L-327): one task's full editor, in the sheet that slides up over
// Tasks (ModalSheet, as the Mono profile opens).
export default function TaskEditLayout() {
  const colors = useColors();
  const navigation = useNavigation();
  return (
    <ModalSheet onClose={() => navigation.goBack()}>
      <Stack
        screenOptions={{ ...modalStackOptions(colors), ...SHEET_HEADER }}
        screenLayout={sheetScreenLayout(colors.sheet)}
      >
        <Stack.Screen
          name="[taskId]"
          options={{
            title: "Edit task",
            headerLeft: () => (
              <HeaderButton icon="close" label="Close" round onPress={() => router.back()} />
            ),
          }}
        />
      </Stack>
    </ModalSheet>
  );
}

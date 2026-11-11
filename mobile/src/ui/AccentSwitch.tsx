import { Platform, Switch, type SwitchProps } from "react-native";

import { useColors } from "./theme";

/**
 * Fork (Hari, L-245): a switch wholly in the app's accent. Android tints the
 * thumb with the system theme's colour (a green) unless told otherwise, so
 * an "on" switch was two colours; here the thumb takes the accent's ink.
 */
export function AccentSwitch(props: SwitchProps) {
  const colors = useColors();
  return (
    <Switch
      trackColor={{ true: colors.accent }}
      // Off, Android's own grey thumb; on, ink that reads on the accent.
      thumbColor={Platform.OS === "android" && props.value ? colors.onAccent : undefined}
      {...props}
    />
  );
}

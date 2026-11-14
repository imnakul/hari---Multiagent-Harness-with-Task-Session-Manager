import { Text, View } from "react-native";

import { Icon } from "@/ui/Icon";
import { radii, themedStyles, useColors } from "@/ui/theme";

/**
 * Fork (Hari, L-281): says a Tasks or Notes list is the phone's saved copy,
 * and that changes made now wait for the computer.
 */
export function ToolsOffline({ waiting }: { waiting: number }) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <View style={styles.line} accessibilityRole="summary" accessibilityLiveRegion="polite">
      <Icon name="computerOff" size={18} color={colors.muted} />
      <Text style={styles.text}>
        {waiting
          ? `Computer not connected. ${waiting} ${waiting === 1 ? "change waits" : "changes wait"} on this phone and go across when it’s back.`
          : "Computer not connected. Showing what this phone saved; changes go across when it’s back."}
      </Text>
    </View>
  );
}

const useStyles = themedStyles((colors) => ({
  line: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: radii.card,
    borderCurve: "continuous",
    backgroundColor: colors.surface,
  },
  text: { flex: 1, color: colors.muted, fontSize: 13, lineHeight: 18 },
}));

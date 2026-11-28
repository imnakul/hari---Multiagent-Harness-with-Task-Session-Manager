import { useEffect, useEffectEvent, useRef, type ReactNode } from "react";
import { Modal, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { themedStyles } from "@/ui/theme";

/** How long the sheet takes to fade out, before a chosen action runs. */
const CLOSE_MS = 260;

/**
 * Fork (Hari, L-412): a bottom sheet in the look of `ChoiceSheet`, for the
 * Tabs layout's pickers. `onClosed` runs once it has gone, so a push that
 * follows doesn't meet the closing modal (slow on Android, see L-235).
 */
export function TabSheet({
  open,
  title,
  onClose,
  onClosed,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  onClosed?: () => void;
  children: ReactNode;
}) {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const wasOpen = useRef(open);
  const closed = useEffectEvent(() => onClosed?.());
  useEffect(() => {
    if (open || !wasOpen.current) {
      wasOpen.current = open;
      return;
    }
    wasOpen.current = false;
    const timer = setTimeout(closed, CLOSE_MS);
    return () => clearTimeout(timer);
  }, [open]);
  return (
    <Modal visible={open} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} style={styles.backdrop} />
        <View accessibilityViewIsModal style={[styles.sheet, { paddingBottom: insets.bottom + 12 }]}>
          <View style={styles.handle} />
          <Text accessibilityRole="header" numberOfLines={1} style={styles.title}>
            {title}
          </Text>
          {children}
        </View>
      </View>
    </Modal>
  );
}

const useStyles = themedStyles((colors) => ({
  overlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.4)" },
  backdrop: { flex: 1 },
  sheet: {
    maxHeight: "85%",
    backgroundColor: colors.sheet,
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    overflow: "hidden",
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.faint,
    alignSelf: "center",
    marginTop: 8,
  },
  title: {
    color: colors.content,
    fontSize: 20,
    fontWeight: "600",
    textAlign: "center",
    paddingVertical: 16,
    paddingHorizontal: 20,
  },
}));

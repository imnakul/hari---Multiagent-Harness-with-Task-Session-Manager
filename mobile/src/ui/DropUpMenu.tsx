import { useRef, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import { MenuRow, type MenuAction } from "./ChoiceMenu";
import { themedStyles, useColors } from "./theme";

// As the composer's own rise with the keyboard (Composer's MORPH).
const OPEN = { duration: 220, easing: Easing.out(Easing.cubic) };
const CLOSE = { duration: 160, easing: Easing.in(Easing.cubic) };
// Far enough past the screen's edges to catch a tap anywhere outside the menu.
const REACH = 4000;

/**
 * Fork (Hari, L-299): a menu that grows up out of its button, in place, with
 * no sheet or window over the app, so the keyboard stays where it is and the
 * composer doesn't jump. A tap outside closes it; a chosen action runs once
 * it has closed.
 */
export function DropUpMenu({
  label,
  actions,
  children,
  style,
  width = 220,
}: {
  label: string;
  actions: MenuAction[];
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  width?: number;
}) {
  const styles = useStyles();
  const colors = useColors();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const progress = useSharedValue(0);
  const chosen = useRef<(() => void) | null>(null);

  const gone = () => {
    setMounted(false);
    const action = chosen.current;
    chosen.current = null;
    action?.();
  };
  const show = () => {
    setMounted(true);
    setOpen(true);
    progress.set(withTiming(1, OPEN));
  };
  const hide = () => {
    setOpen(false);
    progress.set(
      withTiming(0, CLOSE, (finished) => {
        if (finished) scheduleOnRN(gone);
      }),
    );
  };

  const menuStyle = useAnimatedStyle(() => {
    const p = progress.get();
    return {
      opacity: p,
      transform: [{ translateY: (1 - p) * 10 }, { scale: 0.86 + 0.14 * p }],
    };
  });

  return (
    <View style={style}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ expanded: open }}
        onPress={() => (open ? hide() : show())}
      >
        {children}
      </Pressable>
      {mounted ? (
        <>
          <Pressable
            accessibilityLabel="Close menu"
            onPress={hide}
            style={styles.backdrop}
          />
          <Animated.View
            accessibilityViewIsModal
            style={[styles.menu, { width, borderColor: colors.stroke }, menuStyle]}
          >
            {actions.map((action, row) => (
              <View key={action.label}>
                {row > 0 ? <View style={styles.divider} /> : null}
                <MenuRow
                  action={action}
                  onPress={() => {
                    chosen.current = action.onPress;
                    hide();
                  }}
                />
              </View>
            ))}
          </Animated.View>
        </>
      ) : null}
    </View>
  );
}

const useStyles = themedStyles((colors) => ({
  backdrop: {
    position: "absolute",
    top: -REACH,
    left: -REACH,
    right: -REACH,
    bottom: -REACH,
  },
  menu: {
    position: "absolute",
    left: 0,
    bottom: "100%",
    marginBottom: 10,
    transformOrigin: "bottom left",
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    backgroundColor: colors.sheet,
    overflow: "hidden",
    elevation: 12,
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 52,
    backgroundColor: colors.stroke,
  },
}));

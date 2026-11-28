import { useEffect, useEffectEvent, useRef, type ReactNode } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

/** How far a page travels as it comes in, in pt; matches the tabs' move. */
const SHIFT = 56;
const SLIDE = { duration: 220, easing: Easing.out(Easing.cubic) };

/**
 * Fork (Hari, L-412): a page inside a tab (a project's sessions, or All)
 * that slides in from the side it lies on the arc when it becomes the shown
 * one; `from` is 1 for the right, -1 for the left. The page left behind goes
 * at once, so only one moves. Shown at mount, it moves only with `appear`
 * (a page opened for the first time, not the tab's first page).
 */
export function PageSlide({
  shown,
  from,
  appear = false,
  style,
  children,
}: {
  shown: boolean;
  from: 1 | -1;
  appear?: boolean;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const reduceMotion = useReducedMotion();
  const x = useSharedValue(0);
  const opacity = useSharedValue(shown ? 1 : 0);
  const mounted = useRef(false);
  // Runs when `shown` changes, reading `from` and `appear` as they are then.
  const showOrHide = useEffectEvent(() => {
    const first = !mounted.current;
    mounted.current = true;
    if (first && !(shown && appear)) return;
    if (!shown) {
      opacity.set(0);
      return;
    }
    if (reduceMotion) {
      x.set(0);
      opacity.set(1);
      return;
    }
    x.set(from * SHIFT);
    opacity.set(0);
    x.set(withTiming(0, SLIDE));
    opacity.set(withTiming(1, SLIDE));
  });
  useEffect(() => showOrHide(), [shown]);
  const animated = useAnimatedStyle(() => ({ opacity: opacity.get(), transform: [{ translateX: x.get() }] }));
  return (
    <Animated.View
      style={[style, animated]}
      pointerEvents={shown ? "auto" : "none"}
      accessibilityElementsHidden={!shown}
      importantForAccessibility={shown ? "auto" : "no-hide-descendants"}
    >
      {children}
    </Animated.View>
  );
}

import { useCallback, type Ref } from "react";
import {
  Platform,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollView,
  type ScrollViewProps,
} from "react-native";
import {
  KeyboardChatScrollView,
  useKeyboardHandler,
  type KeyboardChatScrollViewProps,
} from "react-native-keyboard-controller";
import Animated, {
  Easing,
  scrollTo,
  useAnimatedReaction,
  useAnimatedRef,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

/** Android only: the list scrolls with the keyboard on its own timing. */
const OWN_TIMING = Platform.OS === "android";
/** The same glide as the composer's lift (`useKeyboardLift`), so they move as one. */
const LIFT = { duration: 250, easing: Easing.out(Easing.cubic) };
/** How near the end still counts as at the end. */
const AT_END_SLACK = 24;

type Props = ScrollViewProps & KeyboardChatScrollViewProps & { ref?: Ref<ScrollView> };

/**
 * Fork (Hari, L-414): KeyboardChatScrollView, but on Android the messages
 * rise and fall with the keyboard in 250 ms, as the composer does.
 *
 * Android's keyboard slide (measured on a Xiaomi IME) runs about a second
 * though it reports 285 ms, and the library scrolls the list on every one of
 * its frames, so the messages crawled up behind a composer that was already
 * there. Here the library keeps the padding (set at the keyboard's start)
 * but is told not to scroll ("never"); this view scrolls by the keyboard's
 * height itself, honouring `keyboardLiftBehavior`, and back by the same
 * amount when the keyboard closes. iOS is unchanged.
 */
export function QuickChatScrollView({
  ref,
  keyboardLiftBehavior = "always",
  offset = 0,
  freeze = false,
  onLayout,
  onContentSizeChange,
  onScroll,
  ...props
}: Props) {
  const scrollRef = useAnimatedRef<Animated.ScrollView>();
  const scrollY = useSharedValue(0);
  const viewHeight = useSharedValue(0);
  const contentHeight = useSharedValue(0);
  // The scroll under way: from `from`, by `by`, `progress` of the way.
  const from = useSharedValue(0);
  const by = useSharedValue(0);
  const progress = useSharedValue(1);
  // How far the open keyboard scrolled the list, to scroll back on close.
  const shifted = useSharedValue(0);

  const setRef = useCallback(
    (node: Animated.ScrollView | null) => {
      scrollRef(node);
      // The library's ScrollView is a ScrollView; Reanimated's type only wraps it.
      const plain = node as unknown as ScrollView | null;
      if (typeof ref === "function") ref(plain);
      else if (ref) ref.current = plain;
    },
    [ref, scrollRef],
  );

  useKeyboardHandler(
    {
      onStart: (e) => {
        "worklet";
        if (!OWN_TIMING || keyboardLiftBehavior === "never") return;
        if (typeof freeze === "boolean" ? freeze : freeze.get()) return;
        let shift: number;
        if (e.height > 0) {
          const lift = Math.max(0, e.height - offset);
          const atEnd = scrollY.get() + viewHeight.get() >= contentHeight.get() - AT_END_SLACK;
          // A list read further up stays put (and a keyboard already up that
          // only changes height moves it by the change).
          if (keyboardLiftBehavior === "whenAtEnd" && !atEnd && shifted.get() === 0) return;
          shift = lift - shifted.get();
          shifted.set(lift);
        } else {
          if (keyboardLiftBehavior === "persistent") return;
          shift = -Math.min(shifted.get(), scrollY.get());
          shifted.set(0);
        }
        if (shift === 0) return;
        from.set(scrollY.get());
        by.set(shift);
        progress.set(0);
        progress.set(withTiming(1, LIFT));
      },
    },
    [keyboardLiftBehavior, offset, freeze],
  );

  useAnimatedReaction(
    () => progress.get(),
    (now, before) => {
      if (before === null || now === before) return;
      scrollTo(scrollRef, 0, Math.max(0, from.get() + by.get() * now), false);
    },
  );

  const handleScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      scrollY.set(event.nativeEvent.contentOffset.y);
      onScroll?.(event);
    },
    [scrollY, onScroll],
  );
  const handleLayout = useCallback(
    (event: LayoutChangeEvent) => {
      viewHeight.set(event.nativeEvent.layout.height);
      onLayout?.(event);
    },
    [viewHeight, onLayout],
  );
  const handleContentSizeChange = useCallback(
    (width: number, height: number) => {
      contentHeight.set(height);
      onContentSizeChange?.(width, height);
    },
    [contentHeight, onContentSizeChange],
  );

  return (
    <KeyboardChatScrollView
      {...props}
      ref={setRef}
      keyboardLiftBehavior={OWN_TIMING ? "never" : keyboardLiftBehavior}
      offset={offset}
      freeze={freeze}
      onScroll={handleScroll}
      onLayout={handleLayout}
      onContentSizeChange={handleContentSizeChange}
    />
  );
}

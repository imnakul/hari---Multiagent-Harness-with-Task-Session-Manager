import { useMemo, useRef, useState, type ReactNode } from "react";
import { ScrollView, View, type ScrollViewProps } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { makeMutable } from "react-native-reanimated";

/**
 * Fork (Hari, L-339): where the last touch on a sideways-scrolling block
 * (a table, a code block) landed, on screen. ScenePager compares it with its
 * own touch: a swipe that starts on one scrolls it, and the side menu opens
 * only from the screen's edge.
 */
export const sideScrollTouchX = makeMutable(-1);
export const sideScrollTouchY = makeMutable(-1);

/** A sideways ScrollView that keeps a swipe on it for itself while it has more to show. */
export function SideScroll({ children, onLayout, onContentSizeChange, ...props }: ScrollViewProps) {
  const view = useRef(0);
  const content = useRef(0);
  const [scrolls, setScrolls] = useState(false);
  const check = () => setScrolls(content.current > view.current + 1);
  // Never takes the touch itself; it only notes where it landed.
  const mark = useMemo(
    () =>
      Gesture.Manual()
        .enabled(scrolls)
        .onTouchesDown((event) => {
          const touch = event.allTouches[0];
          if (!touch) return;
          sideScrollTouchX.set(touch.absoluteX);
          sideScrollTouchY.set(touch.absoluteY);
        }),
    [scrolls],
  );
  return (
    <GestureDetector gesture={mark}>
      <ScrollView
        {...props}
        horizontal
        onLayout={(event) => {
          view.current = event.nativeEvent.layout.width;
          check();
          onLayout?.(event);
        }}
        onContentSizeChange={(width, height) => {
          content.current = width;
          check();
          onContentSizeChange?.(width, height);
        }}
      >
        {children}
      </ScrollView>
    </GestureDetector>
  );
}

/** Marks where a touch on a sideways-swiping child landed, as SideScroll does. */
const sideMark = Gesture.Manual().onTouchesDown((event) => {
  const touch = event.allTouches[0];
  if (!touch) return;
  sideScrollTouchX.set(touch.absoluteX);
  sideScrollTouchY.set(touch.absoluteY);
});

/**
 * Fork (Hari, L-348): around something with a sideways swipe of its own (a
 * row's swipe to remove), so the side menu and Back take a swipe on it only
 * from the screen's edge.
 */
export function SideSwipeArea({ children }: { children: ReactNode }) {
  return (
    <GestureDetector gesture={sideMark}>
      <View collapsable={false}>{children}</View>
    </GestureDetector>
  );
}

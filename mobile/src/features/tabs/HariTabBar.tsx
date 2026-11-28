import { BottomTabBarHeightCallbackContext, type BottomTabBarProps } from "expo-router/js-tabs";
import { use, useEffect, useState } from "react";
import { Pressable, Text, View, useWindowDimensions, type LayoutChangeEvent } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  Easing,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";

import { MONOS_ENABLED } from "@/features/connection/selection";
import { useTabBarStyle } from "@/features/settings/appLayout";
import * as Haptics from "@/ui/haptics";
import { Icon, type IconName } from "@/ui/Icon";
import { GradualBlur } from "@/ui/GradualBlur";
import { LiquidView } from "@/ui/LiquidView";
import { themedStyles, useColors } from "@/ui/theme";
import { ARC_HEIGHT, PlaceArc } from "./PlaceArc";
import { useSessionsArc } from "./sessionsArc";
import { SLIDE_CANCEL_DY, cancelsSlide, indexAt, scrubPosition, wrapIndex } from "./tabMath";
import { beginTabSwitch } from "./TabScreen";
import { tabOfRoute, type TabName } from "./tabsMemory";

/** Each tab's label and icon, from `ui/Icon.tsx`'s set. */
export const TAB_META: Record<TabName, { label: string; icon: IconName }> = {
  sessions: { label: "Sessions", icon: "chat" },
  share: { label: "Share", icon: "share" },
  monos: { label: "Monos", icon: "sparkle" },
  computer: { label: "Computer", icon: "computer" },
  running: { label: "Running", icon: "automation" },
};

// A glide with no overshoot: the highlight stops at the tab, never past it.
const HIGHLIGHT_GLIDE = { duration: 240, easing: Easing.out(Easing.cubic) };
/** The quicker hop from tab to tab under a sliding thumb. */
const HIGHLIGHT_HOP = { duration: 140, easing: Easing.out(Easing.cubic) };
const BAR_PADDING = 6;
const FLOATING_SIDE = 12;
const FLOATING_BOTTOM = 8;
const RADIUS = 28;
/** How long the Sessions tab is held before its arc rises. */
const ARC_HOLD_MS = 250;
const ARC_RISE = { duration: 200, easing: Easing.out(Easing.cubic) };
const ARC_FALL = { duration: 150, easing: Easing.in(Easing.cubic) };
/** Room under the arc, so it rides clear of the bar and the thumb (L-415: more). */
const ARC_LIFT = 34;
/** Room above the bar for the arc and the fade behind it. */
const ARC_LAYER = ARC_HEIGHT + 32 + ARC_LIFT;

/** Whether the tab is on the bar: Monos is left out while Monos are off. */
const listed = (name: string) => name !== "monos" || MONOS_ENABLED;

/**
 * Fork (Hari, L-412): the Tabs layout's bar. A glass pill (or a bar across
 * the bottom) with a highlight that glides to the open tab, and a thumb
 * slide: press anywhere on it and slide to change tabs, a light tick on each.
 * Holding Sessions raises its arc of places over the bar; the same finger
 * slides along to pick one and lets go to open it (or drags down off the
 * bar to leave things as they were).
 */
export function HariTabBar({ state, navigation }: BottomTabBarProps) {
  const styles = useStyles();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [barStyle] = useTabBarStyle();
  const reduceMotion = useReducedMotion();
  // Tells the tabs the bar's real height, for content that sits on it.
  const onHeight = use(BottomTabBarHeightCallbackContext);

  const routes = state.routes.filter((route) => listed(route.name));
  const count = routes.length;
  const activeRoute = state.routes[state.index];
  const active = Math.max(0, routes.findIndex((route) => route.key === activeRoute?.key));

  const [rowWidth, setRowWidth] = useState(0);
  const tabWidth = count > 0 ? rowWidth / count : 0;
  const position = useSharedValue(0);
  const dragging = useSharedValue(false);
  const lastIndex = useSharedValue(active);

  const { width: screenWidth } = useWindowDimensions();
  const arc = useSessionsArc();
  const arcCount = arc.items.length;
  const arcStart = arc.selectedIndex;
  const [arcShown, setArcShown] = useState(false);
  const [arcIndex, setArcIndex] = useState(arcStart);
  const arcPosition = useSharedValue(arcStart);
  const arcNearest = useSharedValue(arcStart);
  const arcReveal = useSharedValue(0);

  // Glides the highlight to the open tab; jumps under reduce motion.
  useEffect(() => {
    if (dragging.get()) return;
    const target = active * tabWidth;
    position.set(withTiming(target, reduceMotion ? { duration: 0 } : HIGHLIGHT_GLIDE));
    lastIndex.set(active);
  }, [active, tabWidth, reduceMotion, position, dragging, lastIndex]);

  const open = (index: number) => {
    const route = routes[index];
    if (!route) return;
    const focused = route.key === activeRoute?.key;
    const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
    if (focused) return;
    // The highlight moves now, not once the page has switched.
    glideTo(event.defaultPrevented ? active : index);
    if (!event.defaultPrevented) switchTo(route);
  };
  // The pages swap on the UI thread at once; React renders the new tab a
  // frame later, so the highlight and the slide are under way before it does.
  const switchTo = (route: (typeof routes)[number]) => {
    beginTabSwitch(tabOfRoute(route.name));
    requestAnimationFrame(() => navigation.navigate(route.name, route.params));
  };
  const glideTo = (index: number) => {
    lastIndex.set(index);
    position.set(withTiming(index * tabWidth, reduceMotion ? { duration: 0 } : HIGHLIGHT_GLIDE));
  };
  const tick = () => void Haptics.selectionAsync();
  const beginArc = () => {
    setArcIndex(arcStart);
    setArcShown(true);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  };
  const arcTick = (index: number) => {
    setArcIndex(index);
    void Haptics.selectionAsync();
  };
  const pickArc = (index: number) => {
    const item = arc.items[index];
    if (!item) return;
    arc.select(item.id);
    const sessions = routes.find((route) => route.name === "sessions");
    if (sessions && sessions.key !== activeRoute?.key) {
      glideTo(routes.indexOf(sessions));
      switchTo(sessions);
    }
  };
  const unmountArc = () => setArcShown(false);

  // Hold Sessions: the arc rises; slide to pick, let go to open it.
  const arcHold = Gesture.Pan()
    .activateAfterLongPress(ARC_HOLD_MS)
    .onStart(() => {
      "worklet";
      arcPosition.set(arcStart);
      arcNearest.set(arcStart);
      arcReveal.set(withTiming(1, reduceMotion ? { duration: 0 } : ARC_RISE));
      scheduleOnRN(beginArc);
    })
    .onUpdate((event) => {
      "worklet";
      arcPosition.set(scrubPosition(arcStart, event.translationX, arcCount));
      const index = wrapIndex(arcPosition.get(), arcCount);
      if (index !== arcNearest.get()) {
        arcNearest.set(index);
        scheduleOnRN(arcTick, index);
      }
    })
    .onEnd((event) => {
      "worklet";
      // Dragged down off the bar: nothing changes.
      if (event.translationY > SLIDE_CANCEL_DY) return;
      scheduleOnRN(pickArc, wrapIndex(arcPosition.get(), arcCount));
    })
    .onFinalize(() => {
      "worklet";
      arcReveal.set(
        withTiming(0, reduceMotion ? { duration: 0 } : ARC_FALL, (finished) => {
          if (finished) scheduleOnRN(unmountArc);
        }),
      );
    });
  const arcStyle = useAnimatedStyle(() => ({
    opacity: arcReveal.get(),
    transform: [{ translateY: (1 - arcReveal.get()) * 24 }],
  }));

  const slide = Gesture.Pan()
    .activeOffsetX([-8, 8])
    .failOffsetY([-24, 24])
    .onStart(() => {
      "worklet";
      dragging.set(true);
    })
    .onUpdate((event) => {
      "worklet";
      // The highlight always sits on one tab: it hops to the one under the
      // thumb as the thumb crosses into it, never stopping in between.
      const index = indexAt(event.x, rowWidth, count);
      if (index !== lastIndex.get()) {
        lastIndex.set(index);
        position.set(withTiming(index * tabWidth, reduceMotion ? { duration: 0 } : HIGHLIGHT_HOP));
        scheduleOnRN(tick);
      }
    })
    .onEnd((event) => {
      "worklet";
      // Settles at once, before the page changes; dragged off the bar, back to the open tab.
      const index = cancelsSlide(event.translationY) ? active : indexAt(event.x, rowWidth, count);
      lastIndex.set(index);
      position.set(withTiming(index * tabWidth, reduceMotion ? { duration: 0 } : HIGHLIGHT_GLIDE));
      if (index !== active) scheduleOnRN(open, index);
    })
    .onFinalize((_event, success) => {
      "worklet";
      dragging.set(false);
      // Interrupted (say, by the system): back to the open tab.
      if (!success) {
        lastIndex.set(active);
        position.set(withTiming(active * tabWidth, reduceMotion ? { duration: 0 } : HIGHLIGHT_GLIDE));
      }
    });

  const highlightStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: position.get() }],
  }));

  const floating = barStyle === "floating";
  return (
    <View
      style={[
        styles.wrap,
        floating
          ? { paddingHorizontal: FLOATING_SIDE, paddingBottom: Math.max(insets.bottom, 0) + FLOATING_BOTTOM }
          : { paddingBottom: insets.bottom },
      ]}
      pointerEvents="box-none"
      onLayout={(event: LayoutChangeEvent) => onHeight?.(event.nativeEvent.layout.height)}
    >
      {arcShown ? (
        <Animated.View pointerEvents="none" style={[styles.arcLayer, arcStyle]}>
          {/* Fades the page out under the arc, so the arc reads over it. */}
          <GradualBlur edge="bottom" height={ARC_LAYER} color={colors.background} />
          <PlaceArc items={arc.items} position={arcPosition} shownIndex={arcIndex} width={screenWidth} />
        </Animated.View>
      ) : null}
      <LiquidView
        borderRadius={floating ? RADIUS : 0}
        row={false}
        style={styles.glass}
        innerStyle={styles.glassInner}
      >
        <GestureDetector gesture={slide}>
          <View
            accessibilityRole="tablist"
            style={styles.row}
            onLayout={(event: LayoutChangeEvent) => setRowWidth(event.nativeEvent.layout.width)}
          >
            {tabWidth > 0 ? (
              <Animated.View
                pointerEvents="none"
                style={[styles.highlight, { width: tabWidth }, highlightStyle]}
              />
            ) : null}
            {routes.map((route, index) => {
              const name = tabOfRoute(route.name);
              const meta = TAB_META[name];
              const selected = index === active;
              const color = selected ? colors.accent : colors.muted;
              const tab = (
                <Pressable
                  key={route.key}
                  accessibilityRole="tab"
                  accessibilityLabel={meta.label}
                  accessibilityHint={name === "sessions" ? "Hold and slide to pick a project" : undefined}
                  accessibilityState={{ selected }}
                  onPress={() => open(index)}
                  // A hold on Sessions is its arc's, so letting go doesn't also tap it.
                  onLongPress={name === "sessions" ? () => {} : undefined}
                  delayLongPress={ARC_HOLD_MS}
                  style={({ pressed }) => [styles.tab, pressed && styles.tabPressed]}
                >
                  <Icon name={meta.icon} size={22} color={color} />
                  <Text style={[styles.label, { color }]} numberOfLines={1}>
                    {meta.label}
                  </Text>
                </Pressable>
              );
              return name === "sessions" ? (
                <GestureDetector key={route.key} gesture={arcHold}>
                  {tab}
                </GestureDetector>
              ) : (
                tab
              );
            })}
          </View>
        </GestureDetector>
      </LiquidView>
    </View>
  );
}

const useStyles = themedStyles((colors) => ({
  wrap: { backgroundColor: "transparent" },
  glass: { alignSelf: "stretch" },
  glassInner: { paddingHorizontal: BAR_PADDING, paddingVertical: BAR_PADDING, alignSelf: "stretch" },
  row: { flexDirection: "row", alignSelf: "stretch" },
  // Just above the bar, across the screen.
  arcLayer: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: "100%",
    height: ARC_LAYER,
    justifyContent: "flex-end",
    paddingBottom: ARC_LIFT,
  },
  highlight: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    backgroundColor: colors.thumb,
    borderRadius: RADIUS - BAR_PADDING,
  },
  tab: {
    flex: 1,
    minHeight: 56,
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
  },
  tabPressed: { transform: [{ scale: 0.94 }] },
  label: { fontSize: 11, fontWeight: "500" },
}));

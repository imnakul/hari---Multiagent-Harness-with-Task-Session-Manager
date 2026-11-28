import { useFocusEffect, useNavigation } from "expo-router";
import { useCallback, useEffect, type ReactNode } from "react";
import { Text, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useConnection } from "@/features/connection/ConnectionProvider";
import { CircleButton } from "@/ui/CircleButton";
import { useDrawerActions, useDrawerSwipe } from "@/ui/ScenePager";
import { themedStyles } from "@/ui/theme";
import { rememberTab, tabOfRoute, type TabName } from "./tabsMemory";
import { entranceSide, TAB_ENTRANCE_MS, TAB_SHIFT } from "./tabTransition";

/** A plain glide: eases in and out, with no overshoot and no snap at the end. */
const TAB_ENTRANCE = { duration: TAB_ENTRANCE_MS, easing: Easing.bezier(0.25, 0.1, 0.25, 1) };

/** The tab shown last, so the next one knows which side to come in from. */
let shownTab: TabName | undefined;

/** Each mounted tab's entrance, so the bar can start a switch at the tap. */
const entrances = new Map<TabName, { progress: SharedValue<number>; side: SharedValue<number> }>();
/** The tab the bar has already started sliding in, so its focus doesn't restart it. */
let enteringTab: TabName | undefined;

function slideIn(tab: TabName, from: 1 | -1 | 0) {
  const entrance = entrances.get(tab);
  if (!entrance) return;
  entrance.side.set(from);
  entrance.progress.set(from ? withTiming(1, TAB_ENTRANCE) : 1);
}

/**
 * Starts a tab switch at the tap, before React renders it: the tab left
 * clears and the one opened (if it has loaded) slides in, both on the UI
 * thread. Rendering a tab can take a while, and until it's done the two
 * would otherwise show over each other, and the switch would feel stuck.
 */
export function beginTabSwitch(to: TabName) {
  const from = shownTab;
  if (!from || from === to) return;
  entrances.get(from)?.progress.set(0);
  // One not loaded yet slides in once it has, from its focus.
  if (entrances.has(to)) {
    shownTab = to;
    enteringTab = to;
    slideIn(to, entranceSide(to, from));
  }
}

/**
 * Fork (Hari, L-412): the frame of one tab: the side menu button on the
 * right, and the tab remembered as the one left last. L-415: no tab name at
 * the top (the bar says which tab is open), so the page starts higher; a
 * `title` shows only what the bar can't, such as the project Sessions shows.
 */
export function TabScreen({
  tab,
  title,
  children,
}: {
  tab: TabName;
  title?: string;
  children: ReactNode;
}) {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const drawer = useDrawerActions();
  // L-417: a swipe left from the right edge opens the side menu, as on the
  // other pages, since the menu button at the top is out of thumb's reach.
  useDrawerSwipe();
  const fingerprint = useConnection().pairing?.desktop.fingerprint ?? "";
  // How far in the tab is: 1 in place, 0 hidden, waiting to come in. A tab
  // left is hidden at once, so coming back it never shows a frame where it
  // was and then jumps aside to slide in (that read as a bounce).
  const progress = useSharedValue(shownTab && shownTab !== tab ? 0 : 1);
  const side = useSharedValue(0);
  const navigation = useNavigation();
  useEffect(() => {
    entrances.set(tab, { progress, side });
    return () => {
      entrances.delete(tab);
    };
  }, [tab, progress, side]);
  useFocusEffect(
    useCallback(() => {
      if (enteringTab === tab) {
        enteringTab = undefined;
      } else {
        // Opened some other way (a link, a button on another tab, or first load).
        const from = entranceSide(tab, shownTab);
        shownTab = tab;
        side.set(from);
        progress.set(from ? withTiming(1, TAB_ENTRANCE) : 1);
      }
      rememberTab(fingerprint, tab);
      return () => {
        // Only for another tab: a page pushed over the tabs slides over this
        // one, which has to stay drawn under it.
        const tabs = navigation.getState();
        const open = tabs?.routes[tabs.index]?.name;
        if (open && tabOfRoute(open) !== tab) progress.set(0);
      };
    }, [fingerprint, tab, side, progress, navigation]),
  );
  const entrance = useAnimatedStyle(() => {
    const t = progress.get();
    return {
      opacity: t === 0 ? 0 : 0.5 + 0.5 * t,
      transform: [{ translateX: (1 - t) * side.get() * TAB_SHIFT }],
    };
  });
  return (
    <Animated.View style={[styles.container, entrance]}>
      <View style={[styles.header, { paddingTop: insets.top + 4 }]}>
        {title ? (
          <Text accessibilityRole="header" style={styles.title} numberOfLines={1}>
            {title}
          </Text>
        ) : (
          <View />
        )}
        <CircleButton icon="sidebar" label="Menu" onPress={drawer.open} size={40} />
      </View>
      {children}
    </Animated.View>
  );
}

const useStyles = themedStyles((colors) => ({
  container: { flex: 1, backgroundColor: colors.page },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 2,
  },
  title: { flexShrink: 1, color: colors.content, fontSize: 20, fontWeight: "700" },
}));

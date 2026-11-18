import { router, type NativeStackNavigationOptions } from "expo-router";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { Keyboard, StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  makeMutable,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import { HeaderButton } from "@/features/files/codeScreen";
import { PlaceCloseButton, SidebarButton, usePlaceSwipes } from "@/features/workspace/PlaceHeader";
import { ComputerControl } from "@/features/pc/ComputerControl";
import { sliderHeld } from "@/features/pc/ComputerParts";
import { SharePanel } from "@/features/share/SharePanel";
import { hubTabSet, setHubTab, subscribeHubTab, type ComputerTab } from "./hubTab";
import { useContentWidth } from "@/ui/ContentPane";
import * as Haptics from "@/ui/haptics";
import { Icon } from "@/ui/Icon";
import { EDGE_STRIP } from "@/ui/ScenePager";
import { SegmentedSwitch } from "@/ui/SegmentedSwitch";

export type { ComputerTab } from "./hubTab";

// The pages' motion, as ScenePager has it (the Expo Router drawer's).
const SPRING = {
  stiffness: 1000,
  damping: 500,
  mass: 3,
  overshootClamping: true,
  reduceMotion: ReduceMotion.Never,
};
const SWIPE_MIN_OFFSET = 5;
const SWIPE_MIN_DISTANCE = 60;
const SWIPE_MIN_VELOCITY = 500;

/**
 * Fork (Hari, L-307): where the hub's pages are, 0 (Share) to 1 (Control),
 * shared with the header's switch so its thumb follows a swipe.
 */
const hubProgress = makeMutable(0);

const SEGMENTS = [
  {
    value: "share" as const,
    label: "Share",
    icon: <Icon name="share" size={18} />,
  },
  {
    value: "control" as const,
    label: "Control",
    icon: <Icon name="computer" size={18} />,
  },
];

// The open tab's store (L-290) is in hubTab.ts, where the side menu's
// memory (L-347) reads it too.
const setTab = setHubTab;
const useTab = (initial: ComputerTab) =>
  useSyncExternalStore(subscribeHubTab, () => hubTabSet() ?? initial);

function ComputerSwitch({ initial }: { initial: ComputerTab }) {
  const tab = useTab(initial);
  return (
    <SegmentedSwitch<ComputerTab>
      value={tab}
      onChange={setTab}
      segments={SEGMENTS}
      progress={hubProgress}
    />
  );
}

/** Which tab the hub opens on: Control, unless the link asks for Share. */
export const hubTabOf = (params: object | undefined): ComputerTab =>
  (params as { tab?: unknown } | undefined)?.tab === "share"
    ? "share"
    : "control";

/** The hub's header, for the Computer and Share layouts: Close, and the toggle. */
export const computerHubOptions = (
  initial: ComputerTab,
): NativeStackNavigationOptions => ({
  title: "Computer",
  headerTitleAlign: "center",
  headerTitle: () => <ComputerSwitch initial={initial} />,
  // Fork (Hari, L-346): a place of its own, opened and left from the side menu.
  headerLeft: () => <PlaceCloseButton />,
  headerRight: () => <SidebarButton />,
});

/**
 * Fork (Hari, L-299): Computer files under the same header as Share and
 * Control: the glass Back button and a centred title.
 */
export const computerFilesOptions: NativeStackNavigationOptions = {
  title: "Computer files",
  headerTitleAlign: "center",
  headerBackVisible: false,
  headerLeft: () => (
    <HeaderButton icon="arrowLeft" label="Back" onPress={() => router.back()} />
  ),
  headerRight: () => <SidebarButton />,
};

const TABS: ComputerTab[] = ["share", "control"];
/** The other page mounts this long after the hub opens, so opening stays quick. */
const NEIGHBOUR_AFTER_MS = 350;

/**
 * Fork (Hari, L-288): everything to do with the paired computer in one
 * place: Share (the chat-style timeline) and Control (stats, power, apps,
 * Wake), switched by the header toggle a project's New | Sessions uses.
 * Control asks the computer for nothing while Share shows.
 * L-307: the two sit side by side and a sideways swipe moves between them,
 * the header's switch following the finger, with the pages' spring and
 * swipe distances (ScenePager's). A drag on a slider stays the slider's.
 */
export function ComputerHub({ initial }: { initial: ComputerTab }) {
  const tab = useTab(initial);
  const index = TABS.indexOf(tab);
  const width = useContentWidth();
  const target = useSharedValue(index);
  const touchX = useSharedValue(0);
  const touchY = useSharedValue(0);
  const touchLocalX = useSharedValue(0);
  const dragging = useSharedValue(false);
  const dragStart = useSharedValue(0);
  const [both, setBoth] = useState(false);
  usePlaceSwipes();

  useLayoutEffect(() => {
    hubProgress.set(index);
    target.set(index);
    // On open only: later changes spring below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => setBoth(true), NEIGHBOUR_AFTER_MS);
    // Closing forgets the tab, so the next visit opens where its link says.
    return () => {
      clearTimeout(timer);
      setTab(undefined);
    };
  }, []);
  // A tap on the header's switch (or Open Share) springs there; a swipe has
  // already moved there itself.
  useEffect(() => {
    if (tab !== "share") Keyboard.dismiss();
    if (target.get() === index) return;
    target.set(index);
    hubProgress.set(withSpring(index, SPRING));
  }, [tab, index, target]);

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .enabled(width > 0)
        // Takes only a sideways swipe towards the other page, so scrolling,
        // a slider and anything off the edge keep their own.
        .manualActivation(true)
        .onTouchesDown((event) => {
          const touch = event.allTouches[0];
          touchX.set(touch.absoluteX);
          touchY.set(touch.absoluteY);
          touchLocalX.set(touch.x);
        })
        .onTouchesMove((event, manager) => {
          if (dragging.get()) return;
          if (sliderHeld.get()) {
            manager.fail();
            return;
          }
          const touch = event.allTouches[0];
          const dx = touch.absoluteX - touchX.get();
          const dy = touch.absoluteY - touchY.get();
          if (Math.abs(dy) > SWIPE_MIN_OFFSET && Math.abs(dy) >= Math.abs(dx)) {
            manager.fail();
            return;
          }
          if (Math.abs(dx) <= SWIPE_MIN_OFFSET) return;
          // Fork (Hari, L-348): from the right edge it is the side menu's.
          if (dx < 0 && touchLocalX.get() >= width - EDGE_STRIP) {
            manager.fail();
            return;
          }
          const next = target.get() + (dx < 0 ? 1 : -1);
          if (next >= 0 && next < TABS.length) {
            dragging.set(true);
            manager.activate();
          } else manager.fail();
        })
        .onStart(() => {
          dragStart.set(hubProgress.get());
        })
        .onUpdate((event) => {
          const next = dragStart.get() - event.translationX / width;
          hubProgress.set(Math.min(TABS.length - 1, Math.max(0, next)));
        })
        .onEnd((event) => {
          const { translationX, velocityX } = event;
          const decisive =
            (Math.abs(translationX) > SWIPE_MIN_OFFSET && Math.abs(velocityX) > SWIPE_MIN_VELOCITY) ||
            Math.abs(translationX) > SWIPE_MIN_DISTANCE;
          const leftward = (velocityX === 0 ? translationX : velocityX) < 0;
          const from = target.get();
          const page = decisive ? Math.min(TABS.length - 1, Math.max(0, from + (leftward ? 1 : -1))) : from;
          if (page !== from) {
            target.set(page);
            scheduleOnRN(Haptics.selectionAsync);
            scheduleOnRN(showPage, page);
          }
          hubProgress.set(withSpring(page, { ...SPRING, velocity: -velocityX / width }));
        })
        .onFinalize(() => {
          dragging.set(false);
        }),
    [width, target, touchX, touchY, touchLocalX, dragging, dragStart],
  );

  const row = useAnimatedStyle(() => ({ transform: [{ translateX: -hubProgress.get() * width }] }));
  const page = (at: number, content: ReactNode) => {
    const shown = at === index;
    return (
      <View
        style={{ width }}
        importantForAccessibility={shown ? "auto" : "no-hide-descendants"}
        accessibilityElementsHidden={!shown}
      >
        {shown || both ? content : null}
      </View>
    );
  };
  return (
    <GestureDetector gesture={pan}>
      <View style={styles.frame}>
        <Animated.View style={[styles.row, { width: width * TABS.length }, row]}>
          {page(0, <SharePanel />)}
          {page(1, <ComputerControl active={tab === "control"} onOpenShare={() => setTab("share")} />)}
        </Animated.View>
      </View>
    </GestureDetector>
  );
}

const showPage = (page: number) => setTab(TABS[page]);

const styles = StyleSheet.create({
  frame: { flex: 1, overflow: "hidden" },
  row: { flex: 1, flexDirection: "row" },
});

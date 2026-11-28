import { useContext, useEffect } from "react";
import { Image, StyleSheet } from "react-native";
import { scheduleOnRN } from "react-native-worklets";
import Animated, {
  Easing,
  withDelay,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";

import { Backdrop, BackdropReading, useBackdrop } from "@/features/wallpaper/Backdrop";

import { HARI_LOGO } from "./brand";
import { traceSwitch } from "./ScenePager";
import { useColors } from "./theme";

// Fork (Hari, L-420): a screen's content loading, shown as the Hari feather
// and flute swaying from its stem as if in a breeze, breathing a little as it
// goes. It used to be a dithered ring. It shows while the drawer shuts, so
// nothing in it may load the JS thread: every move is a transform on the UI
// thread, and the logo is a bundled image, ready at once.

/** The logo's square, in points. */
const LOGO_SIZE = 76;
/** One sway, from side to side and back, and how far it leans each way. */
const SWAY_MS = 1600;
const SWAY_DEG = 7;
/** The breath, slower than the sway so the two never lock step. */
const BREATH_MS = 2200;
const BREATH_SCALE = 0.05;
/** The cover's arrival: its ground fades in as the drawer starts to shut, the
 *  logo a beat after. Its leaving, in turn: the logo fades and shrinks, then
 *  the ground fades off the next screen. */
const GROUND_IN = { duration: 150, easing: Easing.out(Easing.quad) };
const LOGO_IN = { delay: 70, duration: 180, easing: Easing.out(Easing.quad) };
const LOGO_OUT = { duration: 150, easing: Easing.in(Easing.quad) };
const GROUND_OUT = { delay: 80, duration: 200, easing: Easing.inOut(Easing.quad) };
/** How small the logo gets as it goes. */
const LOGO_GONE_SCALE = 0.7;
const SWING = Easing.inOut(Easing.sin);

/**
 * Fills its parent while a screen's content loads, the logo in its middle.
 * With `leaving` it plays its way out, the logo then the ground, and calls
 * `onGone` once it is clear, for the parent to let it go; asked to stay again
 * meanwhile, it comes back. With reduced motion the logo holds still.
 */
export function DitherLoading({
  leaving = false,
  onGone,
}: {
  leaving?: boolean;
  onGone?: () => void;
}) {
  const colors = useColors();
  // Fork (Hari, L-299): over the wallpaper, as the screen it covers draws it,
  // not a solid page; the solid page only without a wallpaper.
  const reading = useContext(BackdropReading) ?? false;
  const wallpaper = useBackdrop(reading) !== null;
  const reduced = useReducedMotion();
  const sway = useSharedValue(0);
  const breath = useSharedValue(0);
  const ground = useSharedValue(0);
  const logo = useSharedValue(0);
  useEffect(() => {
    if (reduced) return;
    sway.set(
      withRepeat(
        withSequence(
          withTiming(1, { duration: SWAY_MS / 4, easing: SWING }),
          withTiming(-1, { duration: SWAY_MS / 2, easing: SWING }),
          withTiming(0, { duration: SWAY_MS / 4, easing: SWING }),
        ),
        -1,
      ),
    );
    breath.set(withRepeat(withTiming(1, { duration: BREATH_MS / 2, easing: SWING }), -1, true));
  }, [sway, breath, reduced]);
  useEffect(() => {
    if (!leaving) {
      ground.set(withTiming(1, GROUND_IN));
      logo.set(withDelay(LOGO_IN.delay, withTiming(1, LOGO_IN)));
      return;
    }
    logo.set(withTiming(0, LOGO_OUT));
    ground.set(
      withDelay(
        GROUND_OUT.delay,
        withTiming(0, GROUND_OUT, (finished) => {
          if (finished && onGone) scheduleOnRN(onGone);
          if (finished) scheduleOnRN(traceSwitch, "cover gone");
        }),
      ),
    );
  }, [leaving, ground, logo, onGone]);
  const groundStyle = useAnimatedStyle(() => ({ opacity: ground.get() }));
  const logoStyle = useAnimatedStyle(() => {
    const shown = logo.get();
    const breathing = 1 + BREATH_SCALE * breath.get();
    return {
      opacity: shown,
      transform: [
        { scale: (LOGO_GONE_SCALE + (1 - LOGO_GONE_SCALE) * shown) * breathing },
        { rotate: `${SWAY_DEG * sway.get()}deg` },
      ],
    };
  });
  return (
    <Animated.View
      accessibilityLabel="Loading"
      pointerEvents="none"
      style={[styles.fill, wallpaper ? null : { backgroundColor: colors.background }, groundStyle]}
    >
      {wallpaper ? <Backdrop reading={reading} /> : null}
      <Animated.View style={[styles.logo, logoStyle]}>
        <Image source={HARI_LOGO} style={styles.logo} />
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  fill: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
  },
  logo: {
    width: LOGO_SIZE,
    height: LOGO_SIZE,
    // The stem, where the flute curls at the lower left: the feather sways
    // from there, as a plume does from its quill.
    transformOrigin: "22% 78%",
  },
});

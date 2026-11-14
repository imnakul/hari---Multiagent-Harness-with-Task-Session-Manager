import * as Haptics from "@/ui/haptics";
import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import { useKeyboardState } from "react-native-keyboard-controller";
import Animated, {
  cancelAnimation,
  Easing,
  FadeIn,
  FadeOut,
  FlipInEasyY,
  FlipOutEasyY,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";

import type { SessionSummary } from "@/features/workspace/types";
import { useWorkspace } from "@/features/workspace/WorkspaceProvider";
import {
  GlassPresence,
  LiquidView,
  useGlassEntrance,
  usePopStyle,
} from "@/ui/LiquidView";
import { GLASS_MIN_OPACITY } from "@/ui/SceneFade";
import { Ticker } from "@/ui/Ticker";
import { radii, themedStyles, useColors, withAlpha } from "@/ui/theme";

import { FinishedSessions } from "./FinishedSessions";
import { ProviderLogo } from "./ProviderLogo";
import { TerminalSpinner } from "./TerminalSpinner";
import { markStoppedHere, useSessionActivity } from "./activityStore";
import { useFinishedHandoff, WORKING_PRESENCE_MS } from "./useFinishedHandoff";

const ART = 40;
const PILL_PADDING_VERTICAL = 10;
const STACK_GAP = 10;
/** How long the pill takes to come and go. */
const PRESENCE_MS = WORKING_PRESENCE_MS;
/** Past a push or a page slide, by when the screen is out of sight. */
const OUT_OF_VIEW_MS = 600;
/** Back in view, by when the page has settled, so mounting doesn't land
 *  mid-spring. */
const IN_VIEW_MS = 350;
/** A session's own pill, in the list the now-playing pill opens into. */
const MINI = 52;
const MINI_GAP = 8;
/** Between one mini pill setting off and the next. */
const MINI_STAGGER = 45;
const MINI_SPRING = { damping: 17, stiffness: 210, mass: 0.8 };
/** The one-title line in the big pill has no others to say are in front. */
const noop = () => {};

/**
 * A project's sessions at work, resting on the composer: the finished ones
 * stacked above (see FinishedSessions), and those still working in a
 * now-playing pill, as in the Music app. Both step aside while the keyboard
 * is up. Out of view (a session pushed over the screen, or the Sessions page
 * swiped in) they're unmounted once the screen has slid away, so nothing
 * animates or is held behind it; they come back as it does.
 */
export function LiveSessions({
  projectId,
  onOpen,
  inView,
  swiping,
}: {
  projectId: string;
  onOpen: (session: SessionSummary) => void;
  inView: boolean;
  /** True while the screen's pages are moving; the ticker holds still then. */
  swiping?: SharedValue<boolean>;
}) {
  const [mounted, setMounted] = useState(inView);
  useEffect(() => {
    const timer = setTimeout(
      () => setMounted(inView),
      inView ? IN_VIEW_MS : OUT_OF_VIEW_MS,
    );
    return () => clearTimeout(timer);
  }, [inView]);
  if (!mounted) return null;
  return (
    <LiveSessionsShown
      projectId={projectId}
      onOpen={onOpen}
      swiping={swiping}
    />
  );
}

function LiveSessionsShown({
  projectId,
  onOpen,
  swiping,
}: {
  projectId: string;
  onOpen: (session: SessionSummary) => void;
  swiping?: SharedValue<boolean>;
}) {
  const { working, finished, arrivals } = useSessionActivity(projectId);
  // Titles as renamed here, ahead of the desktop.
  const { sessions } = useWorkspace();
  const live = useMemo(
    () =>
      working.map((session) => {
        const listed = sessions.find((other) => other.id === session.id);
        return listed && listed.title !== session.title
          ? { ...session, title: listed.title }
          : session;
      }),
    [working, sessions],
  );
  const keyboardUp = useKeyboardState((state) => state.isVisible);
  const shownFinished = useFinishedHandoff(live.length, finished, keyboardUp);
  return (
    <View pointerEvents="box-none">
      <FinishedSessions
        entries={shownFinished}
        hidden={keyboardUp}
        onOpen={onOpen}
      />
      <NowWorking
        swiping={swiping}
        live={live}
        arrivals={arrivals}
        hidden={keyboardUp}
        onOpen={onOpen}
      />
    </View>
  );
}

/**
 * The sessions at work, every one in sight: the first in a now-playing pill,
 * its agent for artwork and its title on a line that scrolls when too long,
 * and the rest each in a pill of its own stacked above it (see MiniPills).
 * A tap opens one, its square stops it. One that starts working on the
 * desktop rises in with a buzz.
 */
function NowWorking({
  swiping,
  live,
  arrivals,
  hidden,
  onOpen,
}: {
  live: SessionSummary[];
  arrivals: Record<string, number>;
  hidden: boolean;
  onOpen: (session: SessionSummary) => void;
  swiping?: SharedValue<boolean>;
}) {
  const styles = useStyles();
  const { stop, rememberSession } = useWorkspace();
  // Keep the entire presentation, including titles, count and arrival subtitle,
  // until the outgoing pill has cleared. An empty ticker flashes mid-exit.
  const [shown, setShown] = useState({ live, arrivals });
  if (live.length > 0 && (shown.live !== live || shown.arrivals !== arrivals))
    setShown({ live, arrivals });
  const displayed = live.length > 0 ? live : shown.live;
  const shownArrivals = live.length > 0 ? arrivals : shown.arrivals;
  const current = live[0] as SessionSummary | undefined;
  // Fork (Hari, L-249): every session at work shows at once, the first in
  // the big pill and the rest each in a pill of its own above it.
  const others = useMemo(() => displayed.slice(1), [displayed]);
  const stacked = live.length > 1 && !hidden;

  // A session that starts working once the pill is up rises in with a buzz,
  // and a pulse if it's the one in front. The ones there at first aren't news.
  const known = useRef<Set<string> | null>(null);
  const [pulse, setPulse] = useState(0);
  useEffect(() => {
    const before = known.current;
    known.current = new Set(live.map((session) => session.id));
    if (!before) return;
    const arrived = live.findIndex((session) => !before.has(session.id));
    if (arrived < 0) return;
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    if (arrived === 0) setPulse((count) => count + 1);
  }, [live]);

  // Opacity alone leaves native glass behind, so the glass forms and clears
  // on its own (GlassPresence) as the content fades and rises with it.
  const present = !!current && !hidden;
  const { mounted, visible, presence } = useGlassEntrance(present, PRESENCE_MS);
  const appearStyle = usePopStyle(visible, PRESENCE_MS, { shrinkOnExit: false });
  const pillHeight = useSharedValue(ART + PILL_PADDING_VERTICAL * 2);
  const miniHeight = useSharedValue(0);
  const occupied = useSharedValue(present ? 1 : 0);
  useEffect(() => {
    occupied.set(
      withTiming(present ? 1 : 0, {
        duration: PRESENCE_MS,
        easing: Easing.in(Easing.cubic),
      }),
    );
  }, [present, occupied]);
  // Collapse the space along with the exit, including the gap above it. The
  // finished deck is bottom anchored, so it follows on every animation frame.
  // Keep this spacer mounted after the glass clears to avoid a final layout snap.
  const spaceStyle = useAnimatedStyle(() => ({
    height: (pillHeight.get() + miniHeight.get() + STACK_GAP) * occupied.get(),
  }));

  const session = displayed[0] as SessionSummary | undefined;
  const items = useMemo(
    () => (session ? [{ key: session.id, text: session.title }] : []),
    [session],
  );

  const openSession = (picked: SessionSummary) => {
    rememberSession(picked);
    onOpen(picked);
  };
  const stopSession = (picked: SessionSummary) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    markStoppedHere(picked.id);
    stop(picked.id).catch((reason) =>
      Alert.alert("Could not stop", String(reason)),
    );
  };

  return (
    <Animated.View
      style={spaceStyle}
      pointerEvents={visible ? "box-none" : "none"}
    >
      {mounted && session ? (
        <View style={styles.workingContent} pointerEvents="box-none">
          <MiniPills
            live={others}
            open={stacked}
            height={miniHeight}
            onOpen={openSession}
            onStop={stopSession}
          />
          <GlassPresence value={presence}>
            <Animated.View
              style={[styles.pillSlot, appearStyle]}
              onLayout={(event) => pillHeight.set(event.nativeEvent.layout.height)}
              pointerEvents={visible ? "box-none" : "none"}
            >
              <LiquidView
                borderRadius={radii.pill}
                innerStyle={styles.pill}
                onPress={() => openSession(session)}
                pressedScale={1.02}
                accessibilityLabel={`${session.title}, ${statusLabel(session)}. Open`}
              >
                <Artwork session={session} pulse={pulse} />
                <View style={styles.text}>
                  <Ticker
                    held={swiping}
                    items={items}
                    style={styles.title}
                    onActiveChange={noop}
                  />
                  <Subtitle
                    session={session}
                    arrived={session.id in shownArrivals}
                  />
                </View>
                <StopButton onPress={() => stopSession(session)} />
              </LiquidView>
            </Animated.View>
          </GlassPresence>
        </View>
      ) : null}
    </Animated.View>
  );
}

/**
 * Every other session at work as a pill of its own, stacked above the
 * now-playing pill: each rises out from behind it in turn, the nearest
 * first, and sinks back into it, the farthest first. The space they take
 * eases open and shut with them, so what's stacked above moves along. A tap
 * on one opens it.
 */
function MiniPills({
  live,
  open,
  height,
  onOpen,
  onStop,
}: {
  live: SessionSummary[];
  open: boolean;
  height: SharedValue<number>;
  onOpen: (session: SessionSummary) => void;
  onStop: (session: SessionSummary) => void;
}) {
  const styles = useStyles();
  const { mounted, visible, presence } = useGlassEntrance(open, PRESENCE_MS);
  const count = live.length;
  useEffect(() => () => height.set(0), [height]);
  useEffect(() => {
    height.set(
      visible
        ? withSpring(count * (MINI + MINI_GAP), MINI_SPRING)
        : withTiming(0, {
            duration: PRESENCE_MS,
            easing: Easing.inOut(Easing.cubic),
          }),
    );
  }, [visible, count, height]);
  const listStyle = useAnimatedStyle(() => ({ height: height.get() }));

  if (!mounted) return null;
  return (
    <GlassPresence value={presence}>
      <Animated.View
        style={[styles.miniList, listStyle]}
        pointerEvents={visible ? "box-none" : "none"}
      >
        {live.map((session, index) => (
          <MiniPill
            key={session.id}
            session={session}
            // Counted up from the now-playing pill.
            place={count - 1 - index}
            count={count}
            visible={visible}
            onPress={() => onOpen(session)}
            onStop={() => onStop(session)}
          />
        ))}
      </Animated.View>
    </GlassPresence>
  );
}

function MiniPill({
  session,
  place,
  count,
  visible,
  onPress,
  onStop,
}: {
  session: SessionSummary;
  /** How many pills down to the now-playing pill. */
  place: number;
  count: number;
  visible: boolean;
  onPress: () => void;
  onStop: () => void;
}) {
  const colors = useColors();
  const styles = useStyles();
  const waiting = !!session.waiting;
  const model = session.modelName || session.model;
  const detail = waiting
    ? statusLabel(session)
    : [model, session.branch].filter(Boolean).join(" · ") || "Working";

  const rise = useSharedValue(0);
  useEffect(() => {
    const order = visible ? place : count - 1 - place;
    rise.set(
      withDelay(
        order * MINI_STAGGER,
        visible
          ? withSpring(1, MINI_SPRING)
          : withTiming(0, {
              duration: PRESENCE_MS - 60,
              easing: Easing.in(Easing.cubic),
            }),
      ),
    );
  }, [visible, place, count, rise]);
  // Its own slot, springing along as others come and go.
  const slot = useSharedValue(place);
  useEffect(() => {
    slot.set(withSpring(place, MINI_SPRING));
  }, [place, slot]);
  const style = useAnimatedStyle(() => {
    const t = rise.get();
    // Tucked behind the now-playing pill, and up into its slot.
    const tucked = MINI + MINI_GAP;
    const at = -slot.get() * (MINI + MINI_GAP);
    return {
      // Never quite clear, or its glass comes up without its effect.
      opacity: Math.max(GLASS_MIN_OPACITY, Math.min(1, t / 0.5)),
      transform: [
        { translateY: interpolate(t, [0, 1], [tucked, at]) },
        { scale: interpolate(t, [0, 1], [0.8, 1]) },
      ],
    };
  });

  return (
    <Animated.View style={[styles.miniSlot, style]} pointerEvents="box-none">
      <LiquidView
        borderRadius={radii.pill}
        innerStyle={styles.mini}
        onPress={onPress}
        pressedScale={1.03}
        accessibilityLabel={`${session.title}, ${statusLabel(session)}. Open`}
      >
        <View style={styles.miniArt}>
          <ProviderLogo
            harness={session.harness}
            size={16}
            color={colors.content}
          />
          <View
            style={[
              styles.miniDot,
              { backgroundColor: waiting ? colors.caution : colors.accent },
            ]}
          />
        </View>
        <View style={styles.text}>
          <Text style={styles.miniTitle} numberOfLines={1}>
            {session.title}
          </Text>
          <Text
            style={[styles.miniMeta, waiting && { color: colors.caution }]}
            numberOfLines={1}
          >
            {detail}
          </Text>
        </View>
        <StopButton onPress={onStop} />
      </LiquidView>
    </Animated.View>
  );
}

function statusLabel(session: SessionSummary) {
  if (session.waiting === "approval") return "Needs your approval";
  if (session.waiting === "question") return "Has a question for you";
  return "Working";
}

/**
 * The agent's mark in a circle, ringed in a slow glow while it works. A new
 * agent flips in like a coin; `pulse` going up throws a ring out from it.
 */
function Artwork({
  session,
  pulse,
}: {
  session: SessionSummary;
  pulse: number;
}) {
  const colors = useColors();
  const styles = useStyles();
  const waiting = !!session.waiting;
  const tone = waiting ? colors.caution : colors.accent;
  const reduceMotion = useReducedMotion();
  const glow = useSharedValue(0.6);
  useEffect(() => {
    if (reduceMotion) return;
    // Waiting pulses quicker, to catch the eye.
    const half = waiting ? 520 : 1100;
    glow.set(
      withRepeat(
        withSequence(
          withTiming(1, { duration: half, easing: Easing.inOut(Easing.sin) }),
          withTiming(0.2, { duration: half, easing: Easing.inOut(Easing.sin) }),
        ),
        -1,
      ),
    );
    return () => cancelAnimation(glow);
  }, [waiting, reduceMotion, glow]);
  const ring = useAnimatedStyle(() => ({ opacity: glow.get() }));

  // A ring thrown out and fading, for a session that just arrived.
  const burst = useSharedValue(1);
  useEffect(() => {
    if (pulse === 0 || reduceMotion) return;
    burst.set(0);
    burst.set(
      withTiming(1, { duration: 900, easing: Easing.out(Easing.cubic) }),
    );
  }, [pulse, reduceMotion, burst]);
  const burstStyle = useAnimatedStyle(() => ({
    opacity: 1 - burst.get(),
    transform: [{ scale: 1 + burst.get() * 0.7 }],
  }));
  const pop = useSharedValue(1);
  useEffect(() => {
    if (pulse === 0 || reduceMotion) return;
    pop.set(withSequence(withTiming(1.15, { duration: 140 }), withSpring(1)));
  }, [pulse, reduceMotion, pop]);
  const popStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pop.get() }],
  }));

  return (
    <Animated.View style={[styles.art, popStyle]}>
      <Animated.View
        pointerEvents="none"
        style={[styles.ring, { borderColor: tone }, burstStyle]}
      />
      {/* Keyed by agent, so only a different one flips in. */}
      <Animated.View
        key={session.harness}
        style={styles.logo}
        entering={FlipInEasyY.duration(420).delay(120)}
        exiting={FlipOutEasyY.duration(240)}
      >
        <ProviderLogo
          harness={session.harness}
          size={22}
          color={colors.content}
        />
      </Animated.View>
      <Animated.View
        pointerEvents="none"
        style={[
          styles.ring,
          { borderColor: tone, backgroundColor: withAlpha(tone, 0.1) },
          ring,
        ]}
      />
    </Animated.View>
  );
}

/** What the one in front is up to, and its model. */
function Subtitle({
  session,
  arrived,
}: {
  session: SessionSummary;
  /** It started working on the desktop a moment ago. */
  arrived: boolean;
}) {
  const colors = useColors();
  const styles = useStyles();
  const model = session.modelName || session.model;
  const waiting = !!session.waiting;
  const detail = waiting
    ? statusLabel(session)
    : [arrived ? "From desktop" : null, model, session.branch]
        .filter(Boolean)
        .join(" · ") || "Working";
  return (
    <View style={styles.subtitle}>
      {waiting ? null : <TerminalSpinner style={styles.spinner} />}
      <Animated.Text
        key={`${session.id}:${detail}`}
        style={[styles.meta, waiting && { color: colors.caution }]}
        numberOfLines={1}
        entering={FadeIn.duration(260)}
        exiting={FadeOut.duration(140)}
      >
        {detail}
      </Animated.Text>
    </View>
  );
}

/** The Music app's stop: a plain rounded square. */
function StopButton({ onPress }: { onPress: () => void }) {
  const styles = useStyles();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Stop"
      hitSlop={6}
      onPress={onPress}
      style={({ pressed }) => [styles.control, pressed && styles.pressed]}
    >
      <View style={styles.stop} />
    </Pressable>
  );
}


const useStyles = themedStyles((colors) => ({
  workingContent: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
  },
  pillSlot: {
    marginHorizontal: 20,
  },
  miniList: {
    marginHorizontal: 28,
  },
  miniSlot: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: MINI_GAP,
  },
  mini: {
    height: MINI,
    gap: 10,
    paddingLeft: 10,
    paddingRight: 6,
    alignItems: "center",
  },
  miniArt: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 16,
    backgroundColor: colors.fill,
  },
  miniDot: {
    position: "absolute",
    right: -1,
    bottom: -1,
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: colors.background,
  },
  miniTitle: {
    color: colors.content,
    fontSize: 14,
    fontWeight: "600",
  },
  miniMeta: {
    color: colors.muted,
    fontSize: 12,
  },
  pill: {
    gap: 4,
    paddingLeft: 10,
    paddingRight: 8,
    paddingVertical: PILL_PADDING_VERTICAL,
  },
  art: {
    width: ART,
    height: ART,
    marginRight: 8,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: ART / 2,
    backgroundColor: colors.fill,
  },
  logo: {
    alignItems: "center",
    justifyContent: "center",
  },
  ring: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: ART / 2,
    // No shadow: one without a set path is redrawn every frame it moves.
    borderWidth: 1.5,
  },
  text: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  title: {
    color: colors.content,
    fontSize: 16,
    fontWeight: "600",
  },
  subtitle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  meta: {
    flexShrink: 1,
    color: colors.muted,
    fontSize: 13,
  },
  spinner: {
    width: 12,
    flexShrink: 0,
    color: colors.accent,
    fontSize: 13,
    lineHeight: 16,
    textAlign: "center",
  },
  control: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 20,
  },
  pressed: {
    backgroundColor: colors.fill,
  },
  stop: {
    width: 15,
    height: 15,
    borderRadius: 3.5,
    borderCurve: "continuous",
    backgroundColor: colors.content,
  },
}));

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  FadeIn,
  FadeOut,
  makeMutable,
  useAnimatedReaction,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import * as Haptics from "@/ui/haptics";
import { Icon, type IconName } from "@/ui/Icon";
import { radii, themedStyles, useColors, withAlpha } from "@/ui/theme";

// Fork (Hari, L-280): the Computer screen's small building blocks.

export function Section({
  title,
  right,
  children,
  fold,
}: {
  title: string;
  right?: ReactNode;
  children: ReactNode;
  /** L-293: a section that opens and closes from its title, with a count. */
  fold?: { open: boolean; onToggle: () => void; count?: number };
}) {
  const styles = useStyles();
  const colors = useColors();
  const reduced = useReducedMotion();
  const turn = useSharedValue(fold?.open ? 1 : 0);
  useEffect(() => {
    turn.value = withTiming(fold?.open ? 1 : 0, { duration: reduced ? 0 : 200 });
  }, [fold?.open, reduced, turn]);
  const chevron = useAnimatedStyle(() => ({ transform: [{ rotate: `${-90 + turn.value * 90}deg` }] }));
  if (!fold)
    return (
      <View style={styles.section}>
        <View style={styles.sectionHead}>
          <Text style={styles.sectionTitle} accessibilityRole="header">
            {title}
          </Text>
          {right}
        </View>
        <View style={styles.card}>{children}</View>
      </View>
    );
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: fold.open }}
          accessibilityLabel={`${title}${fold.count === undefined ? "" : `, ${fold.count}`}`}
          onPress={fold.onToggle}
          hitSlop={8}
          style={({ pressed }) => [styles.foldHead, pressed && { opacity: 0.6 }]}
        >
          <Animated.View style={chevron}>
            <Icon name="chevronDown" size={16} color={colors.muted} />
          </Animated.View>
          <Text style={styles.foldTitle} accessibilityRole="header">
            {title}
          </Text>
          {fold.count === undefined ? null : <Text style={styles.foldCount}>{fold.count}</Text>}
        </Pressable>
        {fold.open ? right : null}
      </View>
      {fold.open ? (
        <Animated.View
          entering={reduced ? undefined : FadeIn.duration(200)}
          exiting={reduced ? undefined : FadeOut.duration(150)}
          style={styles.card}
        >
          {children}
        </Animated.View>
      ) : null}
    </View>
  );
}

/** A labelled meter: "CPU 23%" with a bar; a dash while unknown. */
export function Meter({ label, percent, detail }: { label: string; percent?: number; detail?: string }) {
  const styles = useStyles();
  const known = percent !== undefined;
  const value = known ? Math.round(percent) : null;
  return (
    <View
      style={styles.meter}
      accessible
      accessibilityLabel={`${label} ${value === null ? "unknown" : `${value} percent`}${detail ? `, ${detail}` : ""}`}
    >
      <View style={styles.meterHead}>
        <Text style={styles.meterLabel}>{label}</Text>
        <Text style={styles.meterValue}>{value === null ? "—" : `${value}%`}</Text>
      </View>
      <View style={styles.track}>
        <View style={[styles.bar, { width: `${Math.min(100, Math.max(0, percent ?? 0))}%` }, (percent ?? 0) >= 90 && styles.barHot]} />
      </View>
      {detail ? <Text style={styles.meterDetail}>{detail}</Text> : null}
    </View>
  );
}

/**
 * True while a finger is on a slider, so the hub's swipe between Share and
 * Control leaves the drag to it.
 */
export const sliderHeld = makeMutable(false);

/** How often a slider sends while it's dragged. */
const SLIDER_SEND_MS = 150;
/** After a slider is let go, readings that may predate it are ignored this long. */
const SLIDER_QUIET_MS = 1_500;

/**
 * Fork (Hari, L-307): a control-centre tile: icon, label and a short state
 * line. A switch (`on` given) fills with the accent while on; an action (no
 * `on`) keeps an accent icon. A spinner takes the icon's place while its
 * change is on the way.
 */
export function Tile({
  icon,
  label,
  state,
  on,
  busy,
  disabled,
  onPress,
}: {
  icon: IconName;
  label: string;
  state?: string;
  on?: boolean;
  busy?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  const reduced = useReducedMotion();
  const toggle = on !== undefined;
  const lit = useSharedValue(on ? 1 : 0);
  useEffect(() => {
    lit.set(withTiming(on ? 1 : 0, { duration: reduced ? 0 : 180 }));
  }, [on, reduced, lit]);
  const fill = useAnimatedStyle(() => ({ opacity: lit.get() }));
  const ink = on ? colors.onAccent : toggle ? colors.content : colors.accent;
  return (
    <Pressable
      accessibilityRole={toggle ? "switch" : "button"}
      accessibilityLabel={label}
      accessibilityHint={state}
      accessibilityState={{
        disabled: Boolean(disabled),
        busy: Boolean(busy),
        checked: toggle ? on : undefined,
      }}
      disabled={Boolean(disabled || busy)}
      onPress={onPress}
      style={({ pressed }) => [
        styles.tile,
        disabled && !busy && styles.disabled,
        pressed && styles.pressedScale,
      ]}
    >
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.tileFill, fill]} />
      <View style={styles.tileIcon}>
        {busy ? <ActivityIndicator size="small" color={ink} /> : <Icon name={icon} size={22} color={ink} />}
      </View>
      <Text
        style={[styles.tileLabel, on && styles.onAccent]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.8}
      >
        {label}
      </Text>
      <Text style={[styles.tileState, on && styles.onAccentSoft]} numberOfLines={1}>
        {state ?? " "}
      </Text>
    </Pressable>
  );
}

/** Tiles side by side, sharing the width. */
export function TileRow({ children }: { children: ReactNode }) {
  const styles = useStyles();
  return <View style={styles.tileRow}>{children}</View>;
}

/**
 * Fork (Hari, L-307): a wide slider as tall as a tile; drag anywhere on it.
 * It moves from where it is, not to the finger, so a scroll that starts on it
 * can't make the value jump. While dragged it sends every
 * [`SLIDER_SEND_MS`], and once more when let go (`final`).
 */
export function TileSlider({
  icon,
  label,
  value,
  min = 0,
  max = 100,
  format = (shown) => `${shown}%`,
  hint,
  disabled,
  onChange,
}: {
  icon: IconName;
  label: string;
  /** Null while unknown. */
  value: number | null;
  min?: number;
  max?: number;
  format?: (value: number) => string;
  hint?: string;
  disabled?: boolean;
  onChange: (value: number, final: boolean) => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  const reduced = useReducedMotion();
  const span = max - min;
  const [width, setWidth] = useState(0);
  const [shown, setShown] = useState(value);
  const [resync, setResync] = useState(0);
  const fill = useSharedValue(value === null ? 0 : Math.min(1, Math.max(0, (value - min) / span)));
  const from = useSharedValue(0);
  /** 0 still, 1 dragged, 2 just let go. */
  const phase = useSharedValue(0);
  const dragging = useRef(false);
  const quietUntil = useRef(0);
  const sentAt = useRef(0);
  const trailing = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const settle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latest = useRef(onChange);
  useEffect(() => {
    latest.current = onChange;
  });
  const unknown = value === null;

  useEffect(
    () => () => {
      clearTimeout(trailing.current);
      clearTimeout(settle.current);
    },
    [],
  );
  // Follows the computer, except during a drag and just after one.
  useEffect(() => {
    if (value === null || dragging.current || Date.now() < quietUntil.current) return;
    setShown(value);
    fill.set(withTiming(Math.min(1, Math.max(0, (value - min) / span)), { duration: reduced ? 0 : 180 }));
  }, [value, resync, reduced, fill, min, span]);

  const live = useCallback((next: number) => {
    dragging.current = true;
    setShown(next);
    clearTimeout(trailing.current);
    const send = () => {
      sentAt.current = Date.now();
      latest.current(next, false);
    };
    const wait = SLIDER_SEND_MS - (Date.now() - sentAt.current);
    if (wait <= 0) send();
    else trailing.current = setTimeout(send, wait);
  }, []);
  const commit = useCallback((next: number) => {
    clearTimeout(trailing.current);
    dragging.current = false;
    quietUntil.current = Date.now() + SLIDER_QUIET_MS;
    clearTimeout(settle.current);
    settle.current = setTimeout(() => setResync((count) => count + 1), SLIDER_QUIET_MS);
    setShown(next);
    void Haptics.selectionAsync();
    latest.current(next, true);
  }, []);

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .enabled(!disabled && !unknown && width > 0)
        .activeOffsetX([-6, 6])
        .failOffsetY([-12, 12])
        .onTouchesDown(() => {
          sliderHeld.set(true);
        })
        .onStart(() => {
          from.set(fill.get());
          phase.set(1);
        })
        .onUpdate((event) => {
          fill.set(Math.min(1, Math.max(0, from.get() + event.translationX / width)));
        })
        .onFinalize(() => {
          sliderHeld.set(false);
          // Let go, or taken over by a scroll: either way the value stays.
          if (phase.get() === 1) phase.set(2);
        }),
    [disabled, unknown, width, fill, from, phase],
  );
  // The drag lives on the UI thread; each new whole value, and the letting
  // go, are handed to JS from here.
  useAnimatedReaction(
    () => ({ state: phase.get(), value: Math.round(min + fill.get() * span) }),
    (now, before) => {
      if (now.state === 2) {
        phase.set(0);
        scheduleOnRN(commit, now.value);
      } else if (now.state === 1 && before?.state === 1 && before.value !== now.value) {
        scheduleOnRN(live, now.value);
      }
    },
  );

  const track = useAnimatedStyle(() => ({ transform: [{ translateX: (fill.get() - 1) * width }] }));
  const step = (direction: 1 | -1) => {
    if (shown === null || disabled) return;
    const next = Math.min(max, Math.max(min, shown + direction * 10));
    fill.set(withTiming((next - min) / span, { duration: reduced ? 0 : 180 }));
    commit(next);
  };
  const off = Boolean(disabled) || unknown;
  return (
    <GestureDetector gesture={pan}>
      <View
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={label}
        accessibilityHint={hint}
        accessibilityState={{ disabled: off }}
        accessibilityValue={shown === null ? { text: "Unknown" } : { min, max, now: shown, text: format(shown) }}
        accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
        onAccessibilityAction={(event) => step(event.nativeEvent.actionName === "increment" ? 1 : -1)}
        onLayout={(event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width)}
        style={[styles.slider, off && styles.disabled]}
      >
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.sliderFill, track]} />
        <Icon name={icon} size={22} color={colors.content} />
        <Text style={styles.sliderLabel} numberOfLines={1}>
          {label}
        </Text>
        <Text style={styles.sliderValue}>{shown === null ? "—" : format(shown)}</Text>
      </View>
    </GestureDetector>
  );
}

/** A pill-shaped action under an expanded row. */
export function Chip({
  label,
  danger,
  disabled,
  onPress,
}: {
  label: string;
  danger?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const styles = useStyles();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        danger && styles.chipDanger,
        disabled && styles.disabled,
        pressed && styles.pressedScale,
      ]}
    >
      <Text style={[styles.chipLabel, danger && styles.chipLabelDanger]}>{label}</Text>
    </Pressable>
  );
}

/** A segmented choice, for sorting. */
export function Segments<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  label: string;
}) {
  const styles = useStyles();
  return (
    <View style={styles.segments} accessibilityRole="radiogroup" accessibilityLabel={label}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            onPress={() => onChange(option.value)}
            hitSlop={6}
            style={[styles.segment, selected && styles.segmentOn]}
          >
            <Text style={[styles.segmentLabel, selected && styles.segmentLabelOn]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const useStyles = themedStyles((colors) => ({
  section: { marginTop: 24 },
  sectionHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 10,
    paddingHorizontal: 4,
    minHeight: 32,
  },
  sectionTitle: { flex: 1, color: colors.muted, fontSize: 15 },
  foldHead: { flex: 1, flexDirection: "row", alignItems: "center", gap: 6, minHeight: 32 },
  foldTitle: { color: colors.muted, fontSize: 15 },
  foldCount: {
    color: colors.muted,
    fontSize: 12,
    fontVariant: ["tabular-nums"],
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 8,
    overflow: "hidden",
    backgroundColor: colors.surface,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderCurve: "continuous",
    overflow: "hidden",
  },
  meter: { flex: 1, minWidth: 0, gap: 6 },
  meterHead: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 8 },
  meterLabel: { color: colors.muted, fontSize: 13 },
  meterValue: { color: colors.content, fontSize: 17, fontWeight: "600", fontVariant: ["tabular-nums"] },
  meterDetail: { color: colors.muted, fontSize: 12, fontVariant: ["tabular-nums"] },
  track: {
    height: 4,
    borderRadius: 2,
    overflow: "hidden",
    backgroundColor: withAlpha(colors.accent, 0.16),
  },
  bar: { height: 4, borderRadius: 2, backgroundColor: colors.accent },
  barHot: { backgroundColor: colors.caution },
  tileRow: { flexDirection: "row", gap: 8 },
  tile: {
    flex: 1,
    minWidth: 0,
    minHeight: 88,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 10,
    overflow: "hidden",
    borderRadius: radii.card,
    borderCurve: "continuous",
    backgroundColor: colors.surface,
  },
  tileFill: { backgroundColor: colors.accent },
  tileIcon: { height: 26, justifyContent: "center", marginBottom: 2 },
  tileLabel: { color: colors.content, fontSize: 13, fontWeight: "600" },
  tileState: { color: colors.muted, fontSize: 12, fontVariant: ["tabular-nums"] },
  onAccent: { color: colors.onAccent },
  onAccentSoft: { color: withAlpha(colors.onAccent, 0.72) },
  slider: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 60,
    paddingHorizontal: 16,
    overflow: "hidden",
    borderRadius: radii.card,
    borderCurve: "continuous",
    backgroundColor: colors.surface,
  },
  sliderFill: { backgroundColor: withAlpha(colors.accent, 0.4) },
  sliderLabel: { flex: 1, color: colors.content, fontSize: 15, fontWeight: "500" },
  sliderValue: { color: colors.content, fontSize: 15, fontWeight: "600", fontVariant: ["tabular-nums"] },
  chip: {
    minHeight: 36,
    justifyContent: "center",
    paddingHorizontal: 14,
    borderRadius: radii.pill,
    backgroundColor: withAlpha(colors.accent, 0.12),
  },
  chipDanger: { backgroundColor: withAlpha(colors.deletions, 0.14) },
  chipLabel: { color: colors.accent, fontSize: 14, fontWeight: "600" },
  chipLabelDanger: { color: colors.deletions },
  segments: {
    flexDirection: "row",
    padding: 2,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
  },
  segment: { minHeight: 32, justifyContent: "center", paddingHorizontal: 12, borderRadius: radii.pill },
  segmentOn: { backgroundColor: colors.surfaceRaised },
  segmentLabel: { color: colors.muted, fontSize: 13, fontWeight: "500" },
  segmentLabelOn: { color: colors.content },
  disabled: { opacity: 0.4 },
  pressedScale: { transform: [{ scale: 0.96 }], opacity: 0.85 },
}));

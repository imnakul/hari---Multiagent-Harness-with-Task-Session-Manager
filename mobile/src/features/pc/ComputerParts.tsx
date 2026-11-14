import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";

import { Icon, type IconName } from "@/ui/Icon";
import { radii, themedStyles, useColors, withAlpha } from "@/ui/theme";

// Fork (Hari, L-280): the Computer screen's small building blocks.

export function Section({ title, right, children }: { title: string; right?: ReactNode; children: ReactNode }) {
  const styles = useStyles();
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

/** A big square control: icon above a label. */
export function Control({
  icon,
  label,
  busy,
  disabled,
  onPress,
}: {
  icon: IconName;
  label: string;
  busy?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  const off = Boolean(busy || disabled);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: off, busy: Boolean(busy) }}
      disabled={off}
      onPress={onPress}
      style={({ pressed }) => [styles.control, off && styles.disabled, pressed && styles.pressedScale]}
    >
      <Icon name={icon} size={22} color={colors.accent} />
      <Text style={styles.controlLabel} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
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
  control: {
    flex: 1,
    minWidth: 72,
    minHeight: 76,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 6,
    borderRadius: radii.card,
    borderCurve: "continuous",
    backgroundColor: colors.surface,
  },
  controlLabel: { color: colors.content, fontSize: 13, fontWeight: "500" },
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

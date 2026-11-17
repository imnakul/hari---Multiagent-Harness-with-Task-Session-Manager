import { Pressable, Text, View } from "react-native";
import Animated, { type EntryOrExitLayoutType } from "react-native-reanimated";

import { relativeTime } from "@/features/workspace/relativeTime";
import type { SessionSummary } from "@/features/workspace/types";
import { Icon } from "@/ui/Icon";
import { radii, withAlpha, themedStyles, useColors } from "@/ui/theme";

import { ProviderLogo } from "./ProviderLogo";
import { TerminalSpinner } from "./TerminalSpinner";

/**
 * A session as one line, like a chat in the Claude app's drawer: the
 * provider's mark where that app shows its chat icon, then the title. While
 * it works, the terminal spinner takes the mark's place, as in the desktop
 * sidebar. Laid out like the drawer's nav rows. Fork (Hari, L-340): a long
 * press opens its menu (no swipe actions); `pinned` marks a phone pin.
 *
 * `detailed` lays it out as the desktop's SessionCard instead, for the
 * Sessions screen: see SessionDetails.
 */
export function SessionCard({
  session,
  active = false,
  onPress,
  onLongPress,
  pinned = false,
  entering,
  exiting,
  detailed = false,
}: {
  session: SessionSummary;
  active?: boolean;
  onPress: () => void;
  onLongPress?: () => void;
  /** Pinned on this phone: a pin beside the title. */
  pinned?: boolean;
  /** How the row comes into the list, when it is new. */
  entering?: EntryOrExitLayoutType;
  /** How the row leaves the list, when it is deleted. */
  exiting?: EntryOrExitLayoutType;
  /** Two lines with the time, branch and model, as on the desktop. */
  detailed?: boolean;
}) {
  const colors = useColors();
  const styles = useStyles();
  const row = (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active, busy: !!session.busy }}
      accessibilityLabel={session.busy ? `${session.title}, working` : session.title}
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityActions={onLongPress ? [{ name: "longpress", label: pinned ? "Unpin" : "Pin" }] : undefined}
      onAccessibilityAction={({ nativeEvent }) => {
        if (nativeEvent.actionName === "longpress") onLongPress?.();
      }}
      style={({ pressed }) => [
        detailed ? styles.card : styles.row,
        active && styles.active,
        pressed && !active && styles.pressed,
      ]}
    >
      {detailed ? (
        <SessionDetails session={session} pinned={pinned} />
      ) : (
        <>
          <View style={styles.mark}>
            {session.busy ? (
              <TerminalSpinner style={styles.working} />
            ) : (
              <ProviderLogo harness={session.harness} size={20} color={colors.content} />
            )}
          </View>
          <Text style={styles.title} numberOfLines={1}>
            {session.title}
          </Text>
          {pinned ? <Icon name="pin" size={14} color={colors.faint} /> : null}
        </>
      )}
    </Pressable>
  );
  if (!entering && !exiting) return row;
  return (
    <Animated.View entering={entering} exiting={exiting}>
      {row}
    </Animated.View>
  );
}

/**
 * A session as the desktop's Mono details panel lays out its SessionCard
 * (`modelInFooter`): the title with the time or status on its right, then the
 * branch with the model and its provider's mark on its right. The desktop
 * reveals the model's name on hover; with no hover here it always shows.
 */
function SessionDetails({ session, pinned }: { session: SessionSummary; pinned: boolean }) {
  const colors = useColors();
  const styles = useStyles();
  const model = session.modelName || session.model;
  return (
    <>
      <View style={styles.line}>
        {pinned ? <Icon name="pin" size={13} color={colors.faint} /> : null}
        <Text style={styles.cardTitle} numberOfLines={1}>
          {session.title}
        </Text>
        {session.busy ? (
          <View style={styles.status}>
            <TerminalSpinner style={styles.statusLabel} />
            <Text style={styles.statusLabel}>Working...</Text>
          </View>
        ) : (
          <Text style={styles.time}>{relativeTime(session.updatedAt)}</Text>
        )}
      </View>
      <View style={styles.line}>
        <View style={styles.branch}>
          <Icon name="branch" size={13} color={colors.faint} />
          <Text style={[styles.meta, !session.branch && styles.noBranch]} numberOfLines={1}>
            {session.branch || "No branch"}
          </Text>
        </View>
        <View style={styles.model}>
          {model ? (
            <Text style={styles.meta} numberOfLines={1}>
              {model}
            </Text>
          ) : null}
          <ProviderLogo harness={session.harness} size={14} color={colors.muted} />
        </View>
      </View>
    </>
  );
}

const useStyles = themedStyles((colors) => ({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 44,
    paddingHorizontal: 14,
    borderRadius: radii.row,
  },
  // As wide as the nav rows' icons, so titles start level with their labels.
  mark: {
    width: 22,
    alignItems: "center",
  },
  active: {
    backgroundColor: colors.selection,
  },
  pressed: {
    backgroundColor: withAlpha(colors.content, 0.05),
  },
  title: {
    flex: 1,
    color: colors.content,
    fontSize: 17,
  },
  // About the logo's size, on a fixed line so the frames don't shift the row.
  working: {
    color: colors.accent,
    fontSize: 18,
    lineHeight: 22,
    textAlign: "center",
  },
  card: {
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderRadius: radii.row,
    borderCurve: "continuous",
  },
  line: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  cardTitle: {
    flex: 1,
    color: colors.content,
    fontSize: 16,
    fontWeight: "600",
  },
  time: {
    color: colors.faint,
    fontSize: 13,
    fontVariant: ["tabular-nums"],
  },
  status: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  statusLabel: {
    color: colors.accent,
    fontSize: 13,
  },
  branch: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  model: {
    flexShrink: 1,
    maxWidth: "50%",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  meta: {
    flexShrink: 1,
    color: colors.muted,
    fontSize: 13,
  },
  noBranch: {
    color: colors.faint,
  },
}));

import { memo, useEffect, useState, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { isRunning } from "@/features/liveUpdates/liveCards";
import { relativeTime } from "@/features/workspace/relativeTime";
import type { Project, SessionSummary } from "@/features/workspace/types";
import * as Haptics from "@/ui/haptics";
import { Icon } from "@/ui/Icon";
import { LiquidView } from "@/ui/LiquidView";
import { themedStyles, useColors } from "@/ui/theme";

/**
 * Fork (Hari, L-412): a project on the Sessions tab's All page, as the
 * Classic drawer's project row: a tap on the card opens the project, a long
 * press its menu. Only a project with sessions at work has the arrow, which
 * folds out those sessions (waiting ones first), each opening on a tap.
 */
export const ProjectCard = memo(function ProjectCard({
  project,
  face,
  running,
  lastActive,
  onOpen,
  onLongPress,
  onOpenSession,
}: {
  project: Project;
  face: ReactNode;
  /** Its sessions at work, in the order to list them (see `runningSessions`). */
  running: readonly SessionSummary[];
  /** When any of its sessions last changed, if it has any. */
  lastActive: number | undefined;
  onOpen: (projectId: string) => void;
  onLongPress: (project: Project) => void;
  onOpenSession: (session: SessionSummary) => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  const reduceMotion = useReducedMotion();
  const [expanded, setExpanded] = useState(false);
  const waiting = running.filter((session) => session.waiting).length;
  const open = expanded && running.length > 0;
  const turn = useSharedValue(0);
  useEffect(() => {
    turn.set(withTiming(open ? 1 : 0, { duration: reduceMotion ? 0 : 200, easing: Easing.out(Easing.cubic) }));
  }, [open, turn, reduceMotion]);
  const chevron = useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.get() * 90}deg` }] }));
  const status = waiting
    ? `${waiting} need${waiting === 1 ? "s" : ""} you`
    : running.length
      ? `${running.length} running`
      : null;

  return (
    <LiquidView borderRadius={22} row={false} innerStyle={styles.card}>
      <View style={styles.head}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={status ? `${project.name}, ${status}` : project.name}
          accessibilityHint="Opens its sessions"
          onPress={() => onOpen(project.id)}
          onLongPress={() => {
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            onLongPress(project);
          }}
          style={({ pressed }) => [styles.main, pressed && styles.pressed]}
        >
          <View style={styles.face}>{face}</View>
          <View style={styles.text}>
            <Text style={styles.name} numberOfLines={1}>
              {project.name}
            </Text>
            {status ? <Text style={[styles.status, waiting > 0 && styles.needs]}>{status}</Text> : null}
          </View>
          {lastActive ? <Text style={styles.time}>{relativeTime(lastActive)}</Text> : null}
        </Pressable>
        {running.length ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${open ? "Hide" : "Show"} running sessions in ${project.name}`}
            accessibilityState={{ expanded: open }}
            hitSlop={6}
            onPress={() => {
              void Haptics.selectionAsync();
              setExpanded((value) => !value);
            }}
            style={({ pressed }) => [styles.toggle, pressed && styles.pressed]}
          >
            <Animated.View style={chevron}>
              <Icon name="chevronRight" size={18} color={colors.muted} />
            </Animated.View>
          </Pressable>
        ) : null}
      </View>
      {open ? (
        <Animated.View
          entering={reduceMotion ? undefined : FadeIn.duration(180)}
          exiting={reduceMotion ? undefined : FadeOut.duration(120)}
          style={styles.body}
        >
          {running.map((session) => (
              <Pressable
                key={session.id}
                accessibilityRole="button"
                accessibilityLabel={`${session.title || "Untitled session"}${session.waiting ? ", needs you" : ", working"}`}
                onPress={() => onOpenSession(session)}
                style={({ pressed }) => [styles.session, pressed && styles.pressed]}
              >
                <View style={[styles.dot, session.waiting ? styles.dotNeeds : styles.dotWorking]} />
                <Text style={styles.sessionTitle} numberOfLines={1}>
                  {session.title || "Untitled session"}
                </Text>
                <Text style={[styles.time, session.waiting && styles.needs]}>
                  {session.waiting ? "Needs you" : relativeTime(session.updatedAt)}
                </Text>
              </Pressable>
          ))}
        </Animated.View>
      ) : null}
    </LiquidView>
  );
});

/** A project's sessions at work, for its card: those waiting on you first, then the latest. */
export function runningSessions(sessions: readonly SessionSummary[]): SessionSummary[] {
  return sessions
    .filter(isRunning)
    .sort((a, b) => Number(!!b.waiting) - Number(!!a.waiting) || b.updatedAt - a.updatedAt);
}

const useStyles = themedStyles((colors) => ({
  card: { alignSelf: "stretch", alignItems: "stretch", padding: 6 },
  head: { flexDirection: "row", alignItems: "center" },
  main: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    minHeight: 56,
    paddingHorizontal: 8,
    borderRadius: 16,
  },
  pressed: { backgroundColor: colors.selection },
  face: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceRaised,
  },
  text: { flex: 1, gap: 2 },
  name: { color: colors.content, fontSize: 16, fontWeight: "600" },
  status: { color: colors.accent, fontSize: 13, fontWeight: "500" },
  needs: { color: colors.accent, fontWeight: "600" },
  time: { color: colors.muted, fontSize: 13 },
  toggle: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  body: { paddingTop: 2, paddingBottom: 2 },
  session: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 44,
    // The dots line up under the project's face.
    paddingLeft: 8 + 21 - 4,
    paddingRight: 12,
    borderRadius: 14,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  dotWorking: { backgroundColor: colors.accent },
  dotNeeds: { backgroundColor: colors.caution },
  sessionTitle: { flex: 1, color: colors.content, fontSize: 15 },
}));

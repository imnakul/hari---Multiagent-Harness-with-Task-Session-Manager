import {
  memo,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import Animated, { FadeIn, LinearTransition } from "react-native-reanimated";

import { FileSearchBar, SEARCH_BAR } from "@/features/files/FileSearchBar";
import type { Harness, SessionSummary, Worktree } from "@/features/workspace/types";
import { useWorkspace } from "@/features/workspace/WorkspaceProvider";
import { AnimationsPaused } from "@/ui/AnimationsPaused";
import { ChoiceSheet } from "@/ui/ChoiceMenu";
import * as Haptics from "@/ui/haptics";
import { GradualBlur } from "@/ui/GradualBlur";
import { themedStyles, useColors } from "@/ui/theme";

import { SessionCard } from "./SessionCard";
import {
  filterSessions,
  NO_FILTER,
  SessionFilterMenu,
  type SessionFilter,
} from "./SessionFilterMenu";
import { useSessionLayout } from "./SessionScreen";
import { ARRIVE_MS, useArrivals } from "./useArrivals";
import { pinnedFirst, toggleSessionPin, useSessionPins } from "./sessionPins";
import { useSessionPages, visibleSessions } from "./useSessionPages";

/**
 * A project's sessions, newest first and paged in as the list scrolls.
 * Fork (Hari, L-340): sessions pinned on the phone come first; a long press
 * on one opens its menu (Pin or Unpin). Searched and
 * filtered from the bar where the composer rests on the chat page, and
 * narrowed to `worktree` when the header's menu picks one, as the desktop's
 * sidebar is. `active` while the page is in view: it reads the list then, and
 * its spinners only run then.
 */
export function SessionsPage({
  projectId,
  active,
  worktree,
  onOpen,
}: {
  projectId: string;
  active: boolean;
  worktree?: Worktree;
  onOpen: (session: SessionSummary) => void;
}) {
  const colors = useColors();
  const styles = useStyles();
  const { sessions, edited, rememberSession } = useWorkspace();
  const { pageTop, dockBottom } = useSessionLayout();
  // Room for the search bar where the composer rests, and the blur under it.
  const bottom = dockBottom + SEARCH_BAR + 16;
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<SessionFilter>(NO_FILTER);
  const needle = query.trim().toLowerCase();
  const recent = sessions.filter((session) => session.projectId === projectId);
  const pages = useSessionPages(projectId, needle, active);
  const listed = visibleSessions(pages, recent, needle, edited).filter((session) =>
    inWorktree(session, worktree),
  );
  const pins = useSessionPins();
  const visible = pinnedFirst(filterSessions(listed, filter), pins);
  const scope = JSON.stringify([projectId, needle, filter, worktree?.path, !!pages]);
  const arrivals = useArrivals(visible, scope, active);
  // The agents to filter by: those in the list, in the order first seen.
  const harnesses = [...new Set<Harness>(listed.map((session) => session.harness))];
  if (filter.harness && !harnesses.includes(filter.harness)) harnesses.push(filter.harness);
  const narrowed = !!needle || filter !== NO_FILTER || !!worktree;

  // The menu shows only while the page is in view.
  const [menuFor, setMenuFor] = useState<SessionSummary | null>(null);

  // The rows' handlers keep their identity, reaching the latest render's
  // through a ref, so a row only re-renders when its own session changes.
  const latest = useRef({ onOpen, rememberSession });
  useLayoutEffect(() => {
    latest.current = { onOpen, rememberSession };
  });
  const handlers = useMemo<RowHandlers>(
    () => ({
      open: (session) => {
        latest.current.rememberSession(session);
        latest.current.onOpen(session);
      },
      showActions: (session) => {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        setMenuFor(session);
      },
    }),
    [],
  );
  const { arriving, moving } = arrivals;
  const pinnedIds = useMemo(() => new Set(pins), [pins]);
  const renderItem = useCallback(
    ({ item }: { item: SessionSummary }) => (
      <SessionRow
        session={item}
        pinned={pinnedIds.has(item.id)}
        arriving={arriving.has(item.id)}
        handlers={handlers}
      />
    ),
    [pinnedIds, arriving, handlers],
  );
  const menuPinned = !!menuFor && pinnedIds.has(menuFor.id);

  return (
    <AnimationsPaused value={!active}>
      <View style={styles.page}>
        <Animated.FlatList
          itemLayoutAnimation={moving ? LinearTransition.duration(ARRIVE_MS) : undefined}
          data={arrivals.sessions}
          // Re-renders the rows when they start or stop moving, so each takes up the transition.
          extraData={moving}
          keyExtractor={(session) => session.id}
          renderItem={renderItem}
          ItemSeparatorComponent={Divider}
          ListEmptyComponent={
            pages ? (
              <Text style={styles.empty}>
                {narrowed ? "No matching sessions." : "No sessions yet."}
              </Text>
            ) : null
          }
          ListFooterComponent={
            pages?.loadingMore ? <ActivityIndicator style={styles.more} color={colors.muted} /> : null
          }
          onEndReached={pages?.loadMore}
          onEndReachedThreshold={0.5}
          initialNumToRender={12}
          windowSize={7}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[styles.list, { paddingTop: pageTop, paddingBottom: bottom }]}
          scrollIndicatorInsets={{ top: pageTop, bottom }}
          showsVerticalScrollIndicator={false}
        />
        <GradualBlur edge="bottom" height={bottom} color={colors.background} />
        <FileSearchBar
          value={query}
          onChange={setQuery}
          placeholder="Search sessions"
          accessory={
            <SessionFilterMenu value={filter} onChange={setFilter} harnesses={harnesses} />
          }
        />
        <ChoiceSheet
          open={active && menuFor !== null}
          title={menuFor?.title ?? "Session"}
          sections={
            menuFor
              ? [
                  [
                    {
                      label: menuPinned ? "Unpin" : "Pin",
                      icon: "pin",
                      onPress: () => toggleSessionPin(menuFor.id),
                    },
                  ],
                ]
              : []
          }
          onClose={() => setMenuFor(null)}
        />
      </View>
    </AnimationsPaused>
  );
}

/**
 * Whether a session works in `worktree`; any does without one. An older
 * desktop doesn't say where a session works, so it goes by the branch, which
 * only one working copy can have checked out.
 */
function inWorktree(session: SessionSummary, worktree: Worktree | undefined) {
  if (!worktree) return true;
  if (session.worktreePath) return samePath(session.worktreePath, worktree.path);
  return session.branch === worktree.name;
}

function samePath(a: string, b: string) {
  return a.replace(/\/+$/, "") === b.replace(/\/+$/, "");
}

/** A hairline between cards, inset to their text. */
function Divider() {
  const styles = useStyles();
  return <View style={styles.divider} />;
}

type RowHandlers = {
  open: (session: SessionSummary) => void;
  showActions: (session: SessionSummary) => void;
};

/** What a row shows of its session: a fresh list read hands over new objects
 *  for unchanged sessions, which shouldn't re-render their rows. */
function sameRow(a: SessionSummary, b: SessionSummary) {
  return (
    a === b ||
    (a.id === b.id &&
      a.title === b.title &&
      a.busy === b.busy &&
      a.updatedAt === b.updatedAt &&
      a.branch === b.branch &&
      a.model === b.model &&
      a.modelName === b.modelName &&
      a.harness === b.harness)
  );
}

/** A session in the list, re-rendered only when what it shows changes. */
const SessionRow = memo(function SessionRow({
  session,
  pinned,
  arriving,
  handlers,
}: {
  session: SessionSummary;
  pinned: boolean;
  arriving: boolean;
  handlers: RowHandlers;
}) {
  return (
    <SessionCard
      session={session}
      detailed
      onPress={() => handlers.open(session)}
      onLongPress={() => handlers.showActions(session)}
      pinned={pinned}
      entering={arriving ? FadeIn.duration(ARRIVE_MS).delay(ARRIVE_MS * 0.3) : undefined}
    />
  );
},
(before, after) =>
  before.pinned === after.pinned &&
  before.arriving === after.arriving &&
  before.handlers === after.handlers &&
  sameRow(before.session, after.session));

const useStyles = themedStyles((colors) => ({
  page: {
    flex: 1,
  },
  list: {
    paddingHorizontal: 10,
  },
  empty: {
    paddingHorizontal: 14,
    paddingTop: 4,
    color: colors.muted,
    fontSize: 15,
  },
  more: {
    paddingVertical: 16,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: 14,
    backgroundColor: colors.stroke,
  },
}));

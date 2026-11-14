import { Host, HStack, Label, Menu, Picker, Spacer } from "@expo/ui/swift-ui";
import {
  accessibilityLabel,
  contentShape,
  frame,
  pickerStyle,
  shapes,
  tag,
} from "@expo/ui/swift-ui/modifiers";
import * as Haptics from "@/ui/haptics";
import { router, useGlobalSearchParams, usePathname } from "expo-router";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Image, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useConnection, useMonoTools } from "@/features/connection/ConnectionProvider";
import { shownFeedItems, useFeed } from "@/features/notifications/notificationFeed";
import { useFeedPreferences } from "@/features/settings/notificationFeed";
import { isRunning } from "@/features/liveUpdates/liveCards";
import { canWake } from "@/features/liveUpdates/nativeLive";
import { wakeComputer } from "@/features/pc/wake";
import { PixelMascot } from "@/features/mascots/PixelMascot";
import { ProjectMascot } from "@/features/mascots/ProjectMascot";
import { plainText } from "@/features/sessions/markdownParser";
import { HEADER_GAP, HEADER_HEIGHT, useKeyboardLift } from "@/features/sessions/SessionScreen";
import { HARI_LOGO } from "@/ui/brand";
import { ChoiceMenu } from "@/ui/ChoiceMenu";
import { CircleButton } from "@/ui/CircleButton";
import { useWarmDitherLoading } from "@/ui/DitherLoading";
import { GradualBlur } from "@/ui/GradualBlur";
import { Icon, type IconName } from "@/ui/Icon";
import { LiquidView } from "@/ui/LiquidView";
import { isModalRoute } from "@/ui/SceneFade";
import { AnimationsPaused } from "@/ui/AnimationsPaused";
import { useDrawerActions, useDrawerOpen } from "@/ui/ScenePager";
import { Shimmer } from "@/ui/Shimmer";
import { radii, themedStyles, useColors, useScheme } from "@/ui/theme";

import { useUnreadMonos } from "./monoSeen";
import { onMonoCreated } from "./newMono";
import { pickProject } from "./projectPick";
import { projectForRoute } from "./routing";
import type { Mono, Project, SessionSummary } from "./types";
import { useWorkspace } from "./WorkspaceProvider";

/** As the composer's pill, so the drawer's foot lines up with a chat's. */
const FOOTER_HEIGHT = 50;
/** How far past the header and footer the blur keeps fading. */
const FADE = 16;
/** The Monocode mark in the header. */
const MARK = 38;
/** A Mono row's mascot, as a chat list's avatar. */
const AVATAR = 40;
/** The rows' inset and their own padding, so a Mono's figure lines up with
 *  the header's buttons. */
const LIST_INSET = 6;
const ROW_INSET = 10;
const ROW_GAP = 14;

/** One empty list for every idle project, so their rows stay memoised. */
const NO_SESSIONS: SessionSummary[] = [];

type Filter = "all" | "unread" | "working";
/** Which kinds the list shows. */
type Show = "both" | "monos" | "projects";

/**
 * The phone's counterpart of the desktop's rail, laid out as a messaging
 * app's chat list: the Monocode mark, the filter and a new Mono up top, level
 * with a screen's header; the Monos with their latest line and when; and at
 * Projects under their own label, and at the foot settings and search, level
 * with a screen's composer. Picking one switches the screen under it as the
 * drawer shuts.
 */
export function WorkspaceDrawer() {
  const drawer = useDrawerActions();
  const open = useDrawerOpen();
  // The switch's loading cover, drawn while the drawer is open to be picked from.
  useWarmDitherLoading(open);
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const styles = useStyles();
  const { projects, monos: roster } = useWorkspace();
  const { pairing, catalog } = useConnection();
  // Fork (Hari, L-275): shown once the desktop answers; older ones can't.
  const feed = useFeed();
  const [{ seenOnDesktop }] = useFeedPreferences();
  const feedShown = feed.phase !== "unsupported" && feed.phase !== "loading";
  const feedUnread =
    feed.phase === "ready"
      ? shownFeedItems(feed.items, seenOnDesktop).filter((item) => !item.read).length
      : 0;
  const tools = useMonoTools();
  // Fork (Hari, L-288): Wake computer from the side menu; "Sent" shows a moment.
  const [waking, setWaking] = useState<"busy" | "sent" | null>(null);
  const wake = async () => {
    const fingerprint = pairing?.desktop.fingerprint;
    if (!fingerprint || waking === "busy") return;
    setWaking("busy");
    try {
      if (!(await wakeComputer(fingerprint))) return setWaking(null);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setWaking("sent");
      setTimeout(() => setWaking(null), 4_000);
    } catch (reason) {
      setWaking(null);
      Alert.alert("Couldn’t wake the computer", reason instanceof Error ? reason.message : String(reason));
    }
  };
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [show, setShow] = useState<Show>("both");
  const unread = useUnreadMonos(pairing?.desktop.fingerprint, roster);
  const pathname = usePathname();
  const params = useGlobalSearchParams<{ projectId?: string; monoId?: string }>();
  const onMono = pathname.startsWith("/mono/");
  const onProject = pathname.startsWith("/project/");
  const activeMono = onMono ? params.monoId : undefined;
  const activeProject = onProject
    ? projectForRoute(projects, params.projectId)?.id
    : undefined;

  // The mono heard from last first, as a messaging app's chat list, narrowed
  // by the search and the filter.
  const needle = query.trim().toLowerCase();
  const monos = useMemo(
    () =>
      [...roster]
        .sort((a, b) => (b.lastActiveAt || 0) - (a.lastActiveAt || 0))
        .filter(
          (mono) =>
            (!needle || mono.name.toLowerCase().includes(needle)) &&
            (filter === "all" ||
              (filter === "unread" ? unread.has(mono.id) : mono.status !== "idle")),
        ),
    [roster, needle, filter, unread],
  );
  // Fork (Hari, L-241): each project's running sessions, those waiting on the
  // user first, then the newest, as the Live Update cards order them.
  const runningByProject = useMemo(() => {
    const byProject = new Map<string, SessionSummary[]>();
    for (const session of catalog.sessions) {
      if (!isRunning(session)) continue;
      const list = byProject.get(session.projectId) ?? [];
      list.push(session);
      byProject.set(session.projectId, list);
    }
    for (const list of byProject.values())
      list.sort(
        (a, b) => Number(!!b.waiting) - Number(!!a.waiting) || b.updatedAt - a.updatedAt,
      );
    return byProject;
  }, [catalog.sessions]);
  const shownProjects = projects.filter(
    (project) =>
      (!needle || project.name.toLowerCase().includes(needle)) &&
      // A project has no replies to read, so only "All" and "Working now" keep it.
      (filter === "all" ||
        (filter === "working" && (project.busy || runningByProject.has(project.id)))),
  );

  // The drawer shuts at once over a loading cover, and the next screen is
  // built only once it is shut, so building it can't hitch the motion. Same
  // kind to same kind only swaps the params, so the frame stays mounted.
  const openProject = (id: string) => {
    if (id === activeProject) return drawer.close();
    drawer.closeThen(() => {
      // The project route takes a pick in place; any other screen is replaced.
      if (!pickProject(id))
        router.replace({ pathname: "/project/[projectId]", params: { projectId: id } });
    });
  };
  // A running session opens over its project, as the project's own list
  // pushes it, once the drawer is shut.
  const openSession = (session: SessionSummary) => {
    drawer.closeThen(() => {
      if (session.projectId !== activeProject && !pickProject(session.projectId))
        router.replace({ pathname: "/project/[projectId]", params: { projectId: session.projectId } });
      router.push({
        pathname: "/project/[projectId]/session/[sessionId]",
        params: { projectId: session.projectId, sessionId: session.id },
      });
    });
  };
  const openMono = (id: string) => {
    if (id === activeMono) return drawer.close();
    // Mono to Mono only swaps the conversation in the same screen, which is
    // light enough to switch as the drawer shuts.
    if (onMono) {
      drawer.close();
      return router.setParams({ monoId: id });
    }
    drawer.closeThen(() =>
      router.replace({ pathname: "/mono/[monoId]", params: { monoId: id } }),
    );
  };
  // Settings rises over the open drawer, which is still there once it's shut.
  // Fork (Hari, L-235): on Android a modal opens inside the slid-aside scene,
  // squeezed beside the drawer, so the drawer shuts first.
  const openModal = (
    path: "/settings" | "/mono-new" | "/tasks" | "/notes" | "/notifications" | "/computer",
  ) => {
    if (isModalRoute(pathname)) return;
    if (Platform.OS === "android") drawer.closeThen(() => router.push(path));
    else router.push(path);
  };
  const openSettings = () => openModal("/settings");
  // A new Mono from its own sheet, which rises over the open drawer as
  // settings does; once made, the drawer shuts onto its chat.
  const createMono = () => openModal("/mono-new");
  const openCreated = useRef(openMono);
  useEffect(() => {
    openCreated.current = openMono;
  });
  useEffect(() => onMonoCreated((monoId) => openCreated.current(monoId)), []);

  // Each kind under its label, as the filter lets it show.
  const listedMonos = show === "projects" ? [] : monos;
  const listedProjects = show === "monos" ? [] : shownProjects;
  const headerTop = insets.top + HEADER_GAP;
  const headerBottom = headerTop + HEADER_HEIGHT + 12;
  const footerBottom = Math.max(insets.bottom, 12);
  const footerTop = footerBottom + FOOTER_HEIGHT + 12;
  // The search rides the keyboard, resting just above it.
  const lift = useKeyboardLift(footerBottom - 10);
  const nothing = !listedMonos.length && !listedProjects.length;

  return (
    // A shut drawer's mascots hold still; they move again as it opens.
    <AnimationsPaused value={!open}>
      <View style={styles.container}>
        <ScrollView
          style={StyleSheet.absoluteFill}
          contentContainerStyle={{ paddingTop: headerBottom, paddingBottom: footerTop + FADE }}
          scrollIndicatorInsets={{ top: headerBottom, bottom: footerTop }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          {/* Fork (Hari, L-236): the desktop's Tasks and Notes, over the lists. */}
          {(catalog.phoneTools || feedShown || pairing) && !needle ? (
            <View style={[styles.list, styles.toolList]}>
              {/* Fork (Hari, L-275): the desktop bell's history. */}
              {feedShown ? (
                <ToolRow
                  icon="notifications"
                  label="Notifications"
                  badge={feedUnread}
                  onPress={() => openModal("/notifications")}
                />
              ) : null}
              {/* Fork (Hari, L-288): the Computer hub and Wake-on-LAN, in either layout. */}
              {pairing ? (
                <ToolRow icon="computer" label="Computer" onPress={() => openModal("/computer")} />
              ) : null}
              {pairing && canWake ? (
                <ToolRow
                  icon="power"
                  label="Wake computer"
                  detail={waking === "busy" ? "Sending…" : waking === "sent" ? "Sent" : undefined}
                  onPress={() => void wake()}
                />
              ) : null}
              {catalog.phoneTools ? (
                <>
                  <ToolRow icon="tasks" label="Tasks" onPress={() => openModal("/tasks")} />
                  <ToolRow icon="note" label="Notes" onPress={() => openModal("/notes")} />
                </>
              ) : null}
            </View>
          ) : null}
          {listedMonos.length ? (
            <View style={styles.list}>
              <Text style={styles.sectionLabel}>Monos</Text>
              {listedMonos.map((mono) => (
                <MonoRow
                  key={mono.id}
                  mono={mono}
                  unread={unread.has(mono.id)}
                  active={mono.id === activeMono}
                  onPress={openMono}
                />
              ))}
            </View>
          ) : null}
          {listedProjects.length ? (
            <View style={[styles.list, listedMonos.length > 0 && styles.section]}>
              <Text style={styles.sectionLabel}>Projects</Text>
              {listedProjects.map((project) => (
                <ProjectRow
                  key={project.id}
                  project={project}
                  running={runningByProject.get(project.id) ?? NO_SESSIONS}
                  active={project.id === activeProject}
                  onPress={openProject}
                  onOpenSession={openSession}
                />
              ))}
            </View>
          ) : null}
          {nothing ? (
            <Text style={styles.empty}>
              {needle || filter !== "all" || show !== "both"
                ? "Nothing matches."
                : "No Monos or projects on this phone yet."}
            </Text>
          ) : null}
        </ScrollView>

        <GradualBlur edge="top" height={headerBottom + FADE} color={colors.drawer} />
        <GradualBlur edge="bottom" height={footerTop + FADE} color={colors.drawer} />

        <View style={[styles.header, { top: headerTop }]}>
          <Image
            source={HARI_LOGO}
            style={styles.mark}
            accessibilityIgnoresInvertColors
          />
          <View style={styles.headerActions}>
            <FilterMenu filter={filter} onFilter={setFilter} show={show} onShow={setShow} />
            {/* The older desktop app can't make a Mono from the phone. */}
            {tools ? <CircleButton icon="add" label="New Mono" onPress={createMono} /> : null}
          </View>
        </View>

        <Animated.View style={[styles.foot, { bottom: footerBottom }, lift]}>
          <View style={styles.footer}>
          <CircleButton icon="settings" label="Settings" onPress={openSettings} size={FOOTER_HEIGHT} />
          <LiquidView borderRadius={FOOTER_HEIGHT / 2} style={styles.searchFrame} innerStyle={styles.search}>
            <Icon name="search" size={18} color={colors.muted} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search"
              placeholderTextColor={colors.muted}
              keyboardAppearance={useScheme()}
              returnKeyType="search"
              autoCorrect={false}
              clearButtonMode="while-editing"
              style={styles.searchInput}
            />
          </LiquidView>
          </View>
        </Animated.View>
      </View>
    </AnimationsPaused>
  );
}

// Each with its SF Symbol for the iOS menu and its icon for Android's sheet.
const FILTERS: {
  value: Filter;
  label: string;
  symbol: "tray.full" | "circlebadge" | "bolt";
  icon: IconName;
}[] = [
  { value: "all", label: "All", symbol: "tray.full", icon: "inbox" },
  { value: "unread", label: "Unread", symbol: "circlebadge", icon: "circle" },
  { value: "working", label: "Working now", symbol: "bolt", icon: "automation" },
];

const SHOWS: {
  value: Show;
  label: string;
  symbol: "square.stack" | "person.2" | "folder";
  icon: IconName;
}[] = [
  { value: "both", label: "Monos and projects", symbol: "square.stack", icon: "layers" },
  { value: "monos", label: "Monos", symbol: "person.2", icon: "people" },
  { value: "projects", label: "Projects", symbol: "folder", icon: "folder" },
];

/** The round button beside a new Mono: a native menu of which kinds to show
 *  and which of them. Lit while either narrows the list. */
function FilterMenu({
  filter,
  onFilter,
  show,
  onShow,
}: {
  filter: Filter;
  onFilter: (value: Filter) => void;
  show: Show;
  onShow: (value: Show) => void;
}) {
  const colors = useColors();
  const on = filter !== "all" || show !== "both";
  // The SwiftUI menu has no Android view, so Android groups the same choices in a sheet.
  if (Platform.OS === "android") return (
    <ChoiceMenu label={on ? "Filter, on" : "Filter"} title="Filter" sections={[
      SHOWS.map((option) => ({
        label: option.label,
        icon: option.icon,
        selected: show === option.value,
        onPress: () => onShow(option.value),
      })),
      FILTERS.map((option) => ({
        label: option.label,
        icon: option.icon,
        selected: filter === option.value,
        onPress: () => onFilter(option.value),
      })),
    ]}>
      <LiquidView borderRadius={HEADER_HEIGHT / 2} innerStyle={filterStyles.round}>
        <Icon name="filter" size={20} color={on ? colors.accent : colors.content} />
      </LiquidView>
    </ChoiceMenu>
  );
  return (
    <View>
      <LiquidView borderRadius={HEADER_HEIGHT / 2} innerStyle={filterStyles.round}>
        <Icon name="filter" size={20} color={on ? colors.accent : colors.content} />
      </LiquidView>
      {/* The native menu lies over the glass, its label an invisible box of
          the button's size, as in SessionFilterMenu. */}
      <Host style={StyleSheet.absoluteFill}>
        <Menu
          modifiers={[accessibilityLabel(on ? "Filter, on" : "Filter")]}
          label={
            <HStack modifiers={[frame({ width: HEADER_HEIGHT, height: HEADER_HEIGHT }), contentShape(shapes.circle())]}>
              <Spacer />
            </HStack>
          }
        >
          <Picker
            selection={show}
            onSelectionChange={(next) => onShow(next as Show)}
            modifiers={[pickerStyle("inline")]}
          >
            {SHOWS.map((option) => (
              <Label key={option.value} title={option.label} systemImage={option.symbol} modifiers={[tag(option.value)]} />
            ))}
          </Picker>
          <Picker
            selection={filter}
            onSelectionChange={(next) => onFilter(next as Filter)}
            modifiers={[pickerStyle("inline")]}
          >
            {FILTERS.map((option) => (
              <Label key={option.value} title={option.label} systemImage={option.symbol} modifiers={[tag(option.value)]} />
            ))}
          </Picker>
        </Menu>
      </Host>
    </View>
  );
}

const filterStyles = StyleSheet.create({
  round: {
    width: HEADER_HEIGHT,
    height: HEADER_HEIGHT,
  },
});

/** A Mono as a chat in a messaging app's list: its mascot, its name and when
 *  it was last active, and under them what it is doing or its last line. */
const MonoRow = memo(function MonoRow({
  mono,
  unread,
  active,
  onPress,
}: {
  mono: Mono;
  /** A reply it sent that the user hasn't seen. */
  unread: boolean;
  active: boolean;
  onPress: (id: string) => void;
}) {
  const styles = useStyles();
  // The shimmer only runs where it can be seen.
  const shown = useDrawerOpen();
  const detail =
    mono.status === "working"
      ? "Working…"
      : mono.status === "needs-you"
        ? "Needs you"
        : oneLine(mono.lastMessage) || "No messages yet";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${mono.name}, ${detail}`}
      accessibilityState={{ selected: active }}
      onPress={() => onPress(mono.id)}
      style={({ pressed }) => [styles.row, (active || pressed) && styles.rowActive]}
    >
      <PixelMascot name={mono.mascot} color={mono.color} status={mono.status} size={AVATAR} centered />
      <View style={styles.rowText}>
        <View style={styles.rowTop}>
          <Text style={styles.rowLabel} numberOfLines={1}>
            {mono.name}
          </Text>
          {mono.lastActiveAt ? (
            <Text style={[styles.rowTime, unread && styles.rowTimeUnread]}>{when(mono.lastActiveAt)}</Text>
          ) : null}
        </View>
        <View style={styles.rowTop}>
          {mono.status === "working" && shown ? (
            <Shimmer style={[styles.rowDetail, styles.rowDetailFill]}>{detail}</Shimmer>
          ) : (
            <Text
              style={[styles.rowDetail, styles.rowDetailFill, mono.status === "needs-you" && styles.rowNeedsYou]}
              numberOfLines={1}
            >
              {detail}
            </Text>
          )}
          {unread ? <View style={styles.unread} /> : null}
        </View>
      </View>
    </Pressable>
  );
});

/** When a Mono was last active, as a chat list dates its rows: the time
 *  today, Yesterday, else the day. */
export function when(at: number) {
  const date = new Date(at);
  const today = new Date();
  if (date.toDateString() === today.toDateString())
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

/** The start of a message as one plain line: its markdown read for its
 *  words, so **bold** shows as bold rather than its asterisks. Only as much
 *  as one line can show is read. */
export function oneLine(text: string) {
  // A reply that is only a reaction, as the chat shows it, by its emoji.
  const reaction = text.trim().match(/^<reaction>\s*(.{1,16}?)\s*<\/reaction>$/su);
  if (reaction) return `Reacted ${reaction[1]}`;
  return plainText(text.slice(0, 600));
}

/**
 * A project as a row of the list, under the Monos: its mascot and name. Fork
 * (Hari, L-241): while sessions run in it, the name shimmers as on the
 * desktop, their count sits at the row's end, and that count opens the
 * running sessions under the row, each opening its chat.
 */
const ProjectRow = memo(function ProjectRow({
  project,
  running,
  active,
  onPress,
  onOpenSession,
}: {
  project: Project;
  /** Its running sessions, those waiting on the user first. */
  running: SessionSummary[];
  active: boolean;
  onPress: (id: string) => void;
  onOpenSession: (session: SessionSummary) => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  // The shimmer only runs where it can be seen.
  const shown = useDrawerOpen();
  const [expanded, setExpanded] = useState(false);
  const count = running.length;
  const open = expanded && count > 0;
  const turn = useSharedValue(0);
  useEffect(() => {
    turn.set(withTiming(open ? 1 : 0, { duration: 200, easing: Easing.out(Easing.cubic) }));
  }, [open, turn]);
  const chevron = useAnimatedStyle(() => ({
    transform: [{ rotate: `${turn.get() * 90}deg` }],
  }));
  const waiting = running.filter((session) => session.waiting).length;
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={count ? `${project.name}, ${count} running` : project.name}
        accessibilityState={{ selected: active }}
        onPress={() => onPress(project.id)}
        style={({ pressed }) => [
          styles.projectRow,
          count > 0 && styles.projectRowRunning,
          (active || pressed) && styles.rowActive,
        ]}
      >
        <View style={styles.projectIcon}>
          <ProjectMascot
            project={project.path}
            name={project.mascot}
            color={project.color}
            size={24}
            active={project.busy || count > 0}
          />
        </View>
        {count > 0 && shown ? (
          <Shimmer style={[styles.rowLabel, styles.rowText]} duration={2}>
            {project.name}
          </Shimmer>
        ) : (
          <Text style={[styles.rowLabel, styles.rowText]} numberOfLines={1}>
            {project.name}
          </Text>
        )}
        {count > 0 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${open ? "Hide" : "Show"} ${count} running ${count === 1 ? "session" : "sessions"}`}
            accessibilityState={{ expanded: open }}
            hitSlop={4}
            onPress={() => {
              void Haptics.selectionAsync();
              setExpanded((value) => !value);
            }}
            style={({ pressed }) => [styles.runningToggle, pressed && styles.runningTogglePressed]}
          >
            <Text style={[styles.runningCount, waiting > 0 && styles.rowNeedsYou]}>{count}</Text>
            <Animated.View style={chevron}>
              <Icon name="chevronRight" size={16} color={colors.muted} />
            </Animated.View>
          </Pressable>
        ) : null}
      </Pressable>
      {open ? (
        <Animated.View
          entering={FadeIn.duration(180)}
          exiting={FadeOut.duration(120)}
          style={styles.runningList}
        >
          {running.map((session) => (
            <Pressable
              key={session.id}
              accessibilityRole="button"
              accessibilityLabel={`${session.title || "Untitled session"}, ${session.waiting ? "needs you" : "working"}`}
              onPress={() => onOpenSession(session)}
              style={({ pressed }) => [styles.sessionRow, pressed && styles.rowActive]}
            >
              <View
                style={[
                  styles.sessionDot,
                  { backgroundColor: session.waiting ? colors.caution : colors.accent },
                ]}
              />
              <Text style={styles.sessionTitle} numberOfLines={1}>
                {session.title || "Untitled session"}
              </Text>
              {session.waiting ? <Text style={styles.sessionNeedsYou}>Needs you</Text> : null}
            </Pressable>
          ))}
        </Animated.View>
      ) : null}
    </View>
  );
});

/** A row that opens one of the desktop's tools in its own sheet. */
function ToolRow({
  icon,
  label,
  onPress,
  badge = 0,
  detail,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  /** Fork (L-275): a count shown at the end (unread notifications). */
  badge?: number;
  /** Fork (L-288): a short state at the end, e.g. Wake computer's "Sent". */
  detail?: string;
}) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={badge ? `${label}, ${badge} unread` : detail ? `${label}, ${detail}` : label}
      accessibilityLiveRegion={detail ? "polite" : undefined}
      onPress={onPress}
      style={({ pressed }) => [styles.toolRow, pressed && styles.rowActive]}
    >
      <View style={styles.projectIcon}>
        <Icon name={icon} size={22} color={colors.content} />
      </View>
      <Text style={[styles.rowLabel, styles.rowText]} numberOfLines={1}>
        {label}
      </Text>
      {detail ? <Text style={styles.toolDetail}>{detail}</Text> : null}
      {badge ? (
        <View style={styles.toolBadge}>
          <Text style={styles.toolBadgeText}>{badge > 99 ? "99+" : badge}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const useStyles = themedStyles((colors) => ({
  toolDetail: { color: colors.muted, fontSize: 14 },
  toolBadge: {
    minWidth: 22,
    height: 22,
    paddingHorizontal: 6,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.accent,
  },
  toolBadgeText: {
    color: colors.onAccent,
    fontSize: 12,
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
  },
  toolList: {
    marginBottom: 18,
  },
  toolRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: ROW_GAP,
    minHeight: 48,
    paddingLeft: ROW_INSET,
    paddingRight: ROW_INSET + 12,
    paddingVertical: 8,
    borderRadius: radii.card - 6,
    borderCurve: "continuous",
  },
  container: {
    flex: 1,
    backgroundColor: colors.page,
  },
  header: {
    position: "absolute",
    left: 0,
    right: 0,
    height: HEADER_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  // The Monocode mark, centred on a row's figure below it.
  mark: {
    width: MARK,
    height: MARK,
    marginLeft: LIST_INSET + ROW_INSET + (AVATAR - MARK) / 2 - 16,
  },
  foot: {
    position: "absolute",
    left: 0,
    right: 0,
  },
  section: {
    marginTop: 18,
  },
  // Dimmed heading over each kind, inset like the rows' text.
  sectionLabel: {
    paddingHorizontal: ROW_INSET,
    marginBottom: 4,
    color: colors.muted,
    fontSize: 13,
    fontWeight: "500",
  },
  pressed: {
    opacity: 0.6,
  },
  list: {
    paddingHorizontal: LIST_INSET,
    gap: 2,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: ROW_GAP,
    minHeight: 64,
    paddingLeft: ROW_INSET,
    // Clear of the scene's edge, which the drawer meets on the right.
    paddingRight: ROW_INSET + 12,
    paddingVertical: 10,
    borderRadius: radii.card - 6,
    borderCurve: "continuous",
  },
  projectRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: ROW_GAP,
    minHeight: 52,
    paddingHorizontal: ROW_INSET,
    paddingVertical: 8,
    borderRadius: radii.row,
    borderCurve: "continuous",
  },
  // The width of a Mono's figure, so the logo above centres on it either way.
  projectIcon: {
    width: AVATAR,
    alignItems: "center",
  },
  rowActive: {
    backgroundColor: colors.selection,
  },
  rowText: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  rowTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  rowLabel: {
    flex: 1,
    color: colors.content,
    fontSize: 17,
    fontWeight: "600",
  },
  rowTime: {
    color: colors.muted,
    fontSize: 14,
    fontVariant: ["tabular-nums"],
  },
  rowTimeUnread: {
    color: colors.accent,
  },
  rowDetail: {
    color: colors.muted,
    fontSize: 15,
  },
  rowDetailFill: {
    flex: 1,
  },
  rowNeedsYou: {
    color: colors.caution,
  },
  // The 48dp count toggle sets this row's height, so it keeps only enough
  // padding to match a plain project row (52dp) instead of growing to 64.
  projectRowRunning: {
    paddingRight: 0,
    paddingVertical: 2,
  },
  // The running count and its chevron: a 48dp target at the row's end.
  runningToggle: {
    minWidth: 48,
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 4,
    paddingRight: ROW_INSET,
    borderRadius: radii.row,
  },
  runningTogglePressed: {
    opacity: 0.6,
    transform: [{ scale: 0.96 }],
  },
  runningCount: {
    color: colors.muted,
    fontSize: 15,
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
  },
  // The sessions under a project, starting where its name starts.
  runningList: {
    paddingLeft: ROW_INSET + AVATAR + ROW_GAP - 10,
    paddingBottom: 4,
  },
  sessionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 44,
    paddingHorizontal: 10,
    borderRadius: radii.row,
    borderCurve: "continuous",
  },
  sessionDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  sessionTitle: {
    flex: 1,
    minWidth: 0,
    color: colors.content,
    fontSize: 15,
  },
  sessionNeedsYou: {
    color: colors.caution,
    fontSize: 13,
    fontWeight: "600",
  },
  unread: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.accent,
  },
  empty: {
    paddingHorizontal: LIST_INSET + ROW_INSET,
    paddingTop: 12,
    color: colors.muted,
    fontSize: 15,
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
  },
  searchFrame: {
    flex: 1,
  },
  search: {
    height: FOOTER_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
  },
  searchInput: {
    flex: 1,
    height: FOOTER_HEIGHT,
    color: colors.content,
    fontSize: 17,
  },
}));

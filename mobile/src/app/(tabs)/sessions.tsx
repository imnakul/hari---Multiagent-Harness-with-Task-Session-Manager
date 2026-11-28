import { router, useIsFocused, useNavigation } from "expo-router";
import type { BottomTabNavigationProp } from "expo-router/js-tabs";
import { useEffect, useEffectEvent, useMemo, useState } from "react";
import { FlatList, Text, View } from "react-native";

import { useConnection } from "@/features/connection/ConnectionProvider";
import { SheetLayout } from "@/features/sessions/SessionScreen";
import { SessionsPage } from "@/features/sessions/SessionsPage";
import { ProjectFace } from "@/features/tabs/ArcFaces";
import { useArcMenu } from "@/features/tabs/ArcMenu";
import { NewSessionSheet } from "@/features/tabs/NewSessionSheet";
import { PageSlide } from "@/features/tabs/PageSlide";
import { ProjectCard, runningSessions } from "@/features/tabs/ProjectCard";
import { removePlaceIcons, usePlaceIcons } from "@/features/tabs/placeIcons";
import { PLUS_SIZE, PlusButton } from "@/features/tabs/PlusButton";
import { TabScreen } from "@/features/tabs/TabScreen";
import { ALL, pruneArc, selectInArc, useTabsMemory } from "@/features/tabs/tabsMemory";
import type { Project, SessionSummary } from "@/features/workspace/types";
import { useWorkspace } from "@/features/workspace/WorkspaceProvider";
import { themedStyles } from "@/ui/theme";

/** The + button's distance from the tab's bottom and right edges. */
const PLUS_INSET = 16;
/** Room under the lists' last row, clear of the + button. */
const LIST_BOTTOM = PLUS_SIZE + PLUS_INSET;

/**
 * Fork (Hari, L-412): the Sessions tab. Its arc (a hold on the tab in the
 * bar, see `HariTabBar`) picks All or one of the five projects opened last;
 * All lists every project, a project shows its sessions, and a tap on the
 * tab while a project shows goes back to All. Each project's list stays mounted once opened, so switching back
 * doesn't reload it. The + starts a new session in a project.
 */
export default function SessionsTab() {
  const styles = useStyles();
  const fingerprint = useConnection().pairing?.desktop.fingerprint ?? "";
  const { projects, sessions } = useWorkspace();
  const memory = useTabsMemory(fingerprint);
  const icons = usePlaceIcons(fingerprint);
  const focused = useIsFocused();
  const { recent, selected } = memory.arcs.sessions;
  const byId = useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects]);
  const [newOpen, setNewOpen] = useState(false);
  const menu = useArcMenu(fingerprint, "sessions", icons);

  // Projects the desktop no longer has leave the arc, with their icons. Only
  // once projects have loaded, so a reconnect's empty list never wipes it.
  useEffect(() => {
    if (!fingerprint || projects.length === 0) return;
    const gone = pruneArc(fingerprint, "sessions", new Set(projects.map((project) => project.id)));
    if (gone.length) removePlaceIcons(fingerprint, gone);
  }, [fingerprint, projects]);

  // Each project's list, from its first visit on.
  const [visited, setVisited] = useState<ReadonlySet<string>>(() => new Set(selected === ALL ? [] : [selected]));
  if (selected !== ALL && !visited.has(selected)) setVisited(new Set([...visited, selected]));

  const stats = useMemo(() => {
    const lastActive = new Map<string, number>();
    const byProject = new Map<string, SessionSummary[]>();
    for (const session of sessions) {
      const at = session.updatedAt;
      if (at > (lastActive.get(session.projectId) ?? 0)) lastActive.set(session.projectId, at);
      byProject.set(session.projectId, [...(byProject.get(session.projectId) ?? []), session]);
    }
    const running = new Map<string, SessionSummary[]>();
    for (const [id, list] of byProject) running.set(id, runningSessions(list));
    return { lastActive, running };
  }, [sessions]);

  const current = selected === ALL ? undefined : byId.get(selected);
  const select = (id: string) => selectInArc(fingerprint, "sessions", id);
  const openSession = (session: SessionSummary) =>
    router.push({
      pathname: "/project/[projectId]/session/[sessionId]",
      params: { projectId: session.projectId, sessionId: session.id },
    });
  const openMenu = (project: Project) => menu.openMenu({ id: project.id, name: project.name });

  // A tap on Sessions while it shows a project goes back to All.
  const navigation = useNavigation<BottomTabNavigationProp<Record<string, object | undefined>>>();
  const backToAll = useEffectEvent(() => {
    if (focused && selected !== ALL) select(ALL);
  });
  useEffect(() => navigation.addListener("tabPress", backToAll), [navigation]);

  // Which side the shown page comes in from: where it lies on the arc against
  // the one before. `moved` turns on at the first change, so the tab's first
  // page doesn't slide.
  const arcIndex = (id: string) => (id === ALL ? 0 : recent.indexOf(id) + 1);
  const [previous, setPrevious] = useState({ id: selected, from: 1 as 1 | -1, moved: false });
  if (previous.id !== selected) {
    setPrevious({ id: selected, from: arcIndex(selected) >= arcIndex(previous.id) ? 1 : -1, moved: true });
  }

  return (
    <TabScreen tab="sessions" title={current?.name}>
      <View style={styles.content}>
        <PageSlide shown={selected === ALL} from={previous.from} style={styles.page}>
          <AllProjects
            projects={projects}
            icons={icons}
            runningByProject={stats.running}
            lastActive={stats.lastActive}
            onPick={select}
            onLongPress={openMenu}
            onOpenSession={openSession}
          />
        </PageSlide>
        <SheetLayout top={0} bottom={LIST_BOTTOM}>
          {[...visited].map((id) => {
            if (!byId.has(id) || !recent.includes(id)) return null;
            const shown = id === selected;
            return (
              <PageSlide key={id} shown={shown} from={previous.from} appear={previous.moved} style={styles.page}>
                <SessionsPage projectId={id} active={shown && focused} onOpen={openSession} searchAtTop />
              </PageSlide>
            );
          })}
        </SheetLayout>
      </View>
      <View style={styles.plus}>
        <PlusButton label="New session" onPress={() => setNewOpen(true)} />
      </View>
      <NewSessionSheet
        open={newOpen}
        projects={projects}
        selectedId={current?.id}
        lastActive={stats.lastActive}
        icons={icons}
        onClose={() => setNewOpen(false)}
        onPick={(projectId) => {
          select(projectId);
          // The project's own page opens on a new session.
          router.push({ pathname: "/project/[projectId]", params: { projectId } });
        }}
      />
      {menu.sheets}
    </TabScreen>
  );
}

const NO_SESSIONS: SessionSummary[] = [];

/** All on the arc: every project, newest activity first, each folding out its sessions at work. */
function AllProjects({
  projects,
  icons,
  runningByProject,
  lastActive,
  onPick,
  onLongPress,
  onOpenSession,
}: {
  projects: readonly Project[];
  icons: ReturnType<typeof usePlaceIcons>;
  runningByProject: ReadonlyMap<string, SessionSummary[]>;
  lastActive: ReadonlyMap<string, number>;
  onPick: (id: string) => void;
  onLongPress: (project: Project) => void;
  onOpenSession: (session: SessionSummary) => void;
}) {
  const styles = useStyles();
  const sorted = useMemo(
    () => [...projects].sort((a, b) => (lastActive.get(b.id) ?? 0) - (lastActive.get(a.id) ?? 0)),
    [projects, lastActive],
  );
  return (
    <FlatList
      data={sorted}
      keyExtractor={(project) => project.id}
      contentContainerStyle={styles.list}
      showsVerticalScrollIndicator={false}
      ListEmptyComponent={<Text style={styles.empty}>No projects on this phone yet.</Text>}
      renderItem={({ item }) => (
        <ProjectCard
          project={item}
          face={<ProjectFace project={item} icon={icons[item.id]} size={26} />}
          running={runningByProject.get(item.id) ?? NO_SESSIONS}
          lastActive={lastActive.get(item.id)}
          onOpen={onPick}
          onLongPress={onLongPress}
          onOpenSession={onOpenSession}
        />
      )}
    />
  );
}

const useStyles = themedStyles((colors) => ({
  content: { flex: 1 },
  page: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 },
  plus: { position: "absolute", right: PLUS_INSET, bottom: PLUS_INSET },
  list: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: LIST_BOTTOM + 8, gap: 10 },
  empty: { color: colors.muted, textAlign: "center", paddingTop: 80 },
}));

import { router, useScrollToTop } from "expo-router";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { Pressable, SectionList, Text, View } from "react-native";

import { useConnection } from "@/features/connection/ConnectionProvider";
import { AllFace, ProjectFace } from "@/features/tabs/ArcFaces";
import { usePlaceIcons } from "@/features/tabs/placeIcons";
import { runningGroups, runningRows, type RunningGroup, type RunningRow } from "@/features/tabs/runningRows";
import { TabScreen } from "@/features/tabs/TabScreen";
import { relativeTime } from "@/features/workspace/relativeTime";
import { useWorkspace } from "@/features/workspace/WorkspaceProvider";
import { Icon } from "@/ui/Icon";
import { themedStyles, useColors } from "@/ui/theme";

/** The tree's gutter, centred under the heading's face (4 inset + 28 / 2). */
const GUTTER = 36;
/** The gap between a heading's face and its first row. */
const FACE_GAP = 10;
const DOT = 10;

type Section = RunningGroup & { data: RunningRow[] };

/**
 * Fork (Hari, L-412): everything at work or waiting on the user, as a tree:
 * each session under its project, Monos under their own heading. Every group
 * starts open, so all sessions show at once; a heading's tap folds it.
 */
export default function RunningTab() {
  const styles = useStyles();
  const fingerprint = useConnection().pairing?.desktop.fingerprint ?? "";
  const icons = usePlaceIcons(fingerprint);
  const { sessions, monos, projects } = useWorkspace();
  const listRef = useRef<SectionList<RunningRow, Section>>(null);
  useScrollToTop(listRef);
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());
  const groups = useMemo(() => {
    const byId = new Map(projects.map((project) => [project.id, project]));
    return runningGroups(runningRows(sessions, monos, byId), byId);
  }, [sessions, monos, projects]);
  const sections: Section[] = groups.map((group) => ({ ...group, data: folded.has(group.key) ? [] : group.rows }));

  const toggle = (key: string) => {
    const next = new Set(folded);
    if (!next.delete(key)) next.add(key);
    setFolded(next);
  };
  const open = (row: RunningRow) => {
    if (row.kind === "mono") router.push({ pathname: "/mono/[monoId]", params: { monoId: row.mono.id } });
    else
      router.push({
        pathname: "/project/[projectId]/session/[sessionId]",
        params: { projectId: row.session.projectId, sessionId: row.session.id },
      });
  };

  return (
    <TabScreen tab="running">
      <SectionList
        ref={listRef}
        sections={sections}
        keyExtractor={(row) => row.key}
        contentContainerStyle={styles.list}
        stickySectionHeadersEnabled={false}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>Nothing running</Text>
            <Text style={styles.emptyText}>Sessions you start show here while they work.</Text>
          </View>
        }
        renderSectionHeader={({ section }) => (
          <GroupHeader
            group={section}
            open={!folded.has(section.key)}
            face={
              section.project ? (
                <ProjectFace project={section.project} icon={icons[section.project.id]} size={22} />
              ) : (
                <AllFace icon="sparkle" />
              )
            }
            onPress={() => toggle(section.key)}
          />
        )}
        renderItem={({ item, index, section }) => (
          <TreeRow
            row={item}
            first={index === 0}
            last={index === section.data.length - 1}
            onPress={() => open(item)}
          />
        )}
      />
    </TabScreen>
  );
}

function GroupHeader({
  group,
  open,
  face,
  onPress,
}: {
  group: RunningGroup;
  open: boolean;
  face: ReactNode;
  onPress: () => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  const count = group.rows.length;
  const summary = group.needsYou ? `${count} · ${group.needsYou} need you` : String(count);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      accessibilityLabel={`${group.title}, ${count} running${group.needsYou ? `, ${group.needsYou} need you` : ""}`}
      onPress={onPress}
      style={({ pressed }) => [styles.header, pressed && styles.pressed]}
    >
      <View style={styles.face}>{face}</View>
      <Text style={styles.groupTitle} numberOfLines={1}>
        {group.title}
      </Text>
      <Text style={[styles.count, group.needsYou > 0 && styles.needs]}>{summary}</Text>
      <View style={!open && styles.chevronFolded}>
        <Icon name="chevronDown" size={18} color={colors.muted} />
      </View>
    </Pressable>
  );
}

function TreeRow({
  row,
  first,
  last,
  onPress,
}: {
  row: RunningRow;
  first: boolean;
  last: boolean;
  onPress: () => void;
}) {
  const styles = useStyles();
  const title = row.kind === "mono" ? row.mono.name : row.session.title || "New session";
  const detail = rowDetail(row);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${row.needsYou ? "needs you" : "working"}`}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <View style={styles.gutter}>
        <View style={[styles.line, first && styles.lineStart, last && styles.lineEnd]} />
        <View style={[styles.dot, row.needsYou ? styles.dotNeeds : styles.dotWorking]} />
      </View>
      <View style={styles.rowText}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        <Text style={[styles.detail, row.needsYou && styles.needs]} numberOfLines={1}>
          {detail}
        </Text>
      </View>
      {row.at ? <Text style={styles.time}>{relativeTime(row.at)}</Text> : null}
    </Pressable>
  );
}

/** What a row says under its title: what it waits on, or where it works. */
function rowDetail(row: RunningRow): string {
  if (row.kind === "mono") return row.needsYou ? "Needs you" : row.mono.lastMessage || "Working";
  const { session } = row;
  if (row.needsYou) {
    if (session.approval) return `Approve: ${session.approval.label}`;
    return session.waiting === "question" ? "Has a question" : "Needs you";
  }
  return ["Working", session.modelName, session.branch].filter(Boolean).join(" · ");
}

const useStyles = themedStyles((colors) => ({
  list: { paddingHorizontal: 16, paddingBottom: 24, flexGrow: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 48,
    marginTop: 10,
    paddingHorizontal: 4,
    borderRadius: 14,
  },
  face: { width: 28, height: 28, alignItems: "center", justifyContent: "center" },
  groupTitle: { flex: 1, color: colors.content, fontSize: 16, fontWeight: "600" },
  count: { color: colors.muted, fontSize: 13, fontVariant: ["tabular-nums"] },
  chevronFolded: { transform: [{ rotate: "-90deg" }] },
  row: { flexDirection: "row", alignItems: "center", minHeight: 56, paddingRight: 4, borderRadius: 14 },
  gutter: { width: GUTTER, alignSelf: "stretch", alignItems: "center", justifyContent: "center" },
  // Runs down from the heading's face to the last row's dot.
  line: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: GUTTER / 2 - 1,
    width: 2,
    borderRadius: 1,
    backgroundColor: colors.faint,
  },
  lineStart: { top: -FACE_GAP },
  lineEnd: { bottom: "50%" },
  dot: { width: DOT, height: DOT, borderRadius: DOT / 2 },
  dotWorking: { backgroundColor: colors.accent },
  dotNeeds: { backgroundColor: colors.caution },
  rowText: { flex: 1, gap: 2, paddingLeft: 4 },
  title: { color: colors.content, fontSize: 15, fontWeight: "500" },
  detail: { color: colors.muted, fontSize: 13 },
  needs: { color: colors.accent, fontWeight: "600" },
  time: { color: colors.muted, fontSize: 12, marginLeft: 8 },
  pressed: { backgroundColor: colors.selection },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 6, paddingTop: 80 },
  emptyTitle: { color: colors.content, fontSize: 17, fontWeight: "600" },
  emptyText: { color: colors.muted, fontSize: 14, textAlign: "center" },
}));

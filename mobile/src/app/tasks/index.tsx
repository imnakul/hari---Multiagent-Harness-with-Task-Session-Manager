import * as Haptics from "expo-haptics";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { useConnection } from "@/features/connection/ConnectionProvider";
import { SettingsPage } from "@/features/settings/SettingsUI";
import {
  createTask,
  groupTasks,
  inFocusOn,
  listTasks,
  localDay,
  onToolsChanged,
  parseTags,
  projectLabel,
  statusLabel,
  TASK_STATUSES,
  taskProjectKey,
  updateTask,
  type Command,
  type TaskGrouping,
  type TaskItem,
  type TaskStatus,
} from "@/features/tools/tools";
import { Icon } from "@/ui/Icon";
import { radii, themedStyles, useColors, withAlpha } from "@/ui/theme";

// Fork (Hari, L-236, L-241): the desktop's Tasks on the phone. Grouped by
// status or project, narrowed to today's Focus or one project;
// the circle completes a task, a tap on it shows its status to change, and the
// box on top adds one with a project and tags. Changes save on the desktop at
// once, and its Tasks screen follows.
export default function TasksScreen() {
  const styles = useStyles();
  const colors = useColors();
  const { command, catalog } = useConnection();
  const run = command as Command;
  const projects = catalog.projects;
  const [tasks, setTasks] = useState<TaskItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);

  const load = useCallback(async () => {
    try {
      setTasks(await listTasks(run));
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }, [run]);
  useEffect(() => {
    let live = true;
    const fetch = () =>
      listTasks(run).then(
        (items) => {
          if (!live) return;
          setTasks(items);
          setError(null);
        },
        (reason) => live && setError(reason instanceof Error ? reason.message : String(reason)),
      );
    void fetch();
    const stop = onToolsChanged((changed) => changed === "tasks" && void fetch());
    return () => {
      live = false;
      stop();
    };
  }, [run]);

  const change = async (task: TaskItem, status: TaskStatus) => {
    if (task.status === status) return;
    void Haptics.selectionAsync();
    // Shown at once; put back if the desktop refuses it.
    setTasks((all) => all?.map((each) => (each.id === task.id ? { ...each, status } : each)) ?? all);
    try {
      await updateTask(run, task.id, { status });
    } catch (reason) {
      setTasks((all) => all?.map((each) => (each.id === task.id ? task : each)) ?? all);
      Alert.alert("Couldn’t change the task", reason instanceof Error ? reason.message : String(reason));
    }
  };

  // Fork (Hari, L-241): Focus shows the desktop's Focus for today; the project
  // row narrows to one project; groups follow status (default) or project.
  const [focus, setFocus] = useState(false);
  const [grouping, setGrouping] = useState<TaskGrouping>("status");
  const [pickedProject, setProjectFilter] = useState<string | null>(null);

  // Projects that have live tasks, by name, then "No project".
  const taskProjects = useMemo(() => {
    const seen = new Map<string, string>();
    for (const task of tasks ?? []) {
      if (task.archived) continue;
      const key = taskProjectKey(task);
      if (!seen.has(key)) seen.set(key, projectLabel(task.projectCwd, projects) ?? "No project");
    }
    return [...seen.entries()]
      .map(([key, label]) => ({ key, label }))
      .sort((a, b) => (!a.key ? 1 : !b.key ? -1 : a.label.localeCompare(b.label)));
  }, [tasks, projects]);
  // A pick for a project whose last task went away reads as "All projects".
  const projectFilter =
    pickedProject !== null && taskProjects.some((each) => each.key === pickedProject)
      ? pickedProject
      : null;

  const visible = useMemo(() => {
    const today = localDay();
    return (tasks ?? []).filter(
      (task) =>
        !task.archived &&
        (!focus || inFocusOn(task, today)) &&
        (projectFilter === null || taskProjectKey(task) === projectFilter),
    );
  }, [tasks, focus, projectFilter]);

  const doneCount = visible.filter((task) => task.status === "completed").length;
  const groups = useMemo(
    () =>
      groupTasks(
        visible.filter((task) => showDone || task.status !== "completed"),
        projects,
        grouping,
      ),
    [visible, projects, showDone, grouping],
  );
  const narrowed = focus || projectFilter !== null;
  const emptyText = doneCount
    ? "Everything here is done."
    : focus
      ? "Nothing in Focus today."
      : narrowed
        ? "No tasks for this project."
        : "No tasks yet.";

  return (
    <SettingsPage
      refreshing={refreshing}
      onRefresh={() => {
        setRefreshing(true);
        void load().finally(() => setRefreshing(false));
      }}
    >
      <QuickAdd command={run} projects={projects} />
      {tasks?.length ? (
        <View style={styles.filters}>
          <View style={styles.filterRow}>
            <Pressable
              accessibilityRole="switch"
              accessibilityState={{ checked: focus }}
              accessibilityLabel="Focus: today's tasks only"
              onPress={() => {
                void Haptics.selectionAsync();
                setFocus((on) => !on);
              }}
              style={({ pressed }) => [
                styles.chip,
                styles.focusChip,
                focus && styles.chipOn,
                pressed && styles.pressed,
              ]}
            >
              <Icon name="sun" size={15} color={focus ? "#ffffff" : colors.muted} />
              <Text style={[styles.chipText, focus && styles.chipTextOn]}>Focus</Text>
            </Pressable>
            <View style={styles.segment} accessibilityRole="radiogroup" accessibilityLabel="Group by">
              {(["status", "project"] as const).map((value) => (
                <Pressable
                  key={value}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: grouping === value }}
                  onPress={() => setGrouping(value)}
                  style={[styles.segmentItem, grouping === value && styles.segmentItemOn]}
                >
                  <Text style={[styles.segmentText, grouping === value && styles.segmentTextOn]}>
                    {value === "status" ? "Status" : "Project"}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
          {taskProjects.length > 1 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.filterChips}
            >
              <Chip label="All projects" on={projectFilter === null} onPress={() => setProjectFilter(null)} />
              {taskProjects.map((each) => (
                <Chip
                  key={each.key || "none"}
                  label={each.label}
                  on={projectFilter === each.key}
                  onPress={() => setProjectFilter((current) => (current === each.key ? null : each.key))}
                />
              ))}
            </ScrollView>
          ) : null}
        </View>
      ) : null}
      {tasks === null && !error ? (
        <ActivityIndicator style={styles.loading} color={colors.muted} />
      ) : null}
      {error ? <Text style={styles.empty}>{error}</Text> : null}
      {tasks !== null && !groups.length ? <Text style={styles.empty}>{emptyText}</Text> : null}
      {groups.map((group) => (
        <View key={group.key}>
          <Text style={styles.heading}>{group.label}</Text>
          <View style={styles.card}>
            {group.tasks.map((task, index) => (
              <View key={task.id}>
                {index > 0 ? <View style={styles.divider} /> : null}
                <TaskRow
                  task={task}
                  open={open === task.id}
                  onToggle={() => setOpen((current) => (current === task.id ? null : task.id))}
                  onChange={(status) => void change(task, status)}
                />
              </View>
            ))}
          </View>
        </View>
      ))}
      {doneCount ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => setShowDone((shown) => !shown)}
          style={styles.showDone}
        >
          <Text style={styles.showDoneText}>
            {showDone ? "Hide completed" : `Show completed (${doneCount})`}
          </Text>
        </Pressable>
      ) : null}
    </SettingsPage>
  );
}

function TaskRow({
  task,
  open,
  onToggle,
  onChange,
}: {
  task: TaskItem;
  open: boolean;
  onToggle: () => void;
  onChange: (status: TaskStatus) => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  const done = task.status === "completed";
  return (
    <View>
      <View style={styles.row}>
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: done }}
          accessibilityLabel={done ? "Mark as not done" : "Complete"}
          hitSlop={10}
          onPress={() => onChange(done ? "todo" : "completed")}
          style={styles.tick}
        >
          <Icon
            name={done ? "circleDone" : "circle"}
            size={20}
            color={done ? colors.accent : colors.muted}
          />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityHint="Shows its status to change"
          onPress={onToggle}
          style={styles.rowText}
        >
          <Text style={[styles.title, done && styles.titleDone]} numberOfLines={2}>
            {task.title}
          </Text>
          <View style={styles.meta}>
            {task.status !== "todo" && !done ? (
              <Text style={[styles.status, { color: statusColor(task.status, colors) }]}>
                {statusLabel(task.status)}
              </Text>
            ) : null}
            {task.tags.length ? (
              <Text style={styles.tags} numberOfLines={1}>
                {task.tags.map((tag) => `#${tag}`).join(" ")}
              </Text>
            ) : null}
          </View>
        </Pressable>
      </View>
      {open ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {TASK_STATUSES.map((status) => (
            <Chip
              key={status.value}
              label={status.label}
              on={task.status === status.value}
              onPress={() => onChange(status.value)}
            />
          ))}
        </ScrollView>
      ) : null}
    </View>
  );
}

function statusColor(status: TaskStatus, colors: ReturnType<typeof useColors>) {
  if (status === "blocked") return colors.deletions;
  if (status === "review") return colors.caution;
  if (status === "in_progress") return colors.accent;
  return colors.muted;
}

/** The box that adds a task: its title, then a project and tags once typing. */
function QuickAdd({ command, projects }: { command: Command; projects: { name: string; path: string }[] }) {
  const styles = useStyles();
  const colors = useColors();
  const [title, setTitle] = useState("");
  const [tags, setTags] = useState("");
  const [project, setProject] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const ready = title.trim().length > 0 && !adding;
  const add = async () => {
    if (!ready) return;
    setAdding(true);
    try {
      await createTask(command, { title: title.trim(), tags: parseTags(tags), projectCwd: project });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setTitle("");
      setTags("");
    } catch (reason) {
      Alert.alert("Couldn’t add the task", reason instanceof Error ? reason.message : String(reason));
    } finally {
      setAdding(false);
    }
  };
  return (
    <View style={[styles.card, styles.addCard]}>
      <View style={styles.addRow}>
        <Icon name="add" size={20} color={colors.muted} />
        <TextInput
          value={title}
          onChangeText={setTitle}
          placeholder="Add a task"
          placeholderTextColor={colors.faint}
          style={styles.addInput}
          returnKeyType="done"
          onSubmitEditing={() => void add()}
          submitBehavior="blurAndSubmit"
          maxLength={200}
        />
        {title.trim() ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add task"
            disabled={!ready}
            onPress={() => void add()}
            style={[styles.addButton, { backgroundColor: colors.accent }]}
          >
            {adding ? (
              <ActivityIndicator size="small" color="#ffffff" />
            ) : (
              <Text style={styles.addButtonText}>Add</Text>
            )}
          </Pressable>
        ) : null}
      </View>
      {title.trim() ? (
        <>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.chips}
          >
            <Chip label="No project" on={project === null} onPress={() => setProject(null)} />
            {projects.map((each) => (
              <Chip
                key={each.path}
                label={each.name}
                on={project === each.path}
                onPress={() => setProject(each.path)}
              />
            ))}
          </ScrollView>
          <TextInput
            value={tags}
            onChangeText={setTags}
            placeholder="Tags, e.g. bug, ui"
            placeholderTextColor={colors.faint}
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.tagsInput}
          />
        </>
      ) : null}
    </View>
  );
}

function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  const styles = useStyles();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      onPress={onPress}
      style={[styles.chip, on && styles.chipOn]}
    >
      <Text style={[styles.chipText, on && styles.chipTextOn]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const useStyles = themedStyles((colors) => ({
  loading: { marginTop: 32 },
  empty: { color: colors.muted, fontSize: 15, textAlign: "center", marginTop: 32 },
  heading: { color: colors.muted, fontSize: 15, marginTop: 24, marginBottom: 8, marginLeft: 16 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderCurve: "continuous",
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  addCard: { paddingVertical: 8, gap: 4 },
  divider: { height: StyleSheet.hairlineWidth, marginLeft: 40, backgroundColor: colors.stroke },
  row: { flexDirection: "row", alignItems: "flex-start", paddingVertical: 10 },
  tick: { width: 30, paddingTop: 1, alignItems: "flex-start", paddingLeft: 2 },
  rowText: { flex: 1, minWidth: 0, gap: 3 },
  title: { color: colors.content, fontSize: 16, lineHeight: 21 },
  titleDone: { color: colors.muted, textDecorationLine: "line-through" },
  meta: { flexDirection: "row", alignItems: "center", gap: 8 },
  status: { fontSize: 13, fontWeight: "600" },
  tags: { flexShrink: 1, color: colors.muted, fontSize: 13 },
  chips: { gap: 6, paddingLeft: 30, paddingBottom: 10, paddingRight: 4 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radii.pill,
    backgroundColor: withAlpha(colors.content, 0.06),
    maxWidth: 200,
  },
  chipOn: { backgroundColor: colors.accent },
  chipText: { color: colors.content, fontSize: 14 },
  chipTextOn: { color: "#ffffff", fontWeight: "600" },
  addRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingLeft: 2 },
  addInput: { flex: 1, color: colors.content, fontSize: 16, paddingVertical: 8 },
  addButton: {
    minWidth: 56,
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: radii.pill,
  },
  addButtonText: { color: "#ffffff", fontSize: 15, fontWeight: "600" },
  tagsInput: {
    color: colors.content,
    fontSize: 15,
    paddingVertical: 8,
    paddingLeft: 30,
  },
  filters: { marginTop: 14, gap: 10 },
  filterRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  focusChip: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 36 },
  pressed: { opacity: 0.7, transform: [{ scale: 0.96 }] },
  segment: {
    flexDirection: "row",
    padding: 2,
    borderRadius: radii.pill,
    backgroundColor: withAlpha(colors.content, 0.06),
  },
  segmentItem: { minHeight: 32, justifyContent: "center", paddingHorizontal: 12, borderRadius: radii.pill },
  segmentItemOn: { backgroundColor: colors.surface },
  segmentText: { color: colors.muted, fontSize: 14 },
  segmentTextOn: { color: colors.content, fontWeight: "600" },
  filterChips: { gap: 6, paddingRight: 4 },
  showDone: { alignSelf: "center", marginTop: 20, padding: 8 },
  showDoneText: { color: colors.accent, fontSize: 15 },
}));

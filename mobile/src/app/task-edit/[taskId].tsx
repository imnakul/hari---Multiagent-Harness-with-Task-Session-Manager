import { router, Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Pressable, Text, TextInput, View } from "react-native";

import { useConnection } from "@/features/connection/ConnectionProvider";
import { HeaderButton } from "@/features/files/codeScreen";
import { Markdown } from "@/features/sessions/Markdown";
import { SettingsPage } from "@/features/settings/SettingsUI";
import { ProjectMenu, StatusMenu } from "@/features/tools/TaskMenus";
import { SubtaskTree, subtaskProgress } from "@/features/tools/SubtaskTree";
import {
  readTask,
  taskChanges,
  taskFields,
  updateTask,
  type Command,
  type TaskFields as Fields,
} from "@/features/tools/tools";
import { radii, themedStyles, useColors, withAlpha } from "@/ui/theme";

// Fork (Hari, L-327): a task's full editor, as the desktop's: title, status,
// project, tags and a Markdown body (lists, checkboxes and all), written or
// previewed. Closing the sheet saves what changed; Done saves and closes.
export default function TaskEditScreen() {
  const styles = useStyles();
  const colors = useColors();
  const { taskId } = useLocalSearchParams<{ taskId: string }>();
  const { command, catalog } = useConnection();
  const run = command as Command;
  const [fields, setFields] = useState<Fields | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  const loaded = useRef<Fields | null>(null);
  const latest = useRef<Fields | null>(null);

  useEffect(() => {
    let live = true;
    readTask(run, taskId).then(
      (task) => {
        if (!live) return;
        loaded.current = taskFields(task);
        latest.current = loaded.current;
        setFields(loaded.current);
        // A task with a body opens on how it reads; an empty one to write.
        setPreview(task.body.trim().length > 0);
      },
      (reason) => live && setError(reason instanceof Error ? reason.message : String(reason)),
    );
    return () => {
      live = false;
    };
  }, [run, taskId]);

  // Leaving (Done, Close, a tap above the sheet or Back) saves what changed.
  useEffect(
    () => () => {
      const before = loaded.current;
      const after = latest.current;
      if (!before || !after) return;
      const changes = taskChanges(before, after);
      if (!Object.keys(changes).length) return;
      updateTask(run, taskId, changes).catch((reason) =>
        Alert.alert("Couldn’t save the task", reason instanceof Error ? reason.message : String(reason)),
      );
    },
    [run, taskId],
  );

  const edit = (change: Partial<Fields>) => {
    if (!latest.current) return;
    latest.current = { ...latest.current, ...change };
    setFields(latest.current);
  };

  return (
    <>
      <Stack.Screen
        options={{
          headerRight: () =>
            fields ? <HeaderButton icon="check" label="Done" round onPress={() => router.back()} /> : null,
        }}
      />
      <SettingsPage>
        {error ? <Text style={styles.empty}>{error}</Text> : null}
        {!fields && !error ? <ActivityIndicator style={styles.loading} color={colors.muted} /> : null}
        {fields ? (
          <View style={styles.form}>
            <TextInput
              value={fields.title}
              onChangeText={(title) => edit({ title })}
              placeholder="Title"
              placeholderTextColor={colors.faint}
              style={styles.titleInput}
              maxLength={200}
              multiline
              scrollEnabled={false}
            />
            <View style={styles.pickers}>
              <StatusMenu status={fields.status} onChange={(status) => edit({ status })} />
              <ProjectMenu
                value={fields.projectCwd}
                projects={catalog.projects}
                onChange={(projectCwd) => edit({ projectCwd })}
              />
            </View>
            <TextInput
              value={fields.tags}
              onChangeText={(tags) => edit({ tags })}
              placeholder="Tags, e.g. bug, ui"
              placeholderTextColor={colors.faint}
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.tagsInput}
            />
            <Text style={styles.stepsHeading}>
              Subtasks
              {fields.subtasks.length
                ? `  ${subtaskProgress(fields.subtasks).done}/${fields.subtasks.length}`
                : ""}
            </Text>
            <SubtaskTree subtasks={fields.subtasks} onChange={(subtasks) => edit({ subtasks })} editable />
            <View style={styles.segment} accessibilityRole="radiogroup" accessibilityLabel="Body">
              {([false, true] as const).map((value) => (
                <Pressable
                  key={String(value)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: preview === value }}
                  onPress={() => setPreview(value)}
                  style={[styles.segmentItem, preview === value && styles.segmentItemOn]}
                >
                  <Text style={[styles.segmentText, preview === value && styles.segmentTextOn]}>
                    {value ? "Preview" : "Write"}
                  </Text>
                </Pressable>
              ))}
            </View>
            {preview ? (
              <Pressable onPress={() => setPreview(false)} style={styles.read}>
                {fields.body.trim() ? (
                  <Markdown text={fields.body} />
                ) : (
                  <Text style={styles.placeholder}>No details yet. Tap to write.</Text>
                )}
              </Pressable>
            ) : (
              <TextInput
                value={fields.body}
                onChangeText={(body) => edit({ body })}
                placeholder={"Details in Markdown, e.g.\n- [ ] First step\n- [ ] Second step"}
                placeholderTextColor={colors.faint}
                multiline
                scrollEnabled={false}
                textAlignVertical="top"
                style={styles.bodyInput}
              />
            )}
          </View>
        ) : null}
      </SettingsPage>
    </>
  );
}

const useStyles = themedStyles((colors) => ({
  loading: { marginTop: 32 },
  empty: { color: colors.muted, fontSize: 15, textAlign: "center", marginTop: 32 },
  form: { gap: 8, paddingHorizontal: 4 },
  titleInput: { color: colors.content, fontSize: 24, fontWeight: "700", paddingVertical: 6 },
  pickers: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tagsInput: { color: colors.muted, fontSize: 15, paddingVertical: 6 },
  stepsHeading: { color: colors.muted, fontSize: 13, fontWeight: "600", marginTop: 6 },
  segment: {
    alignSelf: "flex-start",
    flexDirection: "row",
    padding: 2,
    marginTop: 4,
    borderRadius: radii.pill,
    backgroundColor: withAlpha(colors.content, 0.06),
  },
  segmentItem: { minHeight: 32, justifyContent: "center", paddingHorizontal: 12, borderRadius: radii.pill },
  segmentItemOn: { backgroundColor: colors.surface },
  segmentText: { color: colors.muted, fontSize: 14 },
  segmentTextOn: { color: colors.content, fontWeight: "600" },
  bodyInput: { color: colors.content, fontSize: 16, lineHeight: 23, minHeight: 240, paddingVertical: 8 },
  read: { minHeight: 240, paddingVertical: 8 },
  placeholder: { color: colors.faint, fontSize: 16 },
}));

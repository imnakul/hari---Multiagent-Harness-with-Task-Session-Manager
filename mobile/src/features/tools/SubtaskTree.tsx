import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import Animated, { FadeInUp, FadeOutUp, LinearTransition } from "react-native-reanimated";

import * as Haptics from "@/ui/haptics";
import { Icon } from "@/ui/Icon";
import { themedStyles, useColors, withAlpha } from "@/ui/theme";

import { newId, statusLabel, type Subtask } from "./tools";

// Fork (L-373): a task's steps as a tree under it, as on the desktop: one rail
// down from the task, an elbow into each step, a rounded corner into the last.
// Steps slide in and out; what sits below moves with them.

const SUBTASKS_MAX = 100;
const RAIL = 12;
const ROW = 40;

export function subtaskProgress(subtasks: readonly Subtask[] | undefined) {
  const list = subtasks ?? [];
  return { done: list.filter((step) => step.status === "completed").length, total: list.length };
}

/** "2/5" with a chevron that opens a task's steps; nothing when it has none. */
export function SubtaskToggle({
  subtasks,
  open,
  onToggle,
}: {
  subtasks: readonly Subtask[] | undefined;
  open: boolean;
  onToggle: () => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  const { done, total } = subtaskProgress(subtasks);
  if (!total) return null;
  const tint = done === total ? colors.accent : colors.muted;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      accessibilityLabel={`${done} of ${total} subtasks done`}
      accessibilityHint={open ? "Hides the subtasks" : "Shows the subtasks"}
      hitSlop={10}
      onPress={onToggle}
      style={({ pressed }) => [styles.toggle, pressed && styles.pressed]}
    >
      <Text style={[styles.toggleText, { color: tint }]}>
        {done}/{total}
      </Text>
      <View style={{ transform: [{ rotate: open ? "180deg" : "0deg" }] }}>
        <Icon name="chevronDown" size={12} color={tint} />
      </View>
    </Pressable>
  );
}

/**
 * The steps. With `onChange` they can be ticked; with `editable` also added,
 * renamed and removed (the task's edit sheet).
 */
export function SubtaskTree({
  subtasks,
  onChange,
  editable = false,
}: {
  subtasks: readonly Subtask[];
  onChange?: (next: Subtask[]) => void;
  editable?: boolean;
}) {
  const styles = useStyles();
  const colors = useColors();
  const [draft, setDraft] = useState("");
  const full = subtasks.length >= SUBTASKS_MAX;
  const add = () => {
    const title = draft.trim();
    if (!title || !onChange || full) return;
    onChange([...subtasks, { id: newId(), title: title.slice(0, 200), status: "todo" }]);
    setDraft("");
  };
  const tick = (id: string) => {
    if (!onChange) return;
    void Haptics.selectionAsync();
    onChange(
      subtasks.map((step) =>
        step.id === id ? { ...step, status: step.status === "completed" ? "todo" : "completed" } : step,
      ),
    );
  };
  const rows: (Subtask | null)[] = editable && onChange ? [...subtasks, null] : [...subtasks];
  return (
    <View accessibilityLabel="Subtasks">
      {rows.map((step, index) => {
        const last = index === rows.length - 1;
        const done = step?.status === "completed";
        return (
          <Animated.View
            key={step?.id ?? "add"}
            entering={FadeInUp.duration(200)}
            exiting={FadeOutUp.duration(150)}
            layout={LinearTransition.duration(200)}
            style={styles.item}
          >
            {last ? (
              <View pointerEvents="none" style={[styles.corner, { borderColor: colors.stroke }]} />
            ) : (
              <>
                <View pointerEvents="none" style={[styles.rail, { backgroundColor: colors.stroke }]} />
                <View pointerEvents="none" style={[styles.elbow, { backgroundColor: colors.stroke }]} />
              </>
            )}
            {step ? (
              <View style={styles.row}>
                <Pressable
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: done, disabled: !onChange }}
                  accessibilityLabel={step.title}
                  disabled={!onChange}
                  hitSlop={8}
                  onPress={() => tick(step.id)}
                  style={({ pressed }) => [styles.tick, pressed && styles.pressed]}
                >
                  <Icon name={done ? "circleDone" : "circle"} size={18} color={done ? colors.accent : colors.muted} />
                </Pressable>
                {editable && onChange ? (
                  <TextInput
                    defaultValue={step.title}
                    onEndEditing={(event) => {
                      const title = event.nativeEvent.text.trim();
                      if (title && title !== step.title)
                        onChange(subtasks.map((each) => (each.id === step.id ? { ...each, title } : each)));
                    }}
                    accessibilityLabel="Subtask title"
                    maxLength={200}
                    style={[styles.title, styles.input, done && styles.titleDone]}
                  />
                ) : (
                  <Text style={[styles.title, done && styles.titleDone]} numberOfLines={2}>
                    {step.title}
                  </Text>
                )}
                {step.status !== "todo" && !done ? (
                  <Text style={styles.status}>{statusLabel(step.status)}</Text>
                ) : null}
                {editable && onChange ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Delete ${step.title}`}
                    hitSlop={8}
                    onPress={() => onChange(subtasks.filter((each) => each.id !== step.id))}
                    style={({ pressed }) => [styles.remove, pressed && styles.pressed]}
                  >
                    <Icon name="close" size={14} color={colors.muted} />
                  </Pressable>
                ) : null}
              </View>
            ) : (
              <View style={styles.row}>
                <View style={styles.tick}>
                  <Icon name="add" size={18} color={colors.faint} />
                </View>
                <TextInput
                  value={draft}
                  onChangeText={setDraft}
                  editable={!full}
                  placeholder={full ? `Up to ${SUBTASKS_MAX} subtasks` : "Add subtask"}
                  placeholderTextColor={colors.faint}
                  accessibilityLabel="Add subtask"
                  returnKeyType="done"
                  submitBehavior="submit"
                  onSubmitEditing={add}
                  onBlur={add}
                  maxLength={200}
                  style={[styles.title, styles.input]}
                />
              </View>
            )}
          </Animated.View>
        );
      })}
    </View>
  );
}

const useStyles = themedStyles((colors) => ({
  toggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: withAlpha(colors.content, 0.06),
  },
  toggleText: { fontSize: 12, fontWeight: "600", fontVariant: ["tabular-nums"] },
  pressed: { opacity: 0.7, transform: [{ scale: 0.96 }] },
  item: { paddingLeft: RAIL + 8, minHeight: ROW, justifyContent: "center" },
  rail: { position: "absolute", left: 0, top: 0, bottom: 0, width: 1 },
  elbow: { position: "absolute", left: 0, top: ROW / 2, width: RAIL, height: 1 },
  corner: {
    position: "absolute",
    left: 0,
    top: 0,
    width: RAIL,
    height: ROW / 2,
    borderLeftWidth: 1,
    borderBottomWidth: 1,
    borderBottomLeftRadius: 8,
  },
  row: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: ROW },
  tick: { width: 24, height: 24, alignItems: "center", justifyContent: "center" },
  title: { flex: 1, minWidth: 0, color: colors.content, fontSize: 15 },
  input: { paddingVertical: 6 },
  titleDone: { color: colors.muted, textDecorationLine: "line-through" },
  status: { color: colors.muted, fontSize: 12, fontWeight: "600" },
  remove: { width: 28, height: 28, alignItems: "center", justifyContent: "center" },
}));

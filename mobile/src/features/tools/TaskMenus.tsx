import { Text, type StyleProp, type ViewStyle } from "react-native";

import { ChoiceMenu } from "@/ui/ChoiceMenu";
import { Icon } from "@/ui/Icon";
import { radii, themedStyles, useColors, withAlpha } from "@/ui/theme";

import { statusLabel, TASK_STATUSES, type TaskStatus } from "./tools";

type Project = { name: string; path: string };

// Fork (Hari, L-327): Tasks' status and project pickers, as one pill each that
// opens ChoiceMenu's sheet (the Sound output picker's pattern), in place of a
// row of pills that ran off the screen.

/** The task's status, as a pill that opens the list of statuses. */
export function StatusMenu({
  status,
  onChange,
  style,
}: {
  status: TaskStatus;
  onChange: (status: TaskStatus) => void;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <MenuPill
      label={`Status, ${statusLabel(status)}`}
      title="Status"
      value={statusLabel(status)}
      style={style}
      actions={TASK_STATUSES.map((each) => ({
        label: each.label,
        selected: each.value === status,
        onPress: () => onChange(each.value),
      }))}
    />
  );
}

/**
 * A project, or none; `all` adds "All projects" (as null) for a filter, and
 * `keys` limits the list to those projects ("" is No project).
 */
export function ProjectMenu({
  value,
  projects,
  onChange,
  all,
  keys,
  style,
}: {
  value: string | null;
  projects: Project[];
  onChange: (path: string | null) => void;
  all?: boolean;
  keys?: { key: string; label: string }[];
  style?: StyleProp<ViewStyle>;
}) {
  const choices = keys ?? [
    { key: "", label: "No project" },
    ...projects.map((each) => ({ key: each.path, label: each.name })),
  ];
  const current = all && value === null ? null : (value ?? "");
  const shown =
    current === null
      ? "All projects"
      : (choices.find((each) => each.key === current)?.label ??
        // A project the phone's list doesn't have: its folder's name.
        current.split(/[\\/]/).filter(Boolean).pop() ??
        "No project");
  return (
    <MenuPill
      label={`Project, ${shown}`}
      title="Project"
      value={shown}
      style={style}
      actions={[
        ...(all
          ? [{ label: "All projects", selected: current === null, onPress: () => onChange(null) }]
          : []),
        ...choices.map((each) => ({
          label: each.label,
          selected: current === each.key,
          // A filter keeps "" for No project; a task's project is null.
          onPress: () => onChange(all ? each.key : each.key || null),
        })),
      ]}
    />
  );
}

function MenuPill({
  label,
  title,
  value,
  actions,
  style,
}: {
  label: string;
  title: string;
  value: string;
  actions: { label: string; selected: boolean; onPress: () => void }[];
  style?: StyleProp<ViewStyle>;
}) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <ChoiceMenu label={label} title={title} actions={actions} style={[styles.pill, style]}>
      <Text style={styles.text} numberOfLines={1}>
        {value}
      </Text>
      <Icon name="chevronUpDown" size={14} color={colors.muted} />
    </ChoiceMenu>
  );
}

const useStyles = themedStyles((colors) => ({
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: 32,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radii.pill,
    backgroundColor: withAlpha(colors.content, 0.06),
    maxWidth: 220,
  },
  text: { flexShrink: 1, color: colors.content, fontSize: 14 },
}));

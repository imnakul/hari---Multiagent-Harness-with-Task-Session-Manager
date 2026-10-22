import { fuzzyMatch } from "../../shared/lib/fuzzy";
import { filterTasks, taskWorkPrompt, type Task } from "./tasks";

/** The character that opens the task picker in a composer (L-180). */
export const TASK_TRIGGER = "#";

/** Where a picker row comes from: the composer's project, or Personal. */
export type TaskPickerGroup = "project" | "personal";

export type TaskPickerRow = { task: Task; group: TaskPickerGroup };

export const TASK_PICKER_GROUP_LABELS: Record<TaskPickerGroup, string> = {
  project: "This project",
  personal: "Personal",
};

/**
 * Todo tasks a composer in `cwd` may insert: the project's own, then
 * Personal ones (no project). Other projects' tasks never show. Each group
 * keeps the most recently updated first.
 */
export function pickerTasks(
  tasks: readonly Task[],
  cwd: string | null | undefined,
): TaskPickerRow[] {
  const todo = filterTasks(tasks, {
    statuses: ["todo"],
    projectCwds: cwd ? [cwd, null] : [null],
    archived: false,
  });
  const project: TaskPickerRow[] = [];
  const personal: TaskPickerRow[] = [];
  for (const task of todo) {
    if (task.projectCwd) project.push({ task, group: "project" });
    else personal.push({ task, group: "personal" });
  }
  return [...project, ...personal];
}

/**
 * Picker rows matching `query`, still grouped (project, then Personal) so
 * the list can show its group labels. Inside a group: title prefix, title
 * substring, fuzzy title, then description or tag text.
 */
export function rankPickerTasks(
  tasks: readonly Task[],
  query: string,
  cwd: string | null | undefined,
  limit = 8,
): TaskPickerRow[] {
  const rows = pickerTasks(tasks, cwd);
  const needle = query.trim().toLowerCase();
  if (!needle) return rows.slice(0, limit);
  const scored: { row: TaskPickerRow; score: number; index: number }[] = [];
  rows.forEach((row, index) => {
    const title = row.task.title.toLowerCase();
    let score: number | null = null;
    if (title.startsWith(needle)) score = 3;
    else if (title.includes(needle)) score = 2;
    else if (fuzzyMatch(needle, title)) score = 1;
    else if (
      [row.task.body, ...row.task.tags]
        .join("\n")
        .toLowerCase()
        .includes(needle)
    )
      score = 0.5;
    if (score !== null) scored.push({ row, score, index });
  });
  const groupOrder = (group: TaskPickerGroup): number =>
    group === "project" ? 0 : 1;
  return scored
    .sort(
      (a, b) =>
        groupOrder(a.row.group) - groupOrder(b.row.group) ||
        b.score - a.score ||
        a.index - b.index,
    )
    .slice(0, limit)
    .map((entry) => entry.row);
}

/** What picking a task inserts: the same text as Work on… (title, tags, body). */
export function taskPickerText(
  task: Pick<Task, "title" | "body" | "tags">,
): string {
  return taskWorkPrompt(task);
}

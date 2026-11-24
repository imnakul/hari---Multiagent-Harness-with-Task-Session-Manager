import type { TaskViewId } from "../../tasks/taskViewState";
import type { ClickupStatus, ClickupTask } from "./clickupApi";

/**
 * Fork (L-381): how the ClickUp page shows tasks: List, Table or Board, the
 * grouping, the sort, and which groups are folded. One setting for every
 * list, kept in this device's storage.
 */

export const CLICKUP_GROUP_BYS = ["status", "assignee", "priority", "list", "none"] as const;
export type ClickupGroupBy = (typeof CLICKUP_GROUP_BYS)[number];
export const CLICKUP_GROUP_LABELS: Record<ClickupGroupBy, string> = {
  status: "Group by status",
  assignee: "Group by assignee",
  priority: "Group by priority",
  list: "Group by list",
  none: "No grouping",
};

/** The sort fields ClickUp offers for a list, minus time tracking and custom fields. */
export const CLICKUP_SORT_FIELDS = [
  "status",
  "name",
  "assignee",
  "priority",
  "dueDate",
  "startDate",
  "dateCreated",
  "dateUpdated",
  "dateClosed",
] as const;
export type ClickupSortField = (typeof CLICKUP_SORT_FIELDS)[number];
export const CLICKUP_SORT_LABELS: Record<ClickupSortField, string> = {
  status: "Status",
  name: "Task name",
  assignee: "Assignee",
  priority: "Priority",
  dueDate: "Due date",
  startDate: "Start date",
  dateCreated: "Date created",
  dateUpdated: "Date updated",
  dateClosed: "Date closed",
};
export type ClickupSort = { field: ClickupSortField; dir: "asc" | "desc" };

export interface ClickupViewState {
  view: TaskViewId;
  groupBy: ClickupGroupBy;
  sort: ClickupSort;
  /** Folded group keys in List and Table. */
  collapsed: string[];
  /** Show only tasks assigned to the connected ClickUp user. */
  mine: boolean;
  /**
   * Board column shares by group key (1 = an average column). The board always
   * fits the pane; dragging a divider moves width between two neighbours.
   */
  boardColumnWeights: Record<string, number>;
  /**
   * Fork (L-387): status names to hide (lowercase). Empty shows every status;
   * the Status menu starts with all ticked and unticking one hides it.
   */
  hiddenStatuses: string[];
  /** Task panel width in px, clamped to CLICKUP_PANEL_MIN..CLICKUP_PANEL_MAX. */
  panelWidth: number;
}

export const CLICKUP_PANEL_MIN = 320;
export const CLICKUP_PANEL_MAX = 1000;
export const CLICKUP_PANEL_DEFAULT = 380;

export const DEFAULT_CLICKUP_VIEW_STATE: ClickupViewState = {
  view: "list",
  groupBy: "status",
  sort: { field: "dueDate", dir: "asc" },
  collapsed: [],
  mine: false,
  boardColumnWeights: {},
  hiddenStatuses: [],
  panelWidth: CLICKUP_PANEL_DEFAULT,
};

export const CLICKUP_VIEW_KEY = "monocode.clickup.view";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isOneOf = <T extends string>(values: readonly T[], value: unknown): value is T =>
  typeof value === "string" && values.some((entry) => entry === value);

const MAX_WEIGHT_KEYS = 200;

function parseWeights(raw: unknown): Record<string, number> {
  if (!isRecord(raw)) return {};
  const weights: Record<string, number> = {};
  for (const [key, weight] of Object.entries(raw).slice(0, MAX_WEIGHT_KEYS))
    if (typeof weight === "number" && Number.isFinite(weight) && weight > 0)
      weights[key] = Math.min(10, Math.max(0.1, weight));
  return weights;
}

/** Reads stored settings, falling back field by field so one bad value doesn't reset the rest. */
export function parseClickupViewState(raw: unknown): ClickupViewState {
  const value = isRecord(raw) ? raw : {};
  const sort = isRecord(value.sort) ? value.sort : {};
  return {
    view: isOneOf(["list", "table", "board"] as const, value.view) ? value.view : DEFAULT_CLICKUP_VIEW_STATE.view,
    groupBy: isOneOf(CLICKUP_GROUP_BYS, value.groupBy) ? value.groupBy : DEFAULT_CLICKUP_VIEW_STATE.groupBy,
    sort: {
      field: isOneOf(CLICKUP_SORT_FIELDS, sort.field) ? sort.field : DEFAULT_CLICKUP_VIEW_STATE.sort.field,
      dir: sort.dir === "desc" ? "desc" : sort.dir === "asc" ? "asc" : DEFAULT_CLICKUP_VIEW_STATE.sort.dir,
    },
    collapsed: Array.isArray(value.collapsed)
      ? value.collapsed.filter((key): key is string => typeof key === "string").slice(0, 200)
      : [],
    mine: value.mine === true,
    boardColumnWeights: parseWeights(value.boardColumnWeights),
    // The older `statuses` (statuses to show) is dropped on purpose: everything shows again.
    hiddenStatuses: Array.isArray(value.hiddenStatuses)
      ? value.hiddenStatuses.filter((name): name is string => typeof name === "string").map(statusKey).slice(0, 100)
      : [],
    panelWidth:
      typeof value.panelWidth === "number" && Number.isFinite(value.panelWidth)
        ? Math.round(Math.min(CLICKUP_PANEL_MAX, Math.max(CLICKUP_PANEL_MIN, value.panelWidth)))
        : CLICKUP_PANEL_DEFAULT,
  };
}

export function loadClickupViewState(): ClickupViewState {
  try {
    const stored = window.localStorage.getItem(CLICKUP_VIEW_KEY);
    return parseClickupViewState(stored ? JSON.parse(stored) : null);
  } catch {
    return DEFAULT_CLICKUP_VIEW_STATE;
  }
}

export function saveClickupViewState(state: ClickupViewState): void {
  try {
    window.localStorage.setItem(CLICKUP_VIEW_KEY, JSON.stringify(state));
  } catch (error) {
    console.warn("Couldn't save the ClickUp view settings", error);
  }
}

/** The member's first name for the "Assignee: Nakul" button; the username when it is one word. */
export function firstName(username: string): string {
  return username.trim().split(/\s+/)[0] || username;
}

/** A board always has columns: "No grouping" shows status columns there. */
export function boardGroupBy(groupBy: ClickupGroupBy): Exclude<ClickupGroupBy, "none"> {
  return groupBy === "none" ? "status" : groupBy;
}

export const PRIORITY_INFO: Record<1 | 2 | 3 | 4, { label: string; color: string }> = {
  1: { label: "Urgent", color: "#f50000" },
  2: { label: "High", color: "#ffcc00" },
  3: { label: "Normal", color: "#6fddff" },
  4: { label: "Low", color: "#d8d8d8" },
};

export const statusKey = (name: string): string => name.trim().toLowerCase();

/** Tasks whose status is not in `hidden` (status keys). */
export function withoutHiddenStatuses<T extends { status: { status: string } }>(
  tasks: readonly T[],
  hidden: readonly string[],
): T[] {
  if (hidden.length === 0) return [...tasks];
  const skip = new Set(hidden);
  return tasks.filter((task) => !skip.has(statusKey(task.status.status)));
}

/**
 * One status order for the lists on screen: each list's statuses by
 * orderindex, in list order, first occurrence of a name wins. Statuses seen
 * only on tasks (a list whose statuses haven't loaded) come last.
 */
export function mergeStatuses(
  lists: readonly (readonly ClickupStatus[])[],
  tasks: readonly ClickupTask[] = [],
): ClickupStatus[] {
  const seen = new Map<string, ClickupStatus>();
  for (const statuses of lists) {
    for (const status of [...statuses].sort((a, b) => a.orderindex - b.orderindex)) {
      if (!seen.has(statusKey(status.status))) seen.set(statusKey(status.status), status);
    }
  }
  for (const task of tasks) {
    const key = statusKey(task.status.status);
    if (key && !seen.has(key)) seen.set(key, { ...task.status, orderindex: Number.MAX_SAFE_INTEGER });
  }
  return [...seen.values()];
}

export interface ClickupGroup {
  key: string;
  label: string;
  /** Pill or dot colour; null for groups without one (unassigned, no priority). */
  color: string | null;
  tasks: ClickupTask[];
}

export interface GroupContext {
  /** Status order from `mergeStatuses`. */
  statuses: readonly ClickupStatus[];
  lists: readonly { id: string; name: string }[];
  /**
   * Also return groups with no tasks: the board shows every status column,
   * so a task can be found where it belongs.
   */
  includeEmpty?: boolean;
  /** With `includeEmpty`, drop closed status columns (Show done is off). */
  hideClosed?: boolean;
}

/**
 * Splits sorted tasks into groups in ClickUp's order. A task with several
 * assignees shows under each of them, as in ClickUp.
 */
export function groupClickupTasks(
  tasks: readonly ClickupTask[],
  groupBy: ClickupGroupBy,
  context: GroupContext,
): ClickupGroup[] {
  const groups: ClickupGroup[] = [];
  const byKey = new Map<string, ClickupGroup>();
  const add = (key: string, label: string, color: string | null): ClickupGroup => {
    const existing = byKey.get(key);
    if (existing) return existing;
    const group = { key, label, color, tasks: [] };
    byKey.set(key, group);
    groups.push(group);
    return group;
  };

  if (groupBy === "none") return [{ key: "all", label: "All tasks", color: null, tasks: [...tasks] }];

  if (groupBy === "status") {
    for (const status of context.statuses) {
      if (context.hideClosed && status.type === "closed") continue;
      add(`status:${statusKey(status.status)}`, status.status, status.color || null);
    }
    for (const task of tasks) {
      add(`status:${statusKey(task.status.status)}`, task.status.status, task.status.color || null).tasks.push(task);
    }
  } else if (groupBy === "priority") {
    for (const level of [1, 2, 3, 4] as const) add(`priority:${level}`, PRIORITY_INFO[level].label, PRIORITY_INFO[level].color);
    add("priority:none", "No priority", null);
    for (const task of tasks) byKey.get(`priority:${task.priority ?? "none"}`)?.tasks.push(task);
  } else if (groupBy === "list") {
    for (const list of context.lists) add(`list:${list.id}`, list.name, null);
    for (const task of tasks) add(`list:${task.listId}`, task.listId, null).tasks.push(task);
  } else {
    const names = new Map<number, string>();
    for (const task of tasks) for (const member of task.assignees) names.set(member.id, member.username);
    const members = [...names].sort((a, b) => a[1].localeCompare(b[1]));
    for (const [id, name] of members) add(`assignee:${id}`, name, null);
    add("assignee:none", "Unassigned", null);
    for (const task of tasks) {
      if (task.assignees.length === 0) byKey.get("assignee:none")?.tasks.push(task);
      for (const member of task.assignees) byKey.get(`assignee:${member.id}`)?.tasks.push(task);
    }
  }
  return context.includeEmpty ? groups : groups.filter((group) => group.tasks.length > 0);
}

function sortValue(task: ClickupTask, field: ClickupSortField, statusOrder: ReadonlyMap<string, number>): string | number | null {
  switch (field) {
    case "status":
      return statusOrder.get(statusKey(task.status.status)) ?? null;
    case "name":
      return task.name.toLowerCase();
    case "assignee":
      return task.assignees[0]?.username.toLowerCase() ?? null;
    case "priority":
      return task.priority;
    case "dueDate":
      return task.dueDate;
    case "startDate":
      return task.startDate;
    case "dateCreated":
      return task.dateCreated;
    case "dateUpdated":
      return task.dateUpdated || null;
    case "dateClosed":
      return task.dateClosed;
  }
}

/**
 * Sorts by one field. Empty values go last in either direction, as in
 * ClickUp; ties fall back to the most recently updated first.
 */
export function sortClickupTasks(
  tasks: readonly ClickupTask[],
  sort: ClickupSort,
  statuses: readonly ClickupStatus[] = [],
): ClickupTask[] {
  const statusOrder = new Map(statuses.map((status, index) => [statusKey(status.status), index]));
  const sign = sort.dir === "asc" ? 1 : -1;
  return [...tasks].sort((a, b) => {
    const left = sortValue(a, sort.field, statusOrder);
    const right = sortValue(b, sort.field, statusOrder);
    if (left !== right) {
      if (left === null) return 1;
      if (right === null) return -1;
      const order = typeof left === "string" && typeof right === "string"
        ? left.localeCompare(right)
        : Number(left) - Number(right);
      if (order !== 0) return order * sign;
    }
    return b.dateUpdated - a.dateUpdated;
  });
}

/** Custom fields that have a value on any shown task, in first-seen order: the Table's extra columns. */
export function customFieldColumns(tasks: readonly ClickupTask[]): { id: string; name: string; type: string }[] {
  const seen = new Map<string, { id: string; name: string; type: string }>();
  for (const task of tasks) {
    for (const field of task.customFields) {
      if (!seen.has(field.id)) seen.set(field.id, { id: field.id, name: field.name, type: field.type });
    }
  }
  return [...seen.values()];
}

/**
 * Text colour for a status or option fill: white or near-black, whichever
 * contrasts more (WCAG), so grey "Open" and yellow "S3" get dark text.
 */
export function readableTextOn(color: string | null): string {
  const match = color?.trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!match?.[1]) return "#fff";
  const hex = match[1].length === 3 ? [...match[1]].map((c) => c + c).join("") : match[1];
  const [r, g, b] = [0, 2, 4].map((at) => parseInt(hex.slice(at, at + 2), 16) / 255);
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const luminance = 0.2126 * lin(r ?? 0) + 0.7152 * lin(g ?? 0) + 0.0722 * lin(b ?? 0);
  const DARK = 0.0103; // relative luminance of #1a1a1a
  return 1.05 / (luminance + 0.05) >= (luminance + 0.05) / (DARK + 0.05) ? "#fff" : "#1a1a1a";
}

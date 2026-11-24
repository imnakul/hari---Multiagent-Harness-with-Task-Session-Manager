import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { normalizeNoteTags, noteTitle } from "../notes/notes";
import { pathKey } from "../../shared/lib/paths";
import { normalizeSubtasks, type Subtask } from "./subtasks";

export const TASK_STATUS_LABELS = {
  todo: "Todo",
  in_progress: "Progress",
  blocked: "Blocked",
  review: "Verify",
  completed: "Completed",
} as const;
export type TaskStatus = keyof typeof TASK_STATUS_LABELS;
export const TASK_STATUSES = Object.keys(TASK_STATUS_LABELS) as TaskStatus[];
/**
 * Retired statuses still accepted from older rows and Operator prompts: Draft
 * becomes Todo, Deferred becomes an archived Todo. The database keeps
 * accepting them, so no table rebuild is needed.
 */
const LEGACY_STATUSES = { draft: "todo", deferred: "todo" } as const;
type LegacyStatus = keyof typeof LEGACY_STATUSES;
function isLegacyStatus(value: string): value is LegacyStatus {
  return value === "draft" || value === "deferred";
}
export const TASKS_CHANGED_EVENT = "monocode:tasks-changed";
/** Cross-window signal: the floating composer saves tasks in its own window. */
export const TASKS_CHANGED_TAURI_EVENT = "monocode://tasks-changed";
export type Task = {
  id: string;
  title: string;
  body: string;
  status: TaskStatus;
  tags: string[];
  projectCwd?: string;
  sourceSessionId?: string;
  sourceBlockId?: string;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  /** Local day (YYYY-MM-DD) this task is pinned to Focus. */
  focusDate?: string;
  /** Past local days the task sat in focus before moving on (R2/R3 history). */
  focusDays: string[];
  /** Archived tasks keep their status and are hidden unless shown. */
  archivedAt?: number;
  /** Manual position in a board column; lower comes first. */
  sortOrder?: number;
  /**
   * Fork (L-373): the task's steps, in order. On a write, omitted keeps the
   * stored steps; an empty list clears them.
   */
  subtasks?: Subtask[];
};
export type TaskUpsert = Omit<
  Task,
  "createdAt" | "updatedAt" | "completedAt" | "archivedAt"
> & {
  archived?: boolean;
  /** Local day of the writer, sent whenever `focusDate` changes (R2/R3). */
  today?: string;
};
export type TaskChanges = Partial<
  Omit<
    TaskUpsert,
    | "id"
    | "projectCwd"
    | "sourceSessionId"
    | "sourceBlockId"
    | "focusDate"
    | "focusDays"
    | "sortOrder"
    | "today"
  >
> & {
  projectCwd?: string | null;
  sourceSessionId?: string | null;
  sourceBlockId?: string | null;
  focusDate?: string | null;
  sortOrder?: number | null;
  /** Local day (YYYY-MM-DD) of the writer; sent with every `focusDate` change. */
  today?: string;
};
export type TaskFilters = {
  statuses?: TaskStatus[];
  tags?: string[];
  tagMatch?: "all" | "any";
  /** Omitted: all projects; null: Personal. */
  projectCwd?: string | null;
  /** Several projects (OR); null in the list means Personal. Wins over projectCwd. */
  projectCwds?: (string | null)[];
  query?: string;
  /** false/omitted: hide archived; true: only archived; "all": both. */
  archived?: boolean | "all";
  /** Keep only tasks in Focus or completed on this local day (YYYY-MM-DD). */
  day?: string;
};

/** Local calendar day, YYYY-MM-DD. Focus is about the user's day, not UTC. */
export function localDay(at: number | Date = Date.now()): string {
  const date = typeof at === "number" ? new Date(at) : at;
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Focus history entries, normalised to sorted unique `YYYY-MM-DD` days. */
export function normalizeFocusDays(days: unknown): string[] {
  if (!Array.isArray(days)) return [];
  const kept = days.filter(
    (day): day is string =>
      typeof day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(day),
  );
  return [...new Set(kept)].sort();
}

/**
 * In Focus on day D (R4): recorded in `focusDays`, pinned to D, or created
 * on D while unpinned (or pinned no later than D). A task created on the 7th
 * but planned for the 9th does not show on the 7th.
 */
export function inFocusOn(task: Pick<Task, "focusDate" | "focusDays" | "createdAt">, day: string): boolean {
  // Older rows and test fixtures may omit the history; treat it as empty.
  if ((task.focusDays ?? []).includes(day)) return true;
  if (task.focusDate === day) return true;
  if (localDay(task.createdAt) !== day) return false;
  return task.focusDate === undefined || task.focusDate <= day;
}

/** In Focus on `day`: created that day, or pinned to it. */
export function isInFocus(task: Pick<Task, "focusDate" | "focusDays" | "createdAt">, day: string): boolean {
  return inFocusOn(task, day);
}

/** Completed on day D (R5): the local day of `completedAt`. */
export function completedOn(task: Pick<Task, "completedAt">, day: string): boolean {
  return task.completedAt !== undefined && localDay(task.completedAt) === day;
}

/**
 * Earliest day the task was in focus: the first of `focusDays`, `focusDate`
 * (when not in the future) and the created day (when R4 covers it).
 */
export function firstFocusDay(
  task: Pick<Task, "focusDate" | "focusDays" | "createdAt">,
  today: string = localDay(),
): string | undefined {
  const candidates: string[] = [];
  for (const day of task.focusDays ?? []) candidates.push(day);
  if (task.focusDate !== undefined && task.focusDate <= today)
    candidates.push(task.focusDate);
  const created = localDay(task.createdAt);
  if (inFocusOn(task, created)) candidates.push(created);
  if (!candidates.length) return undefined;
  return candidates.sort()[0];
}

/** Status for user or Operator input, mapping retired names. */
export function parseTaskStatus(value: unknown): {
  status: TaskStatus;
  archive: boolean;
} {
  if (typeof value !== "string") throw new Error("Invalid task status");
  const normalized = value.trim().toLowerCase().replace(/[ -]+/g, "_");
  const aliased =
    normalized === "progress"
      ? "in_progress"
      : normalized === "done"
        ? "completed"
        : normalized;
  if (isLegacyStatus(aliased))
    return { status: LEGACY_STATUSES[aliased], archive: aliased === "deferred" };
  const status = TASK_STATUSES.find((entry) => entry === aliased);
  if (!status) throw new Error(`Invalid task status: ${value}`);
  return { status, archive: false };
}

type StoredTask = Omit<Task, "status" | "focusDays" | "subtasks"> & {
  status: TaskStatus | LegacyStatus;
  focusDays?: unknown;
  subtasks?: unknown;
};

/** A row as the UI should see it: retired statuses mapped, plus whether to rewrite it. */
export function normalizeStoredTask(raw: StoredTask): {
  task: Task;
  legacy: boolean;
} {
  const focusDays = normalizeFocusDays(raw.focusDays);
  const subtasks = normalizeSubtasks(raw.subtasks);
  if (!isLegacyStatus(raw.status))
    return { task: { ...raw, focusDays, subtasks, status: raw.status }, legacy: false };
  const deferred = raw.status === "deferred";
  return {
    task: {
      ...raw,
      focusDays,
      subtasks,
      status: LEGACY_STATUSES[raw.status],
      archivedAt: deferred ? (raw.archivedAt ?? raw.updatedAt) : raw.archivedAt,
    },
    legacy: true,
  };
}

export function taskStatus(value: unknown): TaskStatus {
  return parseTaskStatus(value).status;
}

/** UI and Operator share the same combined filter semantics. */
export function filterTasks(
  tasks: readonly Task[],
  filters: TaskFilters = {},
): Task[] {
  const query = filters.query?.trim().toLowerCase();
  const tags = normalizeNoteTags(filters.tags ?? []);
  return tasks
    .filter((task) => {
      if (filters.statuses?.length && !filters.statuses.includes(task.status))
        return false;
      if (filters.day) {
        // A day view shows everything recorded for it, including tasks
        // archived since; the archived filter does not apply here.
        if (!inFocusOn(task, filters.day) && !completedOn(task, filters.day))
          return false;
      } else {
        const archived = task.archivedAt !== undefined;
        if (filters.archived === true ? !archived : filters.archived !== "all" && archived)
          return false;
      }
      if (filters.projectCwds) {
        if (
          !filters.projectCwds.some((cwd) =>
            cwd === null
              ? !task.projectCwd
              : Boolean(task.projectCwd) &&
                pathKey(task.projectCwd ?? "") === pathKey(cwd),
          )
        )
          return false;
      } else if (filters.projectCwd === null && task.projectCwd) return false;
      if (
        !filters.projectCwds &&
        typeof filters.projectCwd === "string" &&
        (!task.projectCwd ||
          pathKey(task.projectCwd) !== pathKey(filters.projectCwd))
      )
        return false;
      const taskTags = normalizeNoteTags(task.tags);
      if (
        tags.length &&
        !(filters.tagMatch === "any"
          ? tags.some((tag) => taskTags.includes(tag))
          : tags.every((tag) => taskTags.includes(tag)))
      )
        return false;
      if (
        query &&
        ![task.title, task.body, ...task.tags, task.projectCwd ?? ""]
          .join("\n")
          .toLowerCase()
          .includes(query)
      )
        return false;
      return true;
    })
    .sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
}

function changed() {
  if (typeof window !== "undefined")
    window.dispatchEvent(new Event(TASKS_CHANGED_EVENT));
  // Other windows (the main workspace, the floating composer) refresh too.
  void Promise.resolve()
    .then(() => emit(TASKS_CHANGED_TAURI_EVENT))
    .catch(() => {});
}

/**
 * One task as Markdown: what Copy puts on the clipboard. Fork (L-390): only the
 * useful part, the title and description; status, project, dates and tags stay out.
 */
export function taskMarkdown(task: Pick<Task, "title" | "body">): string {
  const body = task.body.trim();
  return [`# ${task.title.trim()}`, ...(body ? ["", body] : [])].join("\n") + "\n";
}

/** The prompt "Work on…" prefills: the task's title, tags and description. */
export function taskWorkPrompt(task: Pick<Task, "title" | "body" | "tags">): string {
  const body = task.body.trim();
  const tags = task.tags.length
    ? `\n\nTags: ${task.tags.map((tag) => `#${tag}`).join(" ")}`
    : "";
  return `Task: ${task.title}${tags}${body ? `\n\n${body}` : ""}\n\n`;
}
let cachedTasks: Task[] | null = null;
/** Tasks from the latest successful load, so the view can paint before the next one. */
export function peekTasks(): Task[] | null {
  return cachedTasks;
}
export function invalidateTasks() {
  cachedTasks = null;
}
export async function loadTasks(): Promise<Task[]> {
  const rows = await invoke<StoredTask[]>("tasks_list");
  const tasks: Task[] = [];
  const legacy: Task[] = [];
  for (const row of rows) {
    const normalized = normalizeStoredTask(row);
    tasks.push(normalized.task);
    if (normalized.legacy) legacy.push(normalized.task);
  }
  cachedTasks = tasks;
  // Rewrite retired statuses once, in the background; the view already shows
  // the mapped values.
  for (const task of legacy) void rewriteLegacyTask(task).catch(() => {});
  return tasks;
}
async function rewriteLegacyTask(task: Task): Promise<void> {
  await serialize(task.id, () => upsertTask(taskToUpsert(task)));
}
export async function getTask(id: string): Promise<Task | null> {
  const row = await invoke<StoredTask | null>("tasks_get", { id });
  return row ? normalizeStoredTask(row).task : null;
}

/** The upsert payload that recreates a task exactly. */
export function taskToUpsert(task: Task): TaskUpsert {
  const {
    createdAt: _created,
    updatedAt: _updated,
    completedAt: _completed,
    archivedAt,
    focusDays,
    ...record
  } = task;
  return {
    ...record,
    focusDays: [...focusDays],
    archived: archivedAt !== undefined,
  };
}
export async function upsertTask(task: TaskUpsert): Promise<Task> {
  const saved = await invoke<StoredTask>("tasks_upsert", {
    task: {
      ...task,
      title: task.title.trim() || noteTitle(task.body),
      tags: normalizeNoteTags(task.tags),
    },
  });
  changed();
  return normalizeStoredTask(saved).task;
}
export async function createTask(
  input: Omit<Partial<TaskUpsert>, "id"> = {},
): Promise<Task> {
  const body = input.body ?? "";
  const { today: _today, ...rest } = input;
  return upsertTask({
    ...rest,
    id: crypto.randomUUID(),
    title: input.title?.trim() || noteTitle(body),
    body,
    status: input.status ?? "todo",
    tags: input.tags ?? [],
    focusDays: input.focusDays ?? [],
  });
}

// Serialize UI and Operator changes, and merge against the latest durable row.
const pendingWrites = new Map<string, Promise<unknown>>();
function serialize<T>(id: string, operation: () => Promise<T>): Promise<T> {
  const prior = pendingWrites.get(id) ?? Promise.resolve();
  const pending = prior
    .catch(() => {})
    .then(operation)
    .finally(() => {
      if (pendingWrites.get(id) === pending) pendingWrites.delete(id);
    });
  pendingWrites.set(id, pending);
  return pending;
}
export function updateTask(id: string, changes: TaskChanges): Promise<Task> {
  return serialize(id, async () => {
    const current = await getTask(id);
    if (!current) throw new Error("Task was not found");
    const record = taskToUpsert(current);
    return upsertTask({
      ...record,
      ...changes,
      today: changes.today ?? undefined,
      focusDate:
        changes.focusDate === null
          ? undefined
          : (changes.focusDate ?? record.focusDate),
      sortOrder:
        changes.sortOrder === null
          ? undefined
          : (changes.sortOrder ?? record.sortOrder),
      sourceSessionId:
        changes.sourceSessionId === null
          ? undefined
          : (changes.sourceSessionId ?? record.sourceSessionId),
      sourceBlockId:
        changes.sourceBlockId === null
          ? undefined
          : (changes.sourceBlockId ?? record.sourceBlockId),
      projectCwd:
        changes.projectCwd === null
          ? undefined
          : (changes.projectCwd ?? record.projectCwd),
    });
  });
}
export function deleteTask(id: string): Promise<void> {
  return serialize(id, async () => {
    await invoke("tasks_delete", { id });
    changed();
  });
}

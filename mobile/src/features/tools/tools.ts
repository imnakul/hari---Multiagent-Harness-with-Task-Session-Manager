import type { Inline, MarkdownBlock } from "@/features/sessions/markdownParser";
import type { Project } from "@/features/workspace/types";
import {
  dropLinkItems,
  linkCanQueue,
  linkStreamLive,
  sendLinkItem,
} from "@/features/link/linkStream";

import {
  cachedNote,
  cachedNotes,
  cachedTasks,
  pendingToolEdits,
  savedTask,
  storeNote,
  storeNotes,
  storeTasks,
} from "./toolsCache";
import {
  overlayNote,
  overlayNotes,
  overlayTasks,
  pendingTaskResult,
  queuedNoteBase,
} from "./toolsOverlay";

export { titleFrom } from "./toolsOverlay";

// Fork (Hari, L-236): the desktop's Tasks and Notes, and its link previews, as
// the phone reads them. The desktop answers from its own store; these are the
// shapes it sends and the small rules the screens share.

export type Command = <T>(method: string, params?: object) => Promise<T>;

/** The desktop's statuses and their labels. */
export const TASK_STATUSES = [
  { value: "todo", label: "Todo" },
  { value: "in_progress", label: "Progress" },
  { value: "blocked", label: "Blocked" },
  { value: "review", label: "Verify" },
  { value: "completed", label: "Completed" },
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number]["value"];

export type TaskItem = {
  id: string;
  title: string;
  excerpt: string;
  status: TaskStatus;
  tags: string[];
  projectCwd?: string | null;
  sourceSessionId?: string | null;
  /** Older desktops don't send it; Focus then treats the task as not created today. */
  createdAt?: number;
  updatedAt: number;
  completedAt?: number | null;
  archived: boolean;
  /** Local day (YYYY-MM-DD) the desktop pinned this task to Focus. */
  focusDate?: string | null;
  /** Past local days the task sat in Focus. */
  focusDays?: string[];
};

export type NoteItem = {
  id: string;
  title: string;
  excerpt: string;
  tags: string[];
  sourceCwd?: string | null;
  updatedAt: number;
};

export type Note = {
  id: string;
  slug: string;
  title: string;
  body: string;
  tags: string[];
  sourceCwd?: string | null;
  sourceSessionId?: string | null;
  createdAt: number;
  updatedAt: number;
};

export type NoteSave =
  /** `queued`: the outbox item it waits in (Fork, L-281), when the link is down. */
  | { conflict: false; note: Note; queued?: string }
  | { conflict: true; note: Note | null };

export type LinkPreview = {
  title?: string | null;
  description?: string | null;
  siteName?: string | null;
  faviconDataUrl?: string | null;
  imageDataUrl?: string | null;
};

export type LinkPreviewMode = "off" | "hover" | "always";
export type LinkCardStyle = "compact" | "wide" | "large" | "large-side";
export type LinkPreviewSettings = { mode: LinkPreviewMode; cardStyle: LinkCardStyle };

export const statusLabel = (status: TaskStatus) =>
  TASK_STATUSES.find((entry) => entry.value === status)?.label ?? "Todo";

// ── Lists refresh when a screen or a reply's buttons save ───────────────────

type Kind = "tasks" | "notes";
const listeners = new Set<(kind: Kind) => void>();
export function onToolsChanged(listener: (kind: Kind) => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}
export function toolsChanged(kind: Kind) {
  for (const listener of listeners) listener(kind);
}

// ── Requests ────────────────────────────────────────────────────────────────
// Fork (Hari, L-281): lists and notes are saved on the phone as they arrive,
// and read from there when the computer can't be reached. With the link down,
// task and note writes wait in its outbox and reach the computer when it's
// back; there the newer edit wins and deletes stick.

/** A list, and whether it is the phone's saved copy (the computer is out of reach). */
export type Listed<T> = { items: T[]; offline: boolean };

/**
 * A list asked for again within SHARE_LIST_MS (a sync and a screen together)
 * shares one request. Writes forget it, so the next list is fresh.
 */
const SHARE_LIST_MS = 2_000;
function sharedRequest<T>() {
  let recent: { at: number; request: Promise<T> } | null = null;
  return {
    run(start: () => Promise<T>, fresh = false): Promise<T> {
      const now = Date.now();
      if (!fresh && recent && now - recent.at < SHARE_LIST_MS) return recent.request;
      const request = start();
      recent = { at: now, request };
      request.catch(() => {
        if (recent?.request === request) recent = null;
      });
      return request;
    },
    forget() {
      recent = null;
    },
  };
}
const taskLists = sharedRequest<TaskItem[]>();
const noteLists = sharedRequest<NoteItem[]>();

/** Whether a write goes to the outbox: the link is down, or `preferQueue` (an editor that queued already). */
const queues = (preferQueue = false) => linkCanQueue() && (preferQueue || !linkStreamLive());

const errorText = (reason: unknown) => (reason instanceof Error ? reason.message : String(reason));

/** The tasks; `fresh` skips a list another caller asked for just now. */
export async function listTasks(command: Command, fresh = false): Promise<Listed<TaskItem>> {
  try {
    const tasks = await taskLists.run(async () => {
      const { tasks } = await command<{ tasks: TaskItem[] }>("tasks.list");
      storeTasks(tasks);
      return tasks;
    }, fresh);
    return { items: overlayTasks(tasks, pendingToolEdits()), offline: false };
  } catch (reason) {
    const saved = cachedTasks();
    if (!saved) throw reason;
    return { items: saved, offline: true };
  }
}

export async function createTask(
  command: Command,
  input: {
    title?: string;
    body?: string;
    tags?: string[];
    projectCwd?: string | null;
    sourceSessionId?: string;
  },
): Promise<TaskItem> {
  if (queues()) {
    const edit = { kind: "tasks.create", payload: { ...input, id: newId(), editedAt: Date.now() } };
    const id = sendLinkItem(edit.kind, edit.payload);
    taskLists.forget();
    toolsChanged("tasks");
    const task = pendingTaskResult(null, { id, ...edit });
    if (!task) throw new Error("Couldn’t keep the task on this phone");
    return task;
  }
  const { task } = await command<{ task: TaskItem }>("tasks.create", input);
  taskLists.forget();
  toolsChanged("tasks");
  return task;
}

export async function updateTask(
  command: Command,
  id: string,
  changes: {
    status?: TaskStatus;
    title?: string;
    tags?: string[];
    /**
     * Pins the task to Focus on this local day, or unpins it with null. Needs
     * `today` (the phone's local day) so the desktop records the day it leaves.
     * Desktops older than 0.16.0-local35 ignore it.
     */
    focusDate?: string | null;
    today?: string;
  },
): Promise<TaskItem> {
  if (queues()) {
    const shown = cachedTasks()?.find((task) => task.id === id) ?? null;
    if (!shown) throw new Error("This task isn’t saved on this phone");
    const payload = {
      id,
      ...changes,
      editedAt: Date.now(),
      baseUpdatedAt: savedTask(id)?.updatedAt ?? null,
    };
    const itemId = sendLinkItem("tasks.update", payload);
    taskLists.forget();
    toolsChanged("tasks");
    return pendingTaskResult(shown, { id: itemId, kind: "tasks.update", payload }) ?? shown;
  }
  const { task } = await command<{ task: TaskItem }>("tasks.update", { id, ...changes });
  taskLists.forget();
  toolsChanged("tasks");
  return task;
}

export async function listNotes(command: Command, fresh = false): Promise<Listed<NoteItem>> {
  try {
    const notes = await noteLists.run(async () => {
      const { notes } = await command<{ notes: NoteItem[] }>("notes.list");
      storeNotes(notes);
      return notes;
    }, fresh);
    return { items: overlayNotes(notes, pendingToolEdits()), offline: false };
  } catch (reason) {
    const saved = cachedNotes();
    if (!saved) throw reason;
    return { items: saved, offline: true };
  }
}

/** The note, from the computer, else as this phone saved it last. */
export async function readNote(command: Command, id: string): Promise<Note> {
  try {
    const { note } = await command<{ note: Note }>("notes.read", { id });
    storeNote(note);
    return overlayNote(id, note, pendingToolEdits()) ?? note;
  } catch (reason) {
    const saved = cachedNote(id);
    if (saved) return saved;
    throw new Error(
      linkStreamLive()
        ? errorText(reason)
        : "This note isn’t saved on this phone yet. Open it when your computer is connected.",
    );
  }
}

/**
 * Saves a note the phone read at `baseUpdatedAt` (null for a new one). When it
 * changed on the desktop since, nothing is saved and the desktop's copy comes
 * back as a conflict; `force` saves over it. With the link down (or `queue`,
 * once an editor has queued), it waits in the outbox instead: the answer then
 * names the outbox item (`queued`), and a waiting save of the same note is
 * replaced.
 */
export async function saveNote(
  command: Command,
  input: {
    id: string;
    title: string;
    body: string;
    tags?: string[];
    sourceCwd?: string | null;
    sourceSessionId?: string;
    baseUpdatedAt: number | null;
    force?: boolean;
    finalize?: boolean;
    queue?: boolean;
  },
): Promise<NoteSave> {
  const { queue, ...fields } = input;
  const pending = pendingToolEdits();
  // Saves of this note still waiting; a new save waits behind them, in order,
  // and replaces them.
  const replaced = pending.filter(
    (item) => item.kind === "notes.save" && isNoteSave(item.payload, fields.id),
  );
  if (queues(queue || replaced.length > 0)) {
    const payload = {
      ...fields,
      baseUpdatedAt: queuedNoteBase(fields.id, fields.baseUpdatedAt, pending),
      // A Keep mine still waiting stays one when typing replaces it.
      force: fields.force === true || replaced.some((item) => isForced(item.payload)),
      editedAt: Date.now(),
    };
    dropLinkItems((item) => item.kind === "notes.save" && isNoteSave(item.payload, fields.id));
    const itemId = sendLinkItem("notes.save", payload);
    noteLists.forget();
    toolsChanged("notes");
    const note = cachedNote(fields.id);
    if (!note) throw new Error("Couldn’t keep the note on this phone");
    return { conflict: false, note, queued: itemId };
  }
  const saved = await command<NoteSave>("notes.save", fields);
  if (!saved.conflict) {
    storeNote(saved.note);
    noteLists.forget();
    toolsChanged("notes");
  }
  return saved;
}

const isForced = (payload: unknown) =>
  typeof payload === "object" && payload !== null && "force" in payload && payload.force === true;

const isNoteSave = (payload: unknown, id: string) =>
  typeof payload === "object" && payload !== null && "id" in payload && payload.id === id;

/** Recent previews only, as the desktop keeps them; each can hold a page image. */
const PREVIEW_LIMIT = 30;
const previews = new Map<string, Promise<LinkPreview>>();
export function linkPreview(command: Command, url: string, image: boolean) {
  const key = `${image ? 1 : 0} ${url}`;
  const cached = previews.get(key);
  if (cached) {
    previews.delete(key);
    previews.set(key, cached);
    return cached;
  }
  const pending = command<LinkPreview>("link.preview", { url, image });
  previews.set(key, pending);
  pending.catch(() => previews.delete(key));
  while (previews.size > PREVIEW_LIMIT) {
    const oldest = previews.keys().next().value;
    if (oldest === undefined) break;
    previews.delete(oldest);
  }
  return pending;
}

// ── Shared rules ────────────────────────────────────────────────────────────

const pathKey = (path: string) => path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();

/** The project a task or note belongs to, by its folder; else the folder's name. */
export function projectLabel(cwd: string | null | undefined, projects: Project[]) {
  if (!cwd) return null;
  const key = pathKey(cwd);
  const known = projects.find((project) => pathKey(project.path) === key);
  return known?.name ?? (cwd.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || cwd);
}

export type TaskGroup = { key: string; label: string; tasks: TaskItem[] };
export type TaskGrouping = "status" | "project";

/** The project a task belongs to, as a stable key; "" for no project. */
export const taskProjectKey = (task: Pick<TaskItem, "projectCwd">): string =>
  task.projectCwd ? pathKey(task.projectCwd) : "";

/** The phone's local day as YYYY-MM-DD, as the desktop's Focus reads days. */
export function localDay(at: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

/**
 * In the desktop's Focus on `day`: recorded there before, pinned to it, or
 * created that day while not planned for a later day. Mirrors `inFocusOn` in
 * the desktop's `src/features/tasks/tasks.ts`.
 */
export function inFocusOn(
  task: Pick<TaskItem, "focusDate" | "focusDays" | "createdAt">,
  day: string,
): boolean {
  if ((task.focusDays ?? []).includes(day)) return true;
  if (task.focusDate === day) return true;
  if (task.createdAt === undefined || localDay(new Date(task.createdAt)) !== day) return false;
  return !task.focusDate || task.focusDate <= day;
}

/**
 * Unfinished tasks pinned to an earlier day and not in Focus on `day`: the
 * ones the desktop offers to carry over. Mirrors `carryOver` in the desktop's
 * `src/features/tasks/ui/TasksView.tsx`.
 */
export function carryOverTasks(tasks: TaskItem[], day: string): TaskItem[] {
  return tasks.filter(
    (task) =>
      !!task.focusDate &&
      task.focusDate < day &&
      task.status !== "completed" &&
      !task.archived &&
      !inFocusOn(task, day),
  );
}

/**
 * Tasks in groups. By project: projects by name, then those with none. By
 * status: in the desktop's status order, empty ones left out. Archived ones
 * stay hidden; in each group open tasks come first, newest first, then done
 * ones.
 */
export function groupTasks(
  tasks: TaskItem[],
  projects: Project[],
  by: TaskGrouping = "project",
): TaskGroup[] {
  if (by === "status") {
    return TASK_STATUSES.map((status) => ({
      key: status.value,
      label: status.label,
      tasks: tasks
        .filter((task) => !task.archived && task.status === status.value)
        .sort((a, b) => b.updatedAt - a.updatedAt),
    })).filter((group) => group.tasks.length > 0);
  }
  const groups = new Map<string, TaskGroup>();
  for (const task of tasks) {
    if (task.archived) continue;
    const key = taskProjectKey(task);
    let group = groups.get(key);
    if (!group) {
      group = { key, label: projectLabel(task.projectCwd, projects) ?? "No project", tasks: [] };
      groups.set(key, group);
    }
    group.tasks.push(task);
  }
  const done = (task: TaskItem) => (task.status === "completed" ? 1 : 0);
  for (const group of groups.values())
    group.tasks.sort((a, b) => done(a) - done(b) || b.updatedAt - a.updatedAt);
  return [...groups.values()].sort((a, b) =>
    !a.key ? 1 : !b.key ? -1 : a.label.localeCompare(b.label),
  );
}

/** Tags typed as "#bug, ui later", kept as the desktop keeps them. */
export function parseTags(input: string): string[] {
  const tags: string[] = [];
  for (const word of input.split(/[,\s]+/)) {
    const tag = word.replace(/^#+/, "").toLowerCase().slice(0, 48).replace(/-+$/, "");
    if (tag && !tags.includes(tag)) tags.push(tag);
    if (tags.length === 20) break;
  }
  return tags;
}

/** A note's first words after its title, for the list. */
export function excerptOf(note: Pick<NoteItem, "title" | "excerpt">) {
  const lines = note.excerpt
    .split(/\r?\n/)
    .map((line) => line.replace(/^#{1,6}\s+/, "").trim())
    .filter((line) => line && line !== "---" && !line.startsWith("```"));
  if (lines[0] === note.title) lines.shift();
  return lines.join(" ").slice(0, 160);
}

/** A new note's id, in the desktop's form (letters, digits and dashes). */
export function newId() {
  const hex = (count: number) =>
    Array.from({ length: count }, () => ((Math.random() * 16) | 0).toString(16)).join("");
  return `${hex(8)}-${hex(4)}-4${hex(3)}-${(8 + ((Math.random() * 4) | 0)).toString(16)}${hex(3)}-${hex(12)}`;
}

/** Each web link a block names, once, in order, so its card can follow it. */
export function webLinks(block: MarkdownBlock): string[] {
  const found: string[] = [];
  const visit = (nodes: Inline[]) => {
    for (const node of nodes) {
      if (node.type === "link") {
        if (/^https?:\/\//i.test(node.href) && !found.includes(node.href)) found.push(node.href);
      } else if ("children" in node) visit(node.children);
    }
  };
  if (block.type === "paragraph" || block.type === "heading") visit(block.inline);
  return found;
}

export function hostOf(url: string) {
  const match = /^https?:\/\/([^/?#]+)/i.exec(url);
  return (match?.[1] ?? url).replace(/^www\./i, "");
}

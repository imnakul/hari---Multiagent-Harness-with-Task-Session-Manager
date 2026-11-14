import type { Note, NoteItem, TaskItem, TaskStatus } from "./tools";

// Fork (Hari, L-281): the pure half of Tasks and Notes offline. Reads what the
// phone saved (storage is untrusted, so each entry is checked), and lays the
// edits still waiting in the link outbox over the computer's copy, so the
// lists show them before the computer has them.

/** Outbox kinds the computer applies to its Tasks and Notes. */
export const TOOLS_OUTBOX_KINDS: readonly string[] = ["tasks.create", "tasks.update", "notes.save"];
/** Full notes kept on the phone: the ones read last. */
export const NOTE_BODIES_MAX = 50;

const EXCERPT_CHARS = 300;
const TITLE_CHARS = 200;
const STATUSES: readonly TaskStatus[] = ["todo", "in_progress", "blocked", "review", "completed"];

/** An edit waiting in the outbox, as the overlay reads it. */
export type PendingEdit = { id: string; kind: string; payload: unknown };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown) => (typeof value === "string" ? value : undefined);
const count = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;
const texts = (value: unknown) =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
const statusOf = (value: unknown) => STATUSES.find((status) => status === value);

/** The first heading or line of text, as the desktop titles an untitled note. */
export function titleFrom(body: string): string {
  let fenced = false;
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("```")) {
      fenced = !fenced;
      continue;
    }
    if (fenced || !line || line === "---") continue;
    const title = line
      .replace(/^#{1,6}\s+/, "")
      .replace(/\*\*|__|`/g, "")
      .trim()
      .slice(0, TITLE_CHARS);
    if (title) return title;
  }
  return "Untitled";
}

export function parseTaskItem(value: unknown): TaskItem | null {
  if (!isRecord(value)) return null;
  const id = text(value.id);
  const title = text(value.title);
  const updatedAt = count(value.updatedAt);
  const status = statusOf(value.status);
  if (!id || title === undefined || updatedAt === undefined || !status) return null;
  return {
    id,
    title,
    excerpt: text(value.excerpt) ?? "",
    status,
    tags: texts(value.tags),
    projectCwd: text(value.projectCwd) ?? null,
    sourceSessionId: text(value.sourceSessionId) ?? null,
    createdAt: count(value.createdAt),
    updatedAt,
    completedAt: count(value.completedAt) ?? null,
    archived: value.archived === true,
    focusDate: text(value.focusDate) ?? null,
    focusDays: texts(value.focusDays),
  };
}

export function parseNoteItem(value: unknown): NoteItem | null {
  if (!isRecord(value)) return null;
  const id = text(value.id);
  const title = text(value.title);
  const updatedAt = count(value.updatedAt);
  if (!id || title === undefined || updatedAt === undefined) return null;
  return {
    id,
    title,
    excerpt: text(value.excerpt) ?? "",
    tags: texts(value.tags),
    sourceCwd: text(value.sourceCwd) ?? null,
    updatedAt,
  };
}

export function parseNote(value: unknown): Note | null {
  if (!isRecord(value)) return null;
  const id = text(value.id);
  const title = text(value.title);
  const body = text(value.body);
  const updatedAt = count(value.updatedAt);
  if (!id || title === undefined || body === undefined || updatedAt === undefined) return null;
  return {
    id,
    slug: text(value.slug) ?? "",
    title,
    body,
    tags: texts(value.tags),
    sourceCwd: text(value.sourceCwd) ?? null,
    sourceSessionId: text(value.sourceSessionId) ?? null,
    createdAt: count(value.createdAt) ?? updatedAt,
    updatedAt,
  };
}

/** A stored list, keeping the entries that still read; null when none was stored. */
export function parseList<T>(value: unknown, parse: (entry: unknown) => T | null): T[] | null {
  if (!Array.isArray(value)) return null;
  return value.flatMap((entry) => {
    const parsed = parse(entry);
    return parsed ? [parsed] : [];
  });
}

/** Keeps `note` first among the saved full notes, at most NOTE_BODIES_MAX. */
export function rememberNote(saved: Note[], note: Note): Note[] {
  return [note, ...saved.filter((entry) => entry.id !== note.id)].slice(0, NOTE_BODIES_MAX);
}

/** Drops saved full notes the computer no longer lists: deleted there. */
export function pruneNotes(saved: Note[], listed: NoteItem[]): Note[] {
  const ids = new Set(listed.map((note) => note.id));
  return saved.filter((note) => ids.has(note.id));
}

type Edit = { id: string; editedAt: number; fields: Record<string, unknown> };

function readEdit(edit: PendingEdit): Edit | null {
  if (!isRecord(edit.payload)) return null;
  const id = text(edit.payload.id);
  const editedAt = count(edit.payload.editedAt);
  return id && editedAt !== undefined ? { id, editedAt, fields: edit.payload } : null;
}

/** A task the phone made offline, as the list shows it until the computer has it. */
function createdTask({ id, editedAt, fields }: Edit): TaskItem {
  const body = text(fields.body) ?? "";
  return {
    id,
    title: text(fields.title)?.trim().slice(0, TITLE_CHARS) || titleFrom(body),
    excerpt: body.slice(0, EXCERPT_CHARS),
    status: "todo",
    tags: texts(fields.tags),
    projectCwd: text(fields.projectCwd) ?? null,
    sourceSessionId: text(fields.sourceSessionId) ?? null,
    createdAt: editedAt,
    updatedAt: editedAt,
    completedAt: null,
    archived: false,
    focusDate: null,
    focusDays: [],
  };
}

/** `task` with the fields an offline `tasks.update` changes. */
function updatedTask(task: TaskItem, { editedAt, fields }: Edit): TaskItem {
  const status = statusOf(fields.status);
  const title = text(fields.title)?.trim();
  return {
    ...task,
    ...(status
      ? { status, completedAt: status === "completed" ? (task.completedAt ?? editedAt) : null }
      : {}),
    ...(title ? { title: title.slice(0, TITLE_CHARS) } : {}),
    ...(Array.isArray(fields.tags) ? { tags: texts(fields.tags) } : {}),
    ...("projectCwd" in fields ? { projectCwd: text(fields.projectCwd) ?? null } : {}),
    ...("focusDate" in fields ? { focusDate: text(fields.focusDate) ?? null } : {}),
    updatedAt: editedAt,
  };
}

/** The computer's tasks with the phone's waiting edits laid over, in order. */
export function overlayTasks(tasks: TaskItem[], pending: PendingEdit[]): TaskItem[] {
  let shown = tasks;
  for (const entry of pending) {
    const edit = readEdit(entry);
    if (!edit) continue;
    if (entry.kind === "tasks.create" && !shown.some((task) => task.id === edit.id)) {
      shown = [createdTask(edit), ...shown];
    } else if (entry.kind === "tasks.update") {
      shown = shown.map((task) => (task.id === edit.id ? updatedTask(task, edit) : task));
    }
  }
  return shown;
}

/** The computer's notes with the phone's waiting saves laid over, newest first. */
export function overlayNotes(notes: NoteItem[], pending: PendingEdit[]): NoteItem[] {
  let shown = notes;
  for (const entry of pending) {
    const edit = entry.kind === "notes.save" ? readEdit(entry) : null;
    if (!edit) continue;
    const known = shown.find((note) => note.id === edit.id);
    const body = text(edit.fields.body) ?? "";
    const note: NoteItem = {
      id: edit.id,
      title: text(edit.fields.title)?.trim().slice(0, TITLE_CHARS) || titleFrom(body),
      excerpt: body.slice(0, EXCERPT_CHARS),
      tags: Array.isArray(edit.fields.tags) ? texts(edit.fields.tags) : (known?.tags ?? []),
      sourceCwd: known ? known.sourceCwd : (text(edit.fields.sourceCwd) ?? null),
      updatedAt: edit.editedAt,
    };
    shown = [note, ...shown.filter((each) => each.id !== edit.id)];
  }
  return [...shown].sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * One note with the phone's waiting saves of it laid over; a note made on the
 * phone offline exists only there. Keeps the computer's `updatedAt`, the base
 * the next save names.
 */
export function overlayNote(id: string, note: Note | null, pending: PendingEdit[]): Note | null {
  let shown = note;
  for (const entry of pending) {
    const edit = entry.kind === "notes.save" ? readEdit(entry) : null;
    if (!edit || edit.id !== id) continue;
    const body = text(edit.fields.body) ?? "";
    shown = {
      id,
      slug: shown?.slug ?? "",
      title: text(edit.fields.title)?.trim().slice(0, TITLE_CHARS) || titleFrom(body),
      body,
      tags: Array.isArray(edit.fields.tags) ? texts(edit.fields.tags) : (shown?.tags ?? []),
      sourceCwd: shown ? shown.sourceCwd : (text(edit.fields.sourceCwd) ?? null),
      sourceSessionId: shown
        ? shown.sourceSessionId
        : (text(edit.fields.sourceSessionId) ?? null),
      createdAt: shown?.createdAt ?? edit.editedAt,
      updatedAt: shown?.updatedAt ?? edit.editedAt,
    };
  }
  return shown;
}

/** A queued task edit, as the screen that made it sees it at once. */
export function pendingTaskResult(task: TaskItem | null, edit: PendingEdit): TaskItem | null {
  const read = readEdit(edit);
  if (!read) return null;
  if (edit.kind === "tasks.create") return createdTask(read);
  return task ? updatedTask(task, read) : null;
}

/**
 * The base a queued note save names: an earlier waiting save of the same note
 * keeps its base, since the newer one replaces it in the outbox.
 */
export function queuedNoteBase(
  id: string,
  base: number | null,
  pending: PendingEdit[],
): number | null {
  for (const entry of pending) {
    const edit = entry.kind === "notes.save" ? readEdit(entry) : null;
    if (edit?.id !== id) continue;
    const earlier = edit.fields.baseUpdatedAt;
    return typeof earlier === "number" ? earlier : null;
  }
  return base;
}

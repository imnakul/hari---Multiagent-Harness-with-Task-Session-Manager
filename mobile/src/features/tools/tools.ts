import type { Inline, MarkdownBlock } from "@/features/sessions/markdownParser";
import type { Project } from "@/features/workspace/types";

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
  updatedAt: number;
  completedAt?: number | null;
  archived: boolean;
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

export type NoteSave = { conflict: false; note: Note } | { conflict: true; note: Note | null };

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

export const listTasks = (command: Command) =>
  command<{ tasks: TaskItem[] }>("tasks.list").then((value) => value.tasks);

export async function createTask(
  command: Command,
  input: {
    title?: string;
    body?: string;
    tags?: string[];
    projectCwd?: string | null;
    sourceSessionId?: string;
  },
) {
  const { task } = await command<{ task: TaskItem }>("tasks.create", input);
  toolsChanged("tasks");
  return task;
}

export async function updateTask(
  command: Command,
  id: string,
  changes: { status?: TaskStatus; title?: string; tags?: string[] },
) {
  const { task } = await command<{ task: TaskItem }>("tasks.update", { id, ...changes });
  toolsChanged("tasks");
  return task;
}

export const listNotes = (command: Command) =>
  command<{ notes: NoteItem[] }>("notes.list").then((value) => value.notes);

export const readNote = (command: Command, id: string) =>
  command<{ note: Note }>("notes.read", { id }).then((value) => value.note);

/**
 * Saves a note the phone read at `baseUpdatedAt` (null for a new one). When it
 * changed on the desktop since, nothing is saved and the desktop's copy comes
 * back as a conflict; `force` saves over it.
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
  },
) {
  const saved = await command<NoteSave>("notes.save", input);
  if (!saved.conflict) toolsChanged("notes");
  return saved;
}

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

/**
 * Tasks by project: projects by name, then those with none. Archived ones stay
 * hidden; in each group open tasks come first, newest first, then done ones.
 */
export function groupTasks(tasks: TaskItem[], projects: Project[]): TaskGroup[] {
  const groups = new Map<string, TaskGroup>();
  for (const task of tasks) {
    if (task.archived) continue;
    const key = task.projectCwd ? pathKey(task.projectCwd) : "";
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

/** The first heading or line of text, as the desktop titles an untitled note. */
export function titleFrom(text: string): string {
  let fenced = false;
  for (const raw of text.split(/\r?\n/)) {
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
      .slice(0, 200);
    if (title) return title;
  }
  return "Untitled";
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

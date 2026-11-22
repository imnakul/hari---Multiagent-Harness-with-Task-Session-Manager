import type { ClickupListInfo, ClickupStatus, ClickupTask, ClickupTaskInput } from "./clickupApi";
import { PRIORITY_INFO } from "./clickupViewState";

/** Fork (L-381): pure task helpers. No network, no storage. */

export const MAX_PROMPT_DESCRIPTION = 4000;

/** What the form edits. Dates are local-midnight milliseconds, as ClickUp stores them. */
export interface ClickupTaskDraft {
  name: string;
  description: string;
  status: string;
  priority: 1 | 2 | 3 | 4 | null;
  assigneeIds: number[];
  startDate: number | null;
  dueDate: number | null;
}

export function draftFromTask(task: ClickupTask): ClickupTaskDraft {
  return {
    name: task.name,
    description: task.markdownDescription ?? "",
    status: task.status.status,
    priority: task.priority,
    assigneeIds: task.assignees.map((member) => member.id),
    startDate: task.startDate,
    dueDate: task.dueDate,
  };
}

/** `YYYY-MM-DD` → local midnight in ms, or null when it isn't a real calendar date. */
export function toLocalMidnight(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date.getTime();
}

export function fromLocalMidnight(ms: number | null): string {
  if (ms === null) return "";
  const date = new Date(ms);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** AC-C7. */
export function dueBeforeStart(draft: Pick<ClickupTaskDraft, "startDate" | "dueDate">): boolean {
  return draft.startDate !== null && draft.dueDate !== null && draft.dueDate < draft.startDate;
}

const byOrder = (a: ClickupStatus, b: ClickupStatus): number => a.orderindex - b.orderindex;

/** AC-C9: the first `closed` status by order. */
export function doneStatus(list: Pick<ClickupListInfo, "statuses">): string | null {
  return [...list.statuses].sort(byOrder).find((status) => status.type === "closed")?.status ?? null;
}

/** AC-C9: the first `open` status, else the lowest-order status that isn't closed. */
export function reopenStatus(list: Pick<ClickupListInfo, "statuses">): string | null {
  const ordered = [...list.statuses].sort(byOrder);
  return (
    ordered.find((status) => status.type === "open")?.status ??
    ordered.find((status) => status.type !== "closed")?.status ??
    null
  );
}

export function isClosedTask(task: Pick<ClickupTask, "status">): boolean {
  return task.status.type === "closed";
}

function sameIds(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((id) => b.includes(id));
}

/** C3: only the fields that differ from the snapshot. An empty object means nothing to save. */
export function taskPatch(original: ClickupTaskDraft, edited: ClickupTaskDraft): ClickupTaskInput {
  const patch: ClickupTaskInput = {};
  if (edited.name !== original.name) patch.name = edited.name;
  if (edited.description !== original.description) patch.markdown_content = edited.description;
  if (edited.status !== original.status) patch.status = edited.status;
  if (edited.priority !== original.priority) patch.priority = edited.priority;
  if (!sameIds(original.assigneeIds, edited.assigneeIds)) {
    patch.assignees = {
      add: edited.assigneeIds.filter((id) => !original.assigneeIds.includes(id)),
      rem: original.assigneeIds.filter((id) => !edited.assigneeIds.includes(id)),
    };
  }
  if (edited.startDate !== original.startDate) {
    patch.start_date = edited.startDate;
    patch.start_date_time = false;
  }
  if (edited.dueDate !== original.dueDate) {
    patch.due_date = edited.dueDate;
    patch.due_date_time = false;
  }
  return patch;
}

/** A create sends everything that has a value. */
export function createInput(draft: ClickupTaskDraft): ClickupTaskInput {
  const input: ClickupTaskInput = { name: draft.name.trim() };
  if (draft.description.trim()) input.markdown_content = draft.description;
  if (draft.status) input.status = draft.status;
  if (draft.priority !== null) input.priority = draft.priority;
  if (draft.assigneeIds.length > 0) input.assignees = draft.assigneeIds;
  if (draft.startDate !== null) {
    input.start_date = draft.startDate;
    input.start_date_time = false;
  }
  if (draft.dueDate !== null) {
    input.due_date = draft.dueDate;
    input.due_date_time = false;
  }
  return input;
}

/** Of two copies of one task, the one updated last (ties keep the incoming one). */
export function newerTask(current: ClickupTask | undefined, incoming: ClickupTask): ClickupTask {
  return current && current.dateUpdated > incoming.dateUpdated ? current : incoming;
}

/** Merge by ID keeping the larger `dateUpdated`. */
export function mergeTasks(current: ClickupTask[], incoming: ClickupTask[]): ClickupTask[] {
  const byId = new Map(current.map((task) => [task.id, task]));
  for (const task of incoming) byId.set(task.id, newerTask(byId.get(task.id), task));
  return [...byId.values()];
}

export interface DueLabel {
  text: string;
  overdue: boolean;
}

function startOfDay(ms: number): number {
  const date = new Date(ms);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

export function dueLabel(ms: number | null, now: number): DueLabel | null {
  if (ms === null) return null;
  const days = Math.round((startOfDay(ms) - startOfDay(now)) / 86_400_000);
  if (days === 0) return { text: "Today", overdue: false };
  if (days === 1) return { text: "Tomorrow", overdue: false };
  if (days === -1) return { text: "Yesterday", overdue: true };
  const text = new Date(ms).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  return { text, overdue: days < 0 };
}

const MAX_PROMPT_FIELD = 300;
const MAX_PROMPT_FIELDS = 30;

export interface SessionPromptExtras {
  listName?: string;
  /** Names of files attached to the composer alongside the text. */
  attachedFiles?: readonly string[];
  /** Names of files that couldn't come along (too big, or the download failed). */
  missingFiles?: readonly string[];
}

/**
 * AC-C14: the composer text for a session about this task: name and link,
 * then what the task says about itself (status, priority, list, people,
 * dates, tags, filled-in custom fields, files), then the description.
 */
export function sessionPromptForTask(
  task: Pick<ClickupTask, "name" | "url" | "markdownDescription"> &
    Partial<Pick<ClickupTask, "status" | "priority" | "assignees" | "startDate" | "dueDate" | "tags" | "customFields">>,
  extras: SessionPromptExtras = {},
): string {
  const clip = (text: string): string => {
    const flat = text.replace(/\s+/g, " ").trim();
    return flat.length > MAX_PROMPT_FIELD ? `${flat.slice(0, MAX_PROMPT_FIELD - 1)}…` : flat;
  };
  const facts: string[] = [];
  const overview = [
    task.status?.status ? `Status: ${task.status.status}` : "",
    task.priority ? `Priority: ${PRIORITY_INFO[task.priority].label}` : "",
    extras.listName ? `List: ${clip(extras.listName)}` : "",
  ].filter(Boolean);
  if (overview.length) facts.push(overview.join(" · "));
  const people = (task.assignees ?? []).map((member) => member.username || member.email).filter(Boolean);
  if (people.length) facts.push(`Assignees: ${people.join(", ")}`);
  const dates = [
    task.startDate ? `Start: ${fromLocalMidnight(task.startDate)}` : "",
    task.dueDate ? `Due: ${fromLocalMidnight(task.dueDate)}` : "",
  ].filter(Boolean);
  if (dates.length) facts.push(dates.join(" · "));
  if (task.tags?.length) facts.push(`Tags: ${task.tags.join(", ")}`);
  for (const field of (task.customFields ?? []).filter((item) => item.text.trim()).slice(0, MAX_PROMPT_FIELDS)) {
    facts.push(`${clip(field.name)}: ${clip(field.text)}`);
  }
  if (extras.attachedFiles?.length) facts.push(`Attached files: ${extras.attachedFiles.join(", ")}`);
  if (extras.missingFiles?.length) facts.push(`Not attached (open in ClickUp): ${extras.missingFiles.join(", ")}`);

  const description = (task.markdownDescription ?? "").trim().slice(0, MAX_PROMPT_DESCRIPTION);
  return [`ClickUp task: ${task.name}\n${task.url}`, facts.join("\n"), description].filter(Boolean).join("\n\n");
}

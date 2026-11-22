import type { ClickupApi, ClickupMember, ClickupTask, ClickupTaskInput } from "./clickupApi";
import { ClickupError } from "./clickupApi";
import type { ClickupListRef } from "./clickupConfig";
import type { ClickupStore } from "./clickupStore";
import {
  createInput,
  doneStatus,
  draftFromTask,
  dueBeforeStart,
  fromLocalMidnight,
  reopenStatus,
  taskPatch,
  toLocalMidnight,
  type ClickupTaskDraft,
} from "./clickupTasks";

/** Fork (L-381): the four `clickup.*` agent actions. Access (linked project) is checked by the caller. */

export type ClickupAction = "clickup.lists" | "clickup.tasks" | "clickup.create" | "clickup.update";

export interface ClickupAgentDeps {
  lists: readonly ClickupListRef[];
  store: ClickupStore;
  api: Pick<ClickupApi, "isConnected" | "task">;
}

const MAX_RESULT_TASKS = 100;
const MAX_NAME = 1000;
const MAX_DESCRIPTION = 20_000;
const PRIORITIES = { urgent: 1, high: 2, normal: 3, low: 4 } as const;
const PRIORITY_NAMES = ["", "urgent", "high", "normal", "low"] as const;

export const CLICKUP_NOT_CONNECTED =
  "ClickUp is not connected. Ask the user to connect it in the ClickUp page.";

type Input = Record<string, unknown>;

function resolveList(deps: ClickupAgentDeps, value: unknown): ClickupListRef {
  if (typeof value !== "string" || !value.trim()) {
    if (deps.lists.length === 1) return deps.lists[0];
    throw new Error("list is required; run clickup.lists");
  }
  const wanted = value.trim().toLowerCase();
  const found = deps.lists.find((list) => list.id === value.trim() || list.name.toLowerCase() === wanted);
  if (!found) throw new Error("Unknown list; run clickup.lists");
  return found;
}

function textField(input: Input, key: string, max: number, required: boolean): string | undefined {
  const value = input[key];
  if (value === undefined) {
    if (required) throw new Error(`${key} is required`);
    return undefined;
  }
  if (typeof value !== "string") throw new Error(`${key} must be text`);
  if (required && !value.trim()) throw new Error(`${key} is required`);
  if (value.length > max) throw new Error(`${key} must be at most ${max} characters`);
  return value;
}

function dateField(input: Input, key: string, allowNull: boolean): number | null | undefined {
  const value = input[key];
  if (value === undefined) return undefined;
  if (value === null) {
    if (allowNull) return null;
    throw new Error(`${key} must be YYYY-MM-DD`);
  }
  const ms = typeof value === "string" ? toLocalMidnight(value) : null;
  if (ms === null) throw new Error(`${key} must be YYYY-MM-DD`);
  return ms;
}

function priorityField(input: Input): 1 | 2 | 3 | 4 | null | undefined {
  const value = input.priority;
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === "string" && value.toLowerCase() in PRIORITIES) {
    return PRIORITIES[value.toLowerCase() as keyof typeof PRIORITIES];
  }
  throw new Error("priority must be urgent, high, normal, low or null");
}

function membersOf(deps: ClickupAgentDeps, listId: string, tasks: readonly ClickupTask[]): ClickupMember[] {
  const known = deps.store.getSnapshot().lists[listId]?.members ?? [];
  const seen = new Map<number, ClickupMember>(known.map((member) => [member.id, member]));
  for (const task of tasks) for (const member of task.assignees) if (!seen.has(member.id)) seen.set(member.id, member);
  return [...seen.values()];
}

function assigneeIds(value: unknown, members: readonly ClickupMember[]): number[] {
  if (!Array.isArray(value)) throw new Error("assignees must be a list");
  const ids: number[] = [];
  for (const entry of value) {
    const wanted = String(entry).trim().toLowerCase();
    const member = members.find(
      (candidate) =>
        String(candidate.id) === wanted ||
        candidate.username.toLowerCase() === wanted ||
        candidate.email.toLowerCase() === wanted,
    );
    if (!member) {
      const names = members.map((candidate) => candidate.username).filter(Boolean).join(", ");
      throw new Error(`Unknown assignee ${String(entry)}; members: ${names || "none known"}`);
    }
    if (!ids.includes(member.id)) ids.push(member.id);
  }
  return ids;
}

function view(task: ClickupTask, listName: string): Record<string, unknown> {
  return {
    id: task.id,
    name: task.name,
    status: task.status.status,
    priority: task.priority === null ? null : PRIORITY_NAMES[task.priority],
    assignees: task.assignees.map((member) => member.username),
    startDate: task.startDate === null ? null : fromLocalMidnight(task.startDate),
    dueDate: task.dueDate === null ? null : fromLocalMidnight(task.dueDate),
    url: task.url,
    list: listName,
  };
}

function friendly(error: unknown): Error {
  if (!(error instanceof ClickupError)) return error instanceof Error ? error : new Error("ClickUp failed.");
  switch (error.kind) {
    case "notConnected":
    case "auth":
      return new Error(CLICKUP_NOT_CONNECTED);
    case "forbidden":
      return new Error("You don't have permission to edit this list.");
    case "notFound":
      return new Error("ClickUp couldn't find that.");
    case "rateLimited":
      return new Error(`ClickUp is busy. Try again in ${error.retryAfterSeconds ?? 60} s.`);
    case "invalid":
      return new Error(error.message);
    default:
      return new Error("Couldn't reach ClickUp.");
  }
}

export async function runClickupAction(
  action: ClickupAction,
  input: Input,
  deps: ClickupAgentDeps,
): Promise<unknown> {
  try {
    if (!(await deps.api.isConnected())) throw new Error(CLICKUP_NOT_CONNECTED);
    switch (action) {
      case "clickup.lists":
        return await listLists(deps);
      case "clickup.tasks":
        return await readTasks(input, deps);
      case "clickup.create":
        return await createTask(input, deps);
      case "clickup.update":
        return await updateTask(input, deps);
    }
  } catch (error) {
    throw friendly(error);
  }
}

async function listLists(deps: ClickupAgentDeps): Promise<unknown> {
  const lists = [];
  for (const ref of deps.lists) {
    const state = await deps.store.loadMeta(ref.id);
    lists.push({
      id: ref.id,
      name: ref.name,
      statuses: state.meta?.statuses.map((status) => status.status) ?? [],
      members: state.members.map((member) => member.username),
    });
  }
  return { lists };
}

async function readTasks(input: Input, deps: ClickupAgentDeps): Promise<unknown> {
  if (typeof input.id === "string" && input.id.trim()) {
    const task = await deps.api.task(input.id.trim());
    const list = deps.lists.find((candidate) => candidate.id === task.listId);
    if (!list) throw new Error("Unknown list; run clickup.lists");
    return { task: { ...view(task, list.name), description: task.markdownDescription ?? "" } };
  }
  const includeClosed = input.includeClosed === true;
  const targets = input.list === undefined ? deps.lists : [resolveList(deps, input.list)];
  const tasks: Record<string, unknown>[] = [];
  for (const ref of targets) {
    await deps.store.refresh(ref.id, { force: true, includeClosed });
    const state = deps.store.getSnapshot().lists[ref.id];
    if (state?.load.kind === "error") throw state.load.error;
    for (const task of state?.tasks ?? []) {
      if (!includeClosed && task.status.type === "closed") continue;
      tasks.push(view(task, ref.name));
    }
  }
  return { tasks: tasks.slice(0, MAX_RESULT_TASKS), truncated: tasks.length > MAX_RESULT_TASKS };
}

async function draftFromInput(
  input: Input,
  deps: ClickupAgentDeps,
  listId: string,
  base: ClickupTaskDraft,
  tasks: readonly ClickupTask[],
  isCreate: boolean,
): Promise<ClickupTaskDraft> {
  const draft = { ...base };
  const name = textField(input, "name", MAX_NAME, isCreate);
  if (name !== undefined) draft.name = name;
  const description = textField(input, "description", MAX_DESCRIPTION, false);
  if (description !== undefined) draft.description = description;
  const priority = priorityField(input);
  if (priority !== undefined) draft.priority = priority;
  const start = dateField(input, "startDate", !isCreate);
  if (start !== undefined) draft.startDate = start;
  const due = dateField(input, "dueDate", !isCreate);
  if (due !== undefined) draft.dueDate = due;
  if (input.assignees !== undefined) {
    const state = await deps.store.loadMeta(listId);
    draft.assigneeIds = assigneeIds(input.assignees, membersOf(deps, listId, [...tasks, ...state.tasks]));
  }
  if (input.status !== undefined) {
    if (typeof input.status !== "string") throw new Error("status must be text");
    const state = await deps.store.loadMeta(listId);
    const wanted = input.status.trim().toLowerCase();
    const status = state.meta?.statuses.find((candidate) => candidate.status.toLowerCase() === wanted);
    if (!status) {
      const names = state.meta?.statuses.map((candidate) => candidate.status).join(", ") ?? "";
      throw new Error(`Unknown status ${input.status}; statuses: ${names}`);
    }
    draft.status = status.status;
  }
  if (dueBeforeStart(draft)) throw new Error("dueDate is before startDate");
  return draft;
}

const EMPTY_DRAFT: ClickupTaskDraft = {
  name: "",
  description: "",
  status: "",
  priority: null,
  assigneeIds: [],
  startDate: null,
  dueDate: null,
};

async function createTask(input: Input, deps: ClickupAgentDeps): Promise<unknown> {
  const list = resolveList(deps, input.list);
  const draft = await draftFromInput(input, deps, list.id, EMPTY_DRAFT, [], true);
  const task = await deps.store.createTask(list.id, createInput(draft));
  return { id: task.id, url: task.url };
}

async function updateTask(input: Input, deps: ClickupAgentDeps): Promise<unknown> {
  if (typeof input.id !== "string" || !input.id.trim()) throw new Error("id is required");
  const current = await deps.api.task(input.id.trim());
  const list = deps.lists.find((candidate) => candidate.id === current.listId);
  if (!list) throw new Error("Unknown list; run clickup.lists");
  const original = draftFromTask(current);
  const edited = await draftFromInput(input, deps, list.id, original, [current], false);
  if (input.done !== undefined) {
    if (typeof input.done !== "boolean") throw new Error("done must be true or false");
    const state = await deps.store.loadMeta(list.id);
    const target = state.meta ? (input.done ? doneStatus(state.meta) : reopenStatus(state.meta)) : null;
    if (!target) throw new Error(input.done ? "This list has no done status." : "This list has no open status.");
    edited.status = target;
  }
  const patch: ClickupTaskInput = taskPatch(original, edited);
  if (Object.keys(patch).length === 0) return { id: current.id, url: current.url, changed: false };
  const saved = await deps.store.updateTask(current.id, list.id, patch);
  if (!saved) throw new Error("That task is being saved. Try again.");
  return { id: saved.id, url: saved.url, changed: true };
}

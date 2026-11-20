import { parseTaskStatus, type TaskStatus } from "./tasks";

/**
 * Fork (L-373): one step of a task with its own status. Ticking it sets
 * `completed`; unticking sets `todo`. One level only: a subtask has no steps.
 */
export type Subtask = {
  id: string;
  title: string;
  status: TaskStatus;
};

export const SUBTASKS_MAX = 100;
const TITLE_MAX = 200;

export function subtaskProgress(subtasks: readonly Subtask[] | undefined): {
  done: number;
  total: number;
} {
  const list = subtasks ?? [];
  return {
    done: list.filter((subtask) => subtask.status === "completed").length,
    total: list.length,
  };
}

export function newSubtask(title: string, status: TaskStatus = "todo"): Subtask {
  return { id: crypto.randomUUID(), title: title.trim().slice(0, TITLE_MAX), status };
}

export function toggleSubtask(list: readonly Subtask[], id: string): Subtask[] {
  return list.map((subtask) =>
    subtask.id === id
      ? { ...subtask, status: subtask.status === "completed" ? "todo" : "completed" }
      : subtask,
  );
}

export function changeSubtask(
  list: readonly Subtask[],
  id: string,
  change: Partial<Omit<Subtask, "id">>,
): Subtask[] {
  return list.map((subtask) => (subtask.id === id ? { ...subtask, ...change } : subtask));
}

export function removeSubtask(list: readonly Subtask[], id: string): Subtask[] {
  return list.filter((subtask) => subtask.id !== id);
}

/** Moves a step one place up (-1) or down (1); unchanged at either end. */
export function moveSubtask(list: readonly Subtask[], id: string, delta: -1 | 1): Subtask[] {
  const from = list.findIndex((subtask) => subtask.id === id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= list.length) return [...list];
  const next = [...list];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/** Subtasks as stored: anything malformed is dropped rather than failing the whole task. */
export function normalizeSubtasks(value: unknown): Subtask[] {
  if (!Array.isArray(value)) return [];
  const kept: Subtask[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const { id, title, status } = item as Record<string, unknown>;
    if (typeof id !== "string" || typeof title !== "string" || !title.trim()) continue;
    let parsed: TaskStatus = "todo";
    try {
      parsed = parseTaskStatus(status).status;
    } catch {
      // Unknown status from a newer writer: show it as Todo.
    }
    kept.push({ id, title: title.trim(), status: parsed });
  }
  return kept;
}

/**
 * Operator / agent input: a list of titles or `{ id?, title, status? }`. An
 * entry with a known `id` keeps that step (and its status unless given), so an
 * agent can tick one step by sending the list back.
 *
 * @throws Error with an agent-readable message when the shape is wrong.
 */
export function parseSubtasksInput(
  value: unknown,
  existing: readonly Subtask[] = [],
): Subtask[] {
  if (!Array.isArray(value)) throw new Error("subtasks must be an array");
  if (value.length > SUBTASKS_MAX)
    throw new Error(`A task can have at most ${SUBTASKS_MAX} subtasks`);
  return value.map((item, index) => {
    if (typeof item === "string") {
      if (!item.trim()) throw new Error(`subtasks[${index}] is empty`);
      return newSubtask(item);
    }
    if (!item || typeof item !== "object")
      throw new Error(`subtasks[${index}] must be a title or { title, status }`);
    const { id, title, status } = item as Record<string, unknown>;
    const known =
      typeof id === "string" ? existing.find((subtask) => subtask.id === id) : undefined;
    if (id !== undefined && !known) throw new Error(`subtasks[${index}].id was not found`);
    const name = title === undefined ? known?.title : title;
    if (typeof name !== "string" || !name.trim())
      throw new Error(`subtasks[${index}].title is required`);
    const nextStatus =
      status === undefined ? (known?.status ?? "todo") : parseTaskStatus(status).status;
    return known
      ? { id: known.id, title: name.trim().slice(0, TITLE_MAX), status: nextStatus }
      : newSubtask(name, nextStatus);
  });
}

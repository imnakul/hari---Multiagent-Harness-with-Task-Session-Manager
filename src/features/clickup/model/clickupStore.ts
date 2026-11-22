import { useSyncExternalStore } from "react";
import {
  ClickupError,
  clickupApi,
  type ClickupApi,
  type ClickupListInfo,
  type ClickupMember,
  type ClickupTask,
  type ClickupTaskInput,
} from "./clickupApi";
import { mergeTasks, newerTask } from "./clickupTasks";

/**
 * Fork (L-381): in-memory ClickUp data (tasks, list meta, members). Nothing here
 * is persisted: member names and emails live in memory only (DPDP), and the
 * token never reaches this module.
 */

export const MAX_TASK_PAGES = 5;
export const META_TTL_MS = 10 * 60_000;

export type ListLoad =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready" }
  | { kind: "error"; error: ClickupError };

export interface ListState {
  tasks: ClickupTask[];
  load: ListLoad;
  /** Which "Show done" setting the tasks were fetched with. */
  includeClosed: boolean;
  meta: ClickupListInfo | null;
  metaAt: number;
  members: ClickupMember[];
}

export interface ClickupSnapshot {
  lists: Readonly<Record<string, ListState>>;
  savingTaskIds: readonly string[];
  /** Epoch ms until which no request may start (a 429 for the whole token), or 0. */
  retryAt: number;
  /** Lists a save was refused on (403); read-only until the next app start. */
  readOnlyLists: readonly string[];
  /** Tasks created this session, shown first in their list. */
  createdIds: readonly string[];
  /** A request found the token missing or rejected. */
  needsConnect: boolean;
}

const EMPTY_LIST: ListState = {
  tasks: [],
  load: { kind: "idle" },
  includeClosed: false,
  meta: null,
  metaAt: 0,
  members: [],
};

export interface ClickupStore {
  getSnapshot(): ClickupSnapshot;
  subscribe(listener: () => void): () => void;
  /** Loads (or reloads) a list's tasks. Resolves when settled; failures are recorded in the snapshot. */
  refresh(listId: string, options?: { force?: boolean; includeClosed?: boolean }): Promise<void>;
  loadMeta(listId: string): Promise<ListState>;
  createTask(listId: string, input: ClickupTaskInput): Promise<ClickupTask>;
  /** Returns null when a save for that task is already running (C4). */
  updateTask(taskId: string, listId: string, patch: ClickupTaskInput): Promise<ClickupTask | null>;
  upsertTask(task: ClickupTask): void;
  clear(): void;
  setNeedsConnect(value: boolean): void;
}

export function createClickupStore(
  api: Pick<ClickupApi, "list" | "members" | "tasks" | "createTask" | "updateTask">,
  now: () => number = Date.now,
): ClickupStore {
  let snapshot: ClickupSnapshot = {
    lists: {},
    savingTaskIds: [],
    retryAt: 0,
    readOnlyLists: [],
    createdIds: [],
    needsConnect: false,
  };
  const listeners = new Set<() => void>();
  const generations = new Map<string, number>();
  const metaRequests = new Map<string, Promise<ListState>>();

  const emit = (patch: Partial<ClickupSnapshot>): void => {
    snapshot = { ...snapshot, ...patch };
    listeners.forEach((listener) => listener());
  };
  const listOf = (listId: string): ListState => snapshot.lists[listId] ?? EMPTY_LIST;
  const patchList = (listId: string, patch: Partial<ListState>): void =>
    emit({ lists: { ...snapshot.lists, [listId]: { ...listOf(listId), ...patch } } });

  function noteError(error: unknown): ClickupError {
    const failure = error instanceof ClickupError ? error : new ClickupError("network");
    if (failure.kind === "rateLimited") emit({ retryAt: now() + (failure.retryAfterSeconds ?? 60) * 1000 });
    if (failure.kind === "auth" || failure.kind === "notConnected") emit({ needsConnect: true });
    return failure;
  }
  const blocked = (): boolean => now() < snapshot.retryAt;

  async function loadMeta(listId: string): Promise<ListState> {
    const current = listOf(listId);
    if (current.meta && now() - current.metaAt < META_TTL_MS) return current;
    const pending = metaRequests.get(listId);
    if (pending) return pending;
    if (blocked()) return current;
    const request = (async (): Promise<ListState> => {
      try {
        const meta = await api.list(listId);
        // A guest token may not read members; the picker then uses the assignees seen on the tasks.
        const members = await api.members(listId).catch(() => listOf(listId).members);
        patchList(listId, { meta, members, metaAt: now() });
      } catch (error) {
        noteError(error);
      } finally {
        metaRequests.delete(listId);
      }
      return listOf(listId);
    })();
    metaRequests.set(listId, request);
    return request;
  }

  async function refresh(
    listId: string,
    options: { force?: boolean; includeClosed?: boolean } = {},
  ): Promise<void> {
    const includeClosed = options.includeClosed ?? listOf(listId).includeClosed;
    if (blocked()) return;
    const current = listOf(listId);
    if (current.load.kind === "loading") return;
    const sameFilter = current.includeClosed === includeClosed;
    if (!options.force && sameFilter && current.load.kind === "ready") return;
    const generation = (generations.get(listId) ?? 0) + 1;
    generations.set(listId, generation);
    const startedAt = now();
    patchList(listId, { load: { kind: "loading" }, includeClosed, tasks: sameFilter ? current.tasks : [] });
    const fetched: ClickupTask[] = [];
    try {
      for (let page = 0; page < MAX_TASK_PAGES; page += 1) {
        const reply = await api.tasks(listId, page, includeClosed);
        fetched.push(...reply.tasks);
        if (reply.lastPage) break;
      }
    } catch (error) {
      if (generations.get(listId) !== generation) return;
      patchList(listId, { load: { kind: "error", error: noteError(error) } });
      return;
    }
    if (generations.get(listId) !== generation) return;
    const local = listOf(listId).tasks;
    const fetchedIds = new Set(fetched.map((task) => task.id));
    // Tasks missing from the fetch go, unless they were changed here after the fetch began.
    const kept = local.filter((task) => fetchedIds.has(task.id) || task.dateUpdated > startedAt);
    patchList(listId, { tasks: mergeTasks(kept, fetched), load: { kind: "ready" } });
  }

  function upsertTask(task: ClickupTask): void {
    const list = listOf(task.listId);
    const existing = list.tasks.find((candidate) => candidate.id === task.id);
    patchList(task.listId, {
      tasks: existing
        ? list.tasks.map((candidate) => (candidate.id === task.id ? newerTask(candidate, task) : candidate))
        : [task, ...list.tasks],
    });
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    refresh,
    loadMeta,
    async createTask(listId, input) {
      if (blocked()) throw new ClickupError("rateLimited", Math.ceil((snapshot.retryAt - now()) / 1000));
      try {
        const task = await api.createTask(listId, input);
        const created = { ...task, listId: task.listId || listId };
        upsertTask(created);
        emit({ createdIds: [created.id, ...snapshot.createdIds] });
        return created;
      } catch (error) {
        const failure = noteError(error);
        if (failure.kind === "forbidden") emit({ readOnlyLists: [...snapshot.readOnlyLists, listId] });
        throw failure;
      }
    },
    async updateTask(taskId, listId, patch) {
      if (snapshot.savingTaskIds.includes(taskId)) return null;
      if (blocked()) throw new ClickupError("rateLimited", Math.ceil((snapshot.retryAt - now()) / 1000));
      emit({ savingTaskIds: [...snapshot.savingTaskIds, taskId] });
      try {
        const task = await api.updateTask(taskId, patch);
        const saved = { ...task, listId: task.listId || listId };
        upsertTask(saved);
        return saved;
      } catch (error) {
        const failure = noteError(error);
        if (failure.kind === "forbidden" && !snapshot.readOnlyLists.includes(listId)) {
          emit({ readOnlyLists: [...snapshot.readOnlyLists, listId] });
        }
        throw failure;
      } finally {
        emit({ savingTaskIds: snapshot.savingTaskIds.filter((id) => id !== taskId) });
      }
    },
    upsertTask,
    clear() {
      generations.clear();
      metaRequests.clear();
      emit({ lists: {}, savingTaskIds: [], retryAt: 0, createdIds: [], needsConnect: false });
    },
    setNeedsConnect(value) {
      if (snapshot.needsConnect !== value) emit({ needsConnect: value });
    },
  };
}

/** The app-wide store; the view and the agent actions share it so an agent's write shows up at once. */
export const clickupStore: ClickupStore = createClickupStore(clickupApi);

export function useClickupSnapshot(): ClickupSnapshot {
  return useSyncExternalStore(clickupStore.subscribe, clickupStore.getSnapshot, clickupStore.getSnapshot);
}

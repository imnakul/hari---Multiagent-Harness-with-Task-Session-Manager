/**
 * Fork (L-396): which chats are Activity "Ask" chats. An Ask chat is a normal
 * scratch chat whose id is listed here; the Chats sidebar skips it and its
 * turns can only use `activity.*` app actions.
 */

export const ACTIVITY_ASK_KEY = "monocode.activityAsk.v1";

export type AskRegistry = { ids: string[]; lastOpenId: string | null };

const EMPTY: AskRegistry = { ids: [], lastOpenId: null };
const MAX_IDS = 200;

const listeners = new Set<() => void>();
let cache: { raw: string | null; value: AskRegistry } | null = null;

function storage(): Pick<Storage, "getItem" | "setItem"> | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** Reads and narrows the stored value by hand; anything unexpected is an empty registry. */
function parse(raw: string | null): AskRegistry {
  if (!raw) return EMPTY;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return EMPTY;
    const ids: unknown = Reflect.get(value, "ids");
    const last: unknown = Reflect.get(value, "lastOpenId");
    if (!Array.isArray(ids)) return EMPTY;
    const clean = [...new Set(ids.filter((id): id is string => typeof id === "string" && id.length > 0 && id.length <= 200))].slice(-MAX_IDS);
    return { ids: clean, lastOpenId: typeof last === "string" && clean.includes(last) ? last : null };
  } catch {
    return EMPTY;
  }
}

function read(): AskRegistry {
  const raw = storage()?.getItem(ACTIVITY_ASK_KEY) ?? null;
  if (cache && cache.raw === raw) return cache.value;
  const value = parse(raw);
  cache = { raw, value };
  return value;
}

function write(next: AskRegistry): void {
  try {
    storage()?.setItem(ACTIVITY_ASK_KEY, JSON.stringify(next));
  } catch {
    // Storage full or blocked: the registry stays as it was; chats still work this run.
    return;
  }
  cache = null;
  for (const listener of listeners) listener();
}

/** A stable snapshot for `useSyncExternalStore`. */
export function askRegistrySnapshot(): AskRegistry {
  return read();
}

export function listAskSessions(): readonly string[] {
  return read().ids;
}

export function isActivityAskSession(id: string): boolean {
  return read().ids.includes(id);
}

export function lastOpenAskId(): string | null {
  return read().lastOpenId;
}

export function registerAskSession(id: string): void {
  const current = read();
  if (current.ids.includes(id)) return;
  write({ ids: [...current.ids, id], lastOpenId: current.lastOpenId });
}

export function unregisterAskSession(id: string): void {
  const current = read();
  if (!current.ids.includes(id)) return;
  write({ ids: current.ids.filter((entry) => entry !== id), lastOpenId: current.lastOpenId === id ? null : current.lastOpenId });
}

export function saveLastOpen(id: string): void {
  const current = read();
  if (current.lastOpenId === id || !current.ids.includes(id)) return;
  write({ ...current, lastOpenId: id });
}

/**
 * Drops ids whose session no longer exists, and all but the newest of the
 * chats that have no user turn (a stale open can leave an empty one behind).
 */
export function pruneAskRegistry(existing: ReadonlyMap<string, { hasTurn: boolean }>): void {
  const current = read();
  const alive = current.ids.filter((id) => existing.has(id));
  const empties = alive.filter((id) => existing.get(id)?.hasTurn === false);
  const dropEmpty = new Set(empties.slice(0, Math.max(0, empties.length - 1)));
  const ids = alive.filter((id) => !dropEmpty.has(id));
  if (ids.length === current.ids.length) return;
  write({ ids, lastOpenId: current.lastOpenId && ids.includes(current.lastOpenId) ? current.lastOpenId : null });
}

export function subscribeAsk(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** Test seam: forget the cached read after a test swaps storage. */
export function resetAskRegistryCache(): void {
  cache = null;
}

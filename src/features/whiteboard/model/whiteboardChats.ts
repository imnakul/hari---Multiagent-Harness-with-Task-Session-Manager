/**
 * Fork (L-403): which chat belongs to which Whiteboard sheet. A sheet's chat is
 * a normal scratch chat whose id is listed here; the Chats sidebar skips it,
 * its turns can only use `whiteboard.*` app actions, and those default to its
 * sheet. Stored in localStorage; anything unreadable is an empty map.
 */

export const WHITEBOARD_CHATS_KEY = "monocode.whiteboardChats.v1";

/** sheet id → chat (session) id. */
export type WhiteboardChatMap = Readonly<Record<string, string>>;

const MAX_SHEETS = 500;
const ID = /^[A-Za-z0-9_-]{1,200}$/;
const EMPTY: WhiteboardChatMap = {};

const listeners = new Set<() => void>();
let cache: { raw: string | null; value: WhiteboardChatMap; bySession: Map<string, string> } | null = null;

function storage(): Pick<Storage, "getItem" | "setItem"> | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function parse(raw: string | null): WhiteboardChatMap {
  if (!raw) return EMPTY;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null || Array.isArray(value)) return EMPTY;
    const clean: Record<string, string> = {};
    for (const [sheetId, sessionId] of Object.entries(value).slice(-MAX_SHEETS)) {
      if (ID.test(sheetId) && typeof sessionId === "string" && sessionId.length > 0 && sessionId.length <= 200)
        clean[sheetId] = sessionId;
    }
    return clean;
  } catch {
    return EMPTY;
  }
}

function read(): { value: WhiteboardChatMap; bySession: Map<string, string> } {
  const raw = storage()?.getItem(WHITEBOARD_CHATS_KEY) ?? null;
  if (cache && cache.raw === raw) return cache;
  const value = parse(raw);
  const bySession = new Map(Object.entries(value).map(([sheetId, sessionId]) => [sessionId, sheetId]));
  cache = { raw, value, bySession };
  return cache;
}

function write(next: WhiteboardChatMap): void {
  try {
    storage()?.setItem(WHITEBOARD_CHATS_KEY, JSON.stringify(next));
  } catch {
    // Storage full or blocked: the map stays as it was; the chat still works this run.
    return;
  }
  cache = null;
  for (const listener of listeners) listener();
}

/** A stable snapshot for `useSyncExternalStore`. */
export function whiteboardChatsSnapshot(): WhiteboardChatMap {
  return read().value;
}

export function whiteboardChatFor(sheetId: string): string | null {
  return read().value[sheetId] ?? null;
}

/** The sheet a chat belongs to, or null for any other chat. */
export function whiteboardChatSheet(sessionId: string): string | null {
  return read().bySession.get(sessionId) ?? null;
}

export function isWhiteboardChatSession(sessionId: string): boolean {
  return read().bySession.has(sessionId);
}

/** Every Whiteboard chat id, for keeping them out of the Chats list. */
export function whiteboardChatIds(map: WhiteboardChatMap = read().value): Set<string> {
  return new Set(Object.values(map));
}

export function setWhiteboardChat(sheetId: string, sessionId: string): void {
  if (!ID.test(sheetId)) return;
  const current = read().value;
  if (current[sheetId] === sessionId) return;
  write({ ...current, [sheetId]: sessionId });
}

/**
 * Drops the sheet's chat link: the sheet was deleted, or a new chat starts.
 * The old chat then shows in the Chats list like any other, so it isn't lost.
 */
export function forgetWhiteboardChat(sheetId: string): void {
  const current = read().value;
  if (!(sheetId in current)) return;
  const { [sheetId]: _removed, ...rest } = current;
  write(rest);
}

export function subscribeWhiteboardChats(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** Test seam: forget the cached read after a test swaps storage. */
export function resetWhiteboardChatsCache(): void {
  cache = null;
}

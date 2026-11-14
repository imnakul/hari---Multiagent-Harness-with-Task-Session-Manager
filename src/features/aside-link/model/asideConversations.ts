/**
 * Fork (L-274): which MonoCode session each Aside chat runs in.
 *
 * Aside names no conversation, but each request repeats every earlier user
 * text in order. A chat is keyed by those texts: the key before the newest
 * text finds the session, and the key including it is saved after the turn.
 * An edited or regenerated message changes the key, so it starts afresh.
 */

const STORAGE_KEY = "monocode.asideLink.conversations";
const MAX_ENTRIES = 500;

type Stored = { key: string; sessionId: string }[];

export type KeyValueStore = Pick<Storage, "getItem" | "setItem">;

async function sha256(text: string): Promise<string> {
  const bytes = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
  );
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Model and texts together, so switching harness in Aside starts a new session. */
export function conversationKey(scope: string, texts: readonly string[]): Promise<string> {
  return sha256(JSON.stringify([scope, ...texts]));
}

function read(store: KeyValueStore): Stored {
  try {
    const parsed: unknown = JSON.parse(store.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed)
      ? parsed.filter(
          (item: unknown): item is Stored[number] =>
            !!item &&
            typeof item === "object" &&
            "key" in item &&
            typeof item.key === "string" &&
            "sessionId" in item &&
            typeof item.sessionId === "string",
        )
      : [];
  } catch {
    // A damaged entry only loses the mapping; the next turn starts a new session.
    return [];
  }
}

export function findConversation(store: KeyValueStore, key: string): string | undefined {
  return read(store).find((item) => item.key === key)?.sessionId;
}

/** Newest first, keeping the last `MAX_ENTRIES`. */
export function rememberConversation(store: KeyValueStore, key: string, sessionId: string): void {
  const next = [{ key, sessionId }, ...read(store).filter((item) => item.key !== key)].slice(
    0,
    MAX_ENTRIES,
  );
  store.setItem(STORAGE_KEY, JSON.stringify(next));
}

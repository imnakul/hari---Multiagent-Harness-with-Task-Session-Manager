import Storage from "expo-sqlite/kv-store";
import { useSyncExternalStore } from "react";

/**
 * Fork (Hari, L-275): the desktop bell's history on the phone. The desktop
 * keeps the list (`notifications.list`); the phone shows it on its
 * Notifications screen and posts each new entry in Android's notification
 * panel. Dismiss, read and clear go back to the desktop, so the bell matches.
 */

export const FEED_KINDS = [
  "finished",
  "approval",
  "question",
  "automationSucceeded",
  "automationFailed",
] as const;
export type FeedKind = (typeof FEED_KINDS)[number];

export type FeedItem = {
  id: string;
  kind: FeedKind;
  title: string;
  body: string;
  /** Milliseconds since the epoch, on the desktop's clock. */
  at: number;
  read: boolean;
  sessionId?: string;
  /** The phone's id for the chat's project (the same one the catalog uses). */
  projectId?: string;
  projectName?: string;
  /** Recorded while the chat was open on the computer. */
  seenOnDesktop?: boolean;
};

export type FeedState =
  /** Not asked yet, or the first answer failed (`error`). */
  | { phase: "loading"; error: string | null }
  /** The desktop app is older than L-275. */
  | { phase: "unsupported" }
  /** MonoCode is running, but no window has sent the list yet. */
  | { phase: "waiting" }
  /** `error` is a later refresh that failed; the items are the last ones. */
  | { phase: "ready"; items: FeedItem[]; error: string | null };

type Run = (method: string, params?: object) => Promise<unknown>;

const LOADING: FeedState = { phase: "loading", error: null };
let state: FeedState = LOADING;
let run: Run | null = null;
let refetch: (() => Promise<void>) | null = null;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export function feedState(): FeedState {
  return state;
}

export function setFeedState(next: FeedState): void {
  state = next;
  listeners.forEach((listener) => listener());
}

export function useFeed(): FeedState {
  return useSyncExternalStore(subscribe, feedState);
}

/** Set by the feed while a desktop is paired; null once it goes. */
export function connectFeed(command: Run | null, refresh: (() => Promise<void>) | null): void {
  run = command;
  refetch = refresh;
  if (!command) setFeedState(LOADING);
}

export function refreshFeed(): Promise<void> {
  return refetch?.() ?? Promise.resolve();
}

/** Whether the desktop sends its list: the phone's own guesses can stop. */
export function feedServed(): boolean {
  return state.phase === "ready" || state.phase === "waiting";
}

const text = (value: unknown): value is string => typeof value === "string";
const isKind = (value: unknown): value is FeedKind => FEED_KINDS.some((each) => each === value);

function parseItem(value: unknown): FeedItem | null {
  if (typeof value !== "object" || value === null) return null;
  const field = (name: string): unknown => Reflect.get(value, name);
  const id = field("id");
  const kind = field("kind");
  const title = field("title");
  const body = field("body");
  const at = field("at");
  const read = field("read");
  if (!text(id) || !id || !text(title) || !text(body) || typeof read !== "boolean") return null;
  if (!isKind(kind)) return null;
  if (typeof at !== "number" || !Number.isFinite(at)) return null;
  const optional = (name: string) => {
    const each = field(name);
    return text(each) && each ? each : undefined;
  };
  const sessionId = optional("sessionId");
  const projectId = optional("projectId");
  const projectName = optional("projectName");
  return {
    id,
    kind,
    title,
    body,
    at,
    read,
    ...(sessionId ? { sessionId } : {}),
    ...(projectId ? { projectId } : {}),
    ...(projectName ? { projectName } : {}),
    ...(field("seenOnDesktop") === true ? { seenOnDesktop: true } : {}),
  };
}

/** The desktop's answer to `notifications.list`; null if it isn't one. */
export function parseFeed(value: unknown): { available: boolean; items: FeedItem[] } | null {
  if (typeof value !== "object" || value === null) return null;
  const available = Reflect.get(value, "available");
  const items: unknown = Reflect.get(value, "items");
  if (typeof available !== "boolean" || !Array.isArray(items)) return null;
  return {
    available,
    items: items.map(parseItem).filter((item): item is FeedItem => item !== null),
  };
}

/** The entries to show: those for chats open on the computer only if wanted. */
export function shownFeedItems(items: readonly FeedItem[], seenOnDesktop: boolean): FeedItem[] {
  return items.filter((item) => seenOnDesktop || !item.seenOnDesktop);
}

/** One occurrence of an entry: a chat that finishes again keeps its id. */
export const occurrence = (item: FeedItem) => `${item.id}@${item.at}`;

/** The Android notification that shows this entry. */
export const panelId = (id: string) => `feed:${id}`;

/** Changes the list at once, then on the desktop; put back if it refuses. */
async function change(
  method: string,
  params: object,
  apply: (items: FeedItem[]) => FeedItem[],
): Promise<void> {
  const before = state;
  if (!run) throw new Error("Connect your computer first");
  if (before.phase === "ready") setFeedState({ ...before, items: apply(before.items) });
  try {
    await run(method, params);
  } catch (error) {
    if (state.phase === "ready" && before.phase === "ready") setFeedState(before);
    throw error;
  }
}

export function dismissFeed(ids: string[]): Promise<void> {
  const gone = new Set(ids);
  return change("notifications.dismiss", { ids }, (items) =>
    items.filter((item) => !gone.has(item.id)),
  );
}

/** Marks these entries read, or all of them when `ids` is left out. */
export function readFeed(ids?: string[]): Promise<void> {
  const only = ids ? new Set(ids) : null;
  return change("notifications.read", ids ? { ids } : {}, (items) =>
    items.map((item) => (!only || only.has(item.id) ? { ...item, read: true } : item)),
  );
}

export function clearFeed(): Promise<void> {
  return change("notifications.clear", {}, () => []);
}

/**
 * What the phone remembers per desktop: the entries it has already looked at
 * (`known`, null before its first look) and the ones it has in the panel.
 */
export type FeedRecord = { known: string[] | null; posted: string[] };

const recordKey = (fingerprint: string) => `notifications.feed.${fingerprint}`;

export function loadFeedRecord(fingerprint: string): FeedRecord {
  try {
    const parsed: unknown = JSON.parse(Storage.getItemSync(recordKey(fingerprint)) ?? "null");
    if (typeof parsed !== "object" || parsed === null) return { known: null, posted: [] };
    const strings = (value: unknown) =>
      Array.isArray(value) ? value.filter(text) : null;
    return {
      known: strings(Reflect.get(parsed, "known")),
      posted: strings(Reflect.get(parsed, "posted")) ?? [],
    };
  } catch {
    return { known: null, posted: [] };
  }
}

export function saveFeedRecord(fingerprint: string, record: FeedRecord): void {
  void Storage.setItem(recordKey(fingerprint), JSON.stringify(record));
}

/**
 * What to post and withdraw for this list. The first look posts nothing: the
 * entries already there are old news. An entry is posted once per occurrence,
 * if unread and `wanted`; a posted one goes from the panel once the desktop
 * has it read or gone.
 */
export function planPanel(
  items: readonly FeedItem[],
  record: FeedRecord,
  wanted: (item: FeedItem) => boolean,
): { post: FeedItem[]; withdraw: string[]; record: FeedRecord } {
  const known = new Set(record.known ?? []);
  const post =
    record.known === null
      ? []
      : items.filter((item) => !known.has(occurrence(item)) && !item.read && wanted(item));
  const byId = new Map(items.map((item) => [item.id, item]));
  const withdraw = record.posted.filter((id) => {
    const item = byId.get(id);
    return !item || item.read;
  });
  const gone = new Set(withdraw);
  const posted = [
    ...record.posted.filter((id) => !gone.has(id)),
    ...post.map((item) => item.id).filter((id) => !record.posted.includes(id)),
  ];
  return { post, withdraw, record: { known: items.map(occurrence), posted } };
}

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { isEditTool } from "../../../integrations/harness/core/preview";
import type { Block } from "./session";

/**
 * Session overview (fork, L-191, reworked in L-192): a chat's side panel.
 * The Summary tab shows the chat's notes (`session_metadata`); this file
 * keeps the bookmarks, stored per chat in the `session_panel` table as JSON.
 * Every window reloads on the change event. Older saves also held AI points;
 * they are ignored and dropped on the next save.
 */
export type SessionBookmark = {
  id: string;
  blockId: string;
  text: string;
  at: number;
  /** Selected text saved from the reply; missing for a whole-reply bookmark. */
  quote?: string;
};

export type SessionPanelData = { version: 1; bookmarks: SessionBookmark[] };

export const SESSION_PANEL_CHANGED_EVENT = "monocode:session-panel-changed";
export const EMPTY_SESSION_PANEL: SessionPanelData = { version: 1, bookmarks: [] };

const TEXT_MAX = 400;
const QUOTE_MAX = 2_000;
const BOOKMARKS_MAX = 300;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function cleanText(value: unknown, max = TEXT_MAX): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function optionalId(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function parseBookmark(value: unknown): SessionBookmark | null {
  if (!isRecord(value)) return null;
  const id = optionalId(value.id);
  const blockId = optionalId(value.blockId);
  if (!id || !blockId) return null;
  const bookmark: SessionBookmark = {
    id,
    blockId,
    text: cleanText(value.text),
    at: typeof value.at === "number" ? value.at : 0,
  };
  const quote = cleanText(value.quote, QUOTE_MAX);
  if (quote) bookmark.quote = quote;
  return bookmark;
}

/** Stored JSON (or its parsed value) to panel data; anything unreadable becomes empty. */
export function parseSessionPanelData(raw: unknown): SessionPanelData {
  let value = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw) as unknown;
    } catch {
      return EMPTY_SESSION_PANEL;
    }
  }
  if (!isRecord(value)) return EMPTY_SESSION_PANEL;
  const bookmarks = Array.isArray(value.bookmarks)
    ? value.bookmarks.flatMap((item) => parseBookmark(item) ?? [])
    : [];
  return { version: 1, bookmarks };
}

/** The JSON to store; empty panels store nothing. */
export function serializeSessionPanelData(data: SessionPanelData): string {
  if (!data.bookmarks.length) return "";
  return JSON.stringify({ version: 1, bookmarks: data.bookmarks.slice(-BOOKMARKS_MAX) });
}

let idCounter = 0;
export function newPanelId(prefix: string, now: number = Date.now()): string {
  idCounter = (idCounter + 1) % 1_000_000;
  return `${prefix}-${now.toString(36)}-${idCounter.toString(36)}`;
}

// ---------------------------------------------------------------------------
// Edits (pure, so the store and tests share them).

/**
 * Adds a bookmark. One per reply for whole-reply bookmarks, and one per
 * quote within a reply; saving the same again moves it to the end.
 */
export function addBookmark(
  data: SessionPanelData,
  blockId: string,
  text: string,
  now: number = Date.now(),
  quote?: string,
): SessionPanelData {
  const cleanQuote = cleanText(quote, QUOTE_MAX);
  const others = data.bookmarks.filter(
    (bookmark) => bookmark.blockId !== blockId || (bookmark.quote ?? "") !== cleanQuote,
  );
  const added: SessionBookmark = { id: newPanelId("b", now), blockId, text: cleanText(text), at: now };
  if (cleanQuote) added.quote = cleanQuote;
  return { ...data, bookmarks: [...others, added] };
}

export function editBookmark(data: SessionPanelData, id: string, text: string): SessionPanelData {
  return {
    ...data,
    bookmarks: data.bookmarks.map((bookmark) =>
      bookmark.id === id ? { ...bookmark, text: cleanText(text) } : bookmark,
    ),
  };
}

export function removeBookmark(data: SessionPanelData, id: string): SessionPanelData {
  return { ...data, bookmarks: data.bookmarks.filter((bookmark) => bookmark.id !== id) };
}

// ---------------------------------------------------------------------------
// Files: every file the chat edited, from tool data (no AI).

export type SessionFileTouch = {
  path: string;
  /** The first and last tool block that edited it. */
  firstBlockId: string;
  lastBlockId: string;
  edits: number;
};

/** Successful edits across the whole chat, most recently edited first. */
export function sessionFileTouches(blocks: readonly Block[]): SessionFileTouch[] {
  const byPath = new Map<string, SessionFileTouch & { order: number }>();
  blocks.forEach((block, order) => {
    const tool = block.role === "tool" ? block.tool : undefined;
    if (
      !tool ||
      !["completed", "success"].includes(tool.status ?? "") ||
      !isEditTool(tool.kind, tool.title, tool.preview)
    )
      return;
    const paths = new Set([...(tool.paths ?? []), tool.preview?.path ?? ""].filter(Boolean));
    for (const path of paths) {
      const seen = byPath.get(path);
      if (seen) {
        seen.lastBlockId = block.id;
        seen.edits += 1;
        seen.order = order;
      } else byPath.set(path, { path, firstBlockId: block.id, lastBlockId: block.id, edits: 1, order });
    }
  });
  return [...byPath.values()]
    .sort((a, b) => b.order - a.order)
    .map(({ order: _order, ...touch }) => touch);
}

// ---------------------------------------------------------------------------
// Store: one entry per chat, loaded on first use and reloaded on change.

type Entry = { data: SessionPanelData; loaded: boolean };
const NOT_LOADED: Entry = { data: EMPTY_SESSION_PANEL, loaded: false };

let entries = new Map<string, Entry>();
const listeners = new Map<string, Set<() => void>>();
const loads = new Map<string, Promise<SessionPanelData>>();
const queues = new Map<string, Promise<unknown>>();
let stopListening: (() => void) | null = null;

function publish(sessionId: string, data: SessionPanelData): void {
  entries = new Map(entries).set(sessionId, { data, loaded: true });
  for (const listener of listeners.get(sessionId) ?? []) listener();
}

function fetchPanel(sessionId: string): Promise<SessionPanelData> {
  const running = loads.get(sessionId);
  if (running) return running;
  const load = invoke<unknown>("session_panel_get", { sessionId })
    .then((row) => {
      const data = parseSessionPanelData(isRecord(row) ? row.data : null);
      publish(sessionId, data);
      return data;
    })
    .finally(() => loads.delete(sessionId));
  loads.set(sessionId, load);
  return load;
}

function startListening(): void {
  let disposed = false;
  stopListening = () => {
    disposed = true;
  };
  Promise.resolve()
    .then(() =>
      listen<string>(SESSION_PANEL_CHANGED_EVENT, (event) => {
        const id = event.payload;
        if (typeof id === "string" && listeners.has(id)) void fetchPanel(id).catch(() => {});
      }),
    )
    .then((unlisten) => {
      if (typeof unlisten !== "function") return;
      if (disposed) unlisten();
      else
        stopListening = () => {
          disposed = true;
          unlisten();
        };
    })
    .catch(() => undefined);
}

export function subscribeSessionPanel(sessionId: string, listener: () => void): () => void {
  if (listeners.size === 0) startListening();
  const set = listeners.get(sessionId) ?? new Set();
  set.add(listener);
  listeners.set(sessionId, set);
  if (set.size === 1 && !entries.get(sessionId)?.loaded)
    void fetchPanel(sessionId).catch((error: unknown) =>
      console.warn("Could not load the session panel:", error),
    );
  return () => {
    set.delete(listener);
    if (set.size === 0) listeners.delete(sessionId);
    if (listeners.size === 0) {
      stopListening?.();
      stopListening = null;
    }
  };
}

/** Stable between changes, so it can back `useSyncExternalStore`. */
export function sessionPanelSnapshot(sessionId: string): Entry {
  return entries.get(sessionId) ?? NOT_LOADED;
}

/**
 * Applies `change` to the chat's latest saved panel and saves it. Changes to
 * one chat run one at a time, so two quick edits never overwrite each other.
 * Resolves to the saved data.
 */
export function updateSessionPanel(
  sessionId: string,
  change: (data: SessionPanelData) => SessionPanelData,
): Promise<SessionPanelData> {
  const previous = queues.get(sessionId) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(async () => {
      const entry = entries.get(sessionId);
      const current = entry?.loaded ? entry.data : await fetchPanel(sessionId);
      const updated = change(current);
      if (updated === current) return current;
      await invoke("session_panel_save", {
        panel: { sessionId, data: serializeSessionPanelData(updated) },
      });
      publish(sessionId, updated);
      return updated;
    });
  queues.set(sessionId, next);
  void next.finally(() => {
    if (queues.get(sessionId) === next) queues.delete(sessionId);
  }).catch(() => undefined);
  return next;
}

/** The chat's saved panel, loading it when this window has not yet. */
export async function loadSessionPanel(sessionId: string): Promise<SessionPanelData> {
  const entry = entries.get(sessionId);
  return entry?.loaded ? entry.data : fetchPanel(sessionId);
}

/** Test-only. */
export function resetSessionPanelStoreForTests(): void {
  stopListening?.();
  stopListening = null;
  entries = new Map();
  listeners.clear();
  loads.clear();
  queues.clear();
}

// ---------------------------------------------------------------------------
// Per-device view settings: open or closed, and width.

export type SessionPanelView = { open: boolean; width: number; tab: SessionPanelTab };
export type SessionPanelTab = "summary" | "bookmarks" | "files";
export const SESSION_PANEL_TABS: readonly SessionPanelTab[] = ["summary", "bookmarks", "files"];
export const SESSION_PANEL_MIN_WIDTH = 260;
export const SESSION_PANEL_MAX_WIDTH = 520;
const VIEW_KEY = "monocode.sessionPanel";
const VIEW_EVENT = "monocode:session-panel-view";
const DEFAULT_VIEW: SessionPanelView = { open: false, width: 320, tab: "summary" };

export function clampPanelWidth(width: number): number {
  if (!Number.isFinite(width)) return DEFAULT_VIEW.width;
  return Math.round(Math.min(SESSION_PANEL_MAX_WIDTH, Math.max(SESSION_PANEL_MIN_WIDTH, width)));
}

export function parseSessionPanelView(raw: unknown): SessionPanelView {
  if (!isRecord(raw)) return DEFAULT_VIEW;
  return {
    open: raw.open === true,
    width: typeof raw.width === "number" ? clampPanelWidth(raw.width) : DEFAULT_VIEW.width,
    tab: SESSION_PANEL_TABS.includes(raw.tab as SessionPanelTab)
      ? (raw.tab as SessionPanelTab)
      : DEFAULT_VIEW.tab,
  };
}

let viewCache: { raw: string | null; value: SessionPanelView } | null = null;

export function loadSessionPanelView(): SessionPanelView {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(VIEW_KEY);
  } catch {
    raw = null;
  }
  if (viewCache && viewCache.raw === raw) return viewCache.value;
  let value = DEFAULT_VIEW;
  try {
    value = raw == null ? DEFAULT_VIEW : parseSessionPanelView(JSON.parse(raw));
  } catch {
    value = DEFAULT_VIEW;
  }
  viewCache = { raw, value };
  return value;
}

export function saveSessionPanelView(patch: Partial<SessionPanelView>): void {
  const next = { ...loadSessionPanelView(), ...patch };
  try {
    localStorage.setItem(VIEW_KEY, JSON.stringify(next));
  } catch {
    // private mode / quota
  }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(VIEW_EVENT));
}

/** Opens the Session overview on Summary (L-192); callers focus the chat first. */
export function openSessionOverview(): void {
  saveSessionPanelView({ open: true, tab: "summary" });
}

export function toggleSessionPanel(): void {
  saveSessionPanelView({ open: !loadSessionPanelView().open });
}

export function subscribeSessionPanelView(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onStorage = (event: StorageEvent): void => {
    if (event.key === VIEW_KEY) listener();
  };
  window.addEventListener(VIEW_EVENT, listener);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(VIEW_EVENT, listener);
    window.removeEventListener("storage", onStorage);
  };
}

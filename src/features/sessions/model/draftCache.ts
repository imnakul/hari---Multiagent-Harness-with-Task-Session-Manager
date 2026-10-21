/**
 * In-memory composer drafts, keyed by session id.
 *
 * SessionPane keeps the text you are typing in a React ref so retyping while
 * the pane stays mounted does not re-render on every keystroke. A plain ref
 * only lives as long as that one component instance though: closing a
 * session's pane (or moving it to another split) unmounts SessionPane, and
 * the ref - and whatever you had typed - is gone with no warning the moment
 * it remounts.
 *
 * This module-level map survives that, because it lives outside the React
 * tree for as long as the app process is running: the draft comes back when
 * the pane for that session opens again.
 *
 * Fork (L-160): the text is also saved to localStorage, a moment after each
 * change, so it survives a reload - including the automatic one after a
 * WebView2 page crash on Windows. Attachments and MCP tags stay in memory
 * only. Other windows share the storage, so a save merges only this
 * window's own changes into what is stored.
 */
import type { McpTag } from "./mcpPicker";
import type { Attachment } from "./session";

export const COMPOSER_INPUT_RESTORE_EVENT = "monocode:restore-composer-input";

export type ComposerInputRestore = {
  sessionId: string;
  text: string;
  attachments: Attachment[];
};

/** Restore a failed asynchronous submission into its still-open composer. */
export function restoreComposerInput(input: ComposerInputRestore): void {
  setComposerDraft(input.sessionId, input.text);
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<ComposerInputRestore>(COMPOSER_INPUT_RESTORE_EVENT, {
      detail: input,
    }),
  );
}

const DRAFTS_STORAGE_KEY = "monocode.composerDrafts.v1";
export const MAX_SAVED_DRAFTS = 50;
export const MAX_SAVED_DRAFT_CHARS = 100_000;
export const SAVED_DRAFT_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const SAVE_DELAY_MS = 400;

export type SavedDraft = { text: string; savedAt: number };

/** Reads stored drafts, dropping malformed, oversized and expired entries. */
export function parseSavedDrafts(
  value: unknown,
  now: number,
): Map<string, SavedDraft> {
  const saved = new Map<string, SavedDraft>();
  if (!value || typeof value !== "object" || Array.isArray(value)) return saved;
  for (const [id, entry] of Object.entries(value)) {
    if (!entry || typeof entry !== "object") continue;
    const text = "text" in entry ? entry.text : undefined;
    const savedAt = "savedAt" in entry ? entry.savedAt : undefined;
    if (typeof text !== "string" || !text || text.length > MAX_SAVED_DRAFT_CHARS)
      continue;
    if (typeof savedAt !== "number" || now - savedAt > SAVED_DRAFT_MAX_AGE_MS)
      continue;
    saved.set(id, { text, savedAt });
  }
  return saved;
}

/**
 * Applies this window's `changes` (null removes) to the `stored` drafts and
 * keeps the newest `MAX_SAVED_DRAFTS`.
 */
export function mergeSavedDrafts(
  stored: ReadonlyMap<string, SavedDraft>,
  changes: ReadonlyMap<string, string | null>,
  now: number,
): Record<string, SavedDraft> {
  const next = new Map(stored);
  for (const [id, text] of changes) {
    if (text && text.length <= MAX_SAVED_DRAFT_CHARS) next.set(id, { text, savedAt: now });
    else next.delete(id);
  }
  return Object.fromEntries(
    [...next].sort((a, b) => b[1].savedAt - a[1].savedAt).slice(0, MAX_SAVED_DRAFTS),
  );
}

function readStoredDrafts(): Map<string, SavedDraft> {
  try {
    if (typeof localStorage === "undefined") return new Map();
    const raw = localStorage.getItem(DRAFTS_STORAGE_KEY);
    return parseSavedDrafts(raw ? JSON.parse(raw) : null, Date.now());
  } catch {
    // Unreadable storage: drafts stay in memory for this run.
    return new Map();
  }
}

const drafts = new Map<string, string>(
  [...readStoredDrafts()].map(([id, saved]) => [id, saved.text]),
);
const mcpTags = new Map<string, McpTag[]>();
const unsavedChanges = new Map<string, string | null>();
let saveTimer: ReturnType<typeof setTimeout> | undefined;

/** Writes pending draft changes now. Safe to call with nothing pending. */
export function flushSavedDrafts(): void {
  if (saveTimer !== undefined) clearTimeout(saveTimer);
  saveTimer = undefined;
  if (unsavedChanges.size === 0) return;
  const changes = new Map(unsavedChanges);
  unsavedChanges.clear();
  try {
    if (typeof localStorage === "undefined") return;
    const merged = mergeSavedDrafts(readStoredDrafts(), changes, Date.now());
    localStorage.setItem(DRAFTS_STORAGE_KEY, JSON.stringify(merged));
  } catch {
    // Storage full or unavailable: the draft still lives in memory.
  }
}

function queueDraftSave(sessionId: string, text: string | null): void {
  unsavedChanges.set(sessionId, text);
  if (saveTimer !== undefined) clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSavedDrafts, SAVE_DELAY_MS);
}

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", flushSavedDrafts);
}

const draftRevisions = new Map<string, number>();

function noteDraftChanged(sessionId: string, text: string | null): void {
  draftRevisions.set(sessionId, (draftRevisions.get(sessionId) ?? 0) + 1);
  queueDraftSave(sessionId, text);
}

/**
 * Counts changes to one chat's draft. Fork (L-160): Focus mode keeps the
 * workspace pane mounted while a Focus pane shows a second composer for the
 * same chat; a composer that was hidden compares this to the count it last
 * saw to know the other one changed the text.
 */
export function getComposerDraftRevision(sessionId: string): number {
  return draftRevisions.get(sessionId) ?? 0;
}

export function getComposerDraft(sessionId: string): string | undefined {
  return drafts.get(sessionId);
}

export function setComposerDraft(sessionId: string, text: string): void {
  if (text) {
    if (drafts.get(sessionId) === text) return;
    drafts.set(sessionId, text);
    noteDraftChanged(sessionId, text);
  } else {
    if (drafts.delete(sessionId)) noteDraftChanged(sessionId, null);
    mcpTags.delete(sessionId);
  }
}

export function getComposerMcpTags(sessionId: string): McpTag[] {
  return mcpTags.get(sessionId) ?? [];
}

export function setComposerMcpTags(sessionId: string, tags: McpTag[]): void {
  if (tags.length > 0) {
    mcpTags.set(sessionId, tags);
  } else {
    mcpTags.delete(sessionId);
  }
}

export function clearComposerDraft(sessionId: string): void {
  if (drafts.delete(sessionId)) noteDraftChanged(sessionId, null);
  mcpTags.delete(sessionId);
  pendingInput.delete(sessionId);
}

const pendingInput = new Set<string>();
export function setComposerPendingInput(sessionId: string, pending: boolean): void {
  if (pending) pendingInput.add(sessionId);
  else pendingInput.delete(sessionId);
}
export function hasComposerPendingInput(sessionId: string): boolean {
  return pendingInput.has(sessionId);
}

/** Replacing a session pane must retain any unfinished composer input or run. */
export function protectSessionOpening(session: import("./session").Session): boolean {
  return !!(
    session.busy || session.worktreePreparing || session.backgroundTasks?.length ||
    session.queuedMessages?.length || session.blocks.some(block => block.draft) ||
    getComposerDraft(session.id) || hasComposerPendingInput(session.id)
  );
}

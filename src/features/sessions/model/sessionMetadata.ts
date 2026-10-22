import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

/**
 * Session metadata (L-181): a one-line label and markdown notes the user
 * keeps for a chat. Stored locally per session id (table
 * `session_metadata`); every window refreshes on the backend's change event.
 */
export type SessionMetadata = {
  sessionId: string;
  label: string;
  notes: string;
  updatedAt: number;
};

/** Emitted by the backend to every window after a save. */
export const SESSION_METADATA_CHANGED_EVENT =
  "monocode:session-metadata-changed";
/** Asks this window's dialog host to open the editor (`SessionMetadataEditRequest`). */
export const SESSION_METADATA_EDIT_EVENT = "monocode:session-metadata-edit";

export const SESSION_LABEL_MAX = 120;
export const SESSION_NOTES_MAX = 100_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** One row from the backend, or null when it is not a valid row. */
export function parseSessionMetadata(value: unknown): SessionMetadata | null {
  if (!isRecord(value)) return null;
  const { sessionId, label, notes, updatedAt } = value;
  if (
    typeof sessionId !== "string" ||
    !sessionId ||
    typeof label !== "string" ||
    typeof notes !== "string" ||
    typeof updatedAt !== "number"
  )
    return null;
  return { sessionId, label, notes, updatedAt };
}

/** The list command's result; rows that do not parse are dropped. */
export function parseSessionMetadataRows(value: unknown): SessionMetadata[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) => {
    const parsed = parseSessionMetadata(row);
    return parsed ? [parsed] : [];
  });
}

/** The label on one line, as the backend stores it. */
export function cleanSessionLabel(label: string): string {
  return label.split(/\s+/).filter(Boolean).join(" ");
}

/** Validation shared with the backend, so the dialog can say why before saving. */
export function sessionMetadataError(
  label: string,
  notes: string,
): string | null {
  // Characters, not UTF-16 units, the way the backend counts.
  if ([...cleanSessionLabel(label)].length > SESSION_LABEL_MAX)
    return `The label is longer than ${SESSION_LABEL_MAX} characters.`;
  if (new TextEncoder().encode(notes).length > SESSION_NOTES_MAX)
    return "The notes are too long.";
  return null;
}

/** True when the chat has something to show (a label or notes). */
export function hasSessionMetadata(
  metadata: Pick<SessionMetadata, "label" | "notes"> | null | undefined,
): metadata is SessionMetadata {
  return Boolean(metadata && (metadata.label.trim() || metadata.notes.trim()));
}

export async function listSessionMetadata(): Promise<SessionMetadata[]> {
  return parseSessionMetadataRows(
    await invoke<unknown>("session_metadata_list"),
  );
}

/**
 * Saves the chat's label and notes; both empty clears them. Resolves to the
 * saved row, or null when cleared. The store updates right away and again on
 * the change event.
 */
export async function saveSessionMetadata(
  sessionId: string,
  label: string,
  notes: string,
): Promise<SessionMetadata | null> {
  const saved = parseSessionMetadata(
    await invoke<unknown>("session_metadata_upsert", {
      metadata: { sessionId, label, notes },
    }),
  );
  const next = new Map(byId);
  if (saved) next.set(sessionId, saved);
  else next.delete(sessionId);
  publish(next);
  return saved;
}

/** `title` is the chat's own title, shown in the dialog so it is clear which chat. */
export type SessionMetadataEditRequest = { sessionId: string; title: string };

/** Opens the Session metadata dialog (mounted once per window) for one chat. */
export function requestSessionMetadataEdit(
  sessionId: string,
  title: string,
): void {
  window.dispatchEvent(
    new CustomEvent<SessionMetadataEditRequest>(SESSION_METADATA_EDIT_EVENT, {
      detail: { sessionId, title },
    }),
  );
}

/** Reads the event detail sent by `requestSessionMetadataEdit`. */
export function parseSessionMetadataEditRequest(
  detail: unknown,
): SessionMetadataEditRequest | null {
  if (!isRecord(detail)) return null;
  const { sessionId, title } = detail;
  if (typeof sessionId !== "string" || !sessionId) return null;
  return { sessionId, title: typeof title === "string" ? title : "" };
}

// One map per window, loaded on the first subscriber and refreshed whenever
// any window saves. Replaced (never mutated) so snapshots compare by identity.
let byId: ReadonlyMap<string, SessionMetadata> = new Map();
let loading: Promise<void> | null = null;
let loaded = false;
let stopListening: (() => void) | null = null;
const listeners = new Set<() => void>();

function publish(next: ReadonlyMap<string, SessionMetadata>): void {
  byId = next;
  for (const listener of listeners) listener();
}

function refresh(): Promise<void> {
  loading = listSessionMetadata()
    .then((rows) => {
      loaded = true;
      publish(new Map(rows.map((row) => [row.sessionId, row])));
    })
    .catch((error: unknown) => {
      // Labels simply do not show; the next change event tries again.
      console.warn("Could not load session metadata:", error);
    })
    .finally(() => {
      loading = null;
    });
  return loading;
}

function startListening(): void {
  let disposed = false;
  stopListening = () => {
    disposed = true;
  };
  // Outside Tauri (tests, browser preview) there is no event bridge.
  Promise.resolve()
    .then(() => listen(SESSION_METADATA_CHANGED_EVENT, () => void refresh()))
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

export function subscribeSessionMetadata(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    startListening();
    // Saves made while nobody listened are picked up here.
    if (!loading) void refresh();
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      stopListening?.();
      stopListening = null;
    }
  };
}

/**
 * One chat's saved metadata, loading the map first when this window has not
 * loaded it yet. Rejects when that load fails, so an editor never starts from
 * an empty form over notes it could not read.
 */
export async function loadSessionMetadataFor(
  sessionId: string,
): Promise<SessionMetadata | null> {
  if (!loaded) {
    const rows = await listSessionMetadata();
    loaded = true;
    publish(new Map(rows.map((row) => [row.sessionId, row])));
  }
  return getSessionMetadata(sessionId);
}

export function sessionMetadataSnapshot(): ReadonlyMap<
  string,
  SessionMetadata
> {
  return byId;
}

export function getSessionMetadata(sessionId: string): SessionMetadata | null {
  return byId.get(sessionId) ?? null;
}

/** Test-only: forget the loaded map between tests. */
export function resetSessionMetadataStoreForTests(): void {
  stopListening?.();
  stopListening = null;
  listeners.clear();
  byId = new Map();
  loading = null;
  loaded = false;
}

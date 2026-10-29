import { useContext, useEffect } from "react";
import {
  writeSessionLabel,
  writeSessionNotes,
  writeSessionPoints,
} from "../../../integrations/harness/core/sessionMetadataHelper";
import { isMonoSession } from "../../monos/model/mono";
import type { Session } from "../model/session";
import {
  getSessionMetadata,
  loadSessionMetadataFor,
  saveSessionMetadata,
  sessionMetadataError,
} from "../model/sessionMetadata";
import {
  appendSessionNotes,
  autoNotesAfter,
  autoNotesOn,
  blocksAfter,
  markAutoNotesDone,
} from "../model/sessionMetadataAi";
import {
  applyPointsReply,
  loadSessionPanel,
  panelBlocksAfter,
  updateSessionPanel,
} from "../model/sessionPanel";
import { SessionStateContext, type SessionStateStore } from "../model/sessionStateStore";

/** How long a chat stays quiet after a turn before Auto notes runs (L-190). */
export const AUTO_NOTES_QUIET_MS = 60_000;

type WatchDeps = {
  quietMs?: number;
  /** Auto notes applies to this chat (its switch is on and it is not a Mono). */
  isOn: (sessionId: string) => boolean;
  /** Try again later, e.g. while the chat's Summary is being edited. */
  waitFor: (sessionId: string) => boolean;
  update: (session: Session) => Promise<void>;
};

/**
 * Schedules one notes update per chat after a turn ends and the chat stays
 * quiet; a new turn cancels the wait. One run per chat at a time.
 */
export function watchAutoNotes(
  store: Pick<SessionStateStore, "snapshot" | "session" | "observe">,
  deps: WatchDeps,
): () => void {
  const quietMs = deps.quietMs ?? AUTO_NOTES_QUIET_MS;
  const wasBusy = new Map<string, boolean>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const running = new Set<string>();

  const cancel = (id: string): void => {
    const timer = timers.get(id);
    if (timer !== undefined) clearTimeout(timer);
    timers.delete(id);
  };

  const fire = (id: string): void => {
    timers.delete(id);
    const session = store.session(id);
    if (!session || session.busy || running.has(id) || !deps.isOn(id)) return;
    if (deps.waitFor(id)) {
      schedule(id);
      return;
    }
    running.add(id);
    void deps
      .update(session)
      .catch(() => {})
      .finally(() => running.delete(id));
  };

  const schedule = (id: string): void => {
    cancel(id);
    timers.set(id, setTimeout(() => fire(id), quietMs));
  };

  const check = (): void => {
    const present = new Set<string>();
    for (const session of store.snapshot()) {
      present.add(session.id);
      const busy = !!session.busy;
      const before = wasBusy.get(session.id);
      wasBusy.set(session.id, busy);
      if (busy) cancel(session.id);
      else if (before === true && deps.isOn(session.id)) schedule(session.id);
    }
    for (const id of [...wasBusy.keys()])
      if (!present.has(id)) {
        wasBusy.delete(id);
        cancel(id);
      }
  };

  check();
  const stop = store.observe(check);
  return () => {
    stop();
    for (const id of [...timers.keys()]) cancel(id);
  };
}

// ---------------------------------------------------------------------------
// Summary editing: Auto waits while the user edits a chat's Summary (L-192).

let editingSummaryId: string | null = null;

export function setSummaryEditing(sessionId: string | null): void {
  editingSummaryId = sessionId;
}

/** True while the Session overview's Summary editor is open for this chat. */
export function summaryEditorOpen(sessionId: string): boolean {
  return editingSummaryId === sessionId;
}

// ---------------------------------------------------------------------------
// AI runs, one per chat at a time; the panel shows a spinner while one runs.

export type SummaryUpdateResult =
  | { ok: true; added: boolean }
  | { ok: false; message: string };

const summaryRuns = new Map<string, Promise<SummaryUpdateResult>>();
const labelRuns = new Map<string, Promise<SummaryUpdateResult>>();
const runListeners = new Set<() => void>();

function emitRuns(): void {
  for (const listener of runListeners) listener();
}

export function subscribeSummaryRuns(listener: () => void): () => void {
  runListeners.add(listener);
  return () => runListeners.delete(listener);
}

/** True while an AI run is adding to this chat's Summary. */
export function sessionSummaryUpdating(sessionId: string): boolean {
  return summaryRuns.has(sessionId);
}

/** True while an AI run is writing this chat's label. */
export function sessionLabelUpdating(sessionId: string): boolean {
  return labelRuns.has(sessionId);
}

function track(
  runs: Map<string, Promise<SummaryUpdateResult>>,
  sessionId: string,
  start: () => Promise<SummaryUpdateResult>,
): Promise<SummaryUpdateResult> {
  const running = runs.get(sessionId);
  if (running) return running;
  const run = start().finally(() => {
    runs.delete(sessionId);
    emitRuns();
  });
  runs.set(sessionId, run);
  emitRuns();
  return run;
}

/** Saves a new label, keeping the chat's latest notes. */
async function saveLabel(sessionId: string, label: string): Promise<void> {
  const notes = getSessionMetadata(sessionId)?.notes ?? "";
  if (sessionMetadataError(label, notes)) return;
  await saveSessionMetadata(sessionId, label, notes);
}

/**
 * Adds the Timeline's points for the messages since its last run (L-192).
 * Resolves to whether points were added, or to the failure message.
 */
async function updateSessionTimeline(
  session: Session,
  signal?: AbortSignal,
): Promise<{ ok: true; added: boolean } | { ok: false; message: string }> {
  const data = await loadSessionPanel(session.id);
  const finished = session.blocks.filter((block) => !block.streaming);
  const fresh = panelBlocksAfter(session.blocks, data.after);
  const last = fresh[fresh.length - 1];
  if (!last) return { ok: true, added: false };
  const result = await writeSessionPoints({
    blocks: fresh,
    cwd: session.cwd,
    harness: session.harness,
    data,
    scope: fresh.length < finished.length ? "update" : "full",
    signal,
  });
  if (!result.ok) return { ok: false, message: result.cancelled ? "" : result.message };
  const reply = result.value;
  await updateSessionPanel(session.id, (current) => applyPointsReply(current, reply, last.id));
  return { ok: true, added: reply.kind === "add" };
}

/**
 * Adds what is new since the last update to the chat's Summary notes, then
 * the Timeline's points, and writes a label when the chat has none (L-192).
 * Reads the whole chat when the notes are empty. A second call joins the
 * running one.
 */
export function updateSessionSummary(
  session: Session,
  signal?: AbortSignal,
): Promise<SummaryUpdateResult> {
  return track(summaryRuns, session.id, async () => {
    const saved = await loadSessionMetadataFor(session.id);
    const notes = saved?.notes ?? "";
    const finished = session.blocks.filter((block) => !block.streaming);
    const fresh = notes.trim()
      ? blocksAfter(session.blocks, autoNotesAfter(session.id))
      : finished;
    const last = fresh[fresh.length - 1];
    let added = false;
    if (last) {
      const result = await writeSessionNotes({
        blocks: fresh,
        cwd: session.cwd,
        harness: session.harness,
        notes,
        scope: fresh.length < finished.length ? "update" : "full",
        signal,
      });
      if (!result.ok) return { ok: false, message: result.cancelled ? "" : result.message };
      if (result.value.kind === "add") {
        // The editor opened meanwhile: leave the points for the next run.
        if (summaryEditorOpen(session.id))
          return { ok: false, message: "Close the editor first, then try again." };
        const current = getSessionMetadata(session.id);
        const label = current?.label ?? "";
        const next = appendSessionNotes(current?.notes ?? "", result.value.text);
        const invalid = sessionMetadataError(label, next);
        if (invalid) return { ok: false, message: invalid };
        await saveSessionMetadata(session.id, label, next);
        added = true;
      }
      markAutoNotesDone(session.id, last.id);
    }
    // The label still gets written when the Timeline run fails.
    let timelineFailure: string | null = null;
    if (!signal?.aborted) {
      const timeline = await updateSessionTimeline(session, signal).catch(
        (error: unknown): { ok: false; message: string } => ({
          ok: false,
          message: `Couldn't save the timeline: ${error instanceof Error ? error.message : String(error)}`,
        }),
      );
      if (timeline.ok) added ||= timeline.added;
      else timelineFailure = timeline.message;
    }
    if (timelineFailure === "") return { ok: false, message: "" };
    if (!getSessionMetadata(session.id)?.label.trim() && !signal?.aborted) {
      const label = await writeSessionLabel({
        blocks: finished,
        cwd: session.cwd,
        harness: session.harness,
        signal,
      });
      if (label.ok && !getSessionMetadata(session.id)?.label.trim())
        await saveLabel(session.id, label.value);
    }
    if (timelineFailure)
      return { ok: false, message: added ? `Summary updated. ${timelineFailure}` : timelineFailure };
    return { ok: true, added };
  });
}

/** Writes the chat's label with AI, replacing the current one. */
export function rewriteSessionLabel(
  session: Session,
  signal?: AbortSignal,
): Promise<SummaryUpdateResult> {
  return track(labelRuns, session.id, async () => {
    const result = await writeSessionLabel({
      blocks: session.blocks.filter((block) => !block.streaming),
      cwd: session.cwd,
      harness: session.harness,
      signal,
    });
    if (!result.ok) return { ok: false, message: result.cancelled ? "" : result.message };
    await saveLabel(session.id, result.value);
    return { ok: true, added: true };
  });
}

/** Mounted once per window (L-190; Session overview since L-192). */
export function SessionMetadataAutoWriter(): null {
  const store = useContext(SessionStateContext);
  useEffect(() => {
    if (!store) return;
    return watchAutoNotes(store, {
      isOn: (id) => autoNotesOn(id) && !isMonoSession(id),
      waitFor: summaryEditorOpen,
      update: async (session) => {
        await updateSessionSummary(session);
      },
    });
  }, [store]);
  return null;
}

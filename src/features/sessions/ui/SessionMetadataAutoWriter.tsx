import { useContext, useEffect } from "react";
import { writeSessionNotes } from "../../../integrations/harness/core/sessionMetadataHelper";
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
import { SessionStateContext, type SessionStateStore } from "../model/sessionStateStore";
import { sessionMetadataEditorOpen } from "./SessionMetadataDialog";

/** How long a chat stays quiet after a turn before Auto notes runs (L-190). */
export const AUTO_NOTES_QUIET_MS = 60_000;

type WatchDeps = {
  quietMs?: number;
  /** Auto notes applies to this chat (its switch is on and it is not a Mono). */
  isOn: (sessionId: string) => boolean;
  /** Try again later, e.g. while the chat's Session metadata editor is open. */
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

/** Adds what is new since the last update to the chat's notes; quiet on failure. */
export async function autoUpdateNotes(session: Session): Promise<void> {
  const finished = session.blocks.filter((block) => !block.streaming);
  const fresh = blocksAfter(session.blocks, autoNotesAfter(session.id));
  const last = fresh[fresh.length - 1];
  if (!last) return;
  const saved = await loadSessionMetadataFor(session.id);
  const result = await writeSessionNotes({
    blocks: fresh,
    cwd: session.cwd,
    harness: session.harness,
    notes: saved?.notes ?? "",
    scope: fresh.length < finished.length ? "update" : "full",
  });
  if (!result.ok) return;
  if (result.value.kind === "add") {
    // The editor opened meanwhile: leave the points for the next run.
    if (sessionMetadataEditorOpen(session.id)) return;
    const current = getSessionMetadata(session.id);
    const label = current?.label ?? "";
    const notes = appendSessionNotes(current?.notes ?? "", result.value.text);
    if (sessionMetadataError(label, notes)) return;
    await saveSessionMetadata(session.id, label, notes);
  }
  markAutoNotesDone(session.id, last.id);
}

/** Mounted once per window, beside the Session metadata dialog host. */
export function SessionMetadataAutoWriter(): null {
  const store = useContext(SessionStateContext);
  useEffect(() => {
    if (!store) return;
    return watchAutoNotes(store, {
      isOn: (id) => autoNotesOn(id) && !isMonoSession(id),
      waitFor: sessionMetadataEditorOpen,
      update: autoUpdateNotes,
    });
  }, [store]);
  return null;
}

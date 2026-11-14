import { useEffect } from "react";

import { useConnection } from "@/features/connection/ConnectionProvider";
import { onLinkOutboxSettled, onLinkSignal, useLinkStream } from "@/features/link/linkStream";

import { listNotes, listTasks, readNote, toolsChanged, type Command, type NoteItem } from "./tools";
import { savedNotes } from "./toolsCache";

/** Changes on the computer often come in bursts (an agent, autosave): one refresh each. */
const SETTLE_MS = 600;
/** Full notes kept fresh on the phone without being opened: the newest ones. */
const PREFETCH_NOTES = 20;

/**
 * Fork (Hari, L-281): keeps the phone's copy of Tasks and Notes current. The
 * computer signals `tasks.changed` / `notes.changed` after every write, and
 * the phone asks again each time the stream comes up; each brings a fresh list
 * (and the newest notes in full), then the open screens redraw. Mounted after
 * LinkStreamSync.
 */
export function ToolsSync(): null {
  const { pairing, command } = useConnection();
  const fingerprint = pairing?.desktop.fingerprint ?? null;
  const live = useLinkStream().phase === "live";

  useEffect(() => {
    if (!fingerprint) return;
    const run: Command = command;
    const timers = new Map<"tasks" | "notes", ReturnType<typeof setTimeout>>();
    let stopped = false;

    const sync = async (kind: "tasks" | "notes") => {
      if (kind === "tasks") {
        const listed = await listTasks(run, true);
        if (!listed.offline) toolsChanged("tasks");
        return;
      }
      const listed = await listNotes(run, true);
      if (listed.offline) return;
      toolsChanged("notes");
      await refreshNotes(run, listed.items, () => stopped);
    };
    const later = (kind: "tasks" | "notes") => {
      clearTimeout(timers.get(kind));
      timers.set(
        kind,
        setTimeout(() => {
          sync(kind).catch((reason: unknown) => console.warn(`Tools: could not sync ${kind}`, reason));
        }, SETTLE_MS),
      );
    };

    if (live) {
      later("tasks");
      later("notes");
    }
    const stopTasks = onLinkSignal("tasks.changed", () => later("tasks"));
    const stopNotes = onLinkSignal("notes.changed", () => later("notes"));
    // A refused edit leaves the outbox: the lists drop it and show the computer's copy.
    const stopSettled = onLinkOutboxSettled((answer) => {
      if (!answer.rejected.length) return;
      toolsChanged("tasks");
      toolsChanged("notes");
    });
    return () => {
      stopped = true;
      stopTasks();
      stopNotes();
      stopSettled();
      for (const timer of timers.values()) clearTimeout(timer);
    };
  }, [fingerprint, live, command]);

  return null;
}

/**
 * Reads again, one at a time, each of the newest notes the phone doesn't hold
 * as the computer has it now (`readNote` saves them).
 */
async function refreshNotes(run: Command, listed: NoteItem[], stopped: () => boolean) {
  const held = new Map(savedNotes().map((note) => [note.id, note.updatedAt]));
  const stale = listed
    .filter((note, index) =>
      held.has(note.id) ? held.get(note.id) !== note.updatedAt : index < PREFETCH_NOTES,
    )
    .slice(0, PREFETCH_NOTES * 2);
  for (const note of stale) {
    if (stopped()) return;
    await readNote(run, note.id);
  }
}

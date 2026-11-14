import Storage from "expo-sqlite/kv-store";

import { linkComputer, pendingLinkItems } from "@/features/link/linkStream";

import type { Note, NoteItem, TaskItem } from "./tools";
import {
  overlayNote,
  overlayNotes,
  overlayTasks,
  parseList,
  parseNote,
  parseNoteItem,
  parseTaskItem,
  pruneNotes,
  rememberNote,
  TOOLS_OUTBOX_KINDS,
  type PendingEdit,
} from "./toolsOverlay";

// Fork (Hari, L-281): the phone's copy of the computer's Tasks and Notes, one
// per paired computer, so the screens open offline. Holds what the computer
// last sent; the edits still waiting in the outbox are laid over on read.

type Store = "tasks" | "notes" | "bodies";
const keyOf = (store: Store, fingerprint: string) => `hari.tools.${store}.${fingerprint}`;

function read(store: Store): unknown {
  const fingerprint = linkComputer();
  if (!fingerprint) return null;
  try {
    return JSON.parse(Storage.getItemSync(keyOf(store, fingerprint)) ?? "null");
  } catch {
    return null;
  }
}

function write(store: Store, value: unknown) {
  const fingerprint = linkComputer();
  if (!fingerprint) return;
  try {
    Storage.setItemSync(keyOf(store, fingerprint), JSON.stringify(value));
  } catch (error) {
    // The lists still show; only the offline copy is behind.
    console.warn(`Tools: could not save the ${store} offline`, error);
  }
}

/** Task and note edits still waiting for the computer, oldest first. */
export function pendingToolEdits(): PendingEdit[] {
  return pendingLinkItems().filter((item) => TOOLS_OUTBOX_KINDS.includes(item.kind));
}

/** The saved tasks with waiting edits laid over; null when none were saved. */
export function cachedTasks(): TaskItem[] | null {
  const saved = parseList(read("tasks"), parseTaskItem);
  const pending = pendingToolEdits();
  if (!saved && !pending.length) return null;
  return overlayTasks(saved ?? [], pending);
}

/** The raw saved task (without waiting edits), the base an edit names. */
export function savedTask(id: string): TaskItem | null {
  return parseList(read("tasks"), parseTaskItem)?.find((task) => task.id === id) ?? null;
}

export function storeTasks(tasks: TaskItem[]): void {
  write("tasks", tasks);
}

export function cachedNotes(): NoteItem[] | null {
  const saved = parseList(read("notes"), parseNoteItem);
  const pending = pendingToolEdits();
  if (!saved && !pending.length) return null;
  return overlayNotes(saved ?? [], pending);
}

/** Saves the computer's note list, and drops full notes it no longer has. */
export function storeNotes(notes: NoteItem[]): void {
  write("notes", notes);
  const bodies = savedNotes();
  const kept = pruneNotes(bodies, notes);
  if (kept.length !== bodies.length) write("bodies", kept);
}

/** The saved full notes, most recently read first. */
export function savedNotes(): Note[] {
  return parseList(read("bodies"), parseNote) ?? [];
}

/** One saved note with its waiting saves laid over; null when the phone has none. */
export function cachedNote(id: string): Note | null {
  const saved = savedNotes().find((note) => note.id === id) ?? null;
  return overlayNote(id, saved, pendingToolEdits());
}

export function storeNote(note: Note): void {
  write("bodies", rememberNote(savedNotes(), note));
}

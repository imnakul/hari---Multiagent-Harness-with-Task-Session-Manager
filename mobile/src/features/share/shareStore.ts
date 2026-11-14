import Storage from "expo-sqlite/kv-store";
import { useSyncExternalStore } from "react";

import {
  addShareEntry,
  markShareEntries,
  parseShareHistory,
  settleInterrupted,
  updateShareEntry,
  type PhoneShareEntry,
} from "./shareModel";

// Fork (Hari, L-279): the phone's Share history (the last 100, both ways),
// kept on the phone only.

const KEY = "hari.share.history";

function load(): PhoneShareEntry[] {
  try {
    return settleInterrupted(parseShareHistory(JSON.parse(Storage.getItemSync(KEY) ?? "[]")));
  } catch {
    return [];
  }
}

let history: PhoneShareEntry[] | null = null;
const listeners = new Set<() => void>();

function current(): PhoneShareEntry[] {
  history ??= load();
  return history;
}

function commit(next: PhoneShareEntry[]) {
  history = next;
  Storage.setItemSync(KEY, JSON.stringify(next));
  for (const listener of listeners) listener();
}

export function shareHistory(): PhoneShareEntry[] {
  return current();
}

export function recordShare(entry: PhoneShareEntry) {
  commit(addShareEntry(current(), entry));
}

export function patchShare(id: string, change: Partial<Omit<PhoneShareEntry, "id">>) {
  commit(updateShareEntry(current(), id, change));
}

/** Progress changes often: kept in memory, written with the next real change. */
export function setShareProgress(id: string, progress: number) {
  history = updateShareEntry(current(), id, { status: "moving", progress });
  for (const listener of listeners) listener();
}

/** Removes these from the history (all of them with none given). Saved files stay. */
export function removeShares(ids?: string[]) {
  commit(ids ? current().filter((entry) => !ids.includes(entry.id)) : []);
}

/** Fork (L-290): pins or saves these (or takes the pin or save off). */
export function markShares(ids: readonly string[], change: { pinned?: boolean; saved?: boolean }) {
  commit(markShareEntries(current(), ids, change));
}

/** Fork (L-290): what Delete all leaves: the history becomes exactly these. */
export function replaceShares(next: PhoneShareEntry[]) {
  commit(next);
}

/** Fork (L-290): the history as stored, in bytes (for Storage). */
export function shareHistoryBytes(): number {
  return (Storage.getItemSync(KEY) ?? "").length;
}

export function useShareHistory(): PhoneShareEntry[] {
  return useSyncExternalStore((listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, current);
}


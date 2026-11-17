import Storage from "expo-sqlite/kv-store";
import { useSyncExternalStore } from "react";

/**
 * Fork (Hari, L-340): sessions pinned on the phone, kept on the phone only
 * (the desktop's own pins and folders are its own). The latest pin first.
 */
const STORAGE_KEY = "sessionPins";

function load(): string[] {
  try {
    const parsed: unknown = JSON.parse(Storage.getItemSync(STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

let current: string[] | null = null;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const read = () => (current ??= load());

export function useSessionPins(): string[] {
  return useSyncExternalStore(subscribe, read);
}

/** Pins a session, or unpins it if it is pinned. */
export function toggleSessionPin(id: string) {
  const pins = read();
  current = pins.includes(id) ? pins.filter((pin) => pin !== id) : [id, ...pins];
  void Storage.setItem(STORAGE_KEY, JSON.stringify(current));
  listeners.forEach((listener) => listener());
}

/** The pinned sessions first, in pin order, then the rest as they were. */
export function pinnedFirst<T extends { id: string }>(sessions: readonly T[], pins: readonly string[]): T[] {
  if (pins.length === 0) return [...sessions];
  const rank = new Map(pins.map((id, index) => [id, index]));
  const pinned = sessions.filter((session) => rank.has(session.id));
  pinned.sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
  return [...pinned, ...sessions.filter((session) => !rank.has(session.id))];
}

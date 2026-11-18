import Storage from "expo-sqlite/kv-store";

/**
 * Fork (Hari, L-347): where the user was inside each place, so a place
 * opened again from the side menu rebuilds there: a project's open session,
 * the open note, the Computer hub's tab and the folder in its files. Per
 * desktop, as each has its own projects; kept across restarts.
 */
export type PlaceMemory = {
  /** Project id → its open session; a project left on its list has none. */
  sessions: Record<string, string>;
  note?: string;
  computer?: { tab: "share" | "control"; folder?: string };
};

const key = (desktop: string) => `hari.placeMemory.${desktop}`;
const cache = new Map<string, PlaceMemory>();
const empty = (): PlaceMemory => ({ sessions: {} });

export function readPlaceMemory(desktop: string | undefined): PlaceMemory {
  if (!desktop) return empty();
  const known = cache.get(desktop);
  if (known) return known;
  let memory = empty();
  try {
    const raw = Storage.getItemSync(key(desktop));
    const parsed = raw ? (JSON.parse(raw) as Partial<PlaceMemory>) : null;
    if (parsed && typeof parsed === "object") {
      memory = {
        sessions:
          parsed.sessions && typeof parsed.sessions === "object"
            ? Object.fromEntries(
                Object.entries(parsed.sessions).filter(([, id]) => typeof id === "string"),
              )
            : {},
        note: typeof parsed.note === "string" ? parsed.note : undefined,
        computer:
          parsed.computer?.tab === "share" || parsed.computer?.tab === "control"
            ? {
                tab: parsed.computer.tab,
                folder: typeof parsed.computer.folder === "string" ? parsed.computer.folder : undefined,
              }
            : undefined,
      };
    }
  } catch {
    // A broken record is no memory.
  }
  cache.set(desktop, memory);
  return memory;
}

/** Changes the memory; a field set to undefined is forgotten. */
export function updatePlaceMemory(
  desktop: string | undefined,
  change: (memory: PlaceMemory) => PlaceMemory,
) {
  if (!desktop) return;
  const next = change(readPlaceMemory(desktop));
  cache.set(desktop, next);
  try {
    Storage.setItemSync(key(desktop), JSON.stringify(next));
  } catch (error) {
    console.warn("Could not save where you were", error);
  }
}

/** Forgets everything for a desktop (unpairing). */
export function forgetPlaceMemory(desktop: string) {
  cache.delete(desktop);
  try {
    Storage.removeItemSync(key(desktop));
  } catch {
    // Nothing to forget.
  }
}

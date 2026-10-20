import { sameProjectPath } from "./recents";

/** Project slots in the inset sidebar's top row (L-132). */
const STORAGE_KEY = "monocode.insetProjectSlots.v1";

/** One row of slots: the current one shows its name, the rest their icon. */
export const MAX_PROJECT_SLOTS = 4;

/**
 * The slots, in the order they were added, and which one the current
 * project last sat in. That index decides where a project the user switches
 * to by other means (Switch project, rail, palette) lands.
 */
export type ProjectSlots = { paths: string[]; active: number };

const EMPTY: ProjectSlots = { paths: [], active: 0 };

function slotIndex(paths: readonly string[], path: string): number {
  return paths.findIndex((slot) => sameProjectPath(slot, path));
}

/**
 * Puts the current project in a slot: its own when it has one, otherwise
 * the active slot, so switching from a slot's menu replaces that slot.
 */
export function syncProjectSlots(
  slots: ProjectSlots,
  current: string,
): ProjectSlots {
  const index = slotIndex(slots.paths, current);
  if (index >= 0)
    return index === slots.active ? slots : { ...slots, active: index };
  if (!slots.paths.length) return { paths: [current], active: 0 };
  const active = Math.min(Math.max(slots.active, 0), slots.paths.length - 1);
  const paths = [...slots.paths];
  paths[active] = current;
  return { paths, active };
}

/**
 * The + button: a new slot at the end that becomes active. A project that
 * already has a slot just activates it; a full row stays as it is.
 */
export function addProjectSlot(
  slots: ProjectSlots,
  path: string,
): ProjectSlots {
  const index = slotIndex(slots.paths, path);
  if (index >= 0) return { ...slots, active: index };
  if (slots.paths.length >= MAX_PROJECT_SLOTS) return slots;
  return { paths: [...slots.paths, path], active: slots.paths.length };
}

/**
 * Removes a slot; the last one stays. Closing the active slot makes its
 * right neighbour active, or the left one at the end of the row.
 */
export function closeProjectSlot(
  slots: ProjectSlots,
  path: string,
): ProjectSlots {
  const index = slotIndex(slots.paths, path);
  if (index < 0 || slots.paths.length <= 1) return slots;
  const paths = slots.paths.filter((_, i) => i !== index);
  const active =
    index < slots.active
      ? slots.active - 1
      : Math.min(slots.active, paths.length - 1);
  return { paths, active };
}

/** The project a slot's closing switches to, when it is the current one. */
export function slotAfterClosing(
  slots: ProjectSlots,
  path: string,
): string | undefined {
  const index = slotIndex(slots.paths, path);
  if (index < 0 || slots.paths.length <= 1) return undefined;
  return slots.paths[index + 1] ?? slots.paths[index - 1];
}

/**
 * Drops slots whose project is gone (removed from the sidebar) and repeats,
 * keeping the active slot on the same project where it survives.
 */
export function pruneProjectSlots(
  slots: ProjectSlots,
  keep: (path: string) => boolean,
): ProjectSlots {
  const activePath = slots.paths[slots.active];
  const paths: string[] = [];
  for (const path of slots.paths) {
    if (!keep(path) || slotIndex(paths, path) >= 0) continue;
    paths.push(path);
  }
  if (paths.length === slots.paths.length) return slots;
  const index = activePath ? slotIndex(paths, activePath) : -1;
  return {
    paths,
    active:
      index >= 0
        ? index
        : Math.max(0, Math.min(slots.active, paths.length - 1)),
  };
}

function parseProjectSlots(value: unknown): ProjectSlots {
  if (typeof value !== "object" || value === null) return EMPTY;
  const paths =
    "paths" in value && Array.isArray(value.paths)
      ? value.paths
          .filter((item): item is string => typeof item === "string")
          .slice(0, MAX_PROJECT_SLOTS)
      : [];
  const active =
    "active" in value &&
    typeof value.active === "number" &&
    Number.isInteger(value.active)
      ? Math.min(Math.max(value.active, 0), Math.max(paths.length - 1, 0))
      : 0;
  return { paths, active };
}

export function loadProjectSlots(): ProjectSlots {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? parseProjectSlots(JSON.parse(stored)) : EMPTY;
  } catch {
    // Unreadable or missing storage: start from the current project alone.
    return EMPTY;
  }
}

export function saveProjectSlots(slots: ProjectSlots): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(slots));
  } catch {
    // Storage full or blocked: slots last for this run only.
  }
}

import { projectKey } from "../../../shared/lib/paths";
import { focusGridIds, pruneFocusGrid, type FocusGrid } from "./focusGrid";

/**
 * Focus mode's "Group by project" (fork, L-128): the grid's chats split by
 * project, and the grid as one project sees it.
 */
export type FocusProjectGroup = {
  /** `projectKey` of the project, or "" for chats whose project is unknown. */
  key: string;
  cwd: string | undefined;
  /** In grid order: placed chats column by column, then waiting ones. */
  ids: string[];
};

const STORAGE_KEY = "monocode.focusGroupByProject.v1";

/** Projects in the order their first chat appears in the grid. */
export function focusProjectGroups(
  grid: FocusGrid,
  cwdOf: (id: string) => string | undefined,
): FocusProjectGroup[] {
  const groups = new Map<string, FocusProjectGroup>();
  for (const id of focusGridIds(grid)) {
    const cwd = cwdOf(id);
    const key = cwd ? projectKey(cwd) : "";
    const group = groups.get(key);
    if (group) group.ids.push(id);
    else groups.set(key, { key, cwd, ids: [id] });
  }
  return [...groups.values()];
}

/**
 * The grid with only `group`'s chats: they keep their order, emptied columns
 * collapse, and waiting chats of the project fill the freed places. Swapping
 * two of the group's chats in the full grid swaps them here too, which is why
 * grouped Focus only ever swaps.
 */
export function projectFocusGrid(
  grid: FocusGrid,
  group: FocusProjectGroup,
): FocusGrid {
  const ids = new Set(group.ids);
  return pruneFocusGrid(grid, (id) => ids.has(id));
}

export function loadFocusGroupByProject(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function saveFocusGroupByProject(on: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, on ? "1" : "0");
  } catch {
    // Storage unavailable: the choice still holds for this run.
  }
}

/**
 * The chat to focus after the focused one leaves the grid (L-146): the
 * nearest chat of the same project, so grouped Focus stays on that project,
 * else the nearest chat at all. Nearest is by grid order, before or after.
 */
export function focusAfterClose(
  grid: FocusGrid,
  closedId: string,
  cwdOf: (id: string) => string | undefined,
): string | undefined {
  const ids = focusGridIds(grid);
  const at = ids.indexOf(closedId);
  if (at < 0) return undefined;
  const rest = ids.filter((id) => id !== closedId);
  const byDistance = rest
    .map((id) => ({ id, distance: Math.abs(ids.indexOf(id) - at) }))
    .sort((a, b) => a.distance - b.distance);
  const closedCwd = cwdOf(closedId);
  const key = closedCwd ? projectKey(closedCwd) : "";
  const sameProject = byDistance.find(({ id }) => {
    const cwd = cwdOf(id);
    return (cwd ? projectKey(cwd) : "") === key;
  });
  return (sameProject ?? byDistance[0])?.id;
}

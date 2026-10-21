import { projectKey } from "../../../shared/lib/paths";
import {
  addToFocusGrid,
  FOCUS_GRID_MAX_COLUMNS,
  focusGridIds,
  moveInFocusGrid,
  pruneFocusGrid,
  swapInFocusGrid,
  type FocusDropEdge,
  type FocusGrid,
} from "./focusGrid";

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
 * two of the group's chats in the full grid swaps them here too.
 */
export function projectFocusGrid(
  grid: FocusGrid,
  group: FocusProjectGroup,
): FocusGrid {
  const ids = new Set(group.ids);
  return pruneFocusGrid(grid, (id) => ids.has(id));
}

/**
 * Drops `id` on `targetId`'s edge in grouped Focus (fork, L-177): the move
 * is made on the project's own grid, as `moveInFocusGrid` makes it, and
 * written back into the full grid. The project's chats become one run of
 * columns where its first column was; every other project's chats keep their
 * order and their own grid. When the run leaves no room, other projects'
 * last columns wait in overflow and the full grid refills free places from
 * it, which no project's own grid can see. A center drop swaps in place.
 * Returns null when the move does not fit the project's grid.
 */
export function moveInProjectFocusGrid(
  grid: FocusGrid,
  group: FocusProjectGroup,
  id: string,
  targetId: string,
  edge: FocusDropEdge,
): FocusGrid | null {
  const members = new Set(group.ids);
  if (!members.has(id) || !members.has(targetId)) return null;
  const view = projectFocusGrid(grid, group);
  const moved = moveInFocusGrid(view, id, targetId, edge);
  if (!moved) return null;
  if (edge === "center") return swapInFocusGrid(grid, id, targetId);
  const others = grid.columns
    .map((column) => column.filter((entry) => !members.has(entry)))
    .filter((column) => column.length > 0);
  const first = grid.columns.findIndex((column) =>
    column.some((entry) => members.has(entry)),
  );
  const at =
    first < 0
      ? others.length
      : grid.columns
          .slice(0, first)
          .filter((column) => column.some((entry) => !members.has(entry))).length;
  const before = others.slice(0, at);
  const after = others.slice(at);
  const spilled: string[][] = [];
  while (
    before.length + moved.columns.length + after.length >
    FOCUS_GRID_MAX_COLUMNS
  ) {
    const last = after.length > 0 ? after.pop() : before.pop();
    if (last) spilled.unshift(last);
  }
  const waiting = [
    ...moved.overflow,
    ...spilled.flat(),
    ...grid.overflow.filter((entry) => !members.has(entry)),
  ];
  return waiting.reduce(addToFocusGrid, {
    columns: [...before, ...moved.columns, ...after],
    overflow: [],
  });
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

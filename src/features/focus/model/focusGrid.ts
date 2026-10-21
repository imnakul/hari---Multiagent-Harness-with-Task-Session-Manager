/**
 * Focus mode's grid of chats (fork, L-123): up to 4 columns of 1–2 chats.
 * Chats never move on their own. A new chat takes the next free place
 * (a new column, then the bottom row of the first single-chat column), and
 * one that does not fit waits in `overflow` ("+N more").
 */
export type FocusGrid = {
  /** Left to right; each column holds 1 or 2 session ids, top first. */
  columns: string[][];
  /** Chats beyond the 8 places, oldest first. */
  overflow: string[];
};

export type FocusDropEdge = "left" | "right" | "top" | "bottom" | "center";

export const FOCUS_GRID_MAX_COLUMNS = 4;
export const FOCUS_GRID_MAX_ROWS = 2;
const STORAGE_KEY = "monocode.focusGrid.v1";

export const EMPTY_FOCUS_GRID: FocusGrid = { columns: [], overflow: [] };

/** Every chat in the grid: the placed ones column by column, then overflow. */
export function focusGridIds(grid: FocusGrid): string[] {
  return [...grid.columns.flat(), ...grid.overflow];
}

export function focusGridHas(grid: FocusGrid, id: string): boolean {
  return (
    grid.columns.some((column) => column.includes(id)) ||
    grid.overflow.includes(id)
  );
}

/** Places a chat in the next free place, or in overflow when all 8 are taken. */
export function addToFocusGrid(grid: FocusGrid, id: string): FocusGrid {
  if (focusGridHas(grid, id)) return grid;
  if (grid.columns.length < FOCUS_GRID_MAX_COLUMNS) {
    return { ...grid, columns: [...grid.columns, [id]] };
  }
  const index = grid.columns.findIndex(
    (column) => column.length < FOCUS_GRID_MAX_ROWS,
  );
  if (index < 0) return { ...grid, overflow: [...grid.overflow, id] };
  return {
    ...grid,
    columns: grid.columns.map((column, i) =>
      i === index ? [...column, id] : column,
    ),
  };
}

/** Takes a chat out without moving any other; an emptied column collapses. */
function withoutId(grid: FocusGrid, id: string): FocusGrid {
  return {
    columns: grid.columns
      .map((column) => column.filter((entry) => entry !== id))
      .filter((column) => column.length > 0),
    overflow: grid.overflow.filter((entry) => entry !== id),
  };
}

/** Fills free places from overflow, oldest first. */
function promoteOverflow(grid: FocusGrid): FocusGrid {
  let next: FocusGrid = { ...grid, overflow: [] };
  for (const id of grid.overflow) next = addToFocusGrid(next, id);
  return next;
}

/**
 * Removes a chat. The rest stay where they are; the oldest waiting chat, if
 * any, takes the freed place.
 */
export function removeFromFocusGrid(grid: FocusGrid, id: string): FocusGrid {
  if (!focusGridHas(grid, id)) return grid;
  return promoteOverflow(withoutId(grid, id));
}

/** Keeps only the chats `keep` accepts, as `removeFromFocusGrid` would. */
export function pruneFocusGrid(
  grid: FocusGrid,
  keep: (id: string) => boolean,
): FocusGrid {
  const ids = focusGridIds(grid);
  if (ids.every(keep)) return grid;
  let next = grid;
  for (const id of ids) {
    if (!keep(id)) next = withoutId(next, id);
  }
  return promoteOverflow(next);
}

/** Trades the places of two chats, placed or waiting. */
export function swapInFocusGrid(grid: FocusGrid, a: string, b: string): FocusGrid {
  if (a === b || !focusGridHas(grid, a) || !focusGridHas(grid, b)) return grid;
  const swap = (entry: string) => (entry === a ? b : entry === b ? a : entry);
  return {
    columns: grid.columns.map((column) => column.map(swap)),
    overflow: grid.overflow.map(swap),
  };
}

/**
 * Puts `order`'s chats, in that order, into the places they hold now (fork,
 * L-159): the grid keeps its shape and every other chat stays put. Returns
 * the grid unchanged unless `order` lists distinct chats that are all in it.
 */
export function reorderFocusGrid(
  grid: FocusGrid,
  order: readonly string[],
): FocusGrid {
  const members = new Set(order);
  if (members.size !== order.length || !order.every((id) => focusGridHas(grid, id)))
    return grid;
  let next = 0;
  const place = (id: string) => (members.has(id) ? order[next++] : id);
  return {
    columns: grid.columns.map((column) => column.map(place)),
    overflow: grid.overflow.map(place),
  };
}

/** `items` with the entry at `from` moved to index `to`. */
export function moveListItem<T>(items: readonly T[], from: number, to: number): T[] {
  const next = [...items];
  const [moved] = next.splice(from, 1);
  if (moved !== undefined) next.splice(to, 0, moved);
  return next;
}

/**
 * Drops `id` on `targetId`'s edge: left/right make a column beside the
 * target's, top/bottom share the target's column, and center swaps the two.
 * Returns null when the drop would make a 5th column or a 3rd row.
 */
export function moveInFocusGrid(
  grid: FocusGrid,
  id: string,
  targetId: string,
  edge: FocusDropEdge,
): FocusGrid | null {
  if (id === targetId || !focusGridHas(grid, id)) return null;
  if (!grid.columns.some((column) => column.includes(targetId))) return null;
  if (edge === "center") return swapInFocusGrid(grid, id, targetId);
  const rest = withoutId(grid, id);
  const targetColumn = rest.columns.findIndex((column) =>
    column.includes(targetId),
  );
  if (edge === "left" || edge === "right") {
    if (rest.columns.length >= FOCUS_GRID_MAX_COLUMNS) return null;
    const at = edge === "left" ? targetColumn : targetColumn + 1;
    const columns = [...rest.columns];
    columns.splice(at, 0, [id]);
    return { ...rest, columns };
  }
  const column = rest.columns[targetColumn];
  if (column.length >= FOCUS_GRID_MAX_ROWS) return null;
  return {
    ...rest,
    columns: rest.columns.map((entry, i) =>
      i === targetColumn ? (edge === "top" ? [id, ...entry] : [...entry, id]) : entry,
    ),
  };
}

/** How many columns fit: 1 below 700 px, 2 below 1100 px, else 4. */
export function focusColumnCap(width: number): number {
  if (width < 700) return 1;
  if (width < 1100) return 2;
  return FOCUS_GRID_MAX_COLUMNS;
}

/**
 * What a window of `columnCap` columns shows. Columns past the cap are not
 * moved; their chats are listed with overflow under "+N more".
 */
export function visibleFocusGrid(
  grid: FocusGrid,
  columnCap: number,
): { columns: string[][]; hidden: string[] } {
  return {
    columns: grid.columns.slice(0, columnCap),
    hidden: [...grid.columns.slice(columnCap).flat(), ...grid.overflow],
  };
}

function isIdList(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((entry) => typeof entry === "string" && entry.length > 0)
  );
}

/**
 * Reads a stored grid. Anything malformed gives an empty grid; duplicate ids
 * and over-full columns are re-placed by the normal rules.
 */
export function parseFocusGrid(value: unknown): FocusGrid {
  if (!value || typeof value !== "object") return EMPTY_FOCUS_GRID;
  const raw = value as Record<string, unknown>;
  if (!Array.isArray(raw.columns) || !raw.columns.every(isIdList))
    return EMPTY_FOCUS_GRID;
  const overflow = raw.overflow === undefined ? [] : raw.overflow;
  if (!isIdList(overflow)) return EMPTY_FOCUS_GRID;
  const columns: string[][] = raw.columns;
  const valid = columns.every(
    (column) => column.length > 0 && column.length <= FOCUS_GRID_MAX_ROWS,
  );
  const ids = [...columns.flat(), ...overflow];
  if (
    valid &&
    columns.length <= FOCUS_GRID_MAX_COLUMNS &&
    new Set(ids).size === ids.length
  ) {
    return { columns, overflow };
  }
  return ids.reduce(addToFocusGrid, EMPTY_FOCUS_GRID);
}

export function loadFocusGrid(): FocusGrid {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? parseFocusGrid(JSON.parse(raw)) : EMPTY_FOCUS_GRID;
  } catch {
    return EMPTY_FOCUS_GRID;
  }
}

export function saveFocusGrid(grid: FocusGrid): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(grid));
  } catch {
    // Storage full or unavailable: the grid still works for this run.
  }
}

/**
 * Zen mode's chats (fork, L-230): up to two rows of one or two chats, a 2×2
 * grid at most. It is a Focus grid whose `columns` hold Zen's rows (top
 * first, each left to right), so Focus's upkeep (loading a restored chat,
 * dropping a deleted one) runs on it unchanged.
 */
import type { FocusGrid } from "../../focus/model/focusGrid";

/** Rows in the Zen panel, and chats side by side in one row. */
export const ZEN_MAX_ROWS = 2;
export const ZEN_ROW_MAX = 2;
export const ZEN_MAX_PANES = ZEN_MAX_ROWS * ZEN_ROW_MAX;
/** The panel grows to at least this width (CSS px) for chats side by side. */
export const ZEN_WIDE_MIN_WIDTH = 720;

/** What fills the Zen panel below its top bar. */
export type ZenTool = "chat" | "tasks" | "notes" | "automations" | "monos";

export const ZEN_TOOLS: readonly ZenTool[] = [
  "chat",
  "tasks",
  "notes",
  "automations",
  "monos",
];

export const EMPTY_ZEN_GRID: FocusGrid = { columns: [], overflow: [] };

/** Zen's fade-through (L-230): the old layout fades out, then the new one in. */
export const ZEN_FADE_OUT_MS = 100;
export const ZEN_FADE_IN_MS = 160;

/** Zen's rows, top first: repeats, empty rows and extras dropped. */
export function zenRows(grid: FocusGrid): string[][] {
  const seen = new Set<string>();
  const rows: string[][] = [];
  for (const row of grid.columns) {
    if (rows.length === ZEN_MAX_ROWS) break;
    const kept = row.filter((id) => !seen.has(id)).slice(0, ZEN_ROW_MAX);
    for (const id of kept) seen.add(id);
    if (kept.length > 0) rows.push(kept);
  }
  return rows;
}

/** A Zen grid of these rows, tidied as `zenRows` does. */
export function zenGridOfRows(rows: readonly (readonly string[])[]): FocusGrid {
  const kept = zenRows({ columns: rows.map((row) => [...row]), overflow: [] });
  return kept.length > 0 ? { columns: kept, overflow: [] } : EMPTY_ZEN_GRID;
}

/** The grid tidied; the same object when it already was. */
export function zenNormalize(grid: FocusGrid): FocusGrid {
  const rows = zenRows(grid);
  const same =
    grid.overflow.length === 0 &&
    rows.length === grid.columns.length &&
    rows.every((row, at) => row.length === grid.columns[at]!.length);
  return same ? grid : zenGridOfRows(rows);
}

/** Zen's chats in reading order: row by row, left to right. */
export function zenIds(grid: FocusGrid): string[] {
  return zenRows(grid).flat();
}

/** A Zen grid of these chats, one per row (repeats and extras dropped). */
export function zenGridOf(ids: readonly string[]): FocusGrid {
  return zenGridOfRows([...new Set(ids)].map((id) => [id]));
}

/** True when some row has two chats side by side. */
export function zenHasColumns(grid: FocusGrid): boolean {
  return zenRows(grid).some((row) => row.length > 1);
}

/** Where a dragged chat lands next to another. */
export type ZenPlace = "beside" | "below";

/** The rows with chat `id` taken out (it is moving). */
function rowsWithout(grid: FocusGrid, id: string | undefined): string[][] {
  return zenRows(grid)
    .map((row) => row.filter((each) => each !== id))
    .filter((row) => row.length > 0);
}

/**
 * Whether chat `id` (moved when it already shows) fits beside or below
 * `target`: beside while the target's row has room, below while a row is
 * free.
 */
export function zenCanPlace(
  grid: FocusGrid,
  target: string,
  where: ZenPlace,
  id?: string,
): boolean {
  if (id === target) return false;
  const rows = rowsWithout(grid, id);
  const row = rows.find((each) => each.includes(target));
  if (!row) return false;
  return where === "beside"
    ? row.length < ZEN_ROW_MAX
    : rows.length < ZEN_MAX_ROWS;
}

/**
 * Puts chat `id` beside or below `target`, moving it when it already shows.
 * Unchanged when there is no room.
 */
export function zenPlace(
  grid: FocusGrid,
  id: string,
  target: string,
  where: ZenPlace,
): FocusGrid {
  if (!zenCanPlace(grid, target, where, id)) return grid;
  const rows = rowsWithout(grid, id);
  const at = rows.findIndex((row) => row.includes(target));
  if (where === "beside") {
    const row = rows[at]!;
    row.splice(row.indexOf(target) + 1, 0, id);
  } else {
    rows.splice(at + 1, 0, [id]);
  }
  return zenGridOfRows(rows);
}

/**
 * Where the Split button adds a chat next to `target`: below while there is
 * one row, else beside it. Undefined when neither fits.
 */
export function zenSplitPlace(
  grid: FocusGrid,
  target: string,
): ZenPlace | undefined {
  if (zenRows(grid).length < ZEN_MAX_ROWS && zenCanPlace(grid, target, "below"))
    return "below";
  if (zenCanPlace(grid, target, "beside")) return "beside";
  if (zenCanPlace(grid, target, "below")) return "below";
  return undefined;
}

/**
 * Shows chat `id` in pane `slot` (reading order). A chat already in another
 * pane trades places, so one chat never shows twice. A slot past the last
 * pane adds one: a new row while one is free, else beside the first chat
 * alone in its row.
 */
export function zenShow(grid: FocusGrid, slot: number, id: string): FocusGrid {
  const rows = zenRows(grid);
  const ids = rows.flat();
  const at = ids.indexOf(id);
  if (at === slot) return grid;
  if (slot >= ids.length) {
    if (at >= 0 || ids.length >= ZEN_MAX_PANES) return grid;
    if (rows.length < ZEN_MAX_ROWS) return zenGridOfRows([...rows, [id]]);
    const open = rows.findIndex((row) => row.length < ZEN_ROW_MAX);
    return zenGridOfRows(
      rows.map((row, index) => (index === open ? [...row, id] : row)),
    );
  }
  const current = ids[slot]!;
  return zenGridOfRows(
    rows.map((row) =>
      row.map((each) =>
        each === current ? id : each === id ? current : each,
      ),
    ),
  );
}

/** Where a chat goes: pane `slot` (reading order), or next to a chat. */
export type ZenAt = number | { target: string; where: ZenPlace };

/** Puts chat `id` where `at` says (`zenShow` or `zenPlace`). */
export function zenPut(grid: FocusGrid, at: ZenAt, id: string): FocusGrid {
  return typeof at === "number"
    ? zenShow(grid, at, id)
    : zenPlace(grid, id, at.target, at.where);
}

/**
 * Takes a chat out; the others fill its place (a lone chat spans its row,
 * an empty row goes).
 */
export function zenClose(grid: FocusGrid, id: string): FocusGrid {
  if (!zenIds(grid).includes(id)) return grid;
  return zenGridOfRows(rowsWithout(grid, id));
}

/**
 * The chats Zen opens with: the chat that was in use when it is one Zen can
 * show, else the first of `fallback` (running chats, newest first).
 */
export function zenEntryGrid(
  current: string | undefined,
  fallback: readonly string[],
): FocusGrid {
  const first = current ?? fallback[0];
  return first ? zenGridOf([first]) : EMPTY_ZEN_GRID;
}

/** The first candidate that is not already showing. */
export function zenNextChat(
  candidates: readonly string[],
  shown: readonly string[],
): string | undefined {
  return candidates.find((id) => !shown.includes(id));
}

/** Smallest share either half of a Zen split keeps. */
export const ZEN_MIN_SPLIT = 0.2;

export function clampZenSplit(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.min(1 - ZEN_MIN_SPLIT, Math.max(ZEN_MIN_SPLIT, value));
}

/**
 * Zen mode's chats (fork, L-230): one column of one or two chats, top first.
 * It is a Focus grid with a single column, so Focus's upkeep (loading a
 * restored chat, dropping a deleted one) runs on it unchanged.
 */
import type { FocusGrid } from "../../focus/model/focusGrid";

export const ZEN_MAX_PANES = 2;

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

/** Zen's chats, top first. */
export function zenIds(grid: FocusGrid): string[] {
  return (grid.columns[0] ?? []).slice(0, ZEN_MAX_PANES);
}

/** A Zen grid of these chats (repeats and extras dropped). */
export function zenGridOf(ids: readonly string[]): FocusGrid {
  const kept = [...new Set(ids)].slice(0, ZEN_MAX_PANES);
  return kept.length > 0 ? { columns: [kept], overflow: [] } : EMPTY_ZEN_GRID;
}

/**
 * Shows chat `id` in pane `slot` (0 top, 1 bottom). A chat already in the
 * other pane trades places, so one chat never shows twice; a slot past the
 * last pane adds a pane.
 */
export function zenShow(grid: FocusGrid, slot: number, id: string): FocusGrid {
  const ids = zenIds(grid);
  const at = ids.indexOf(id);
  if (at === slot) return grid;
  if (slot >= ids.length) {
    return zenGridOf(at >= 0 ? ids : [...ids, id]);
  }
  const next = [...ids];
  if (at >= 0) next[at] = next[slot]!;
  next[slot] = id;
  return zenGridOf(next);
}

/** Takes a chat out; the other pane, if any, fills the panel. */
export function zenClose(grid: FocusGrid, id: string): FocusGrid {
  const ids = zenIds(grid);
  return ids.includes(id) ? zenGridOf(ids.filter((each) => each !== id)) : grid;
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

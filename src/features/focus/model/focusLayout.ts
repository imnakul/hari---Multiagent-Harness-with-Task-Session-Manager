/**
 * Focus mode pane sizes (fork, L-143): how wide each column is and where a
 * two-chat column splits. Sizes follow a column's first chat, so moving
 * panes keeps the sizes they had; a column the layout has not seen gets an
 * equal share. Stored apart from the grid, which stays a plain id layout.
 */
export type FocusLayout = {
  /** Column key -> width weight; shares are weights over their sum. */
  widths: Record<string, number>;
  /** Column key -> top chat's share of the column height (0–1). */
  splits: Record<string, number>;
};

export const EMPTY_FOCUS_LAYOUT: FocusLayout = { widths: {}, splits: {} };
export const DEFAULT_FOCUS_SPLIT = 0.5;

const STORAGE_KEY = "monocode.focusLayout.v1";
/** Keeps stored sizes bounded as chats come and go. */
const MAX_ENTRIES = 32;

export function focusColumnKey(column: readonly string[]): string {
  return column[0] ?? "";
}

/** Each column's share of the width, summing to 1. */
export function focusColumnShares(
  columns: readonly (readonly string[])[],
  layout: FocusLayout,
): number[] {
  const weights = columns.map((column) => {
    const weight = layout.widths[focusColumnKey(column)];
    return weight !== undefined && weight > 0 ? weight : 1;
  });
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  return weights.map((weight) => (total > 0 ? weight / total : 0));
}

/**
 * Moves the edge between column `index` and the next one to `edge` (a share
 * of the whole width from the left), keeping both at least `minShare` wide.
 * Other columns keep their shares; all shown columns are stored as weights.
 */
export function resizeFocusColumns(
  layout: FocusLayout,
  columns: readonly (readonly string[])[],
  index: number,
  edge: number,
  minShare: number,
): FocusLayout {
  if (index < 0 || index >= columns.length - 1) return layout;
  const shares = focusColumnShares(columns, layout);
  const start = shares.slice(0, index).reduce((sum, share) => sum + share, 0);
  const pair = shares[index] + shares[index + 1];
  const min = Math.min(minShare, pair / 2);
  const left = clamp(edge - start, min, pair - min);
  shares[index] = left;
  shares[index + 1] = pair - left;
  const widths = { ...layout.widths };
  columns.forEach((column, i) => {
    widths[focusColumnKey(column)] = shares[i];
  });
  return { ...layout, widths: trim(widths) };
}

export function focusRowSplit(
  column: readonly string[],
  layout: FocusLayout,
): number {
  const split = layout.splits[focusColumnKey(column)];
  return split !== undefined && split > 0 && split < 1
    ? split
    : DEFAULT_FOCUS_SPLIT;
}

/** Sets where a two-chat column splits, keeping both rows at least `minShare` tall. */
export function setFocusRowSplit(
  layout: FocusLayout,
  column: readonly string[],
  split: number,
  minShare: number,
): FocusLayout {
  const min = Math.min(minShare, 0.5);
  return {
    ...layout,
    splits: trim({
      ...layout.splits,
      [focusColumnKey(column)]: clamp(split, min, 1 - min),
    }),
  };
}

/** Equal widths and halved columns for what is shown; others keep theirs. */
export function resetFocusLayout(
  layout: FocusLayout,
  columns: readonly (readonly string[])[],
): FocusLayout {
  const widths = { ...layout.widths };
  const splits = { ...layout.splits };
  for (const column of columns) {
    delete widths[focusColumnKey(column)];
    delete splits[focusColumnKey(column)];
  }
  return { widths, splits };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Drops the oldest entries past the cap (objects keep insertion order). */
function trim(entries: Record<string, number>): Record<string, number> {
  const keys = Object.keys(entries);
  if (keys.length <= MAX_ENTRIES) return entries;
  return Object.fromEntries(
    keys.slice(-MAX_ENTRIES).map((key) => [key, entries[key]]),
  );
}

function parseEntries(raw: unknown): Record<string, number> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const entries: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "number" && Number.isFinite(value) && value > 0)
      entries[key] = value;
  }
  return trim(entries);
}

export function parseFocusLayout(raw: unknown): FocusLayout {
  if (typeof raw !== "object" || raw === null) return EMPTY_FOCUS_LAYOUT;
  const record: Record<string, unknown> = { ...raw };
  const splits = parseEntries(record.splits);
  for (const key of Object.keys(splits)) {
    if (splits[key] >= 1) delete splits[key];
  }
  return { widths: parseEntries(record.widths), splits };
}

export function loadFocusLayout(): FocusLayout {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? parseFocusLayout(JSON.parse(raw)) : EMPTY_FOCUS_LAYOUT;
  } catch {
    return EMPTY_FOCUS_LAYOUT;
  }
}

export function saveFocusLayout(layout: FocusLayout): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  } catch {
    // Storage full or unavailable: the sizes still hold for this run.
  }
}

import {
  Children,
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { ResizeHandle } from "../ResizeHandle";

const BOARD_GAP = 12; // gap-3
const BOARD_PADDING = 12; // p-3
const REFLOW_MS = 260;

/** Columns per row while a wrapping board is narrower than one row. */
const WrapContext = createContext(false);
/** The board never scrolls sideways: columns shrink instead. */
const FitContext = createContext(false);

/**
 * Columns per row for `count` columns in `width`: the whole row when it fits,
 * otherwise an even split (4 → 2 → 1) so a wrapped board stays a tidy grid.
 */
export function boardColumnsPerRow(
  count: number,
  width: number,
  minColumnWidth: number,
): number {
  const fits = (perRow: number) =>
    perRow * minColumnWidth + (perRow - 1) * BOARD_GAP + 2 * BOARD_PADDING <=
    width;
  if (count <= 1 || fits(count)) return Math.max(1, count);
  for (
    let perRow = Math.ceil(count / 2);
    perRow > 1;
    perRow = Math.ceil(perRow / 2)
  )
    if (fits(perRow)) return perRow;
  return 1;
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/**
 * Board of columns. By default one horizontal row that scrolls inside
 * itself. With `wrapBelow`, a board narrower than its columns' minimum
 * reflows into an even grid (4 columns → 2×2) instead of scrolling, and the
 * columns glide to their new places.
 */
export function BoardColumns({
  children,
  wrapBelow,
  fit = false,
}: {
  children: ReactNode;
  /**
   * Never scroll horizontally: columns shrink to fit the board (wrapping
   * still applies first when `wrapBelow` is set).
   */
  fit?: boolean;
  /** Minimum column width that triggers wrapping; omit to always scroll. */
  wrapBelow?: number;
}) {
  const board = useRef<HTMLDivElement>(null);
  const count = Children.toArray(children).length;
  const [perRow, setPerRow] = useState(count);
  const perRowRef = useRef(perRow);
  perRowRef.current = perRow;
  // Column positions just before a reflow, for the glide (FLIP) animation.
  const before = useRef<Map<string, DOMRect> | null>(null);

  useLayoutEffect(() => {
    const element = board.current;
    if (!element || wrapBelow === undefined) return;
    let measured = false;
    const measure = () => {
      // A hidden board (display: none) has no width; keep its last layout.
      if (!element.clientWidth) return;
      const next = boardColumnsPerRow(count, element.clientWidth, wrapBelow);
      const first = !measured;
      measured = true;
      if (next === perRowRef.current) return;
      // Measured before React re-lays the board out, for the glide. The
      // first layout just appears in place.
      if (!first) before.current = columnRects(element);
      perRowRef.current = next;
      setPerRow(next);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [count, wrapBelow]);

  useLayoutEffect(() => {
    const element = board.current;
    const previous = before.current;
    before.current = null;
    if (!element || !previous || prefersReducedMotion()) return;
    for (const [id, rect] of columnRects(element)) {
      const from = previous.get(id);
      const column = element.querySelector<HTMLElement>(
        `[data-board-column="${CSS.escape(id)}"]`,
      );
      if (!from || !column || typeof column.animate !== "function") continue;
      const dx = from.left - rect.left;
      const dy = from.top - rect.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
      column.animate(
        [
          { transform: `translate(${dx}px, ${dy}px)` },
          { transform: "translate(0, 0)" },
        ],
        { duration: REFLOW_MS, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" },
      );
    }
  }, [perRow]);

  const wrapped = wrapBelow !== undefined && perRow < count;
  return (
    <WrapContext.Provider value={wrapped}>
      <FitContext.Provider value={fit}>
      <div
        ref={board}
        data-board-wrapped={wrapped ? perRow : undefined}
        style={
          wrapped
            ? {
                gridTemplateColumns: `repeat(${perRow}, minmax(0, 1fr))`,
                gridAutoRows: "minmax(0, 1fr)",
              }
            : undefined
        }
        className={
          wrapped
            ? "grid h-full min-h-0 min-w-0 gap-3 overflow-hidden p-3"
            : `flex h-full min-h-0 min-w-0 gap-3 p-3 ${fit ? "overflow-x-hidden" : "overflow-x-auto"}`
        }
      >
        {children}
      </div>
      </FitContext.Provider>
    </WrapContext.Provider>
  );
}

function columnRects(board: HTMLElement): Map<string, DOMRect> {
  const rects = new Map<string, DOMRect>();
  for (const column of board.querySelectorAll<HTMLElement>(
    ":scope > [data-board-column]",
  ))
    if (column.dataset.boardColumn)
      rects.set(column.dataset.boardColumn, column.getBoundingClientRect());
  return rects;
}

/**
 * Shared column width for a board. `width: null` means columns fill the
 * board equally (never narrower than `fillMin`); a number fixes every column
 * to that width and the board scrolls when they don't fit.
 */
export type BoardColumnResize = {
  width: number | null;
  /** Live width while dragging, or null when idle. */
  liveWidth: number | null;
  min: number;
  max: number;
  onLive: (width: number | null) => void;
  onCommit: (width: number) => void;
  /** Double-click: return to filling the board. */
  onReset: () => void;
};

export function BoardColumn({
  id,
  label,
  icon,
  count,
  fillMin,
  resize,
  actions,
  handle,
  highlighted = false,
  dimmed = false,
  children,
  columnProps,
  grow,
  edge,
}: {
  id: string;
  label: string;
  icon?: ReactNode;
  /** Optional drag grip shown before the icon (column reordering). */
  handle?: ReactNode;
  /** The column is being dragged to a new place. */
  dimmed?: boolean;
  count: number;
  /** Minimum width while columns fill the board. */
  fillMin: number;
  resize?: BoardColumnResize;
  actions?: ReactNode;
  highlighted?: boolean;
  children: ReactNode;
  columnProps?: HTMLAttributes<HTMLElement> & Record<`data-${string}`, string>;
  /** Share of the row while columns fill the board (flex-grow); default 1. */
  grow?: number;
  /** Extra content pinned to the column, such as a divider on its right edge. */
  edge?: ReactNode;
}) {
  const section = useRef<HTMLElement>(null);
  const wrapped = useContext(WrapContext);
  const fit = useContext(FitContext);
  // In a wrapped grid the grid sizes columns; widths and resizing pause.
  const fixed = resize && !wrapped ? (resize.liveWidth ?? resize.width) : null;
  return (
    <section
      {...columnProps}
      ref={section}
      aria-label={`${label} column`}
      data-board-column={id}
      // A fixed width is the preferred width, not a floor: columns shrink to
      // fit the board (down to the resize minimum) instead of overflowing,
      // e.g. a width chosen for fewer columns or a wider window.
      style={
        wrapped
          ? undefined
          : fixed === null
            ? { minWidth: fit ? 0 : fillMin, flexGrow: grow }
            : { flexBasis: fixed, minWidth: resize?.min ?? fillMin }
      }
      className={`relative flex min-h-0 flex-col rounded-xl transition-colors duration-100 ${
        wrapped
          ? "min-w-0"
          : fixed === null
            ? "flex-1 basis-0"
            : "shrink grow-0"
      } ${
        highlighted
          ? "border border-accent/40 bg-content/5"
          : "border border-content/10 bg-content/3"
      } ${dimmed ? "opacity-50" : ""}`}
    >
      <div className="group/column-header flex h-9 shrink-0 items-center gap-2 px-3 text-[12px] font-medium">
        {handle}
        {icon}
        <span className="min-w-0 truncate">{label}</span>
        <span className="text-content/45 tabular-nums">{count}</span>
        {actions ? (
          <div className="ml-auto flex items-center">{actions}</div>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-1.5">
        {children}
      </div>
      {resize && !wrapped ? (
        <ResizeHandle
          label={`Resize ${label} column`}
          value={fixed ?? fillMin}
          min={resize.min}
          max={resize.max}
          defaultValue={fillMin}
          // The last column's edge sits beside the board's own edge (or a side
          // pane's divider); every column shares one width, so the other
          // handles cover it and a second draggable line there only confuses.
          placement="inset-y-2 -right-2.5 rounded-full [[data-board-column]:last-child>&]:hidden"
          getStartValue={() =>
            Math.round(section.current?.getBoundingClientRect().width ?? 0) ||
            fixed ||
            fillMin
          }
          onLive={resize.onLive}
          onCommit={resize.onCommit}
          onReset={resize.onReset}
        />
      ) : null}
      {wrapped ? null : edge}
    </section>
  );
}

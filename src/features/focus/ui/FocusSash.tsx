import type { CSSProperties, ReactNode } from "react";
import { suppressTextSelection } from "../../../shared/lib/drag";

/** One arrow-key press moves an edge this share of its span. */
const KEY_STEP = 0.02;

type Props = {
  /** "vertical" sits between columns and drags sideways; "horizontal" splits a column. */
  orientation: "vertical" | "horizontal";
  label: string;
  /** The edge's place in its span, 0–1. */
  value: number;
  style: CSSProperties;
  /** The span the edge moves along, in client pixels, read when a drag starts. */
  measure: () => { origin: number; span: number } | null;
  onPreview: (value: number) => void;
  onCommit: (value: number) => void;
  onCancel: () => void;
  /** Double-click: back to equal sizes. */
  onReset: () => void;
};

/**
 * A Focus pane edge (fork, L-143), after PaneTree's sash: drag with the
 * pointer (previewed each frame, Escape cancels), or focus it and use the
 * arrow keys. It sits in the gap between panes, showing a line on hover.
 */
export function FocusSash({
  orientation,
  label,
  value,
  style,
  measure,
  onPreview,
  onCommit,
  onCancel,
  onReset,
}: Props): ReactNode {
  const vertical = orientation === "vertical";
  return (
    <div
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation={orientation}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value * 100)}
      data-focus-sash=""
      title="Drag to resize · double-click for equal sizes"
      style={style}
      className={`group absolute z-10 touch-none focus-visible:outline-none ${
        vertical ? "cursor-col-resize" : "cursor-row-resize"
      }`}
      onDoubleClick={onReset}
      onKeyDown={(event) => {
        const back = vertical ? "ArrowLeft" : "ArrowUp";
        const forward = vertical ? "ArrowRight" : "ArrowDown";
        if (event.key !== back && event.key !== forward) return;
        event.preventDefault();
        onCommit(value + (event.key === forward ? KEY_STEP : -KEY_STEP));
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        const area = measure();
        if (!area || area.span <= 0) return;
        event.preventDefault();
        event.stopPropagation();
        const handle = event.currentTarget;
        const pointerId = event.pointerId;
        handle.setPointerCapture(pointerId);
        const restoreSelection = suppressTextSelection();
        const previousCursor = document.body.style.cursor;
        document.body.style.cursor = vertical ? "col-resize" : "row-resize";
        let next = value;
        let moved = false;
        let frame: number | null = null;

        const move = (ev: PointerEvent) => {
          moved = true;
          next =
            ((vertical ? ev.clientX : ev.clientY) - area.origin) / area.span;
          if (frame != null) return;
          frame = requestAnimationFrame(() => {
            frame = null;
            onPreview(next);
          });
        };
        const finish = (commit: boolean) => {
          if (frame != null) cancelAnimationFrame(frame);
          frame = null;
          if (handle.hasPointerCapture(pointerId))
            handle.releasePointerCapture(pointerId);
          handle.removeEventListener("pointermove", move);
          handle.removeEventListener("pointerup", up);
          handle.removeEventListener("pointercancel", cancel);
          window.removeEventListener("keydown", keydown, true);
          restoreSelection();
          document.body.style.cursor = previousCursor;
          if (!moved) return;
          if (commit) onCommit(next);
          else onCancel();
        };
        const up = () => finish(true);
        const cancel = () => finish(false);
        const keydown = (ev: KeyboardEvent) => {
          if (ev.key !== "Escape") return;
          ev.preventDefault();
          ev.stopPropagation();
          finish(false);
        };
        handle.addEventListener("pointermove", move);
        handle.addEventListener("pointerup", up);
        handle.addEventListener("pointercancel", cancel);
        window.addEventListener("keydown", keydown, true);
      }}
    >
      <span
        aria-hidden
        className={`pointer-events-none absolute rounded-full bg-content/0 transition-colors duration-100 group-hover:bg-content/25 group-focus-visible:bg-[var(--user-accent-color,var(--color-accent))] group-active:bg-[var(--user-accent-color,var(--color-accent))] ${
          vertical
            ? "inset-y-3 left-1/2 w-0.5 -translate-x-1/2"
            : "inset-x-3 top-1/2 h-0.5 -translate-y-1/2"
        }`}
      />
    </div>
  );
}

import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { suppressTextSelection } from "../lib/drag";

const KEY_STEP = 16;

/**
 * Vertical drag handle for a column edge. The live value is reported through
 * `onLive` while dragging, at most once per frame (fork, L-176), and `null`
 * when the drag ends; `onCommit` fires once on pointerup/keyup/double-click.
 * An `onLive` that writes the DOM instead of state keeps the drag free of
 * React renders. Double-click restores `defaultValue`, or calls `onReset`.
 */
export function ResizeHandle({
  label,
  value,
  min,
  max,
  defaultValue,
  onLive,
  onCommit,
  placement = "inset-y-0 -right-1",
  getStartValue,
  onReset,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  defaultValue: number;
  onLive: (value: number | null) => void;
  onCommit: (value: number) => void;
  /** Tailwind position classes relative to the nearest positioned ancestor. */
  placement?: string;
  /** Where a drag starts when `value` is not the rendered size (fill layouts). */
  getStartValue?: () => number;
  /** Double-click action instead of committing `defaultValue`. */
  onReset?: () => void;
}) {
  const [dragging, setDragging] = useState(false);
  const liveRef = useRef<number | null>(null);
  const clamp = (next: number) =>
    Math.min(max, Math.max(min, Math.round(next)));
  const setLive = (next: number | null) => {
    liveRef.current = next;
    onLive(next);
  };
  const finish = () => {
    const live = liveRef.current;
    setLive(null);
    if (live !== null) onCommit(live);
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const handle = event.currentTarget;
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startValue = liveRef.current ?? getStartValue?.() ?? value;
    try {
      handle.setPointerCapture(pointerId);
    } catch {
      /* the pointer may already be gone */
    }
    setDragging(true);
    const restoreSelection = suppressTextSelection();
    const previousCursor = document.body.style.cursor;
    document.body.style.cursor = "col-resize";
    let pending: number | null = null;
    let frame = 0;
    const paint = () => {
      frame = 0;
      if (pending === null) return;
      setLive(pending);
      handle.setAttribute("aria-valuenow", String(pending));
    };
    const onMove = (move: globalThis.PointerEvent) => {
      if (move.pointerId !== pointerId) return;
      pending = clamp(startValue + move.clientX - startX);
      if (!frame) frame = requestAnimationFrame(paint);
    };
    const onUp = (up: globalThis.PointerEvent) => {
      if (up.pointerId !== pointerId) return;
      if (frame) {
        cancelAnimationFrame(frame);
        paint();
      }
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      restoreSelection();
      document.body.style.cursor = previousCursor;
      setDragging(false);
      try {
        handle.releasePointerCapture(pointerId);
      } catch {
        /* already released */
      }
      finish();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const delta =
      event.key === "ArrowLeft"
        ? -KEY_STEP
        : event.key === "ArrowRight"
          ? KEY_STEP
          : 0;
    if (!delta) return;
    event.preventDefault();
    event.stopPropagation();
    setLive(clamp((liveRef.current ?? getStartValue?.() ?? value) + delta));
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      className={`absolute ${placement} z-10 w-2 cursor-col-resize touch-none outline-none focus-visible:bg-accent/40 ${
        dragging ? "bg-content/15" : "hover:bg-content/10"
      }`}
      onClick={(event) => event.stopPropagation()}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      onKeyUp={(event) => {
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") finish();
      }}
      onDoubleClick={(event) => {
        event.stopPropagation();
        setLive(null);
        if (onReset) onReset();
        else onCommit(clamp(defaultValue));
      }}
    />
  );
}

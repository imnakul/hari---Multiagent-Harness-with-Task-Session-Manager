import { useSyncExternalStore, type PointerEvent as ReactPointerEvent } from "react";
import type { ZenPlace } from "./zenPanes";

// Fork (L-230): a chat dragged from a Zen dropdown onto a chat's right half
// opens beside it, onto its lower half in a new row below. Pointer events,
// as for sidebar session drags: Tauri takes the webview's native drag and
// drop on Windows.

/** Where a dragged chat would land: next to chat `pane`. */
export type ZenDropTarget = { pane: string; where: ZenPlace };

export type ZenChatDrag = {
  id: string;
  label: string;
  x: number;
  y: number;
  /** The spot under the pointer, if the chat fits there. */
  over: ZenDropTarget | null;
};

let drag: ZenChatDrag | null = null;
const listeners = new Set<() => void>();

function set(next: ZenChatDrag | null): void {
  drag = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const snapshot = (): ZenChatDrag | null => drag;

/** The chat being dragged out of a Zen dropdown, if any. */
export function useZenChatDrag(): ZenChatDrag | null {
  return useSyncExternalStore(subscribe, snapshot, () => null);
}

/** Pointer travel before a press on a chat becomes a drag. */
export const ZEN_DRAG_THRESHOLD = 5;

/**
 * Which half of a pane the point is in: the right half is beside, the
 * lower half below. Where both fit (the lower right), the nearer edge wins.
 */
export function zenDropZone(
  rect: { left: number; top: number; width: number; height: number },
  x: number,
  y: number,
  beside: boolean,
  below: boolean,
): ZenPlace | null {
  if (rect.width <= 0 || rect.height <= 0) return null;
  const across = (x - rect.left) / rect.width;
  const down = (y - rect.top) / rect.height;
  const right = beside && across > 0.5;
  const lower = below && down > 0.5;
  if (right && lower) return across > down ? "beside" : "below";
  if (right) return "beside";
  if (lower) return "below";
  return null;
}

/** The chat pane (`data-zen-drop-pane`) under the point, and the spot in it. */
export function zenDropFromPoint(
  x: number,
  y: number,
  fits: (pane: string, where: ZenPlace) => boolean,
): ZenDropTarget | null {
  const element = document
    .elementFromPoint(x, y)
    ?.closest<HTMLElement>("[data-zen-drop-pane]");
  const pane = element?.dataset.zenDropPane;
  if (!element || !pane) return null;
  const where = zenDropZone(
    element.getBoundingClientRect(),
    x,
    y,
    fits(pane, "beside"),
    fits(pane, "below"),
  );
  return where ? { pane, where } : null;
}

/**
 * Starts watching a press on a dropdown chat. A short press stays a click;
 * past the threshold it drags, and a release over a spot where `fits` says
 * the chat can go calls `onDrop`. Escape cancels.
 */
export function startZenChatDrag(
  event: ReactPointerEvent<HTMLElement>,
  id: string,
  label: string,
  fits: (pane: string, where: ZenPlace) => boolean,
  onDrop: (target: ZenDropTarget) => void,
): void {
  if (event.button !== 0) return;
  const handle = event.currentTarget;
  const pointerId = event.pointerId;
  const startX = event.clientX;
  const startY = event.clientY;
  let active = false;

  const onMove = (ev: PointerEvent): void => {
    if (!active) {
      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < ZEN_DRAG_THRESHOLD)
        return;
      active = true;
      try {
        handle.setPointerCapture(pointerId);
      } catch {
        /* the press already ended */
      }
    }
    // Hit-test after the dropdown hides, so the pane under it is found.
    set({
      id,
      label,
      x: ev.clientX,
      y: ev.clientY,
      over: zenDropFromPoint(ev.clientX, ev.clientY, fits),
    });
  };
  const onUp = (ev: PointerEvent): void => finish(ev, true);
  const onCancel = (ev: PointerEvent): void => finish(ev, false);
  const onKey = (ev: KeyboardEvent): void => {
    if (ev.key !== "Escape" || !active) return;
    ev.preventDefault();
    ev.stopPropagation();
    finish(null, false);
  };

  function finish(ev: PointerEvent | null, commit: boolean): void {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onCancel);
    window.removeEventListener("keydown", onKey, true);
    try {
      handle.releasePointerCapture(pointerId);
    } catch {
      /* already released */
    }
    if (!active) return;
    // Hit-test while the drop hints are still drawn.
    const target =
      commit && ev ? zenDropFromPoint(ev.clientX, ev.clientY, fits) : null;
    set(null);
    // The release would also click the chat; a drag is not a pick.
    const skip = (click: MouseEvent): void => {
      click.preventDefault();
      click.stopPropagation();
    };
    window.addEventListener("click", skip, { capture: true, once: true });
    window.setTimeout(() => window.removeEventListener("click", skip, true), 0);
    if (target) onDrop(target);
  }

  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onCancel);
  window.addEventListener("keydown", onKey, true);
}

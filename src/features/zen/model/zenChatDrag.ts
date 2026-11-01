import { useSyncExternalStore, type PointerEvent as ReactPointerEvent } from "react";

// Fork (L-230): a chat dragged from a Zen dropdown onto the panel's lower
// half opens there, as the second chat. Pointer events, as for sidebar
// session drags: Tauri takes the webview's native drag and drop on Windows.

export type ZenChatDrag = {
  id: string;
  label: string;
  x: number;
  y: number;
  /** Over the lower-half drop area. */
  over: boolean;
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

/** Whether the point is over the lower-half drop area (`data-zen-drop-below`). */
export function zenDropBelowFromPoint(x: number, y: number): boolean {
  return !!document.elementFromPoint(x, y)?.closest("[data-zen-drop-below]");
}

/**
 * Starts watching a press on a dropdown chat. A short press stays a click;
 * past the threshold it drags, and a release over the drop area calls
 * `onDrop`. Escape cancels.
 */
export function startZenChatDrag(
  event: ReactPointerEvent<HTMLElement>,
  id: string,
  label: string,
  onDrop: (id: string) => void,
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
    // Hit-test after the dropdown hides, so the area under it is found.
    set({
      id,
      label,
      x: ev.clientX,
      y: ev.clientY,
      over: zenDropBelowFromPoint(ev.clientX, ev.clientY),
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
    // Hit-test while the drop area is still drawn.
    const drop = commit && ev ? zenDropBelowFromPoint(ev.clientX, ev.clientY) : false;
    set(null);
    // The release would also click the chat; a drag is not a pick.
    const skip = (click: MouseEvent): void => {
      click.preventDefault();
      click.stopPropagation();
    };
    window.addEventListener("click", skip, { capture: true, once: true });
    window.setTimeout(() => window.removeEventListener("click", skip, true), 0);
    if (drop) onDrop(id);
  }

  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onCancel);
  window.addEventListener("keydown", onKey, true);
}

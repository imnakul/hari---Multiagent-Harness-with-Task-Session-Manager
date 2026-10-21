import { useSyncExternalStore } from "react";

// Fork (L-153): a sidebar session card dragged over Focus mode. The card owns
// the drag (pointer events, as for workspace panes); Focus only shows that a
// drop would open the chat there.

let over = false;
const listeners = new Set<() => void>();

export function setFocusSessionDropOver(next: boolean): void {
  if (over === next) return;
  over = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getOver = (): boolean => over;

/** True while a dragged sidebar session is over the Focus drop area. */
export function useFocusSessionDropOver(): boolean {
  return useSyncExternalStore(subscribe, getOver, () => false);
}

/** Whether the point is over Focus mode's drop area (`data-focus-drop-area`). */
export function focusDropFromPoint(x: number, y: number): boolean {
  return !!document.elementFromPoint(x, y)?.closest("[data-focus-drop-area]");
}

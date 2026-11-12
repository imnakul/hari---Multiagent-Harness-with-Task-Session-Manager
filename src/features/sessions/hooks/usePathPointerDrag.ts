import {
  useEffect,
  useRef,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  emitExplorerFilePointerDrag,
  setGrabbing,
  suppressTextSelection,
} from "../../../shared/lib/drag";

const DRAG_THRESHOLD_PX = 5;
const CLICK_SUPPRESS_MS = 400;

type PathPointerDrag = {
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  /** Swallows the click that ends a drag, so a thumbnail doesn't also open. */
  onClickCapture: (event: ReactMouseEvent<HTMLElement>) => void;
};

/**
 * Fork (L-261): drag a saved file (a sent image chip) inside MonoCode and drop
 * it on any composer, which attaches it again. Rides the file explorer's
 * pointer-drag channel, so `useFileDrop` handles the drop the same way. HTML5
 * drag-and-drop is not used: Tauri's native drop handler swallows it on
 * Windows, and dragging out to other apps is out of scope.
 *
 * `path` undefined disables the drag (notes and unsaved images).
 */
export function usePathPointerDrag(
  path: string | undefined,
  label: string,
): PathPointerDrag {
  const cleanup = useRef<(() => void) | null>(null);
  const suppressClickUntil = useRef(0);

  useEffect(() => () => cleanup.current?.(), []);

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>): void => {
    if (!path || event.button !== 0 || cleanup.current) return;
    // A const keeps the narrowed type inside the hoisted handlers below.
    const dragPath: string = path;
    const handle = event.currentTarget;
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startY = event.clientY;
    let lastX = startX;
    let lastY = startY;
    let active = false;
    let restoreSelection: (() => void) | undefined;
    let preview: HTMLDivElement | null = null;

    const movePreview = (): void => {
      if (!preview) return;
      const edge = 8;
      const x = Math.min(
        Math.max(edge, lastX - 12),
        Math.max(edge, window.innerWidth - preview.offsetWidth - edge),
      );
      const y = Math.min(
        Math.max(edge, lastY - 13),
        Math.max(edge, window.innerHeight - preview.offsetHeight - edge),
      );
      preview.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
    };

    const createPreview = (): void => {
      preview = document.createElement("div");
      preview.setAttribute("aria-hidden", "true");
      preview.classList.add("explorer-file-drag-preview");
      const thumbnail = handle.querySelector("img");
      if (thumbnail?.src) {
        const icon = document.createElement("span");
        const image = document.createElement("img");
        image.src = thumbnail.src;
        image.alt = "";
        image.className = "size-4 rounded-sm object-cover";
        icon.append(image);
        preview.append(icon);
      }
      const name = document.createElement("span");
      name.className = "truncate text-[12px]";
      name.textContent = label;
      preview.append(name);
      document.body.append(preview);
      movePreview();
    };

    const reset = (): void => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", onCancel);
      preview?.remove();
      preview = null;
      document.documentElement.classList.remove("is-explorer-file-dragging");
      if (restoreSelection) {
        restoreSelection();
        restoreSelection = undefined;
        setGrabbing(false);
      }
      try {
        if (handle.hasPointerCapture(pointerId))
          handle.releasePointerCapture(pointerId);
      } catch {
        // Already released by the browser.
      }
      if (active) emitExplorerFilePointerDrag({ type: "end", path: dragPath });
      cleanup.current = null;
    };

    const activate = (): void => {
      active = true;
      restoreSelection = suppressTextSelection();
      setGrabbing(true);
      createPreview();
      document.documentElement.classList.add("is-explorer-file-dragging");
      try {
        handle.setPointerCapture(pointerId);
      } catch {
        // Window listeners still track the gesture.
      }
    };

    function onMove(moveEvent: PointerEvent): void {
      if (moveEvent.pointerId !== pointerId) return;
      lastX = moveEvent.clientX;
      lastY = moveEvent.clientY;
      if (!active) {
        if (Math.hypot(lastX - startX, lastY - startY) < DRAG_THRESHOLD_PX)
          return;
        activate();
      }
      moveEvent.preventDefault();
      movePreview();
      emitExplorerFilePointerDrag({ type: "move", path: dragPath, x: lastX, y: lastY });
    }

    function finish(commit: boolean, upEvent?: PointerEvent): void {
      if (commit && upEvent) onMove(upEvent);
      if (active) {
        suppressClickUntil.current = performance.now() + CLICK_SUPPRESS_MS;
        if (commit)
          emitExplorerFilePointerDrag({ type: "drop", path: dragPath, x: lastX, y: lastY });
      }
      reset();
    }

    function onUp(upEvent: PointerEvent): void {
      if (upEvent.pointerId === pointerId) finish(true, upEvent);
    }
    function onCancel(): void {
      finish(false);
    }
    function onKey(keyEvent: KeyboardEvent): void {
      if (keyEvent.key !== "Escape") return;
      keyEvent.preventDefault();
      finish(false);
    }

    cleanup.current = onCancel;
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKey);
    window.addEventListener("blur", onCancel);
  };

  const onClickCapture = (event: ReactMouseEvent<HTMLElement>): void => {
    if (performance.now() >= suppressClickUntil.current) return;
    event.preventDefault();
    event.stopPropagation();
  };

  return { onPointerDown, onClickCapture };
}

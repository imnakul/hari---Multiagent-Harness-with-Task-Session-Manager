import { useLayoutEffect, useRef, type ReactNode } from "react";

export const SLIDE_IN_MS = 220;
export const SLIDE_OUT_MS = 180;
const EASE = "cubic-bezier(0.23, 1, 0.32, 1)";

function reducedMotion(): boolean {
  return Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
}

/** The panel's own width plus its side margins. */
function panelWidth(box: HTMLElement): number {
  const panel = box.firstElementChild as HTMLElement | null;
  if (!panel) return 0;
  const style = window.getComputedStyle(panel);
  return panel.offsetWidth + (parseFloat(style.marginLeft) || 0) + (parseFloat(style.marginRight) || 0);
}

/**
 * Fork (L-219): a right-hand side panel that slides in and out. Its width grows
 * from nothing, so the chat beside it narrows smoothly, and the panel (one
 * child with a fixed width) rides in from the right edge. It stays mounted
 * until the slide out ends, then calls `onGone`. Toggling mid-slide reverses
 * from where it is. At rest the wrapper hugs the panel, so resizing stays
 * instant. Reduced motion: no slide. On mount it slides only with `appear`.
 */
export function SlidePanel({
  open,
  appear = false,
  className = "",
  beforeLeave,
  onMoving,
  onGone,
  children,
}: {
  open: boolean;
  appear?: boolean;
  className?: string;
  /** Runs before the slide out starts (the Browser freezes its page). */
  beforeLeave?: () => Promise<void>;
  /** True while sliding or about to; false once open and still. */
  onMoving?: (moving: boolean) => void;
  onGone: () => void;
  children: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const shownOpen = useRef<boolean | null>(null);
  const latest = useRef({ beforeLeave, onMoving, onGone });
  latest.current = { beforeLeave, onMoving, onGone };

  useLayoutEffect(() => {
    const node = box.current;
    if (!node) return;
    // Slide on a real toggle, or on mount with `appear`; not when the effect
    // simply runs again with the same value.
    const changed = shownOpen.current === null ? appear : shownOpen.current !== open;
    shownOpen.current = open;
    const animate = changed && !reducedMotion();
    let timer = 0;
    let cancelled = false;
    const rest = () => {
      node.style.transition = "";
      node.style.width = "";
      node.style.overflow = "";
    };
    const slide = (to: number, ms: number, done: () => void) => {
      const from = node.getBoundingClientRect().width;
      node.style.overflow = "hidden";
      node.style.transition = "none";
      node.style.width = `${from}px`;
      void node.offsetWidth;
      node.style.transition = `width ${ms}ms ${EASE}`;
      node.style.width = `${to}px`;
      timer = window.setTimeout(done, ms);
    };

    if (open) {
      if (!animate) {
        rest();
        latest.current.onMoving?.(false);
        return;
      }
      latest.current.onMoving?.(true);
      slide(panelWidth(node), SLIDE_IN_MS, () => {
        rest();
        latest.current.onMoving?.(false);
      });
      return () => {
        cancelled = true;
        window.clearTimeout(timer);
      };
    }

    latest.current.onMoving?.(true);
    if (!animate) {
      latest.current.onGone();
      return;
    }
    void (latest.current.beforeLeave?.() ?? Promise.resolve()).then(() => {
      if (cancelled) return;
      slide(0, SLIDE_OUT_MS, () => latest.current.onGone());
    });
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // `appear` matters on mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <div ref={box} className={`flex shrink-0 ${className}`} inert={!open || undefined}>
      {children}
    </div>
  );
}

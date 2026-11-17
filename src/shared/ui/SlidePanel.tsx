import { useLayoutEffect, useRef, type ReactNode } from "react";

export const SLIDE_IN_MS = 220;
export const SLIDE_OUT_MS = 180;
const EASE = "cubic-bezier(0.23, 1, 0.32, 1)";
// Fork (L-323): `motion="slide"` moves the whole panel across the window, so
// it takes longer and eases in softly (a drawer curve); at 220 ms the long
// travel read as a jump.
const GLIDE_IN_MS = 340;
const GLIDE_OUT_MS = 260;
const GLIDE_EASE = "cubic-bezier(0.32, 0.72, 0, 1)";
/** Just past the right edge, margin included. */
const OFFSCREEN = "translateX(calc(100% + 0.5rem))";
// Fork (L-336): `motion="unroll"` uncovers the panel from its top edge down
// (out of the top bar, where its button is) and rolls it back up to close.
// Same timing and curve as the slide; the text never moves or squashes.
const ROLLED_UP = { clip: "inset(0 0 100% 0 round 0.75rem)", transform: "translateY(-0.5rem)" };
const UNROLLED = { clip: "inset(0 0 0 0 round 0.75rem)", transform: "translateY(0)" };

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
 *
 * Fork (L-306): `motion="slide"` moves only the panel (transform and opacity),
 * so nothing beside it is laid out again while it moves: the chat takes its
 * new width once, as the slide in starts or after the slide out ends.
 *
 * Fork (L-336): `motion="unroll"` is the same, but the panel unrolls down from
 * its top edge (clip, a small drop and a fade) instead of sliding in.
 */
export function SlidePanel({
  open,
  appear = false,
  motion = "width",
  className = "",
  beforeLeave,
  onMoving,
  onGone,
  children,
}: {
  open: boolean;
  appear?: boolean;
  motion?: "width" | "slide" | "unroll";
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
    const panel = motion !== "width" ? (node.firstElementChild as HTMLElement | null) : null;
    const unroll = motion === "unroll";
    let timer = 0;
    let cancelled = false;
    const rest = () => {
      node.style.transition = "";
      node.style.width = "";
      node.style.overflow = "";
      if (panel) {
        panel.style.transition = "";
        panel.style.transform = "";
        panel.style.opacity = "";
        panel.style.clipPath = "";
        panel.style.willChange = "";
      }
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
    // A fresh slide in starts past the right edge (or rolled up); one
    // already moving turns around from where it is.
    const hide = (target: HTMLElement) => {
      target.style.transform = unroll ? ROLLED_UP.transform : OFFSCREEN;
      if (unroll) target.style.clipPath = ROLLED_UP.clip;
      target.style.opacity = "0";
    };
    const glide = (target: HTMLElement, show: boolean, ms: number, done: () => void) => {
      if (show && !target.style.transform) {
        target.style.transition = "none";
        hide(target);
        void target.offsetWidth;
      }
      const moves = unroll ? ["transform", "opacity", "clip-path"] : ["transform", "opacity"];
      target.style.willChange = moves.join(", ");
      target.style.transition = moves.map((name) => `${name} ${ms}ms ${GLIDE_EASE}`).join(", ");
      if (!show) hide(target);
      else {
        target.style.transform = unroll ? UNROLLED.transform : "translateX(0)";
        if (unroll) target.style.clipPath = UNROLLED.clip;
        target.style.opacity = "1";
      }
      timer = window.setTimeout(done, ms);
    };

    if (open) {
      if (!animate) {
        rest();
        latest.current.onMoving?.(false);
        return;
      }
      latest.current.onMoving?.(true);
      const settle = () => {
        rest();
        latest.current.onMoving?.(false);
      };
      if (panel) glide(panel, true, GLIDE_IN_MS, settle);
      else slide(panelWidth(node), SLIDE_IN_MS, settle);
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
      if (panel) glide(panel, false, GLIDE_OUT_MS, () => latest.current.onGone());
      else slide(0, SLIDE_OUT_MS, () => latest.current.onGone());
    });
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // `appear` and `motion` matter on mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <div ref={box} className={`flex shrink-0 ${className}`} inert={!open || undefined}>
      {children}
    </div>
  );
}

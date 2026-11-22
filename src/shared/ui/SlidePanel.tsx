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
// Fork (L-376): `motion="fold"` folds the panel down out of the top bar
// (where its button is) and folds it back up to close: it is uncovered from
// its top edge down while it tips flat from a slight backward lean. It stays
// where it will rest the whole time (pinned to the right, laid over the chat
// beside it). The two motions take turns so nothing moves sideways while it
// unrolls: opening, it folds down over the chat first and the chat then
// narrows smoothly underneath it; closing, the chat widens back underneath
// first and the panel then folds up. (Run together, the chat's edge swept
// left below the unrolling panel and read as a slide in from the right.)
const FOLDED = {
  clip: "inset(0 0 100% 0 round 0.75rem)",
  transform: "perspective(1200px) rotateX(-10deg)",
};
const UNFOLDED = {
  clip: "inset(0 0 0 0 round 0.75rem)",
  transform: "perspective(1200px) rotateX(0deg)",
};
const FOLD_ORIGIN = "top center";
const FOLD_IN_MS = 300;
const FOLD_OUT_MS = 220;

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
 * Fork (L-376): `motion="fold"` folds the panel down from its top edge (clip,
 * a slight tilt and a fade) and back up, while its slot widens and narrows.
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
  motion?: "width" | "slide" | "fold";
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
    const fold = motion === "fold";
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
        panel.style.transformOrigin = "";
        panel.style.willChange = "";
        panel.style.position = "";
        panel.style.top = "";
        panel.style.bottom = "";
        panel.style.right = "";
      }
      node.style.position = "";
    };
    // While folding, the panel sits where it will rest, over the chat, and
    // the slot under it only makes room.
    const pin = (target: HTMLElement) => {
      if (window.getComputedStyle(node).position === "static") node.style.position = "relative";
      target.style.position = "absolute";
      target.style.top = "0";
      target.style.bottom = "0";
      target.style.right = "0";
    };
    const resize = (to: number, ms: number, ease: string) => {
      const from = node.getBoundingClientRect().width;
      // A pinned (folding) panel reaches past the slot's left edge while the
      // slot widens; clipping it there would read as a slide from the right.
      node.style.overflow = fold ? "visible" : "hidden";
      node.style.transition = "none";
      node.style.width = `${from}px`;
      void node.offsetWidth;
      node.style.transition = `width ${ms}ms ${ease}`;
      node.style.width = `${to}px`;
    };
    const slide = (to: number, ms: number, done: () => void) => {
      resize(to, ms, EASE);
      timer = window.setTimeout(done, ms);
    };
    // A fresh slide in starts past the right edge (or folded up); one
    // already moving turns around from where it is.
    const hide = (target: HTMLElement) => {
      target.style.transform = fold ? FOLDED.transform : OFFSCREEN;
      if (fold) {
        target.style.transformOrigin = FOLD_ORIGIN;
        target.style.clipPath = FOLDED.clip;
      }
      target.style.opacity = "0";
    };
    // Holds the slot at a fixed width (no transition) while the panel is pinned.
    const hold = (width: number) => {
      node.style.overflow = "visible";
      node.style.transition = "none";
      node.style.width = `${width}px`;
    };
    // A fixed (overlay) panel has no chat beside it to make room for.
    const docked = () => window.getComputedStyle(node).position !== "fixed";
    const glide = (target: HTMLElement, show: boolean, ms: number, done: () => void) => {
      if (show && !target.style.transform) {
        target.style.transition = "none";
        hide(target);
        void target.offsetWidth;
      }
      const moves = fold ? ["transform", "opacity", "clip-path"] : ["transform", "opacity"];
      target.style.willChange = moves.join(", ");
      target.style.transition = moves.map((name) => `${name} ${ms}ms ${GLIDE_EASE}`).join(", ");
      if (!show) hide(target);
      else {
        target.style.transform = fold ? UNFOLDED.transform : "translateX(0)";
        if (fold) {
          target.style.transformOrigin = FOLD_ORIGIN;
          target.style.clipPath = UNFOLDED.clip;
        }
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
      if (fold && panel) {
        const room = panelWidth(node);
        // A fresh open starts with no room made; one turning around keeps the room it has.
        const from = panel.style.position === "absolute" ? node.getBoundingClientRect().width : 0;
        const unfolded = panel.style.clipPath === UNFOLDED.clip;
        pin(panel);
        hold(from);
        const widen = () => {
          if (!docked()) return settle();
          resize(room, SLIDE_IN_MS, EASE);
          timer = window.setTimeout(settle, SLIDE_IN_MS);
        };
        if (unfolded) widen();
        else glide(panel, true, FOLD_IN_MS, widen);
      } else if (panel) glide(panel, true, GLIDE_IN_MS, settle);
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
      if (fold && panel) {
        const from = node.getBoundingClientRect().width;
        pin(panel);
        hold(from);
        const foldUp = () => glide(panel, false, FOLD_OUT_MS, () => latest.current.onGone());
        if (docked() && from > 0) {
          resize(0, SLIDE_OUT_MS, EASE);
          timer = window.setTimeout(foldUp, SLIDE_OUT_MS);
        } else foldUp();
      } else if (panel) glide(panel, false, GLIDE_OUT_MS, () => latest.current.onGone());
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

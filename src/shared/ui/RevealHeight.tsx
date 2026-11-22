import { useEffect, useState, type ReactNode } from "react";

/**
 * State behind a height reveal: whether the content is still mounted, whether
 * it is folding away, and the `reveal-height-in`/`-out` class to put on the
 * element that animates. Call `settle()` when the fold-out animation ends.
 * Shared by `RevealHeight` and places that can't use a wrapper element, such
 * as table rows (animate each cell's content instead).
 */
export function useRevealHeight(
  open: boolean,
  animateIn = false,
): { rendered: boolean; closing: boolean; revealClass: string; settle: () => void } {
  const [growIn, setGrowIn] = useState(animateIn);
  const [wasOpen, setWasOpen] = useState(open);
  // Settled during render, so the first frame of a reopen already grows.
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setGrowIn(true);
  }
  const [rendered, setRendered] = useState(open);
  const closing = rendered && !open;

  useEffect(() => {
    if (open) {
      setRendered(true);
      return;
    }
    // Without motion there is no animation to end, so leave at once.
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches)
      setRendered(false);
  }, [open]);

  return {
    rendered: rendered || open,
    closing,
    revealClass: closing ? "reveal-height-out" : growIn ? "reveal-height-in" : "",
    settle: () => {
      if (closing) setRendered(false);
    },
  };
}

/**
 * Grows its contents open from nothing, pushing what follows down, and folds
 * them away again before unmounting. Opening later always grows; on mount it
 * grows only with `animateIn`, so content that is simply there on load does
 * not animate.
 */
export function RevealHeight({
  open = true,
  animateIn = false,
  className = "",
  children,
  ...attributes
}: {
  open?: boolean;
  animateIn?: boolean;
  className?: string;
  children: ReactNode;
} & Record<`data-${string}`, string | undefined>) {
  const { rendered, closing, revealClass, settle } = useRevealHeight(open, animateIn);
  if (!rendered) return null;
  return (
    <div
      {...attributes}
      className={`${className} ${revealClass}`}
      inert={closing || undefined}
      onAnimationEnd={(event) => {
        if (event.target === event.currentTarget) settle();
      }}
    >
      {children}
    </div>
  );
}

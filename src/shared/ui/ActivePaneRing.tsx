import type { ReactNode } from "react";

/**
 * Outline in the user's accent, with a faint inner glow, on the pane that
 * has focus while several share the screen (fork, L-137): Focus mode's grid
 * and workspace splits. Render it inside
 * the pane's positioned box; it sits over the content and lets every click
 * through. It stays mounted so it fades instead of popping.
 */
export function ActivePaneRing({ shown }: { shown: boolean }): ReactNode {
  return (
    <span
      aria-hidden
      data-active-pane-ring={shown ? "" : undefined}
      className={`pointer-events-none active-pane-ring absolute inset-0 z-20 transition-opacity duration-150 ease-out motion-reduce:transition-none ${
        shown ? "opacity-100" : "opacity-0"
      }`}
    />
  );
}

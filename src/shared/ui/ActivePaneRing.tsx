import type { ReactNode } from "react";

/**
 * Accent outline on the pane that has focus while several share the screen
 * (fork, L-137): Focus mode's grid and workspace splits. Render it inside
 * the pane's positioned box; it sits over the content and lets every click
 * through. It stays mounted so it fades instead of popping.
 */
export function ActivePaneRing({ shown }: { shown: boolean }): ReactNode {
  return (
    <span
      aria-hidden
      data-active-pane-ring={shown ? "" : undefined}
      className={`pointer-events-none absolute inset-0 z-20 border border-accent/70 transition-opacity duration-150 ease-out motion-reduce:transition-none ${
        shown ? "opacity-100" : "opacity-0"
      }`}
    />
  );
}

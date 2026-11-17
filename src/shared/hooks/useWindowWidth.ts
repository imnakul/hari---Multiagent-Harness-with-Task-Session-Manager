import { useSyncExternalStore } from "react";

/** Narrower than this, the window is minimised (Windows reports a tiny size). */
const MINIMISED_BELOW = 200;

let last = typeof window === "undefined" ? 0 : window.innerWidth;

/** The window's width, held at the last real one while minimised or hidden. */
export function readWindowWidth(): number {
  const now = window.innerWidth;
  if (now >= MINIMISED_BELOW && document.visibilityState !== "hidden") last = now;
  return last;
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("resize", onChange);
  document.addEventListener("visibilitychange", onChange);
  return () => {
    window.removeEventListener("resize", onChange);
    document.removeEventListener("visibilitychange", onChange);
  };
}

/**
 * Fork (L-335): the window's width, redrawn when it changes. A side panel
 * capped at a share of the width read it once per draw, so a draw while
 * Hari was minimised capped it at its minimum and nothing widened it again
 * on restore until the next click.
 */
export function useWindowWidth(): number {
  return useSyncExternalStore(subscribe, readWindowWidth, () => last);
}

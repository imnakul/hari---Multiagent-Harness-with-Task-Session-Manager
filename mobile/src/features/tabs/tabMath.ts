// Fork (Hari, L-412): the Tabs layout's gesture and arc maths, as pure
// functions so they can be tested. The bar's worklets call them.

/** How far the finger may stray off the bar, up or down, before a slide cancels. */
export const SLIDE_CANCEL_DY = 40;
/** The arc's spacing: a circle `d` places from the selected one sits here. */
export const ARC_STEP_X = 54;
export const ARC_STEP_Y = 7;
/** How many circles either side of the middle one stay in full view. */
export const MAX_FLING_STEPS = 2;
/** Every circle is drawn this size; the others are scaled down from it. */
export const ARC_CIRCLE = 52;
/** How much smaller each step from the selected circle is, up to two steps. */
const ARC_SHRINK = 0.14;
/** How far past two steps a circle takes to fade out. */
const ARC_FADE = 0.6;

/** The tab under `x` in a bar `width` wide, clamped to the first and last. */
export function indexAt(x: number, width: number, count: number): number {
  "worklet";
  if (count <= 0 || width <= 0) return 0;
  const raw = Math.floor((x / width) * count);
  return Math.min(count - 1, Math.max(0, raw));
}

/** How many tab boundaries a slide from `from` to `to` crossed. */
export function crossings(from: number, to: number): number {
  "worklet";
  return Math.abs(to - from);
}

/** Whether a finger this far (up or down) off where it landed cancels a slide. */
export function cancelsSlide(dy: number): boolean {
  "worklet";
  return Math.abs(dy) > SLIDE_CANCEL_DY;
}

/** How far the finger moves along the bar to step the arc one circle. */
export const ARC_SCRUB_X = 44;

/**
 * Where the arc stands while the finger holding the Sessions tab slides:
 * one circle per `ARC_SCRUB_X` pt from where it started (right moves to the
 * next circle). L-416: unbounded, as the arc goes round (see `wrapIndex`).
 */
export function scrubPosition(start: number, dx: number, count: number): number {
  "worklet";
  if (count <= 0) return 0;
  return start + dx / ARC_SCRUB_X;
}

/** Fork (Hari, L-416): the circle at an arc position, going round past either end. */
export function wrapIndex(position: number, count: number): number {
  "worklet";
  if (count <= 0) return 0;
  return ((Math.round(position) % count) + count) % count;
}

/**
 * Fork (Hari, L-416): how many places circle `index` sits from `position` on
 * the round arc: the shorter way, in [-count/2, count/2).
 */
export function arcOffset(index: number, position: number, count: number): number {
  "worklet";
  if (count <= 0) return 0;
  const raw = (((index - position) % count) + count) % count;
  return raw >= count / 2 ? raw - count : raw;
}

/** Fewest circles drawn round the arc, so its far side, where a circle crosses over, is out of view. */
export const ARC_RING_MIN = 6;

/**
 * Fork (Hari, L-416): how many times the places repeat round the arc. Two
 * or three places repeat, so the arc still reads as going round; one doesn't.
 */
export function ringCopies(count: number): number {
  "worklet";
  if (count <= 1) return 1;
  return Math.ceil(ARC_RING_MIN / count);
}

/** Where a circle `d` places from the selected one sits on the arc. */
export function arcPlacement(d: number): {
  translateX: number;
  translateY: number;
  scale: number;
  opacity: number;
} {
  "worklet";
  // Continuous in `d`, so circles grow and fade smoothly under a drag.
  const distance = Math.abs(d);
  return {
    translateX: d * ARC_STEP_X,
    translateY: d * d * ARC_STEP_Y,
    scale: 1 - Math.min(distance, MAX_FLING_STEPS) * ARC_SHRINK,
    opacity: Math.min(1, Math.max(0, (MAX_FLING_STEPS + ARC_FADE - distance) / ARC_FADE)),
  };
}

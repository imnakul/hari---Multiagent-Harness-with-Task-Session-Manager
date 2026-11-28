// Fork (Hari, L-412): the Tabs layout's directional move between tabs.
//
// The tab navigator's own animation is off on purpose. With one on, its
// screens' activity state becomes an animated value, and its freeze check
// (`activityState === STATE_INACTIVE` in expo-router's vendored
// BottomTabView) is never true, so `freezeOnBlur` does nothing and every tab
// re-renders on every workspace update. Instead the tab coming in slides in
// here, on the UI thread, and the one left freezes at once.
import type { TabName } from "./tabsMemory";

/** The tabs left to right, as the bar shows them. */
export const TAB_ORDER: readonly TabName[] = ["share", "computer", "sessions", "monos", "running"];

/** How far a tab travels as it comes in, in pt. */
export const TAB_SHIFT = 48;

/** How long a tab takes to come in, in ms: short, so a tap feels answered at once. */
export const TAB_ENTRANCE_MS = 240;

/**
 * Which side a tab comes in from, opening it after `previous`: 1 from the
 * right (it lies to the right on the bar), -1 from the left, 0 for no move
 * (the same tab, or none before it).
 */
export function entranceSide(tab: TabName, previous: TabName | undefined): 1 | -1 | 0 {
  if (!previous || previous === tab) return 0;
  return TAB_ORDER.indexOf(tab) > TAB_ORDER.indexOf(previous) ? 1 : -1;
}

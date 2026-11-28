import { useSyncExternalStore } from "react";

import { useAppLayout, type AppLayout } from "./appLayout";

/**
 * Whether the phone shows only Monos, as a messaging app: a list of them,
 * and a chat pushed over it, with no drawer and no projects. Off until
 * turned on. (L-412: a view of the three-way layout, kept so its callers
 * stay as they are.)
 */
export function useMonoOnlyLayout() {
  const [layout, setLayout] = useAppLayout();
  const set = (next: boolean) => setLayout(next ? "monos" : "classic");
  return [layout === "monos", set] as const;
}

/** How long the settings sheet takes to slide away, with the cover coming
 *  up under it, before the app is reset beneath the cover. */
const DISMISS_MS = 500;
/** How long the cover stays up once the new layout is in, for its first
 *  screen to draw before it shows. */
const SETTLE_MS = 400;

let changing = false;
const changeListeners = new Set<() => void>();
const subscribeChange = (listener: () => void) => {
  changeListeners.add(listener);
  return () => {
    changeListeners.delete(listener);
  };
};
const setChanging = (next: boolean) => {
  changing = next;
  changeListeners.forEach((listener) => listener());
};

/** Whether the layout is being switched, for the app to cover itself meanwhile. */
export function useLayoutChanging() {
  return useSyncExternalStore(subscribeChange, () => changing);
}

/**
 * Switches the layout, in order, so nothing half-built ever shows: `close`
 * slides the settings sheet away over the loading cover, which comes up
 * under it; once it is gone, `reset` takes the app back to its first screen
 * and the layout changes, all beneath the cover; and the cover plays its way
 * out once the new first screen (the Mono list, the tabs, or the last Mono or
 * project) has had a moment to draw. The layouts lay the app out too
 * differently to carry over what was open. A second switch while one is in
 * progress is ignored.
 */
export function changeLayout(
  next: AppLayout,
  { close, reset }: { close: () => void; reset: () => void },
  setLayout: (next: AppLayout) => void,
) {
  if (changing) return;
  close();
  setChanging(true);
  setTimeout(() => {
    reset();
    setLayout(next);
    setTimeout(() => setChanging(false), SETTLE_MS);
  }, DISMISS_MS);
}

export function useChangeLayout() {
  const [, setLayout] = useAppLayout();
  return (next: AppLayout, actions: { close: () => void; reset: () => void }) =>
    changeLayout(next, actions, setLayout);
}

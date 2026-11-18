export type ComputerTab = "share" | "control";

// Fork (Hari, L-290): the open tab lives here, not in the screen, so the
// header's toggle is set once in the layout and never changed after the
// screen opens. Changing a transparent Android header after it opened left it
// blank, with the screen behind's buttons showing through. Unset, the hub
// shows the tab it was opened on.
let current: ComputerTab | undefined;
const listeners = new Set<() => void>();

export const setHubTab = (tab: ComputerTab | undefined) => {
  if (tab === current) return;
  current = tab;
  for (const listener of listeners) listener();
};

/** Fork (Hari, L-347): the tab switched to since the hub opened, if any. */
export const hubTabSet = () => current;

export const subscribeHubTab = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

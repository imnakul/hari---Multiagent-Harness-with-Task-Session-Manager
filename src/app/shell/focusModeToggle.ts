import { createContext } from "react";

/**
 * Opens or leaves Focus mode (L-123) from the header at the window's left
 * edge, whichever view or layout draws it. In Settings it closes Settings
 * first (L-141). Undefined hides the button.
 */
export const FocusModeToggle = createContext<(() => void) | undefined>(
  undefined,
);

/**
 * Opens Zen mode (fork, L-230): the window narrows to a docked panel with one
 * or two chats. Its button sits beside Focus; undefined hides it.
 */
export const ZenModeToggle = createContext<(() => void) | undefined>(
  undefined,
);

import { createContext } from "react";

/**
 * Opens or leaves Focus mode (L-123) from the header at the window's left
 * edge, whichever view or layout draws it. Undefined while Focus is not
 * available (Settings), which hides the button.
 */
export const FocusModeToggle = createContext<(() => void) | undefined>(
  undefined,
);

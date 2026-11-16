import type { MarkdownViewMode } from "../../sessions/ui/MarkdownModeToggle";

const KEY = "monocode.fileViewMode";

// Holds a choice only while storage failed to keep it, so later files in this
// window still open in that view when localStorage is unavailable.
let unsaved: MarkdownViewMode | null = null;

/**
 * Reads a stored view; anything unknown means "no choice yet". "live" was
 * saved before Live mode was removed (L-324) and now opens Preview.
 */
export function parseFileViewMode(stored: string | null): MarkdownViewMode | null {
  if (stored === "live") return "preview";
  return stored === "preview" || stored === "source" ? stored : null;
}

/** The view a previewable file opens in: the last one picked, else Preview. */
export function loadFileViewMode(): MarkdownViewMode {
  if (unsaved) return unsaved;
  try {
    return parseFileViewMode(localStorage.getItem(KEY)) ?? "preview";
  } catch {
    return "preview";
  }
}

export function saveFileViewMode(mode: MarkdownViewMode): void {
  try {
    localStorage.setItem(KEY, mode);
    unsaved = null;
  } catch {
    unsaved = mode;
  }
}

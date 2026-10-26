import type { MarkdownViewMode } from "../../sessions/ui/MarkdownModeToggle";

const KEY = "monocode.fileViewMode";

// Holds a choice only while storage failed to keep it, so later files in this
// window still open in that view when localStorage is unavailable.
let unsaved: MarkdownViewMode | null = null;

/** Reads a stored view; anything unknown means "no choice yet". */
export function parseFileViewMode(stored: string | null): MarkdownViewMode | null {
  return stored === "live" || stored === "preview" || stored === "source"
    ? stored
    : null;
}

/**
 * The view a previewable file opens in until that file gets its own choice:
 * the last one picked, else Live (files without Live, like SVG, show Preview).
 */
export function loadFileViewMode(): MarkdownViewMode {
  if (unsaved) return unsaved;
  try {
    return parseFileViewMode(localStorage.getItem(KEY)) ?? "live";
  } catch {
    return "live";
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

import { lineAtOffset } from "../model/markdownPreviewSource";

/**
 * The editing surface a Markdown view is showing (plain Source textarea, Live
 * editor or the file editor), seen through one small interface so image
 * insertion and "edit here" gestures work in every mode.
 */
export type MarkdownCaretTarget = {
  /** Current selection as character offsets into the Markdown. */
  selection: () => { start: number; end: number };
  /** Focuses the field, selects `start`–`end` and scrolls it into view. */
  focusAt: (start: number, end?: number) => void;
};

/** Caret target for a `MarkdownSourceEditor` textarea. */
export function textareaCaretTarget(field: HTMLTextAreaElement): MarkdownCaretTarget {
  return {
    selection: () => ({ start: field.selectionStart, end: field.selectionEnd }),
    focusAt: (start, end = start) => {
      const length = field.value.length;
      const from = Math.min(Math.max(0, start), length);
      const to = Math.min(Math.max(from, end), length);
      field.focus({ preventScroll: true });
      field.setSelectionRange(from, to);
      // The textarea grows with its text, so the page scroller has to bring
      // the caret's line (drawn by the highlight layer) into view.
      field.parentElement
        ?.querySelector(`[data-source-line="${lineAtOffset(field.value, from)}"]`)
        ?.scrollIntoView({ block: "nearest" });
    },
  };
}

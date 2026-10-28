import {
  useCallback,
  useEffect,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from "react";
import { textareaCaretTarget, type MarkdownCaretTarget } from "./markdownCaret";
import { MarkdownLiveEditor, preloadMarkdownLiveEditor } from "./MarkdownLiveEditor";
import type { MarkdownViewMode } from "./MarkdownModeToggle";
import { MarkdownSourceEditor } from "./MarkdownSourceEditor";
import { useMarkdownEditGestures } from "./useMarkdownEditGestures";

/**
 * Body of an editable Markdown field in its current view: Live (formatted
 * editing), Preview (rendered, double-click to edit there) or Source (raw
 * text). Pair it with `MarkdownDetailTabs`. Every editable Markdown body uses
 * this, so Live, the double-click and Ctrl+E behave the same everywhere.
 *
 * `caretRef` always points at the editor on screen (Live or Source), for
 * image insertion and the "edit here" gestures.
 */
export function MarkdownEditorPanel({
  mode,
  onModeChange,
  value,
  onChange,
  caretRef,
  preview,
  emptyPreview,
  label,
  placeholder,
  autoFocus = false,
  lineNumbers = true,
  minHeightClass = "",
  paddingClass = "",
  sourceEndPadClass,
}: {
  mode: MarkdownViewMode;
  onModeChange: (mode: MarkdownViewMode) => void;
  value: string;
  onChange: (value: string) => void;
  caretRef: RefObject<MarkdownCaretTarget | null>;
  /** Rendered Markdown shown in Preview. */
  preview: ReactNode;
  /** Shown in Preview while the body is empty. */
  emptyPreview: ReactNode;
  /** Accessible name of the editor, e.g. "Note Markdown". */
  label: string;
  placeholder?: string;
  autoFocus?: boolean;
  /** Line numbers in Source. */
  lineNumbers?: boolean;
  /** Height floor for every view, so the area does not jump on switching. */
  minHeightClass?: string;
  /** Inset for Live and Preview (Source pads itself). */
  paddingClass?: string;
  /** Right inset of Source text without line numbers. */
  sourceEndPadClass?: string;
}): ReactElement {
  const gestures = useMarkdownEditGestures({
    mode,
    onModeChange,
    markdown: value,
    caretRef,
    liveAvailable: true,
  });
  useEffect(preloadMarkdownLiveEditor, []);
  const sourceField = useCallback(
    (field: HTMLTextAreaElement | null) => {
      if (field) caretRef.current = textareaCaretTarget(field);
      else caretRef.current = null;
    },
    [caretRef],
  );

  return (
    <div className="min-w-0" onKeyDown={gestures.onKeyDown}>
      {mode === "live" ? (
        <MarkdownLiveEditor
          value={value}
          onChange={onChange}
          caretRef={caretRef}
          label={label}
          placeholder={placeholder}
          autoFocus={autoFocus}
          className={`${minHeightClass} ${paddingClass}`}
        />
      ) : mode === "source" ? (
        <MarkdownSourceEditor
          label={label}
          value={value}
          onChange={onChange}
          textareaRef={sourceField}
          autoFocus={autoFocus}
          placeholder={placeholder}
          lineNumbers={lineNumbers}
          className={minHeightClass}
          endPadClass={sourceEndPadClass}
        />
      ) : (
        <div
          {...gestures.previewProps}
          className={`cursor-text outline-none ${minHeightClass} ${paddingClass}`}
        >
          {value.trim() ? preview : emptyPreview}
        </div>
      )}
    </div>
  );
}

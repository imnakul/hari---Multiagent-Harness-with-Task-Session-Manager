import {
  useCallback,
  useLayoutEffect,
  useRef,
  type KeyboardEvent,
  type MouseEvent,
  type RefObject,
} from "react";
import { IS_MAC } from "../../../platform/tauri/platform";
import {
  sourceOffsetForPreviewClick,
  type PreviewClickTarget,
} from "../model/markdownPreviewSource";
import type { MarkdownCaretTarget } from "./markdownCaret";
import type { MarkdownViewMode } from "./MarkdownModeToggle";

/** Shortcut label shown in tab tooltips, matching `isEditToggleShortcut`. */
export const MARKDOWN_EDIT_SHORTCUT_LABEL = IS_MAC ? "⌘E" : "Ctrl+E";
/** `aria-keyshortcuts` value for the same shortcut. */
export const MARKDOWN_EDIT_ARIA_SHORTCUT = IS_MAC ? "Meta+E" : "Control+E";

/** How long a requested caret waits for the Source editor to mount. */
const CARET_WAIT_MS = 5_000;

/** Blocks a preview double-click maps to a source line. */
const PREVIEW_BLOCKS = "li, p, h1, h2, h3, h4, h5, h6, pre, td, th, dt, dd";
/** Controls that keep their own double-click: links, checkboxes, media… */
const PREVIEW_INTERACTIVE =
  "a, button, input, select, textarea, summary, label, img, video, audio, [role='button'], [contenteditable='true']";

/** Cmd+E on macOS, Ctrl+E elsewhere, with no other modifier. */
function isEditToggleShortcut(event: KeyboardEvent<HTMLElement>): boolean {
  if (event.altKey || event.shiftKey || event.key.toLowerCase() !== "e")
    return false;
  return IS_MAC
    ? event.metaKey && !event.ctrlKey
    : event.ctrlKey && !event.metaKey;
}

function firstLine(text: string): string {
  return text.split("\n").find((line) => line.trim()) ?? "";
}

/** Rendered text with `<br>` as newlines; jsdom has no `innerText`. */
function renderedText(element: HTMLElement): string {
  return typeof element.innerText === "string"
    ? element.innerText
    : (element.textContent ?? "");
}

/**
 * Reads what a double-click hit in the preview, or null when it landed on a
 * control (link, checkbox, image) that should keep its own behaviour.
 */
function previewClickTarget(
  root: HTMLElement,
  target: EventTarget,
): PreviewClickTarget | null {
  if (!(target instanceof Element) || !root.contains(target)) return null;
  if (target.closest(PREVIEW_INTERACTIVE)) return null;

  const selection = window.getSelection();
  const word = selection?.toString().trim() ?? "";
  const found = target.closest<HTMLElement>(PREVIEW_BLOCKS);
  const block = found && root.contains(found) ? found : null;
  if (!block) return { blockText: "", occurrence: 0, lineInBlock: 0, word };

  const blockText = firstLine(renderedText(block));
  const tag = block.tagName;
  let occurrence = 0;
  for (const other of root.querySelectorAll<HTMLElement>(tag)) {
    if (other === block) break;
    if (firstLine(renderedText(other)).trim() === blockText.trim())
      occurrence += 1;
  }

  let lineInBlock = 0;
  const anchor = selection?.anchorNode;
  if (anchor && block.contains(anchor)) {
    const before = document.createRange();
    before.setStart(block, 0);
    before.setEnd(anchor, selection?.anchorOffset ?? 0);
    lineInBlock =
      tag === "PRE"
        ? (before.toString().match(/\n/g)?.length ?? 0)
        : before.cloneContents().querySelectorAll("br").length;
  }
  return { blockText, occurrence, lineInBlock, word };
}

/**
 * Shortcuts shared by every editable Markdown view (used inside
 * `MarkdownViewShell` and `MarkdownEditorPanel`, so every surface gets them):
 * - Ctrl+E (Cmd+E on macOS) toggles Preview and Source, returning to the
 *   caret Source had;
 * - double-clicking text in Preview opens Source with the caret on the
 *   clicked line and word.
 *
 * Spread `onKeyDown` on the element that holds the views and `previewProps`
 * on the element that wraps the preview (it becomes focusable, so the
 * shortcut also works while reading). With `editable` false (read-only
 * views) both do nothing.
 */
export function useMarkdownEditGestures({
  mode,
  onModeChange,
  markdown,
  caretRef,
  editable,
}: {
  mode: MarkdownViewMode;
  onModeChange: (mode: MarkdownViewMode) => void;
  markdown: string;
  caretRef: RefObject<MarkdownCaretTarget | null>;
  editable: boolean;
}): {
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  previewProps: {
    ref: RefObject<HTMLDivElement | null>;
    tabIndex: -1;
    onDoubleClick: (event: MouseEvent<HTMLElement>) => void;
  };
} {
  const previewRef = useRef<HTMLDivElement | null>(null);
  // Where the caret goes once Source shows; null leaves focus alone.
  const pendingCaret = useRef<number | null>(null);
  // Caret the editor had when Ctrl+E left it, so Ctrl+E back returns there.
  const lastCaret = useRef<number | null>(null);
  const focusPreview = useRef(false);
  const markdownRef = useRef(markdown);
  markdownRef.current = markdown;

  useLayoutEffect(() => {
    if (mode === "source") {
      const caret = pendingCaret.current;
      pendingCaret.current = null;
      if (caret === null) return;
      if (caretRef.current) {
        caretRef.current.focusAt(caret);
        return;
      }
      // The Source editor may mount after this effect: place the caret once
      // it registers, giving up after a few seconds.
      const deadline = performance.now() + CARET_WAIT_MS;
      let frame = 0;
      const retry = (): void => {
        if (caretRef.current) caretRef.current.focusAt(caret);
        else if (performance.now() < deadline)
          frame = requestAnimationFrame(retry);
      };
      frame = requestAnimationFrame(retry);
      return () => cancelAnimationFrame(frame);
    }
    if (mode === "preview" && focusPreview.current) {
      focusPreview.current = false;
      previewRef.current?.focus({ preventScroll: true });
    }
  }, [mode, caretRef]);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      if (!editable || event.defaultPrevented) return;
      if (!isEditToggleShortcut(event)) return;
      event.preventDefault();
      event.stopPropagation();
      if (mode === "preview") {
        pendingCaret.current = lastCaret.current ?? 0;
        onModeChange("source");
      } else {
        lastCaret.current = caretRef.current?.selection().start ?? null;
        focusPreview.current = true;
        onModeChange("preview");
      }
    },
    [caretRef, editable, mode, onModeChange],
  );

  const onDoubleClick = useCallback(
    (event: MouseEvent<HTMLElement>) => {
      const root = previewRef.current;
      if (!editable || !root || event.button !== 0) return;
      const target = previewClickTarget(root, event.target);
      if (!target) return;
      event.preventDefault();
      pendingCaret.current =
        sourceOffsetForPreviewClick(markdownRef.current, target) ??
        markdownRef.current.length;
      window.getSelection()?.removeAllRanges();
      onModeChange("source");
    },
    [editable, onModeChange],
  );

  return {
    onKeyDown,
    previewProps: { ref: previewRef, tabIndex: -1, onDoubleClick },
  };
}

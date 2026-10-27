import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import {
  Annotation,
  Compartment,
  EditorSelection,
  EditorState,
} from "@codemirror/state";
import {
  drawSelection,
  EditorView,
  keymap,
  placeholder as placeholderText,
} from "@codemirror/view";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  type ReactElement,
  type RefObject,
} from "react";
import { markdownLive } from "../../files/editor/markdownLive";
import { isNoteImagePath } from "../../notes/noteImages";
import { loadNoteImageSrc } from "./AgentMarkdown";
import type { MarkdownCaretTarget } from "./markdownCaret";

/** Marks a document replaced from the `value` prop, so it is not echoed back. */
const externalChange = Annotation.define<boolean>();

/** Only web and mail links open from the editor; local paths stay text. */
const OPENABLE_LINK = /^(https?:|mailto:)/i;

/** Opens a web or mail link from Live mode (Ctrl/Cmd+click); ignores others. */
export function openMarkdownLink(url: string): void {
  if (!OPENABLE_LINK.test(url)) return;
  void openUrl(url).catch((error: unknown) => {
    console.error("[markdown-live] could not open link", error);
  });
}

/** Note images resolve like the preview; other images keep their Markdown. */
function resolveImage(url: string): Promise<string | null> | null {
  return isNoteImagePath(url) ? loadNoteImageSrc(url) : null;
}

/** Layout of the editor inside a page-scrolled Markdown body. */
const surfaceTheme = EditorView.theme({
  "&": { backgroundColor: "transparent", color: "var(--color-content)" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { overflow: "visible", fontFamily: "var(--font-sans)" },
  ".cm-content": { padding: "0", caretColor: "var(--color-content)" },
  ".cm-line": { padding: "0" },
  ".cm-placeholder": {
    color: "color-mix(in srgb, var(--color-content) 40%, transparent)",
  },
  // drawSelection() hides the native caret and draws its own, black unless
  // the theme is dark; match the file editor (editorChrome.ts).
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--color-content)" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection":
    {
      backgroundColor:
        "color-mix(in srgb, var(--color-accent) 35%, transparent) !important",
    },
});

/** Props of the Live editor (see `MarkdownLiveEditor`). */
export type MarkdownLiveEditorProps = {
  value: string;
  onChange: (value: string) => void;
  /** Set to this editor while it is mounted, for image insertion and gestures. */
  caretRef?: RefObject<MarkdownCaretTarget | null>;
  label: string;
  placeholder?: string;
  readOnly?: boolean;
  autoFocus?: boolean;
  className?: string;
};

/**
 * Obsidian-style Live Markdown editor: formatted while you type, plain
 * Markdown in `value`/`onChange`. Markdown symbols show only on the caret's
 * lines; Enter continues lists and checklists. Load it through
 * `MarkdownLiveEditor`, which keeps CodeMirror out of the startup bundle.
 */
export function MarkdownLiveEditorView({
  value,
  onChange,
  caretRef,
  label,
  placeholder = "Write…",
  readOnly = false,
  autoFocus = false,
  className = "",
}: MarkdownLiveEditorProps): ReactElement {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const editable = useRef(new Compartment()).current;
  const initial = useRef({ value, readOnly, autoFocus, label, placeholder });

  // Layout effect: the view and caret target exist before a parent's layout
  // effect places the caret (double-click in Preview → Live at that line).
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const start = initial.current;
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: start.value,
        extensions: [
          history(),
          drawSelection(),
          // Ctrl/Cmd+Enter belongs to the surrounding form (save, next task).
          keymap.of([
            ...defaultKeymap.filter((binding) => binding.key !== "Mod-Enter"),
            ...historyKeymap,
          ]),
          markdown({ base: markdownLanguage }),
          markdownLive({ resolveImage, openLink: openMarkdownLink }),
          EditorView.lineWrapping,
          placeholderText(start.placeholder),
          surfaceTheme,
          editable.of([
            EditorState.readOnly.of(start.readOnly),
            EditorView.editable.of(!start.readOnly),
          ]),
          EditorView.contentAttributes.of({
            "aria-label": start.label,
            "aria-multiline": "true",
            spellcheck: "true",
          }),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return;
            if (update.transactions.some((tr) => tr.annotation(externalChange)))
              return;
            onChangeRef.current(update.state.doc.toString());
          }),
        ],
      }),
    });
    viewRef.current = view;
    const target: MarkdownCaretTarget = {
      selection: () => {
        const main = view.state.selection.main;
        return { start: main.from, end: main.to };
      },
      focusAt: (from, to = from) => {
        const length = view.state.doc.length;
        const anchor = Math.min(Math.max(0, from), length);
        const head = Math.min(Math.max(anchor, to), length);
        view.focus();
        view.dispatch({
          selection: EditorSelection.range(anchor, head),
          effects: EditorView.scrollIntoView(anchor, { y: "nearest" }),
        });
      },
    };
    if (caretRef) caretRef.current = target;
    if (start.autoFocus) view.focus();
    return () => {
      if (caretRef?.current === target) caretRef.current = null;
      viewRef.current = null;
      view.destroy();
    };
  }, [caretRef, editable]);

  // Outside edits (image insert, another window, switching items) replace the
  // document without being reported back as typing.
  useEffect(() => {
    const view = viewRef.current;
    if (!view || view.state.doc.toString() === value) return;
    const caret = view.state.selection.main.head;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value },
      selection: EditorSelection.cursor(Math.min(caret, value.length)),
      annotations: externalChange.of(true),
    });
  }, [value]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: editable.reconfigure([
        EditorState.readOnly.of(readOnly),
        EditorView.editable.of(!readOnly),
      ]),
    });
  }, [editable, readOnly]);

  return <div ref={hostRef} className={`min-w-0 ${className}`} />;
}

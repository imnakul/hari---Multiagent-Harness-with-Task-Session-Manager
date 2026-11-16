import { MarkdownCopyButton } from "./MarkdownCopyButton";
import {
  useEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from "react";
import type { MarkdownCaretTarget } from "./markdownCaret";
import {
  MARKDOWN_EDIT_ARIA_SHORTCUT,
  MARKDOWN_EDIT_SHORTCUT_LABEL,
  useMarkdownEditGestures,
} from "./useMarkdownEditGestures";

/**
 * How a Markdown body is shown: `preview` renders it read-only, `source`
 * edits the raw text. (Fork L-324 removed the formatted Live mode.)
 */
export type MarkdownViewMode = "preview" | "source";

/** Tab order everywhere Markdown can be shown. */
export const MARKDOWN_MODE_TABS: readonly { mode: MarkdownViewMode; label: string }[] = [
  { mode: "preview", label: "Preview" },
  { mode: "source", label: "Source" },
];

/** Tooltip for a mode tab, naming the shortcut where it applies. */
export function markdownModeTabTitle(label: string, editable: boolean): string {
  return editable
    ? `${label} (${MARKDOWN_EDIT_SHORTCUT_LABEL} switches Preview and Source)`
    : label;
}

const remembered = new Map<string, MarkdownViewMode>();

export function useMarkdownMode(
  key: string,
  fallback: MarkdownViewMode = "preview",
): [MarkdownViewMode, (mode: MarkdownViewMode) => void] {
  const [mode, setMode] = useState<MarkdownViewMode>(
    () => remembered.get(key) ?? fallback,
  );
  // A changed fallback applies to the next key, not the item already shown.
  const shownKey = useRef(key);

  useEffect(() => {
    if (shownKey.current === key) return;
    shownKey.current = key;
    setMode(remembered.get(key) ?? fallback);
  }, [key, fallback]);

  return [
    mode,
    (next) => {
      remembered.set(key, next);
      setMode(next);
    },
  ];
}

type ToggleProps = {
  markdown?: string;
  mode: MarkdownViewMode;
  onChange: (mode: MarkdownViewMode) => void;
  /** Editable Markdown: tabs name the Preview/Source shortcut. */
  editable?: boolean;
};

export function MarkdownModeToggle({
  mode,
  onChange,
  markdown,
  editable = false,
}: ToggleProps): ReactElement {
  return (
    <div className="flex items-center gap-1.5">
      <div
        role="tablist"
        aria-label="Markdown view"
        className="flex rounded-md border border-content/10 bg-content/10 p-0.5 backdrop-blur-md"
      >
        {MARKDOWN_MODE_TABS.map((tab) => (
          <ModeTab
            key={tab.mode}
            label={tab.label}
            title={markdownModeTabTitle(tab.label, editable)}
            shortcut={editable}
            selected={mode === tab.mode}
            onSelect={() => onChange(tab.mode)}
          />
        ))}
      </div>
      {markdown !== undefined ? <MarkdownCopyButton text={markdown} /> : null}
    </div>
  );
}

function ModeTab({
  label,
  title,
  shortcut,
  selected,
  onSelect,
}: {
  label: string;
  title: string;
  shortcut: boolean;
  selected: boolean;
  onSelect: () => void;
}): ReactElement {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      aria-keyshortcuts={shortcut ? MARKDOWN_EDIT_ARIA_SHORTCUT : undefined}
      title={title}
      className={`rounded px-2 py-0.5 font-sans text-[11px] transition-colors ${
        selected
          ? "bg-selection-strong text-content"
          : "text-content/45 hover:text-content/80"
      }`}
      onClick={onSelect}
    >
      {label}
    </button>
  );
}

type ShellProps = {
  markdown?: string;
  mode: MarkdownViewMode;
  onModeChange: (mode: MarkdownViewMode) => void;
  preview: ReactNode;
  source: ReactNode;
  /** The Markdown can be edited: Ctrl+E and double-click open Source. */
  editable?: boolean;
  /** The editor shown in Source, for "edit here" gestures. */
  caretRef?: RefObject<MarkdownCaretTarget | null>;
  actions?: ReactNode;
};

const layerClass = (shown: boolean): string =>
  shown ? "absolute inset-0" : "pointer-events-none invisible absolute inset-0";

/**
 * Overlay Preview/Source switcher used by file tabs and plan panes. Both
 * views stay mounted so switching keeps scroll and undo history; when
 * `editable`, double-clicking the preview and Ctrl+E switch into Source.
 */
export function MarkdownViewShell({
  mode,
  onModeChange,
  preview,
  source,
  editable = false,
  caretRef,
  actions,
  markdown,
}: ShellProps): ReactElement {
  const fallbackCaret = useRef<MarkdownCaretTarget | null>(null);
  const gestures = useMarkdownEditGestures({
    mode,
    onModeChange,
    markdown: markdown ?? "",
    caretRef: caretRef ?? fallbackCaret,
    editable,
  });

  return (
    <div
      className="markdown-view-shell relative min-h-0 min-w-0 flex-1"
      onKeyDown={gestures.onKeyDown}
    >
      <div className="markdown-view-actions pointer-events-none absolute right-2 z-20">
        <div className="pointer-events-auto flex items-center gap-1.5">
          {actions}
          <MarkdownModeToggle
            mode={mode}
            onChange={onModeChange}
            markdown={markdown}
            editable={editable}
          />
        </div>
      </div>
      <div
        {...gestures.previewProps}
        data-markdown-view-active={mode === "preview" ? "" : undefined}
        className={`${layerClass(mode === "preview")} outline-none`}
      >
        {preview}
      </div>
      <div
        data-markdown-view-active={mode === "source" ? "" : undefined}
        className={layerClass(mode === "source")}
      >
        {source}
      </div>
    </div>
  );
}

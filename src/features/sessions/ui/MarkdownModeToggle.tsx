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
import { preloadMarkdownLiveEditor } from "./MarkdownLiveEditor";
import {
  MARKDOWN_EDIT_ARIA_SHORTCUT,
  MARKDOWN_EDIT_SHORTCUT_LABEL,
  useMarkdownEditGestures,
} from "./useMarkdownEditGestures";

/**
 * How a Markdown body is shown: `live` edits it formatted (Obsidian-style),
 * `preview` renders it read-only, `source` edits the raw text.
 */
export type MarkdownViewMode = "live" | "preview" | "source";

/** Tab order everywhere Markdown can be shown. */
const MODE_TABS: readonly { mode: MarkdownViewMode; label: string }[] = [
  { mode: "live", label: "Live" },
  { mode: "preview", label: "Preview" },
  { mode: "source", label: "Source" },
];

/** The tabs a view offers: Live only where the Markdown can be edited. */
export function markdownModeTabs(
  liveAvailable: boolean,
): readonly { mode: MarkdownViewMode; label: string }[] {
  return liveAvailable ? MODE_TABS : MODE_TABS.filter((tab) => tab.mode !== "live");
}

/** Tooltip for a mode tab, naming the shortcut where it applies. */
export function markdownModeTabTitle(label: string, liveAvailable: boolean): string {
  return liveAvailable
    ? `${label} (${MARKDOWN_EDIT_SHORTCUT_LABEL} switches Live and Preview)`
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
  /** Offer the Live tab (editable Markdown only). */
  liveAvailable?: boolean;
};

export function MarkdownModeToggle({
  mode,
  onChange,
  markdown,
  liveAvailable = false,
}: ToggleProps): ReactElement {
  return (
    <div className="flex items-center gap-1.5">
      <div
        role="tablist"
        aria-label="Markdown view"
        className="flex rounded-md border border-content/10 bg-content/10 p-0.5 backdrop-blur-md"
      >
        {markdownModeTabs(liveAvailable).map((tab) => (
          <ModeTab
            key={tab.mode}
            label={tab.label}
            title={markdownModeTabTitle(tab.label, liveAvailable)}
            shortcut={liveAvailable}
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
  /**
   * Live view. `"source"` means the `source` element turns itself into Live
   * (the file editor reuses one CodeMirror for both); omit for read-only views.
   */
  live?: ReactNode | "source";
  /** The editor shown in Live, for "edit here" gestures. */
  caretRef?: RefObject<MarkdownCaretTarget | null>;
  actions?: ReactNode;
};

const layerClass = (shown: boolean): string =>
  shown ? "absolute inset-0" : "pointer-events-none invisible absolute inset-0";

/**
 * Overlay Preview/Live/Source switcher used by file tabs and plan panes. All
 * views stay mounted so switching keeps scroll and undo history; with a Live
 * view, double-clicking the preview and Ctrl+E switch into it.
 */
export function MarkdownViewShell({
  mode,
  onModeChange,
  preview,
  source,
  live,
  caretRef,
  actions,
  markdown,
}: ShellProps): ReactElement {
  const liveAvailable = live !== undefined;
  const liveInSource = live === "source";
  const fallbackCaret = useRef<MarkdownCaretTarget | null>(null);
  const gestures = useMarkdownEditGestures({
    mode,
    onModeChange,
    markdown: markdown ?? "",
    caretRef: caretRef ?? fallbackCaret,
    liveAvailable,
  });
  // Warm the lazy Live editor; the file editor's Live is its own CodeMirror.
  const preloadLive = liveAvailable && !liveInSource;
  useEffect(() => {
    if (preloadLive) preloadMarkdownLiveEditor();
  }, [preloadLive]);
  // A view without Live (SVG, read-only) shows Preview for a remembered "live".
  const shown: MarkdownViewMode =
    mode === "live" && !liveAvailable ? "preview" : mode;

  return (
    <div
      className="markdown-view-shell relative min-h-0 min-w-0 flex-1"
      onKeyDown={gestures.onKeyDown}
    >
      <div className="markdown-view-actions pointer-events-none absolute right-2 z-20">
        <div className="pointer-events-auto flex items-center gap-1.5">
          {actions}
          <MarkdownModeToggle
            mode={shown}
            onChange={onModeChange}
            markdown={markdown}
            liveAvailable={liveAvailable}
          />
        </div>
      </div>
      <div
        {...gestures.previewProps}
        data-markdown-view-active={shown === "preview" ? "" : undefined}
        className={`${layerClass(shown === "preview")} outline-none`}
      >
        {preview}
      </div>
      <div
        data-markdown-view-active={
          shown === "source" || (liveInSource && shown === "live") ? "" : undefined
        }
        className={layerClass(shown === "source" || (liveInSource && shown === "live"))}
      >
        {source}
      </div>
      {liveAvailable && !liveInSource ? (
        <div
          data-markdown-view-active={shown === "live" ? "" : undefined}
          className={layerClass(shown === "live")}
        >
          {live}
        </div>
      ) : null}
    </div>
  );
}

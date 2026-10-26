import type { ReactElement, ReactNode } from "react";
import { MarkdownCopyButton } from "./MarkdownCopyButton";
import {
  markdownModeTabs,
  markdownModeTabTitle,
  type MarkdownViewMode,
} from "./MarkdownModeToggle";
import { MARKDOWN_EDIT_ARIA_SHORTCUT } from "./useMarkdownEditGestures";

/**
 * Underline Live/Preview/Source tab strip with a copy button, shared by
 * Notes, Tasks and Session metadata (bodies drawn by `MarkdownEditorPanel`).
 */
export function MarkdownDetailTabs({
  mode,
  onChange,
  markdown,
  label,
  actions,
  liveAvailable = true,
}: {
  mode: MarkdownViewMode;
  onChange: (mode: MarkdownViewMode) => void;
  markdown: string;
  label: string;
  /** Extra toolbar buttons shown before Copy. */
  actions?: ReactNode;
  /** Offer the Live tab; true wherever the body is editable. */
  liveAvailable?: boolean;
}): ReactElement {
  return (
    <div className="flex items-center justify-between border-b border-stroke">
      <div
        role="tablist"
        aria-label={label}
        className="flex h-9 items-stretch gap-4"
      >
        {markdownModeTabs(liveAvailable).map((tab) => (
          <DetailTab
            key={tab.mode}
            label={tab.label}
            title={markdownModeTabTitle(tab.label, liveAvailable)}
            shortcut={liveAvailable}
            selected={mode === tab.mode}
            onSelect={() => onChange(tab.mode)}
          />
        ))}
      </div>
      <span className="inline-flex items-center gap-1">
        {actions}
        <MarkdownCopyButton text={markdown} />
      </span>
    </div>
  );
}

function DetailTab({
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
      onClick={onSelect}
      className={`relative flex h-9 items-center text-[12px] leading-none transition-colors ${
        selected ? "text-content" : "text-content/50 hover:text-content"
      }`}
    >
      {label}
      {selected ? (
        <span className="absolute inset-x-0 bottom-0 h-0.5 bg-content" />
      ) : null}
    </button>
  );
}

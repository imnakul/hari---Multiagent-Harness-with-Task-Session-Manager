import type { ReactNode } from "react";
import { MarkdownCopyButton } from "./MarkdownCopyButton";
import type { MarkdownViewMode } from "./MarkdownModeToggle";

/** Underline Preview/Source tab strip with a copy button, shared by Notes and Tasks. */
export function MarkdownDetailTabs({
  mode,
  onChange,
  markdown,
  label,
  actions,
}: {
  mode: MarkdownViewMode;
  onChange: (mode: MarkdownViewMode) => void;
  markdown: string;
  label: string;
  /** Extra toolbar buttons shown before Copy. */
  actions?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between border-b border-stroke">
      <div
        role="tablist"
        aria-label={label}
        className="flex h-9 items-stretch gap-4"
      >
        <DetailTab
          label="Preview"
          selected={mode === "preview"}
          onSelect={() => onChange("preview")}
        />
        <DetailTab
          label="Source"
          selected={mode === "source"}
          onSelect={() => onChange("source")}
        />
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
  selected,
  onSelect,
}: {
  label: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      onClick={onSelect}
      className={`relative flex h-9 items-center text-[12px] leading-none ${
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

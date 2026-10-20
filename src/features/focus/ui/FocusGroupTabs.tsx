import type { KeyboardEvent, ReactNode } from "react";

export type FocusTab = {
  id: string;
  /** Visible content; truncated to the tab's width. */
  content: ReactNode;
  /** Accessible name and tooltip. */
  title: string;
};

/**
 * One row of Focus's group-by-project tabs (L-128): a WAI-ARIA tablist with
 * one tab stop, where Left/Right/Home/End move and select at once.
 */
export function FocusTabRow({
  label,
  tabs,
  selectedId,
  onSelect,
  controls,
}: {
  label: string;
  tabs: readonly FocusTab[];
  selectedId: string | undefined;
  onSelect: (id: string) => void;
  /** Id of the region the tabs switch. */
  controls?: string;
}): ReactNode {
  const tabStop = tabs.some((tab) => tab.id === selectedId)
    ? selectedId
    : tabs[0]?.id;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const at = tabs.findIndex((tab) => tab.id === tabStop);
    const next =
      event.key === "ArrowRight"
        ? at + 1
        : event.key === "ArrowLeft"
          ? at - 1
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? tabs.length - 1
              : null;
    if (next === null || tabs.length === 0) return;
    event.preventDefault();
    const index = (next + tabs.length) % tabs.length;
    const tab = tabs[index];
    event.currentTarget
      .querySelectorAll<HTMLButtonElement>("[role=tab]")
      [index]?.focus();
    onSelect(tab.id);
  };

  return (
    <div
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
      className="flex h-8 shrink-0 items-center gap-1 overflow-x-auto border-b border-stroke px-1.5 scrollbar-none"
    >
      {tabs.map((tab) => {
        const selected = tab.id === selectedId;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={controls}
            tabIndex={tab.id === tabStop ? 0 : -1}
            title={tab.title}
            aria-label={tab.title}
            data-tauri-drag-region="false"
            onClick={() => onSelect(tab.id)}
            className={`flex h-6 min-w-0 max-w-56 shrink-0 items-center gap-1.5 rounded-md px-2 text-[12px] transition-[background-color,color,scale] duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 active:scale-96 motion-reduce:active:scale-100 ${
              selected
                ? "bg-content/8 text-content"
                : "text-content/60 hover:bg-content/5 hover:text-content/85"
            }`}
          >
            {tab.content}
          </button>
        );
      })}
    </div>
  );
}

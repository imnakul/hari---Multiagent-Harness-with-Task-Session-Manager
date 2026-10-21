import { X } from "../../../shared/ui/icons";
import type { KeyboardEvent, ReactNode } from "react";

export type FocusTab = {
  id: string;
  /** Visible content; truncated to the tab's width. */
  content: ReactNode;
  /** Accessible name and tooltip. */
  title: string;
  /** Name of the tab's hover close button, when the row can close tabs. */
  closeLabel?: string;
};

/**
 * One row of Focus's group-by-project tabs (L-128): a WAI-ARIA tablist with
 * one tab stop, where Left/Right/Home/End move and select at once. Fork
 * (L-158): with `onClose`, each tab shows a close button on hover or focus,
 * and Delete closes the focused tab. The button stays out of the Tab order so
 * the row keeps its single tab stop.
 */
export function FocusTabRow({
  label,
  tabs,
  selectedId,
  onSelect,
  onClose,
  controls,
}: {
  label: string;
  tabs: readonly FocusTab[];
  selectedId: string | undefined;
  onSelect: (id: string) => void;
  onClose?: (id: string) => void;
  /** Id of the region the tabs switch. */
  controls?: string;
}): ReactNode {
  const tabStop = tabs.some((tab) => tab.id === selectedId)
    ? selectedId
    : tabs[0]?.id;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const at = tabs.findIndex((tab) => tab.id === tabStop);
    if (event.key === "Delete" && onClose && at >= 0) {
      event.preventDefault();
      onClose(tabs[at].id);
      return;
    }
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
        const closable = !!onClose;
        return (
          <div
            key={tab.id}
            className="group/tab relative flex min-w-0 max-w-56 shrink-0"
          >
            <button
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={controls}
              tabIndex={tab.id === tabStop ? 0 : -1}
              title={tab.title}
              aria-label={tab.title}
              data-tauri-drag-region="false"
              onClick={() => onSelect(tab.id)}
              className={`flex h-6 min-w-0 flex-1 items-center rounded-md px-2 text-[12px] transition-[background-color,color,scale] duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 active:scale-96 motion-reduce:active:scale-100 ${
                selected
                  ? "bg-content/8 text-content"
                  : "text-content/60 hover:bg-content/5 hover:text-content/85"
              }`}
            >
              {/* The tab's end fades under the close button while it shows. */}
              <span
                className={`flex min-w-0 items-center gap-1.5${
                  closable
                    ? " group-focus-within/tab:[mask-image:linear-gradient(to_left,transparent_18px,black_30px)] group-hover/tab:[mask-image:linear-gradient(to_left,transparent_18px,black_30px)]"
                    : ""
                }`}
              >
                {tab.content}
              </span>
            </button>
            {closable ? (
              <button
                type="button"
                tabIndex={-1}
                aria-label={tab.closeLabel ?? `Close ${tab.title}`}
                title={tab.closeLabel ?? "Close"}
                data-focus-tab-close={tab.id}
                data-tauri-drag-region="false"
                onClick={(event) => {
                  event.stopPropagation();
                  onClose(tab.id);
                }}
                className="absolute top-1/2 right-0.5 grid size-5 -translate-y-1/2 place-items-center rounded text-content/55 opacity-0 transition-[opacity,background-color,color,scale] duration-100 hover:bg-content/10 hover:text-content focus-visible:opacity-100 active:scale-96 group-focus-within/tab:opacity-100 group-hover/tab:opacity-100 motion-reduce:active:scale-100"
              >
                <X aria-hidden className="size-3" strokeWidth={1.75} />
              </button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

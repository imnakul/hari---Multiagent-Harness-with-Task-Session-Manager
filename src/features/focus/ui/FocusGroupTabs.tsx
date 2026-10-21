import { X } from "../../../shared/ui/icons";
import {
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";

export type FocusTab = {
  id: string;
  /** Visible content; truncated to the tab's width. */
  content: ReactNode;
  /** Accessible name and tooltip. */
  title: string;
  /** Name of the tab's hover close button, when the row can close tabs. */
  closeLabel?: string;
};

/** Pointer travel before a press on a tab becomes a drag. */
const DRAG_THRESHOLD_PX = 4;
/** The row's `gap-1`, which a moving tab's neighbours shift across. */
const TAB_GAP_PX = 4;

type TabDrag = {
  id: string;
  from: number;
  /** Index the tab lands on if dropped now. */
  to: number;
  dx: number;
  width: number;
};

type DragStart = {
  id: string;
  from: number;
  pointerId: number;
  startX: number;
  /** Each tab's horizontal centre and the pressed tab's width, at press. */
  centers: number[];
  width: number;
  started: boolean;
};

/**
 * One row of Focus's group-by-project tabs (L-128): a WAI-ARIA tablist with
 * one tab stop, where Left/Right/Home/End move and select at once. Fork
 * (L-158): with `onClose`, each tab shows a close button on hover or focus,
 * and Delete closes the focused tab. The button stays out of the Tab order so
 * the row keeps its single tab stop. Fork (L-159): with `onReorder`, tabs can
 * be dragged along the row, and Ctrl+Shift+Left/Right moves the focused tab.
 */
export function FocusTabRow({
  label,
  tabs,
  selectedId,
  onSelect,
  onClose,
  onReorder,
  controls,
}: {
  label: string;
  tabs: readonly FocusTab[];
  selectedId: string | undefined;
  onSelect: (id: string) => void;
  onClose?: (id: string) => void;
  /** Moves the tab `id` to index `to` of the row. */
  onReorder?: (id: string, to: number) => void;
  /** Id of the region the tabs switch. */
  controls?: string;
}): ReactNode {
  const [drag, setDrag] = useState<TabDrag | null>(null);
  const pressRef = useRef<DragStart | null>(null);
  // A drag ends with a click on the tab; this swallows it.
  const suppressClick = useRef(false);
  const rowRef = useRef<HTMLDivElement>(null);

  const tabStop = tabs.some((tab) => tab.id === selectedId)
    ? selectedId
    : tabs[0]?.id;

  const tabButtons = () =>
    rowRef.current?.querySelectorAll<HTMLButtonElement>("[role=tab]") ?? [];

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const at = tabs.findIndex((tab) => tab.id === tabStop);
    if (event.key === "Delete" && onClose && at >= 0) {
      event.preventDefault();
      onClose(tabs[at].id);
      return;
    }
    if (
      onReorder &&
      at >= 0 &&
      event.ctrlKey &&
      event.shiftKey &&
      (event.key === "ArrowLeft" || event.key === "ArrowRight")
    ) {
      event.preventDefault();
      const to = at + (event.key === "ArrowRight" ? 1 : -1);
      if (to >= 0 && to < tabs.length) onReorder(tabs[at].id, to);
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
    tabButtons()[index]?.focus();
    onSelect(tab.id);
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>, index: number) => {
    if (!onReorder || event.button !== 0 || tabs.length < 2) return;
    if (
      event.target instanceof Element &&
      event.target.closest("[data-focus-tab-close]")
    )
      return;
    const wrappers = [
      ...(rowRef.current?.querySelectorAll<HTMLElement>("[data-focus-tab]") ?? []),
    ];
    const rects = wrappers.map((el) => el.getBoundingClientRect());
    pressRef.current = {
      id: tabs[index].id,
      from: index,
      pointerId: event.pointerId,
      startX: event.clientX,
      centers: rects.map((rect) => rect.left + rect.width / 2),
      width: rects[index]?.width ?? 0,
      started: false,
    };
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const press = pressRef.current;
    if (!press || press.pointerId !== event.pointerId) return;
    const dx = event.clientX - press.startX;
    if (!press.started) {
      if (Math.abs(dx) < DRAG_THRESHOLD_PX) return;
      press.started = true;
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    const center = (press.centers[press.from] ?? press.startX) + dx;
    const to = press.centers.filter(
      (other, index) => index !== press.from && other < center,
    ).length;
    setDrag({ id: press.id, from: press.from, to, dx, width: press.width });
  };

  const endDrag = (event: PointerEvent<HTMLDivElement>, commit: boolean) => {
    const press = pressRef.current;
    if (!press || press.pointerId !== event.pointerId) return;
    pressRef.current = null;
    if (!press.started) return;
    suppressClick.current = true;
    if (commit && drag && drag.to !== drag.from) onReorder?.(drag.id, drag.to);
    setDrag(null);
  };

  /** How far a tab shifts aside while another is dragged across it. */
  const shiftOf = (index: number): number => {
    if (!drag || index === drag.from) return 0;
    const step = drag.width + TAB_GAP_PX;
    if (drag.from < drag.to && index > drag.from && index <= drag.to) return -step;
    if (drag.from > drag.to && index >= drag.to && index < drag.from) return step;
    return 0;
  };

  return (
    <div
      ref={rowRef}
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
      className="flex h-8 shrink-0 items-center gap-1 overflow-x-auto border-b border-stroke px-1.5 scrollbar-none"
    >
      {tabs.map((tab, index) => {
        const selected = tab.id === selectedId;
        const closable = !!onClose;
        const dragging = drag?.id === tab.id;
        const shift = dragging ? drag.dx : shiftOf(index);
        return (
          <div
            key={tab.id}
            data-focus-tab={tab.id}
            data-focus-tab-dragging={dragging ? "" : undefined}
            onPointerDown={(event) => onPointerDown(event, index)}
            onPointerMove={onPointerMove}
            onPointerUp={(event) => endDrag(event, true)}
            onPointerCancel={(event) => endDrag(event, false)}
            onClickCapture={(event) => {
              if (!suppressClick.current) return;
              suppressClick.current = false;
              event.stopPropagation();
              event.preventDefault();
            }}
            style={shift ? { transform: `translateX(${shift}px)` } : undefined}
            className={`group/tab relative flex min-w-0 max-w-56 shrink-0 ${
              dragging
                ? "z-10 cursor-grabbing opacity-90"
                : drag
                  ? "transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none"
                  : ""
            }`}
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
                dragging
                  ? "bg-content/10 text-content shadow-[0_1px_4px_rgb(0_0_0/0.25)]"
                  : selected
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

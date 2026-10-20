import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type JSX,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { SharedHoverHighlight } from "../../sessions/ui/SharedHoverHighlight";
import { Plus, X } from "../../../shared/ui/icons";
import { MAX_PROJECT_SLOTS } from "../model/projectSlots";
import { sameProjectPath } from "../model/recents";
import { CurrentProjectIcon, useProjectLabel } from "./CurrentProjectIcon";

type SlotContextMenu = (
  path: string,
  x: number,
  y: number,
  trigger: HTMLElement,
) => void;

/**
 * Up to four projects in the inset sidebar's top row (L-132). The current
 * slot is `renderCurrent` (the project name and its usual ⌄ menu); the
 * others show their icon and name, muted. With several slots they sit in a
 * segmented track styled like Settings' Theme switch: the selected pill glides
 * to the current slot and the shared hover highlight follows the pointer. +
 * after the track adds one through `renderAddPicker`.
 */
export function ProjectSlots({
  paths,
  currentPath,
  renderCurrent,
  renderAddPicker,
  isBusy,
  onSelect,
  onClose,
  onContextMenu,
}: {
  paths: readonly string[];
  currentPath: string;
  renderCurrent: () => ReactNode;
  /** The picker the + opens; it calls `onDismiss` once a project is chosen. */
  renderAddPicker?: (
    anchor: RefObject<HTMLButtonElement | null>,
    onDismiss: () => void,
  ) => ReactNode;
  isBusy: (path: string) => boolean;
  onSelect: (path: string) => void;
  onClose: (path: string) => void;
  onContextMenu?: SlotContextMenu;
}): JSX.Element {
  const row = useRef<HTMLDivElement>(null);
  const current = useRef<HTMLDivElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const [adding, setAdding] = useState(false);
  const [marker, setMarker] = useState<MarkerBox | null>(null);
  // The first placement jumps; later ones glide.
  const [glide, setGlide] = useState(false);
  const several = paths.length > 1;

  const place = useCallback(() => {
    const target = current.current?.querySelector("[data-project-menu]");
    const rowElement = row.current;
    if (!rowElement || !(target instanceof HTMLElement)) {
      setMarker(null);
      return;
    }
    const rowRect = rowElement.getBoundingClientRect();
    const rect = target.getBoundingClientRect();
    // Absolute children are placed from the padding box, inside the border.
    const next: MarkerBox = {
      x: Math.round(rect.left - rowRect.left - rowElement.clientLeft),
      y: Math.round(rect.top - rowRect.top - rowElement.clientTop),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };
    setMarker((previous) =>
      previous &&
      previous.x === next.x &&
      previous.y === next.y &&
      previous.width === next.width &&
      previous.height === next.height
        ? previous
        : next,
    );
  }, []);

  useLayoutEffect(() => {
    if (!several) {
      setMarker(null);
      setGlide(false);
      return;
    }
    place();
    const frame = requestAnimationFrame(() => setGlide(true));
    const observer = new ResizeObserver(place);
    if (row.current) observer.observe(row.current);
    if (current.current) observer.observe(current.current);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [several, place, currentPath, paths]);

  const closeOnMiddleClick = (path: string) => (event: ReactMouseEvent) => {
    if (event.button !== 1 || !several) return;
    event.preventDefault();
    onClose(path);
  };

  return (
    <div
      role="group"
      aria-label="Project slots"
      data-tauri-drag-region="false"
      className="flex min-w-0 items-center gap-1"
    >
      <div
        ref={row}
        className={
          several
            ? "relative -ml-2 flex min-w-0 items-center gap-0.5 rounded-md border border-content/10 p-0.5"
            : "relative flex min-w-0 items-center"
        }
      >
        {several && marker ? (
          <span
            aria-hidden="true"
            data-slot-selected-marker=""
            className={`pointer-events-none absolute left-0 top-0 rounded-[5px] bg-selection ${
              glide
                ? "transition-[translate,width,height] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none"
                : ""
            }`}
            style={{
              width: marker.width,
              height: marker.height,
              translate: `${marker.x}px ${marker.y}px`,
            }}
          />
        ) : null}
        {several ? (
          <SharedHoverHighlight selector={SLOT_HOVER_SELECTOR} />
        ) : null}
        {paths.map((path) =>
          sameProjectPath(path, currentPath) ? (
            <div
              key={path}
              ref={current}
              className={`group/slot relative flex min-w-20 shrink-[0.5] items-center${several ? ` ${CURRENT_IN_TRACK}` : ""}`}
              onAuxClick={closeOnMiddleClick(path)}
            >
              {renderCurrent()}
              {several ? (
                <CloseSlotButton path={path} onClose={onClose} />
              ) : null}
            </div>
          ) : (
            <ProjectSlot
              key={path}
              path={path}
              busy={isBusy(path)}
              onSelect={onSelect}
              onClose={onClose}
              onAuxClick={closeOnMiddleClick(path)}
              onContextMenu={onContextMenu}
            />
          ),
        )}
      </div>
      {renderAddPicker && paths.length < MAX_PROJECT_SLOTS ? (
        <button
          ref={addButton}
          type="button"
          aria-label="Add a project slot"
          title="Add a project slot"
          aria-haspopup="dialog"
          aria-expanded={adding}
          onClick={() => setAdding((open) => !open)}
          className="grid size-6 shrink-0 place-items-center rounded-md text-content/45 transition-colors duration-100 hover:bg-content/8 hover:text-content focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-content/30 aria-expanded:bg-content/8 aria-expanded:text-content"
        >
          <Plus className="size-3.5" strokeWidth={1.75} />
        </button>
      ) : null}
      {adding && renderAddPicker
        ? renderAddPicker(addButton, () => setAdding(false))
        : null}
    </div>
  );
}

type MarkerBox = { x: number; y: number; width: number; height: number };

/** The slot buttons plus the current slot's project menu button. */
const SLOT_HOVER_SELECTOR =
  "[data-shared-hover-item],button[data-project-menu]";

/**
 * Fits the project menu button (SidebarWorktreeSwitcher) into the track: no
 * outdent, the track's height and radius, and no own hover fill since the
 * shared highlight paints it.
 */
const CURRENT_IN_TRACK = [
  "[&>button[data-project-menu]]:ml-0",
  "[&>button[data-project-menu]]:h-6",
  "[&>button[data-project-menu]]:rounded-[5px]",
  "[&>button[data-project-menu]]:px-2",
  "[&>button[data-project-menu]]:hover:bg-transparent",
].join(" ");

function ProjectSlot({
  path,
  busy,
  onSelect,
  onClose,
  onAuxClick,
  onContextMenu,
}: {
  path: string;
  busy: boolean;
  onSelect: (path: string) => void;
  onClose: (path: string) => void;
  onAuxClick: (event: ReactMouseEvent) => void;
  onContextMenu?: SlotContextMenu;
}): JSX.Element {
  const label = useProjectLabel(path);
  return (
    <div
      className="group/slot relative flex min-w-14 max-w-44 shrink items-center"
      onAuxClick={onAuxClick}
    >
      <button
        type="button"
        title={`${label}
${path}`}
        aria-label={`Switch to ${label}`}
        data-shared-hover-item=""
        onClick={() => onSelect(path)}
        onContextMenu={
          onContextMenu
            ? (event) => {
                event.preventDefault();
                event.stopPropagation();
                onContextMenu(
                  path,
                  event.clientX,
                  event.clientY,
                  event.currentTarget,
                );
              }
            : undefined
        }
        className="flex h-6 min-w-0 max-w-full items-center gap-2 rounded-[5px] px-2 text-[13px] font-semibold leading-tight text-content/50 transition-colors duration-100 hover:text-content focus-visible:text-content focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-content/30"
      >
        <CurrentProjectIcon cwd={path} busy={busy} mascotClassName="size-2.5" />
        <span className="min-w-0 truncate">{label}</span>
      </button>
      <CloseSlotButton path={path} onClose={onClose} />
    </div>
  );
}

function CloseSlotButton({
  path,
  onClose,
}: {
  path: string;
  onClose: (path: string) => void;
}): JSX.Element {
  const label = useProjectLabel(path);
  return (
    <button
      type="button"
      aria-label={`Close ${label} slot`}
      title="Close slot"
      onClick={(event) => {
        event.stopPropagation();
        onClose(path);
      }}
      className="absolute -right-1 -top-1 z-10 grid size-3.5 place-items-center rounded-full bg-content/20 text-content opacity-0 backdrop-blur-sm transition-opacity duration-100 hover:bg-content/35 focus-visible:opacity-100 focus-visible:outline-none group-hover/slot:opacity-100"
    >
      <X className="size-2.5" strokeWidth={2} />
    </button>
  );
}

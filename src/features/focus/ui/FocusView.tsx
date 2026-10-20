import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { IconButton } from "../../../app/shell/TitleBar";
import { WindowControls } from "../../../app/shell/WindowControls";
import { IS_MAC, MOD, SHIFT } from "../../../platform/tauri/platform";
import { useTrafficLightsVisible } from "../../../platform/tauri/useTrafficLightsVisible";
import { setGrabbing, suppressTextSelection } from "../../../shared/lib/drag";
import { projectName } from "../../../shared/lib/paths";
import { Focus, GripVertical, X } from "../../../shared/ui/icons";
import type { RecentProject } from "../../projects/model/recents";
import {
  ProjectIcon,
  ProjectMark,
  useProjectMarks,
} from "../../projects/ui/ProjectMark";
import type { BoardCard } from "../../session-board/sessionBoard";
import { BoardCardTag } from "../../session-board/ui/BoardSessionCard";
import { sessionDisplayTitle, type Session } from "../../sessions/model/session";
import {
  focusColumnCap,
  focusGridHas,
  moveInFocusGrid,
  visibleFocusGrid,
  type FocusDropEdge,
  type FocusGrid,
} from "../model/focusGrid";
import { focusPaneTag, newestBoardCards } from "../model/focusPaneTag";
import {
  focusContinueItems,
  focusProjectItems,
  FocusSearchList,
  type FocusPickItem,
} from "./FocusPicker";
import { FOCUS_NEW_OPTIONS, FocusMoreButton, FocusNewButton } from "./FocusTopBar";

const DRAG_THRESHOLD = 4;
/** Within this share of a pane's edge a drop goes beside it; else it swaps. */
const EDGE_ZONE = 0.25;

type PaneDrag = { fromId: string; overId: string | null; edge: FocusDropEdge };

type Props = {
  grid: FocusGrid;
  sessions: readonly Session[];
  boardCards: readonly BoardCard[];
  recents: readonly RecentProject[];
  focusedId: string | undefined;
  /** The chat itself; App owns SessionPane's wiring. */
  renderPane: (session: Session) => ReactNode;
  onGridChange: (grid: FocusGrid) => void;
  onFocusPane: (sessionId: string) => void;
  onClosePane: (sessionId: string) => void;
  /** How many columns the window has room for, as it resizes. */
  onColumnCapChange: (cap: number) => void;
  onExit: () => void;
  onNewChat: () => void;
  onStartNew: (cwd: string) => void;
  /** Adds a chat (Continue, "+N more"), trading places with the focused pane if it would not show. */
  onOpenChat: (sessionId: string) => void;
  onImport?: () => void;
  footer?: ReactNode;
};

function paneTitle(session: Session | undefined, card: BoardCard | undefined): string {
  if (session) return sessionDisplayTitle(session.title, session.harness) || "New session";
  return card?.title || "Chat";
}

/**
 * Focus mode (fork, L-123): every running chat from any project side by
 * side, in up to 4 columns of 1–2 chats, with the app's chrome hidden.
 * Panes keep their place; dragging a header moves one.
 */
export function FocusView({
  grid,
  sessions,
  boardCards,
  recents,
  focusedId,
  renderPane,
  onGridChange,
  onFocusPane,
  onClosePane,
  onColumnCapChange,
  onExit,
  onNewChat,
  onStartNew,
  onOpenChat,
  onImport,
  footer,
}: Props): ReactNode {
  const marks = useProjectMarks();
  const trafficLightsVisible = useTrafficLightsVisible();
  const [cap, setCap] = useState(4);
  const main = useRef<HTMLElement>(null);
  const [drag, setDrag] = useState<PaneDrag | null>(null);
  const gridRef = useRef(grid);
  gridRef.current = grid;
  const onGridChangeRef = useRef(onGridChange);
  onGridChangeRef.current = onGridChange;
  const endDrag = useRef<(() => void) | null>(null);

  useEffect(() => {
    const el = main.current;
    if (!el) return;
    const measure = () => setCap(focusColumnCap(el.clientWidth));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  useEffect(() => onColumnCapChange(cap), [cap, onColumnCapChange]);
  useEffect(() => () => endDrag.current?.(), []);

  const byId = useMemo(
    () => new Map(sessions.map((session) => [session.id, session])),
    [sessions],
  );
  const cards = useMemo(() => newestBoardCards(boardCards), [boardCards]);
  const shown = visibleFocusGrid(grid, cap);
  const empty = shown.columns.length === 0 && shown.hidden.length === 0;
  const rows = shown.columns.some((column) => column.length > 1) ? 2 : 1;

  const projectItems = useMemo(
    () => focusProjectItems(recents, marks),
    [recents, marks],
  );
  const continueItems = useMemo(
    () => focusContinueItems(boardCards, (id) => focusGridHas(grid, id), marks),
    [boardCards, grid, marks],
  );
  const hiddenItems: FocusPickItem[] = shown.hidden.map((id) => {
    const session = byId.get(id);
    const cwd = session?.cwd ?? cards.get(id)?.cwd;
    return {
      id,
      label: paneTitle(session, cards.get(id)),
      detail: cwd ? projectName(cwd) : undefined,
      icon: cwd ? <ProjectIcon cwd={cwd} {...marks} /> : undefined,
      group: "Not shown",
    };
  });
  const newActions = {
    projectItems,
    continueItems,
    onStartNew,
    onContinue: onOpenChat,
    onImport,
  };

  const dropAt = (fromId: string, x: number, y: number) => {
    const pane = document
      .elementFromPoint(x, y)
      ?.closest<HTMLElement>("[data-focus-pane]");
    const overId = pane?.dataset.focusPane;
    if (!pane || !overId || overId === fromId) return null;
    const rect = pane.getBoundingClientRect();
    const rx = (x - rect.left) / rect.width;
    const ry = (y - rect.top) / rect.height;
    const sides: [FocusDropEdge, number][] = [
      ["left", rx],
      ["right", 1 - rx],
      ["top", ry],
      ["bottom", 1 - ry],
    ];
    const [side, distance] = sides.reduce((a, b) => (b[1] < a[1] ? b : a));
    const edge = distance > EDGE_ZONE ? "center" : side;
    // A drop that would make a 5th column or a 3rd row shows no target.
    return moveInFocusGrid(gridRef.current, fromId, overId, edge)
      ? { overId, edge }
      : null;
  };

  const startDrag = (fromId: string, event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    if (event.target instanceof Element && event.target.closest("button")) return;
    const handle = event.currentTarget;
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startY = event.clientY;
    let active = false;
    let target: { overId: string; edge: FocusDropEdge } | null = null;
    let restoreSelection: (() => void) | null = null;
    handle.setPointerCapture(pointerId);

    const onMove = (ev: PointerEvent) => {
      if (!active) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < DRAG_THRESHOLD)
          return;
        active = true;
        restoreSelection = suppressTextSelection();
        setGrabbing(true);
      }
      target = dropAt(fromId, ev.clientX, ev.clientY);
      setDrag({
        fromId,
        overId: target?.overId ?? null,
        edge: target?.edge ?? "center",
      });
    };
    const onUp = () => finish(true);
    const onCancel = () => finish(false);
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape" || !active) return;
      ev.preventDefault();
      ev.stopPropagation();
      finish(false);
    };
    function finish(commit: boolean) {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onKey, true);
      endDrag.current = null;
      restoreSelection?.();
      if (active) setGrabbing(false);
      setDrag(null);
      try {
        handle.releasePointerCapture(pointerId);
      } catch {
        // Already released when the pointer left the window.
      }
      if (!commit || !active || !target) return;
      const next = moveInFocusGrid(gridRef.current, fromId, target.overId, target.edge);
      if (next) onGridChangeRef.current(next);
    }
    endDrag.current = () => finish(false);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKey, true);
  };

  const panes = shown.columns.flatMap((column, columnIndex) =>
    column.map((id, rowIndex) => {
      const session = byId.get(id);
      const card = cards.get(id);
      const title = paneTitle(session, card);
      const focused = id === focusedId;
      const tag = session ? focusPaneTag(session, card) : null;
      const cwd = session?.cwd ?? card?.cwd;
      return (
        <section
          // Keyed by chat and placed by grid lines, so moving a pane never
          // remounts its transcript.
          key={id}
          data-focus-pane={id}
          aria-label={title}
          onPointerDownCapture={() => {
            if (!focused) onFocusPane(id);
          }}
          className={`relative flex min-h-0 min-w-0 flex-col overflow-hidden${
            columnIndex > 0 ? " border-l border-stroke" : ""
          }${rowIndex > 0 ? " border-t border-stroke" : ""}${
            drag?.fromId === id ? " opacity-40" : ""
          }`}
          style={{
            gridColumn: columnIndex + 1,
            gridRow: column.length === 1 ? `1 / span ${rows}` : rowIndex + 1,
          }}
        >
          <header
            data-focus-pane-header
            title="Drag to move"
            onPointerDown={(event) => startDrag(id, event)}
            className={`flex h-8 shrink-0 cursor-grab select-none items-center gap-2 border-b border-stroke pr-1 pl-1.5 text-[12px] transition-colors duration-100 ${
              focused ? "bg-content/5" : ""
            }`}
          >
            <GripVertical
              aria-hidden
              className="size-3 shrink-0 text-content/30"
              strokeWidth={1.75}
            />
            {cwd ? (
              <span className="flex min-w-0 max-w-[40%] shrink-0 text-content/55">
                <ProjectMark cwd={cwd} {...marks} />
              </span>
            ) : null}
            <span
              className={`min-w-0 flex-1 truncate ${
                focused ? "text-content" : "text-content/65"
              }`}
            >
              {title}
            </span>
            {tag ? (
              <span className="flex shrink-0 text-[11px]">
                <BoardCardTag
                  label={tag.label}
                  tone={tag.tone}
                  title={card?.reason}
                />
              </span>
            ) : null}
            <button
              type="button"
              aria-label={`Remove ${title} from Focus`}
              title="Remove from Focus"
              onClick={() => onClosePane(id)}
              className="grid size-6 shrink-0 place-items-center rounded-md text-content/45 transition-[background-color,color,scale] duration-100 hover:bg-content/10 hover:text-content focus-visible:bg-content/10 focus-visible:text-content focus-visible:outline-none active:scale-96 motion-reduce:active:scale-100"
            >
              <X aria-hidden className="size-3.5" strokeWidth={1.75} />
            </button>
          </header>
          <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
            {session ? (
              renderPane(session)
            ) : (
              <div
                aria-busy="true"
                aria-label="Loading chat"
                className="flex flex-1 flex-col gap-3 p-4"
              >
                <div className="h-3 w-2/3 animate-pulse rounded bg-content/8" />
                <div className="h-3 w-1/2 animate-pulse rounded bg-content/8" />
              </div>
            )}
          </div>
          {drag && drag.overId === id ? <FocusDropHint edge={drag.edge} /> : null}
        </section>
      );
    }),
  );

  return (
    <div data-focus-view className="flex min-h-0 flex-1 flex-col">
      <header
        className="flex h-10 shrink-0 select-none items-stretch border-b border-stroke"
        data-tauri-drag-region="deep"
      >
        {IS_MAC && trafficLightsVisible ? (
          <div className="w-[78px] shrink-0" />
        ) : null}
        <div className="flex min-w-0 items-center gap-1.5 px-1.5">
          <IconButton
            label={`Leave Focus (${MOD}${SHIFT}E)`}
            active
            onClick={onExit}
          >
            <Focus className="size-3.5" strokeWidth={1.75} />
          </IconButton>
          {empty ? null : (
            <FocusNewButton onNewChat={onNewChat} {...newActions} />
          )}
          {hiddenItems.length > 0 ? (
            <FocusMoreButton items={hiddenItems} onPick={onOpenChat} />
          ) : null}
        </div>
        <div className="flex-1" />
        {IS_MAC ? null : <WindowControls />}
      </header>
      <main ref={main} className="relative flex min-h-0 min-w-0 flex-1">
        {empty ? (
          <FocusEmptyState {...newActions} />
        ) : shown.columns.length === 0 ? (
          // Everything is in "+N more" (e.g. a column the window lost).
          <p className="m-auto text-[13px] text-content/50">
            Pick a chat from “+{hiddenItems.length} more”.
          </p>
        ) : (
          <div
            className="grid min-h-0 min-w-0 flex-1"
            style={{
              gridTemplateColumns: `repeat(${shown.columns.length}, minmax(0, 1fr))`,
              gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
            }}
          >
            {panes}
          </div>
        )}
      </main>
      {footer}
    </div>
  );
}

function FocusDropHint({ edge }: { edge: FocusDropEdge }): ReactNode {
  const wash = {
    left: "inset-y-0 left-0 w-1/2",
    right: "inset-y-0 right-0 w-1/2",
    top: "inset-x-0 top-0 h-1/2",
    bottom: "inset-x-0 bottom-0 h-1/2",
    center: "inset-0",
  }[edge];
  const line = {
    left: "inset-y-0 left-0 w-0.5",
    right: "inset-y-0 right-0 w-0.5",
    top: "inset-x-0 top-0 h-0.5",
    bottom: "inset-x-0 bottom-0 h-0.5",
    center: "inset-0 border-2 border-accent",
  }[edge];
  return (
    <div className="pointer-events-none absolute inset-0 z-20">
      <div className={`absolute bg-accent/15 ${wash}`} />
      <div className={`absolute ${edge === "center" ? line : `bg-accent ${line}`}`} />
    </div>
  );
}

/** No chats yet: the three ways in, large; a list opens under the one picked. */
function FocusEmptyState({
  projectItems,
  continueItems,
  onStartNew,
  onContinue,
  onImport,
}: {
  projectItems: readonly FocusPickItem[];
  continueItems: readonly FocusPickItem[];
  onStartNew: (cwd: string) => void;
  onContinue: (sessionId: string) => void;
  onImport?: () => void;
}): ReactNode {
  const [picking, setPicking] = useState<"start" | "continue" | null>(null);
  return (
    <div className="m-auto flex w-full max-w-2xl flex-col items-center gap-6 px-6 py-10">
      <div className="text-center">
        <h1 className="text-[18px] font-semibold tracking-tight text-balance text-content">
          Nothing in Focus yet
        </h1>
        <p className="mt-1.5 text-[13px] text-pretty text-content/55">
          Running chats from every project show here side by side.
        </p>
      </div>
      <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-3">
        {FOCUS_NEW_OPTIONS.map(({ id, label, description, Icon }) => {
          const selected = picking === id;
          const disabled = id === "import" && !onImport;
          return (
            <button
              key={id}
              type="button"
              disabled={disabled}
              aria-pressed={id === "import" ? undefined : selected}
              onClick={() => {
                if (id === "import") onImport?.();
                else setPicking(selected ? null : id);
              }}
              className={`flex flex-col items-start gap-2 rounded-xl border p-3.5 text-left transition-[background-color,border-color,scale] duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 active:scale-96 motion-reduce:active:scale-100 disabled:opacity-40 ${
                selected
                  ? "border-accent/40 bg-accent/8"
                  : "border-content/10 bg-content/3 hover:bg-content/6"
              }`}
            >
              <Icon
                aria-hidden
                className="size-4 text-content/60"
                strokeWidth={1.5}
              />
              <span>
                <span className="block text-[13px] font-medium text-content">
                  {label}
                </span>
                <span className="mt-0.5 block text-[12px] text-content/50">
                  {description}
                </span>
              </span>
            </button>
          );
        })}
      </div>
      {picking ? (
        <div className="flex h-72 w-full max-w-md flex-col overflow-hidden rounded-xl border border-content/10 bg-content/3">
          {picking === "start" ? (
            <FocusSearchList
              key="start"
              className="flex-1"
              items={projectItems}
              label="Projects"
              placeholder="Search projects"
              emptyLabel="No projects"
              onPick={onStartNew}
            />
          ) : (
            <FocusSearchList
              key="continue"
              className="flex-1"
              items={continueItems}
              label="Chats"
              placeholder="Search chats"
              emptyLabel="No chats to continue"
              onPick={onContinue}
            />
          )}
        </div>
      ) : null}
    </div>
  );
}

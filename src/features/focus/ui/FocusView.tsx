import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type Ref,
} from "react";
import { IconButton } from "../../../app/shell/TitleBar";
import { WindowControls } from "../../../app/shell/WindowControls";
import { IS_MAC, MOD, SHIFT } from "../../../platform/tauri/platform";
import { useTrafficLightsVisible } from "../../../platform/tauri/useTrafficLightsVisible";
import { setGrabbing, suppressTextSelection } from "../../../shared/lib/drag";
import { projectName } from "../../../shared/lib/paths";
import { ActivePaneRing } from "../../../shared/ui/ActivePaneRing";
import {
  CheckCircle,
  Focus,
  FolderTree,
  GripVertical,
  Settings,
  X,
  Zap,
} from "../../../shared/ui/icons";
import type { RecentProject } from "../../projects/model/recents";
import {
  ProjectIcon,
  ProjectMark,
  useProjectMarks,
} from "../../projects/ui/ProjectMark";
import type { BoardCard } from "../../session-board/sessionBoard";
import { BoardCardTag } from "../../session-board/ui/BoardSessionCard";
import {
  sessionDisplayTitle,
  type Session,
} from "../../sessions/model/session";
import {
  focusColumnCap,
  focusGridHas,
  moveInFocusGrid,
  swapInFocusGrid,
  visibleFocusGrid,
  type FocusDropEdge,
  type FocusGrid,
} from "../model/focusGrid";
import {
  focusProjectGroups,
  loadFocusGroupByProject,
  projectFocusGrid,
  saveFocusGroupByProject,
} from "../model/focusGroups";
import { focusPaneTag, newestBoardCards } from "../model/focusPaneTag";
import { FocusTabRow, type FocusTab } from "./FocusGroupTabs";
import {
  focusContinueItems,
  focusProjectItems,
  FocusSearchList,
  type FocusPickItem,
} from "./FocusPicker";
import {
  FOCUS_NEW_OPTIONS,
  FocusMoreButton,
  FocusNewButton,
} from "./FocusTopBar";

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
  /**
   * App's project terminal docks. They open inside the focused pane, whose
   * body App lays out through `dockGridRef` as it does the workspace (L-136).
   */
  dock?: ReactNode;
  dockGridRef?: Ref<HTMLDivElement>;
  /** Title-bar shortcuts; each leaves Focus (its grid is kept) for that view. */
  onOpenTasks?: () => void;
  onOpenAutomations?: () => void;
  onOpenSettings?: () => void;
  footer?: ReactNode;
};

function paneTitle(
  session: Session | undefined,
  card: BoardCard | undefined,
): string {
  if (session)
    return sessionDisplayTitle(session.title, session.harness) || "New session";
  return card?.title || "Chat";
}

/**
 * Focus mode (fork, L-123): every running chat from any project side by
 * side, in up to 4 columns of 1–2 chats, with the app's chrome hidden.
 * Panes keep their place; dragging a header moves one. Grouped by project
 * (L-128), tab rows pick a project and a chat, and the grid shows only that
 * project's chats; dragging then only swaps, so hidden projects keep their
 * places.
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
  dock,
  dockGridRef,
  onOpenTasks,
  onOpenAutomations,
  onOpenSettings,
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
  const [grouped, setGrouped] = useState(loadFocusGroupByProject);
  const groupedRef = useRef(grouped);
  groupedRef.current = grouped;
  const gridRegionId = useId();
  const groups = useMemo(
    () =>
      focusProjectGroups(grid, (id) => byId.get(id)?.cwd ?? cards.get(id)?.cwd),
    [grid, byId, cards],
  );
  const focusedGroup = focusedId
    ? groups.find((group) => group.ids.includes(focusedId))
    : undefined;
  // The focused chat's project; the first one until a chat is focused.
  const activeGroup = grouped ? (focusedGroup ?? groups[0]) : undefined;
  /** Project key -> the chat last focused in it, for returning to a project. */
  const lastFocused = useRef(new Map<string, string>());
  useEffect(() => {
    if (focusedGroup && focusedId)
      lastFocused.current.set(focusedGroup.key, focusedId);
  }, [focusedGroup, focusedId]);
  const viewGrid = activeGroup ? projectFocusGrid(grid, activeGroup) : grid;
  const shown = visibleFocusGrid(viewGrid, cap);
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
  /** Focuses a chat of the shown project, trading it in if it is off screen. */
  const showChat = (id: string) => {
    const visible = shown.columns.flat();
    if (!visible.includes(id)) {
      const target =
        focusedId && visible.includes(focusedId) ? focusedId : visible[0];
      if (target) onGridChange(swapInFocusGrid(grid, id, target));
    }
    onFocusPane(id);
  };
  const showProject = (key: string) => {
    const group = groups.find((entry) => entry.key === key);
    if (!group) return;
    const visible = visibleFocusGrid(
      projectFocusGrid(grid, group),
      cap,
    ).columns.flat();
    const remembered = lastFocused.current.get(key);
    const target =
      remembered && visible.includes(remembered) ? remembered : visible[0];
    if (target) onFocusPane(target);
  };
  const toggleGrouped = () => {
    const next = !grouped;
    saveFocusGroupByProject(next);
    setGrouped(next);
  };
  const projectTabs: FocusTab[] = groups.map((group) => {
    const name = group.cwd ? projectName(group.cwd) : "Other";
    const count = group.ids.length;
    return {
      id: group.key,
      title: `${name}, ${count} ${count === 1 ? "chat" : "chats"}`,
      content: (
        <>
          {group.cwd ? (
            <ProjectMark cwd={group.cwd} {...marks} />
          ) : (
            <span className="truncate">Other</span>
          )}
          <span className="shrink-0 text-[11px] tabular-nums text-content/40">
            {count}
          </span>
        </>
      ),
    };
  });
  const chatTabs: FocusTab[] = (activeGroup?.ids ?? []).map((id) => {
    const session = byId.get(id);
    const card = cards.get(id);
    const title = paneTitle(session, card);
    const tag = session ? focusPaneTag(session, card) : null;
    return {
      id,
      title: tag ? `${title}, ${tag.label}` : title,
      content: (
        <>
          <span className="min-w-0 truncate">{title}</span>
          {tag ? (
            <span className="flex shrink-0 text-[11px]">
              <BoardCardTag label={tag.label} tone={tag.tone} />
            </span>
          ) : null}
        </>
      ),
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
    // Grouped, a side drop could move chats of hidden projects: swap only.
    const edge = groupedRef.current || distance > EDGE_ZONE ? "center" : side;
    // A drop that would make a 5th column or a 3rd row shows no target.
    return planDrop(fromId, overId, edge) ? { overId, edge } : null;
  };

  const planDrop = (
    fromId: string,
    overId: string,
    edge: FocusDropEdge,
  ): FocusGrid | null => {
    const current = gridRef.current;
    if (!groupedRef.current)
      return moveInFocusGrid(current, fromId, overId, edge);
    return fromId !== overId &&
      focusGridHas(current, fromId) &&
      focusGridHas(current, overId)
      ? swapInFocusGrid(current, fromId, overId)
      : null;
  };

  const startDrag = (fromId: string, event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    if (event.target instanceof Element && event.target.closest("button"))
      return;
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
        if (
          Math.hypot(ev.clientX - startX, ev.clientY - startY) < DRAG_THRESHOLD
        )
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
      const next = planDrop(fromId, target.overId, target.edge);
      if (next) onGridChangeRef.current(next);
    }
    endDrag.current = () => finish(false);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKey, true);
  };

  const outlined = shown.columns.flat().length > 1;
  // The dock opens inside the focused pane; with that pane hidden (another
  // project's tab, or "+N more") it falls back to the whole pane region.
  const dockInPane = shown.columns.some((column) =>
    column.includes(focusedId ?? ""),
  );
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
            title={grouped ? "Drag onto a chat to swap" : "Drag to move"}
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
          {/* Every pane keeps this wrapper, so moving the dock between panes
              never remounts a transcript; App lays out the focused one. */}
          <div
            ref={focused && dockInPane ? dockGridRef : undefined}
            className={`min-h-0 min-w-0 flex-1 ${
              focused && dockInPane ? "grid" : "flex flex-col"
            }`}
          >
            {focused && dockInPane ? dock : null}
            <div
              className="relative flex min-h-0 min-w-0 flex-1 flex-col"
              style={{ gridArea: "main" }}
            >
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
          </div>
          <ActivePaneRing shown={focused && outlined} />
          {drag && drag.overId === id ? (
            <FocusDropHint edge={drag.edge} />
          ) : null}
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
          {onOpenTasks ? (
            <IconButton label="Task Manager" onClick={onOpenTasks}>
              <CheckCircle className="size-3.5" strokeWidth={1.75} />
            </IconButton>
          ) : null}
          {onOpenAutomations ? (
            <IconButton label="Automations" onClick={onOpenAutomations}>
              <Zap className="size-3.5" strokeWidth={1.75} />
            </IconButton>
          ) : null}
          {onOpenSettings ? (
            <IconButton label="Settings" onClick={onOpenSettings}>
              <Settings className="size-3.5" strokeWidth={1.75} />
            </IconButton>
          ) : null}
          {empty ? null : (
            <span aria-hidden className="mx-1.5 h-4 w-px shrink-0 bg-stroke" />
          )}
          {empty ? null : (
            <FocusNewButton onNewChat={onNewChat} {...newActions} />
          )}
          {empty ? null : (
            <button
              type="button"
              aria-pressed={grouped}
              title="Group chats by project"
              data-tauri-drag-region="false"
              onClick={toggleGrouped}
              className={`flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-[12px] font-medium transition-[background-color,color,scale] duration-100 hover:bg-content/8 hover:text-content focus-visible:bg-content/8 focus-visible:outline-none active:scale-96 motion-reduce:active:scale-100 ${
                grouped ? "bg-content/8 text-content" : "text-content/60"
              }`}
            >
              <FolderTree aria-hidden className="size-3.5" strokeWidth={1.75} />
              Group by project
            </button>
          )}
          {hiddenItems.length > 0 ? (
            <FocusMoreButton
              items={hiddenItems}
              onPick={grouped ? showChat : onOpenChat}
            />
          ) : null}
        </div>
        <div className="flex-1" />
        {IS_MAC ? null : <WindowControls />}
      </header>
      {activeGroup && !empty ? (
        <>
          <FocusTabRow
            label="Projects in Focus"
            tabs={projectTabs}
            selectedId={activeGroup.key}
            onSelect={showProject}
            controls={gridRegionId}
          />
          <FocusTabRow
            label="Chats in this project"
            tabs={chatTabs}
            selectedId={focusedId}
            onSelect={showChat}
            controls={gridRegionId}
          />
        </>
      ) : null}
      <div
        ref={dockInPane ? undefined : dockGridRef}
        className={`min-h-0 min-w-0 flex-1 ${dockInPane ? "flex" : "grid"}`}
      >
        {dockInPane ? null : dock}
        <main
          ref={main}
          id={gridRegionId}
          role={activeGroup && !empty ? "tabpanel" : undefined}
          aria-label={
            activeGroup && !empty
              ? activeGroup.cwd
                ? projectName(activeGroup.cwd)
                : "Other"
              : undefined
          }
          className="relative flex min-h-0 min-w-0 flex-1"
          style={{ gridArea: "main" }}
        >
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
      </div>
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
      <div
        className={`absolute ${edge === "center" ? line : `bg-accent ${line}`}`}
      />
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

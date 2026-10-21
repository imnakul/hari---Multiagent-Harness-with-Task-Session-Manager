import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { OverlayNav } from "../../../app/shell/TitleBar";
import { WindowControls } from "../../../app/shell/WindowControls";
import { IS_MAC } from "../../../platform/tauri/platform";
import { MessageMultiple, Plus, Search, X } from "../../../shared/ui/icons";
import { isHarnessId } from "../../sessions/model/models";
import { sessionDisplayTitle } from "../../sessions/model/session";
import {
  BoardColumn,
  BoardColumns,
} from "../../../shared/ui/board/BoardColumns";
import { SharedHoverHighlight } from "../../sessions/ui/SharedHoverHighlight";
import { ResultCount } from "../../../shared/ui/ResultCount";
import {
  SearchableSelect,
  type SearchableSelectOption,
} from "../../../shared/ui/SearchableSelect";
import { projectName, pathKey } from "../../../shared/lib/paths";
import {
  projectRailItems,
  type RecentProject,
} from "../../projects/model/recents";
import {
  BOARD_LANES,
  boardLane,
  hideBoardCards,
  loadBoard,
  visibleBoardCards,
  type BoardCard,
  type BoardLane,
} from "../sessionBoard";
import { BoardSessionCard } from "./BoardSessionCard";
import { usePresence } from "../../../shared/hooks/usePresence";

const COLUMN_MIN_WIDTH = 256;
export function SessionBoardView({
  cards,
  cwd,
  recents = [],
  loading,
  error,
  activeSessionId,
  onOpenSession,
  onClose,
  onWorkspaceHost,
  onPaneVisible,
  besideRail,
  compactRail,
  onToggleSidebar,
  onAddTodo,
  onEditTodo,
  onStartTodo,
  onDeleteTodo,
  remoteControlSessionIds,
  paneTabs,
}: {
  cards: readonly BoardCard[];
  cwd?: string;
  recents?: RecentProject[];
  loading: boolean;
  error: string | null;
  activeSessionId?: string;
  /** Resolves false when the session no longer exists (its card is dropped). */
  onOpenSession: (sessionId: string, altKey?: boolean) => Promise<boolean | void>;
  onClose: () => void;
  onPaneVisible: (visible: boolean) => void;
  onWorkspaceHost: (host: HTMLElement | null) => void;
  besideRail?: boolean;
  compactRail?: boolean;
  onToggleSidebar?: () => void;
  onAddTodo?: (cwd?: string) => void;
  onEditTodo?: (id: string) => Promise<void>;
  onStartTodo?: (id: string) => Promise<void>;
  onDeleteTodo?: (id: string) => Promise<void>;
  /** Chats with Remote Control turned on; their cards show a PC icon. */
  remoteControlSessionIds?: ReadonlySet<string>;
  /** The workspace tab strip for the pane (shows extra tabs under "New tab"). */
  paneTabs?: ReactNode;
}) {
  const [query, setQuery] = useState("");
  const [project, setProject] = useState("");
  const [status, setStatus] = useState("");
  const [selected, setSelected] = useState(false);
  // The session pane slides in and out; it stays mounted while leaving.
  const pane = usePresence(selected);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [width, setWidth] = useState(() => {
    try {
      return Math.max(
        25,
        Math.min(75, Number(localStorage.getItem("monocode.boardWidth")) || 48),
      );
    } catch {
      return 48;
    }
  });
  const resizeCleanup = useRef<(() => void) | undefined>(undefined);
  useEffect(() => {
    onPaneVisible(pane.mounted);
    return () => onPaneVisible(false);
  }, [pane.mounted, onPaneVisible]);
  useEffect(() => {
    try {
      localStorage.setItem("monocode.boardWidth", String(width));
    } catch {}
  }, [width]);
  useEffect(() => () => resizeCleanup.current?.(), []);
  const body = useRef<HTMLDivElement>(null);
  const boardSide = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);
  const projects = useMemo(() => {
    const paths = new Map(
      projectRailItems(recents, cwd ?? "").map(({ path }) => [
        pathKey(path),
        path,
      ]),
    );
    // Keep projects from durable cards even after they leave the recent-project rail.
    for (const card of cards) {
      if (card.cwd && !paths.has(pathKey(card.cwd)))
        paths.set(pathKey(card.cwd), card.cwd);
    }
    return [...paths.values()];
  }, [cards, recents, cwd]);
  const boardCards = visibleBoardCards(cards);
  const paneCard = cards.find((card) => card.sessionId === activeSessionId);
  const paneTitle = paneCard
    ? isHarnessId(paneCard.harness)
      ? sessionDisplayTitle(paneCard.title, paneCard.harness)
      : paneCard.title
    : "Session";
  const needle = query.trim().toLowerCase();
  const matchesProject = (card: BoardCard) =>
    !project || pathKey(project) === pathKey(card.cwd);
  const matchesStatus = (card: BoardCard) =>
    !status || boardLane(card) === status;
  const matchesQuery = (card: BoardCard) =>
    !needle ||
    [card.title, card.cwd, card.model, card.harness, card.reason ?? ""]
      .join(" ")
      .toLowerCase()
      .includes(needle);
  const visible = boardCards.filter(
    (card) => matchesProject(card) && matchesStatus(card) && matchesQuery(card),
  );
  // Faceted counts: each dropdown applies every filter except its own.
  const projectCounts = new Map<string, number>();
  let anyProjectCount = 0;
  for (const card of boardCards) {
    if (!matchesStatus(card) || !matchesQuery(card)) continue;
    anyProjectCount += 1;
    const key = pathKey(card.cwd);
    projectCounts.set(key, (projectCounts.get(key) ?? 0) + 1);
  }
  const statusCounts = new Map<string, number>();
  let anyStatusCount = 0;
  for (const card of boardCards) {
    if (!matchesProject(card) || !matchesQuery(card)) continue;
    anyStatusCount += 1;
    const lane = boardLane(card);
    statusCounts.set(lane, (statusCounts.get(lane) ?? 0) + 1);
  }
  const projectOptions: SearchableSelectOption[] = [
    { value: "", label: "All projects", count: anyProjectCount },
    // Normalized keys so Windows drive-letter casing matches card paths.
    ...projects.map((path) => ({
      value: pathKey(path),
      label: projectName(path),
      keywords: path,
      count: projectCounts.get(pathKey(path)) ?? 0,
    })),
  ];
  const statusOptions: SearchableSelectOption[] = [
    { value: "", label: "All statuses", count: anyStatusCount },
    ...Object.entries(BOARD_LANES).map(([value, label]) => ({
      value,
      label,
      count: statusCounts.get(value) ?? 0,
    })),
  ];
  const runAction = async (action: () => Promise<void>) => {
    setBusy(true);
    setActionError(null);
    try {
      await action();
    } catch (failure) {
      setActionError(String(failure));
    } finally {
      setBusy(false);
    }
  };
  const open = async (card: BoardCard, altKey?: boolean) => {
    await runAction(async () => {
      // False means the session is gone (its card was removed): no pane.
      const opened = await onOpenSession(card.sessionId, altKey);
      if (opened === false) return;
      setSelected(true);
    });
  };
  /**
   * Fork (L-176): the divider writes the board's width straight on the DOM
   * once per frame and sets state (and so the saved width) on release, so
   * cards and the session pane re-wrap live without a render per move.
   */
  const resize = (event: React.PointerEvent<HTMLDivElement>) => {
    resizeCleanup.current?.();
    const divider = event.currentTarget;
    divider.setPointerCapture?.(event.pointerId);
    document.documentElement.classList.add("is-resizing");
    let pending: number | undefined;
    let frame = 0;
    const paint = () => {
      frame = 0;
      if (pending === undefined) return;
      boardSide.current?.style.setProperty("width", `${pending}%`);
      divider.setAttribute("aria-valuenow", String(Math.round(pending)));
    };
    const move = (next: PointerEvent) => {
      const rect = body.current?.getBoundingClientRect();
      if (!rect) return;
      pending = Math.max(
        25,
        Math.min(75, ((next.clientX - rect.left) / rect.width) * 100),
      );
      if (!frame) frame = requestAnimationFrame(paint);
    };
    const up = () => {
      if (frame) cancelAnimationFrame(frame);
      paint();
      document.documentElement.classList.remove("is-resizing");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      resizeCleanup.current = undefined;
      if (pending !== undefined) setWidth(pending);
    };
    resizeCleanup.current = up;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };
  return (
    <div
      data-app-kanban
      aria-label="Session Manager"
      role="region"
      className="flex min-h-0 min-w-0 flex-1 flex-col text-content"
    >
      <div
        className="flex h-10 shrink-0 items-center border-b border-stroke"
        data-tauri-drag-region="deep"
      >
        {IS_MAC && !besideRail ? <div className="w-[78px] shrink-0" /> : null}
        {IS_MAC && compactRail ? <div className="w-4 shrink-0" /> : null}
        {!besideRail ? (
          <OverlayNav onBack={onClose} onToggleSidebar={onToggleSidebar} />
        ) : null}
        <div className="flex min-w-0 flex-1 items-center gap-2 px-3 text-[13px]">
          <MessageMultiple
            className="size-3.5 shrink-0 text-content/45"
            strokeWidth={1.75}
          />
          <span className="min-w-0 truncate text-content">Session Manager</span>
          {loading ? null : (
            <ResultCount
              shown={visible.length}
              total={boardCards.length}
              filtered={Boolean(needle || project || status)}
              noun="sessions"
            />
          )}
        </div>
        <button
          type="button"
          className="mr-2 h-7 rounded-md px-2.5 text-[12px] text-content/70 hover:bg-content/10 hover:text-content"
          onClick={onClose}
        >
          Back to workspace
        </button>
        {!IS_MAC ? <WindowControls /> : null}
      </div>
      {/* px-3 matches the board's p-3 so Add Draft lines up with the columns.
          items-end: the board's 12px top padding is the gap below. */}
      <div className="flex h-10 shrink-0 items-end gap-1.5 px-3">
        {onAddTodo ? (
          <button
            type="button"
            aria-label="Add Draft"
            onClick={() =>
              onAddTodo(
                projects.find((path) => pathKey(path) === project) ?? cwd,
              )
            }
            className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md bg-content pl-2.5 pr-3 text-[12px] font-medium text-background-base transition-colors duration-100 hover:bg-content/85 active:bg-content/75"
          >
            <Plus aria-hidden className="size-3.5" strokeWidth={1.75} />
            Add Draft
          </button>
        ) : null}
        <div className="relative flex h-7 min-w-0 max-w-72 flex-1 items-center">
          <Search className="pointer-events-none absolute left-2 size-3 shrink-0 opacity-50" />
          <input
            className="h-7 w-full rounded-md bg-transparent pl-7 pr-2 text-[12px] text-content outline-none placeholder:text-content/40"
            aria-label="Search board"
            placeholder="Search sessions, projects, models…"
            spellCheck={false}
            autoComplete="off"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <SearchableSelect
          variant="pill"
          label="Board project"
          value={project}
          options={projectOptions}
          searchPlaceholder="Search projects…"
          onChange={setProject}
        />
        <SearchableSelect
          variant="pill"
          label="Board status"
          value={status}
          options={statusOptions}
          searchable={false}
          onChange={setStatus}
        />
        {query || project || status ? (
          <button
            type="button"
            className="h-7 shrink-0 rounded-md px-2 text-[12px] text-content/50 hover:bg-content/10 hover:text-content"
            onClick={() => {
              setQuery("");
              setProject("");
              setStatus("");
            }}
          >
            Reset
          </button>
        ) : null}
      </div>
      {error || actionError ? (
        <div role="alert" className="p-2 text-xs text-red-400">
          {actionError || error}{" "}
          <button
            className="underline"
            onClick={() => void loadBoard().then(() => setActionError(null))}
          >
            Reload board
          </button>
        </div>
      ) : null}
      <div
        ref={body}
        className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden"
      >
        <div
          ref={boardSide}
          className="flex min-h-0 min-w-0 flex-col"
          style={{ width: pane.mounted ? `${width}%` : "100%" }}
        >
          {loading ? (
            <p className="px-4 pt-3 text-[12px] text-content/50">
              Loading sessions…
            </p>
          ) : null}
          {!loading && !visible.length ? (
            <p className="px-4 pt-3 text-[13px] text-content/45">
              No sessions match. Add a draft or start a session to see it here.
            </p>
          ) : null}
          <div className="min-h-0 flex-1">
            {/* Columns always fill the board (no per-column resize); the only
                divider is the one beside the session pane. */}
            <BoardColumns wrapBelow={COLUMN_MIN_WIDTH} fit>
              {(Object.entries(BOARD_LANES) as [BoardLane, string][])
                .filter(([key]) => !status || key === status)
                .map(([key, label]) => {
                  const rows = visible.filter(
                    (card) => boardLane(card) === key,
                  );
                  return (
                    <BoardColumn
                      key={key}
                      id={key}
                      label={label}
                      count={rows.length}
                      fillMin={COLUMN_MIN_WIDTH}
                      actions={
                        key === "done" ? (
                          <button
                            type="button"
                            className="text-[12px] font-normal text-content/50 hover:text-content disabled:opacity-40"
                            disabled={busy || !rows.length}
                            onClick={() =>
                              void runAction(() => hideBoardCards(rows))
                            }
                            aria-label={`Clear ${label}`}
                          >
                            Clear
                          </button>
                        ) : null
                      }
                    >
                      <div
                        data-shared-hover-continuity
                        className="relative flex flex-col"
                      >
                        <SharedHoverHighlight />
                        {rows.map((card) => (
                          <BoardSessionCard
                            key={card.sessionId}
                            card={card}
                            lane={key}
                            remoteControl={
                              remoteControlSessionIds?.has(card.sessionId) ??
                              false
                            }
                            now={now}
                            busy={busy}
                            preserveHover={
                              selected && card.sessionId === activeSessionId
                            }
                            onOpen={(altKey) => void open(card, altKey)}
                            onStart={
                              onStartTodo
                                ? () =>
                                    void runAction(async () => {
                                      await onStartTodo(card.sessionId);
                                      await onOpenSession(card.sessionId);
                                      setSelected(true);
                                    })
                                : undefined
                            }
                            onEdit={
                              onEditTodo
                                ? () =>
                                    void runAction(() =>
                                      onEditTodo(card.sessionId),
                                    )
                                : undefined
                            }
                            onDelete={
                              onDeleteTodo
                                ? () =>
                                    void runAction(() =>
                                      onDeleteTodo(card.sessionId),
                                    )
                                : undefined
                            }
                            onRemove={() =>
                              void runAction(() => hideBoardCards([card]))
                            }
                          />
                        ))}
                      </div>
                    </BoardColumn>
                  );
                })}
            </BoardColumns>
          </div>
        </div>
        {pane.mounted ? (
          <div
            role="separator"
            aria-label="Board and session divider"
            aria-orientation="vertical"
            tabIndex={0}
            aria-valuemin={25}
            aria-valuemax={75}
            aria-valuenow={Math.round(width)}
            className="w-1.5 shrink-0 cursor-col-resize bg-content/5 hover:bg-accent/30 focus:bg-accent/30"
            onPointerDown={resize}
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                event.preventDefault();
                setWidth((value) =>
                  Math.max(
                    25,
                    Math.min(75, value + (event.key === "ArrowLeft" ? -5 : 5)),
                  ),
                );
              }
            }}
          />
        ) : null}
        <div
          data-board-pane
          inert={pane.mounted && !selected ? true : undefined}
          className={
            pane.mounted
              ? `flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden transition-[opacity,transform] duration-200 ease-[cubic-bezier(0.2,0.8,0.2,1)] will-change-transform motion-reduce:transition-none ${
                  pane.shown
                    ? "translate-x-0 opacity-100"
                    : "translate-x-full opacity-0"
                }`
              : "hidden"
          }
        >
          {/* Tabs only (no window buttons or menus) and a single close; the
              board stays open. */}
          <div
            className={`flex h-9 shrink-0 items-center gap-2 border-b border-stroke pr-1.5 ${
              paneTabs ? "pl-0" : "pl-3"
            }`}
          >
            {paneTabs ?? (
              <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-content/80">
                {paneTitle}
              </span>
            )}
            <button
              type="button"
              aria-label="Close session"
              title="Close session"
              onClick={() => setSelected(false)}
              className="grid size-7 shrink-0 place-items-center rounded-md text-content/55 transition-colors duration-100 hover:bg-content/10 hover:text-content"
            >
              <X aria-hidden className="size-3.5" strokeWidth={1.75} />
            </button>
          </div>
          <div
            ref={onWorkspaceHost}
            className="flex min-h-0 min-w-0 flex-1 flex-col"
            aria-label="Board session workspace"
          />
        </div>
      </div>
    </div>
  );
}

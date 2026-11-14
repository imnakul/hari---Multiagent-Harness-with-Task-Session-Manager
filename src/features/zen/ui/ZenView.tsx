import {
  Suspense,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
  type Ref,
} from "react";
import { IconButton } from "../../../app/shell/TitleBar";
import { WindowControls } from "../../../app/shell/WindowControls";
import { ALT, IS_MAC, MOD } from "../../../platform/tauri/platform";
import { useTrafficLightsVisible } from "../../../platform/tauri/useTrafficLightsVisible";
import { projectKey, projectName } from "../../../shared/lib/paths";
import { Popover } from "../../../shared/ui/Popover";
import {
  CheckCircle,
  ChevronDown,
  ChevronLeft,
  File,
  FolderTree,
  MessageSquare,
  MoreHorizontal,
  PanelBottom,
  PanelRight,
  Pin,
  PinOff,
  Plus,
  Settings,
  Target,
  X,
  Zap,
} from "../../../shared/ui/icons";
import {
  focusProjectItems,
  focusProjectsActiveFirst,
  FocusSearchList,
  ProjectChatList,
  type FocusPickItem,
} from "../../focus/ui/FocusPicker";
import { MonoRailMascot } from "../../monos/ui/MonoRailMascot";
import type { RecentProject } from "../../projects/model/recents";
import {
  ProjectIcon,
  ProjectMark,
  useProjectMarks,
  type ProjectMarks,
} from "../../projects/ui/ProjectMark";
import type { BoardCard } from "../../session-board/sessionBoard";
import { boardModelLabel } from "../../session-board/ui/BoardSessionCard";
import { isHarnessId, resolveModel } from "../../sessions/model/models";
import {
  sessionDisplayTitle,
  type HarnessId,
  type Session,
} from "../../sessions/model/session";
import { SharedHoverHighlight } from "../../sessions/ui/SharedHoverHighlight";
import { SessionMetadataHover } from "../../sessions/ui/SessionMetadataHoverCard";
import {
  startZenChatDrag,
  useZenChatDrag,
  type ZenDropTarget,
} from "../model/zenChatDrag";
import {
  ZEN_MAX_PANES,
  zenCanPlace,
  zenGridOfRows,
  zenSplitPlace,
  type ZenAt,
  type ZenPlace,
  type ZenTool,
} from "../model/zenPanes";
import {
  ZEN_RECENT_LIMIT,
  zenChatGroups,
  type ZenChat,
} from "../model/zenRecent";
import {
  loadZenChatsByProject,
  saveZenChatsByProject,
  subscribeZenChatsByProject,
} from "../model/zenWindow";
import { useZenMonos, type ZenMonoEntry } from "./ZenMonos";
import { ZenSplit } from "./ZenSplit";

const TOOLS: readonly {
  id: Exclude<ZenTool, "monos">;
  label: string;
  Icon: typeof MessageSquare;
}[] = [
  { id: "chat", label: "Chat", Icon: MessageSquare },
  { id: "tasks", label: "Tasks", Icon: CheckCircle },
  { id: "notes", label: "Notes", Icon: File },
  { id: "automations", label: "Automations", Icon: Zap },
];

/** Mono buttons shown in the top bar; the rest go under More. */
const ZEN_MONO_BUTTONS = 3;

const MENU_ROW =
  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] text-content/80 transition-colors duration-100 hover:bg-content/5 hover:text-content focus-visible:bg-content/5 focus-visible:outline-none";

/** The user's accent, as Focus's edges use it. */
const ACCENT = "var(--user-accent-color,var(--color-accent))";

function chatTitle(session: Session | undefined, card?: BoardCard): string {
  if (session)
    return sessionDisplayTitle(session.title, session.harness) || "New session";
  return card?.title || "Chat";
}

/** A model's display name, from a model id or a stored label. */
function modelName(harness: HarnessId, stored: string): string {
  if (!stored) return "";
  const resolved = resolveModel(harness, stored);
  return resolved.id === stored
    ? resolved.name
    : boardModelLabel(harness, stored);
}

type ZenChatItems = {
  /** Every chat: what a search covers. */
  all: FocusPickItem[];
  /** The most recent chats: the list before a search. */
  recent: FocusPickItem[];
};

/** Whether Zen's chat dropdowns group chats by project, shared and remembered. */
function useZenChatsByProject(): boolean {
  return useSyncExternalStore(
    subscribeZenChatsByProject,
    loadZenChatsByProject,
  );
}

/** The dropdown's icon button that turns project groups on or off. */
function ZenGroupToggle(): ReactNode {
  const byProject = useZenChatsByProject();
  const label = byProject ? "List chats by time" : "Group chats by project";
  return (
    <button
      type="button"
      aria-label="Group chats by project"
      aria-pressed={byProject}
      title={label}
      onClick={() => saveZenChatsByProject(!byProject)}
      className={`${SEARCH_ACTION} ${byProject ? "bg-content/8 text-content" : ""}`}
    >
      <FolderTree aria-hidden className="size-3.5" strokeWidth={1.75} />
    </button>
  );
}

/**
 * A dropdown's chats (L-230), newest first, after the pane's own chat
 * (marked current, L-256). By project: projects by their newest chat under headings, "Other" last;
 * else one list with the project on each card's second line. A chat in
 * another pane is marked so.
 */
function zenChatItems(
  chats: readonly ZenChat[],
  byId: ReadonlyMap<string, Session>,
  marks: ProjectMarks,
  except: string | undefined,
  shown: readonly string[],
  byProject: boolean,
): ZenChatItems {
  const listed = chats.filter((chat) => chat.id !== except);
  const toItems = (list: readonly ZenChat[]): FocusPickItem[] =>
    zenChatGroups(list).flatMap((group) => {
      const groupIcon = group.cwd ? (
        <ProjectIcon cwd={group.cwd} {...marks} />
      ) : undefined;
      return group.chats.map((chat): FocusPickItem => {
        const session = byId.get(chat.id);
        const harness =
          session?.harness ?? (isHarnessId(chat.harness) ? chat.harness : null);
        const title = session
          ? chatTitle(session)
          : (harness ? sessionDisplayTitle(chat.title, harness) : chat.title) ||
            "Chat";
        const model = harness
          ? modelName(harness, session?.model ?? chat.model)
          : chat.model;
        return {
          id: chat.id,
          label: title,
          detail: byProject
            ? shown.includes(chat.id)
              ? "Other pane"
              : undefined
            : [
                shown.includes(chat.id) ? "Other pane" : "",
                group.cwd ? projectName(group.cwd) : "",
              ]
                .filter(Boolean)
                .join(" · ") || undefined,
          icon: groupIcon,
          group: byProject
            ? group.cwd
              ? projectName(group.cwd)
              : "Other"
            : undefined,
          groupIcon: byProject ? groupIcon : undefined,
          project: group.cwd
            ? { key: projectKey(group.cwd), cwd: group.cwd }
            : undefined,
          model: model || undefined,
          chat: harness
            ? {
                harness,
                modelLabel: model,
                providerAccountId:
                  session?.providerAccountId ?? chat.providerAccountId,
                updatedAt: chat.updatedAt || undefined,
                status: chat.status,
              }
            : undefined,
        };
      });
    });
  const inOrder = (list: readonly ZenChat[]): FocusPickItem[] => {
    const items = toItems(list);
    if (byProject) return items;
    const at = new Map(list.map((chat, index) => [chat.id, index]));
    return items.sort((a, b) => at.get(a.id)! - at.get(b.id)!);
  };
  // L-256: the pane's own chat leads the list, marked, outside any group.
  const own = except ? zenOwnChat(chats, byId, except) : undefined;
  const ownItem = own
    ? toItems([own]).map(
        (item): FocusPickItem => ({
          ...item,
          detail: item.project ? projectName(item.project.cwd) : undefined,
          group: undefined,
          groupIcon: undefined,
          current: true,
        }),
      )
    : [];
  return {
    all: [...ownItem, ...inOrder(listed)],
    recent: [...ownItem, ...inOrder(listed.slice(0, ZEN_RECENT_LIMIT))],
  };
}

/** The pane's chat from the list, or from its open session (a new chat isn't listed yet). */
function zenOwnChat(
  chats: readonly ZenChat[],
  byId: ReadonlyMap<string, Session>,
  id: string,
): ZenChat | undefined {
  const listed = chats.find((chat) => chat.id === id);
  if (listed) return listed;
  const session = byId.get(id);
  if (!session) return undefined;
  return {
    id,
    cwd: session.cwd,
    title: session.title,
    harness: session.harness,
    model: session.model,
    updatedAt: 0,
    providerAccountId: session.providerAccountId,
  };
}

export type ZenViewProps = {
  /** Zen's chats: up to two rows of one or two, top first. */
  rows: readonly (readonly string[])[];
  sessions: readonly Session[];
  boardCards: readonly BoardCard[];
  recents: readonly RecentProject[];
  /** Every chat the dropdowns can list, newest activity first. */
  chats: readonly ZenChat[];
  focusedId?: string;
  tool: ZenTool;
  onToolChange: (tool: ZenTool) => void;
  /** The Mono whose chat fills the panel while `tool` is "monos". */
  monoId: string | null;
  /** False when Monos are turned off: no Mono buttons. */
  showMonos: boolean;
  onOpenMono: (monoId: string) => void;
  pinned: boolean;
  onTogglePin: () => void;
  renderPane: (session: Session) => ReactNode;
  /** A tool's slim view; Chat is Zen's own. */
  renderTool: (tool: Exclude<ZenTool, "chat">) => ReactNode;
  onFocusPane: (sessionId: string) => void;
  /** Shows a chat in a pane (reading order; past the last adds one) or next to a chat. */
  onShow: (at: ZenAt, sessionId: string) => void;
  /** A new chat there, in `cwd` or the nearby pane's project. */
  onNewChat: (at: ZenAt, cwd?: string) => void;
  /** Takes a chat out of Zen (the others fill its place). */
  onClosePane: (sessionId: string) => void;
  /** Whether chats now show side by side (the panel widens for them). */
  onColumnsChange?: (columns: boolean) => void;
  onExit: () => void;
  /**
   * Settings is a full page the panel can't hold, so this leaves Zen and
   * opens it there (fork, L-264).
   */
  onOpenSettings: () => void;
  /**
   * The project terminals (L-233). They sit below or beside the chats in a
   * grid App lays out through `dockGridRef`, as in Focus (L-136).
   */
  dock?: ReactNode;
  dockGridRef?: Ref<HTMLDivElement>;
  /** The usage bar along the bottom (L-233). */
  footer?: ReactNode;
};

/** A cell of Zen's grid: a chat, or the spot the Split button opened. */
type ZenCell = { id: string } | { pending: true };

/**
 * Zen mode (fork, L-230): the window as a narrow panel beside other apps.
 * Up to four chats, two rows of one or two; Tasks, Notes, Automations and
 * Monos in slim layouts from the top bar.
 */
export function ZenView({
  rows,
  sessions,
  boardCards,
  recents,
  chats,
  focusedId,
  tool,
  onToolChange,
  monoId,
  showMonos,
  onOpenMono,
  pinned,
  onTogglePin,
  renderPane,
  renderTool,
  onFocusPane,
  onShow,
  onNewChat,
  onClosePane,
  onColumnsChange,
  onExit,
  onOpenSettings,
  dock,
  dockGridRef,
  footer,
}: ZenViewProps): ReactNode {
  const marks = useProjectMarks();
  const trafficLightsVisible = useTrafficLightsVisible();
  const byId = useMemo(
    () => new Map(sessions.map((session) => [session.id, session])),
    [sessions],
  );
  const cards = useMemo(() => {
    const newest = new Map<string, BoardCard>();
    for (const card of boardCards) {
      const seen = newest.get(card.sessionId);
      if (!seen || card.updatedAt > seen.updatedAt)
        newest.set(card.sessionId, card);
    }
    return newest;
  }, [boardCards]);
  const projectItems = useMemo(
    () => focusProjectItems(recents, marks),
    [recents, marks],
  );
  const monos = useZenMonos();
  // The open Mono was deleted (or Monos turned off): back to the chats.
  const monoGone =
    tool === "monos" &&
    (!showMonos || !monoId || !monos.some((entry) => entry.mono.id === monoId));
  useEffect(() => {
    if (monoGone) onToolChange("chat");
  }, [monoGone, onToolChange]);

  const grid = useMemo(() => zenGridOfRows(rows), [rows]);
  const ids = useMemo(() => grid.columns.flat(), [grid]);
  const fits = (target: string, where: ZenPlace, id?: string): boolean =>
    zenCanPlace(grid, target, where, id);
  // Split opens an empty spot next to a chat until one is picked for it.
  const [splitAt, setSplitAt] = useState<{
    target: string;
    where: ZenPlace;
  } | null>(null);
  const pending =
    splitAt && fits(splitAt.target, splitAt.where) ? splitAt : null;
  /** Where Split would open a spot: next to the focused chat when it can. */
  const splitTarget = useMemo(() => {
    const order = [
      ...(focusedId && ids.includes(focusedId) ? [focusedId] : []),
      ...ids,
    ];
    for (const target of order) {
      const where = zenSplitPlace(grid, target);
      if (where) return { target, where };
    }
    return null;
  }, [focusedId, grid, ids]);
  const multi = ids.length > 1 || pending !== null;

  const cellRows: ZenCell[][] = grid.columns.map((row) =>
    row.map((id): ZenCell => ({ id })),
  );
  if (pending) {
    const at = cellRows.findIndex((row) =>
      row.some((cell) => "id" in cell && cell.id === pending.target),
    );
    if (pending.where === "beside") {
      const row = cellRows[at]!;
      const index = row.findIndex(
        (cell) => "id" in cell && cell.id === pending.target,
      );
      row.splice(index + 1, 0, { pending: true });
    } else {
      cellRows.splice(at + 1, 0, [{ pending: true }]);
    }
  }
  const columns = cellRows.some((row) => row.length > 1);
  useEffect(() => {
    onColumnsChange?.(columns);
  }, [columns, onColumnsChange]);

  /** A chat dragged from a dropdown onto a pane's right or lower half. */
  const drop = (id: string, target: ZenDropTarget): void => {
    setSplitAt(null);
    onShow({ target: target.pane, where: target.where }, id);
  };

  const pane = (id: string): ReactNode => {
    const session = byId.get(id);
    const focused = id === focusedId;
    const slot = ids.indexOf(id);
    return (
      <section
        key={id}
        data-zen-pane={id}
        data-zen-drop-pane={id}
        aria-label={chatTitle(session, cards.get(id))}
        onPointerDownCapture={() => {
          if (!focused) onFocusPane(id);
        }}
        className="relative flex min-h-0 min-w-0 flex-1 flex-col"
      >
        <ZenPaneHeader
          id={id}
          session={session}
          card={cards.get(id)}
          focused={focused && multi}
          marks={marks}
          chats={chats}
          byId={byId}
          shown={ids}
          projectItems={projectItems}
          onPick={(next) => {
            // Already in another pane: go there instead of showing it twice.
            if (next !== id && ids.includes(next)) onFocusPane(next);
            else onShow(slot, next);
          }}
          onNewChat={(cwd) => onNewChat(slot, cwd)}
          onClose={multi ? () => onClosePane(id) : undefined}
          fits={fits}
          onDrop={drop}
        />
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
        <ZenDropHint pane={id} fits={fits} />
      </section>
    );
  };

  const pendingCell = (at: { target: string; where: ZenPlace }): ReactNode => (
    <section
      key="pending"
      aria-label="New chat spot"
      className="flex min-h-0 min-w-0 flex-1 flex-col"
    >
      <div className="flex h-8 shrink-0 items-center gap-1 border-b border-stroke pr-1 pl-3 text-[12px] text-content/55">
        <span className="min-w-0 flex-1 truncate">Another chat</span>
        <button
          type="button"
          title="Cancel split"
          aria-label="Cancel split"
          onClick={() => setSplitAt(null)}
          className="grid size-6 shrink-0 place-items-center rounded-md text-content/45 hover:bg-content/10 hover:text-content"
        >
          <X aria-hidden className="size-3.5" strokeWidth={1.75} />
        </button>
      </div>
      <ZenChooser
        chats={chats}
        byId={byId}
        marks={marks}
        shown={ids}
        onPick={(id) => {
          setSplitAt(null);
          // Already showing: go there instead of showing it twice.
          if (ids.includes(id)) onFocusPane(id);
          else onShow(at, id);
        }}
        onNewChat={() => {
          setSplitAt(null);
          onNewChat(at);
        }}
      />
    </section>
  );

  const cell = (entry: ZenCell | undefined): ReactNode => {
    if (!entry) return null;
    if ("id" in entry) return pane(entry.id);
    return pending ? pendingCell(pending) : null;
  };
  const row = (index: number): ReactNode => {
    const cells = cellRows[index];
    if (!cells) return null;
    return (
      <ZenSplit
        name={index === 0 ? "chats-top" : "chats-bottom"}
        label="Resize chats side by side"
        beside
        accent
        top={cell(cells[0])}
        bottom={cells[1] ? cell(cells[1]) : null}
      />
    );
  };

  const chatArea =
    ids.length === 0 ? (
      <ZenChooser
        title="No chat open"
        chats={chats}
        byId={byId}
        marks={marks}
        shown={ids}
        onPick={(id) => onShow(0, id)}
        onNewChat={() => onNewChat(0)}
      />
    ) : (
      <ZenSplit
        name="chats"
        label="Resize chats"
        accent
        top={row(0)}
        bottom={cellRows[1] ? row(1) : null}
      />
    );

  const splitLabel =
    pending !== null
      ? "Cancel split"
      : ids.length >= ZEN_MAX_PANES
        ? "Zen shows four chats at most"
        : splitTarget?.where === "beside"
          ? "Add a chat beside"
          : "Add a chat below";
  const SplitIcon = splitTarget?.where === "beside" ? PanelRight : PanelBottom;

  return (
    <div data-zen-view className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header
        className="flex h-10 shrink-0 select-none items-center gap-1 border-b border-stroke pl-1.5"
        data-tauri-drag-region="deep"
      >
        {IS_MAC && trafficLightsVisible ? (
          <div className="w-[78px] shrink-0" />
        ) : null}
        <IconButton
          label={`Leave Zen mode (${MOD}${ALT}Z)`}
          active
          onClick={onExit}
        >
          <Target className="size-3.5" strokeWidth={1.75} />
        </IconButton>
        <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-stroke" />
        <div className="relative flex min-w-0 items-center gap-0.5">
          <SharedHoverHighlight />
          <ZenToolTabs tool={tool} onToolChange={onToolChange} />
          {showMonos && monos.length > 0 ? (
            <ZenMonoButtons
              monos={monos}
              openId={tool === "monos" ? monoId : null}
              onOpen={onOpenMono}
            />
          ) : null}
        </div>
        <div className="min-w-2 flex-1" />
        {tool === "chat" ? (
          <IconButton
            label={splitLabel}
            active={pending !== null}
            disabled={ids.length === 0 || (pending === null && !splitTarget)}
            onClick={() => setSplitAt(pending ? null : splitTarget)}
          >
            <SplitIcon className="size-3.5" strokeWidth={1.75} />
          </IconButton>
        ) : null}
        <IconButton
          label={pinned ? "Stop keeping on top" : "Keep on top"}
          active={pinned}
          onClick={onTogglePin}
        >
          {pinned ? (
            <PinOff className="size-3.5" strokeWidth={1.75} />
          ) : (
            <Pin className="size-3.5" strokeWidth={1.75} />
          )}
        </IconButton>
        <IconButton label="Settings (leaves Zen mode)" onClick={onOpenSettings}>
          <Settings className="size-3.5" strokeWidth={1.75} />
        </IconButton>
        {IS_MAC ? <div className="w-1.5 shrink-0" /> : <WindowControls />}
      </header>
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        {/* Chats stay mounted under a tool, so coming back finds them as left. */}
        <div
          className={
            tool === "chat" ? "flex min-h-0 min-w-0 flex-1 flex-col" : "hidden"
          }
          inert={tool !== "chat" || undefined}
        >
          {/* The terminals stay in this grid under a tool, so they keep
              running and come back as left. */}
          <div ref={dockGridRef} className="grid min-h-0 min-w-0 flex-1">
            {dock}
            <div
              className="flex min-h-0 min-w-0 flex-col"
              style={{ gridArea: "main" }}
            >
              {chatArea}
            </div>
          </div>
        </div>
        <ZenDragPreview />
        {/* A tool loading for the first time waits here, not by blanking
            the whole app (Notes and Automations load lazily). */}
        {tool === "chat" ? null : (
          <Suspense fallback={<div className="min-h-0 flex-1" />}>
            {renderTool(tool)}
          </Suspense>
        )}
      </div>
      {footer}
    </div>
  );
}

/** A Zen pane's bar: its project and a dropdown to show another chat. */
function ZenPaneHeader({
  id,
  session,
  card,
  focused,
  marks,
  chats,
  byId,
  shown,
  projectItems,
  onPick,
  onNewChat,
  onClose,
  fits,
  onDrop,
}: {
  id: string;
  session: Session | undefined;
  card: BoardCard | undefined;
  focused: boolean;
  marks: ProjectMarks;
  chats: readonly ZenChat[];
  byId: ReadonlyMap<string, Session>;
  /** Every chat in Zen now. */
  shown: readonly string[];
  projectItems: readonly FocusPickItem[];
  onPick: (sessionId: string) => void;
  onNewChat: (cwd?: string) => void;
  onClose?: () => void;
  /** Whether a dragged chat fits next to a pane. */
  fits: (target: string, where: ZenPlace, id?: string) => boolean;
  /** A chat dragged out of the dropdown, dropped next to a pane. */
  onDrop: (sessionId: string, target: ZenDropTarget) => void;
}): ReactNode {
  const dragging = useZenChatDrag() !== null;
  const [view, setView] = useState<
    "chats" | "projects" | "continue-projects" | "continue" | null
  >(null);
  const [continueCwd, setContinueCwd] = useState<string | null>(null);
  const anchor = useRef<HTMLButtonElement>(null);
  const title = chatTitle(session, card);
  const cwd = session?.cwd ?? card?.cwd;
  const open = view !== null;
  const byProject = useZenChatsByProject();
  // Built only while the dropdown is open: the lists change as chats stream.
  const items = useMemo(
    () =>
      open
        ? zenChatItems(chats, byId, marks, id, shown, byProject)
        : { all: [], recent: [] },
    [open, chats, byId, marks, id, shown, byProject],
  );
  const close = (restore: boolean): void => {
    setView(null);
    if (restore) anchor.current?.focus();
  };
  // Pressing a chat can drag it beside or below a pane; the dropdown steps aside.
  const dragOut = (
    item: FocusPickItem,
    event: Parameters<typeof startZenChatDrag>[0],
  ): void =>
    startZenChatDrag(
      event,
      item.id,
      item.label,
      (target, where) => fits(target, where, item.id),
      (target) => {
        close(false);
        onDrop(item.id, target);
      },
    );
  return (
    <header
      data-zen-pane-header
      className={`flex h-8 shrink-0 select-none items-center gap-1.5 border-b border-stroke pr-1 pl-2 text-[12px] transition-colors duration-100 ${
        focused
          ? "bg-[color-mix(in_srgb,var(--user-accent-color,var(--color-accent))_8%,transparent)]"
          : ""
      }`}
    >
      {cwd ? (
        <span className="flex min-w-0 max-w-[35%] shrink-0 text-content/55">
          <ProjectMark cwd={cwd} {...marks} />
        </span>
      ) : null}
      <SessionMetadataHover sessionId={id} title={title}>
        {(hover) => (
          <button
            {...hover.anchorProps}
            ref={anchor}
            type="button"
            aria-haspopup="dialog"
            aria-expanded={open}
            title="Show another chat"
            onClick={() => (view ? close(false) : setView("chats"))}
            className={`flex h-6 min-w-0 flex-1 items-center gap-1 rounded-md px-1.5 text-left transition-colors duration-100 hover:bg-content/8 ${
              view
                ? "bg-content/8 text-content"
                : "text-content/80 hover:text-content"
            }`}
          >
            <span className="min-w-0 flex-1 truncate">{title}</span>
            <ChevronDown
              aria-hidden
              className={`size-3 shrink-0 text-content/45 transition-transform duration-150 ease-out motion-reduce:transition-none ${
                view ? "rotate-180" : ""
              }`}
              strokeWidth={1.75}
            />
          </button>
        )}
      </SessionMetadataHover>
      {onClose ? (
        <button
          type="button"
          aria-label={`Remove ${title} from Zen`}
          title="Remove from Zen"
          onClick={onClose}
          className="grid size-6 shrink-0 place-items-center rounded-md text-content/45 hover:bg-content/10 hover:text-content"
        >
          <X aria-hidden className="size-3.5" strokeWidth={1.75} />
        </button>
      ) : null}
      {view ? (
        <Popover
          anchor={anchor}
          side="bottom"
          align="start"
          width={300}
          maxHeight={460}
          onDismiss={(reason) => close(reason === "escape")}
          role="dialog"
          aria-label={
            view === "chats"
              ? "Show a chat"
              : view === "projects"
                ? "New chat in a project"
                : "Continue a chat"
          }
          className={`flex flex-col overflow-hidden transition-opacity duration-100 motion-reduce:transition-none ${
            dragging ? "pointer-events-none opacity-0" : ""
          }`}
        >
          {view === "continue" && continueCwd ? (
            <>
              <ZenBackRow
                label={`Chats in ${projectName(continueCwd)}`}
                onBack={() => setView("continue-projects")}
              />
              <ProjectChatList
                className="h-[340px]"
                cwd={continueCwd}
                exclude={new Set([id])}
                marks={marks}
                onChatPointerDown={dragOut}
                onPick={(next) => {
                  close(false);
                  onPick(next);
                }}
              />
            </>
          ) : view === "chats" ? (
            <FocusSearchList
              className="h-[340px]"
              items={items.all}
              idleItems={items.recent}
              groupDividers={byProject}
              label="Chats"
              placeholder="Search all chats"
              emptyLabel={
                items.all.length > 0 ? "No matching chats" : "No recent chats"
              }
              onChatPointerDown={dragOut}
              onPick={(next) => {
                // The pane's own chat (L-256): already showing, just close.
                close(next === id);
                if (next !== id) onPick(next);
              }}
              actions={
                <>
                  <ZenGroupToggle />
                  <button
                    type="button"
                    aria-label="New chat in a project"
                    title="New chat in a project"
                    onClick={() => setView("projects")}
                    className={SEARCH_ACTION}
                  >
                    <Plus aria-hidden className="size-3.5" strokeWidth={1.75} />
                  </button>
                  <button
                    type="button"
                    aria-label="Continue a chat in a project"
                    title="Continue a chat in a project"
                    onClick={() => setView("continue-projects")}
                    className={SEARCH_ACTION}
                  >
                    <MessageSquare
                      aria-hidden
                      className="size-3.5"
                      strokeWidth={1.75}
                    />
                  </button>
                </>
              }
            />
          ) : (
            <>
              <ZenBackRow
                label={
                  view === "projects" ? "New chat in…" : "Continue a chat in…"
                }
                onBack={() => setView("chats")}
              />
              <FocusSearchList
                className="h-[320px]"
                items={focusProjectsActiveFirst(
                  projectItems,
                  [
                    ...(cwd ? [cwd] : []),
                    ...items.recent.flatMap((item) =>
                      item.project ? [item.project.cwd] : [],
                    ),
                  ],
                  marks,
                )}
                label="Projects"
                placeholder="Search projects"
                emptyLabel="No projects"
                onPick={(path) => {
                  if (view === "projects") {
                    close(false);
                    onNewChat(path);
                    return;
                  }
                  setContinueCwd(path);
                  setView("continue");
                }}
              />
            </>
          )}
        </Popover>
      ) : null}
    </header>
  );
}

/**
 * Where a chat dragged out of a dropdown can land on this pane (L-230): a
 * faint outline while it fits here, and the half under the pointer (right:
 * beside, lower: below) filled in the accent.
 */
function ZenDropHint({
  pane,
  fits,
}: {
  pane: string;
  fits: (target: string, where: ZenPlace, id?: string) => boolean;
}): ReactNode {
  const drag = useZenChatDrag();
  if (!drag) return null;
  if (!fits(pane, "beside", drag.id) && !fits(pane, "below", drag.id))
    return null;
  const where = drag.over?.pane === pane ? drag.over.where : null;
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-20">
      <div className="absolute inset-1 rounded-lg border border-dashed border-content/20" />
      {where ? (
        <div
          className={`absolute grid place-items-center rounded-lg border border-dashed text-[12px] font-medium text-content ${
            where === "beside"
              ? "top-1 right-1 bottom-1 w-[calc(50%-4px)]"
              : "right-1 bottom-1 left-1 h-[calc(50%-4px)]"
          }`}
          style={{
            borderColor: ACCENT,
            backgroundColor: `color-mix(in srgb, ${ACCENT} 18%, transparent)`,
          }}
        >
          {where === "beside" ? "Open beside" : "Open below"}
        </div>
      ) : null}
    </div>
  );
}

/** The dragged chat's name, beside the pointer. */
function ZenDragPreview(): ReactNode {
  const drag = useZenChatDrag();
  if (!drag) return null;
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed top-0 left-0 z-[1000] max-w-[220px] truncate rounded-md border border-stroke bg-surface px-2 py-1 text-[12px] text-content shadow-lg"
      style={{ translate: `${drag.x + 12}px ${drag.y + 10}px` }}
    >
      {drag.label}
    </div>
  );
}

/** The search row's New chat and Continue buttons. */
const SEARCH_ACTION =
  "grid size-6 shrink-0 place-items-center rounded-md text-content/55 transition-[background-color,color,scale] duration-100 hover:bg-content/8 hover:text-content focus-visible:bg-content/8 focus-visible:outline-none active:scale-96 motion-reduce:active:scale-100";

/** A dropdown's back row, above a list opened from its menu. */
function ZenBackRow({
  label,
  onBack,
}: {
  label: string;
  onBack: () => void;
}): ReactNode {
  return (
    <div className="flex h-8 shrink-0 items-center gap-1 border-b border-stroke px-1">
      <button
        type="button"
        aria-label="Back"
        title="Back"
        onClick={onBack}
        className="grid size-6 shrink-0 place-items-center rounded-md text-content/55 hover:bg-content/8 hover:text-content"
      >
        <ChevronLeft aria-hidden className="size-3.5" strokeWidth={1.75} />
      </button>
      <span className="min-w-0 truncate text-[12px] font-medium text-content/70">
        {label}
      </span>
    </div>
  );
}

/**
 * Chat, Tasks, Notes and Automations as one tab group: the selected fill
 * slides to the picked tab (200ms; instant with Reduce motion).
 */
function ZenToolTabs({
  tool,
  onToolChange,
}: {
  tool: ZenTool;
  onToolChange: (tool: ZenTool) => void;
}): ReactNode {
  const tabs = useRef(new Map<ZenTool, HTMLButtonElement>());
  const [thumb, setThumb] = useState<{
    x: number;
    width: number;
    shown: boolean;
    glide: boolean;
  } | null>(null);
  useLayoutEffect(() => {
    const tab = tabs.current.get(tool);
    setThumb((prev) =>
      tab
        ? {
            x: tab.offsetLeft,
            width: tab.offsetWidth,
            shown: true,
            // The first placement (and a return from a Mono) does not slide.
            glide: prev?.shown === true,
          }
        : prev && { ...prev, shown: false, glide: false },
    );
  }, [tool]);
  return (
    <div
      role="tablist"
      aria-label="Zen tools"
      className="relative flex shrink-0 items-center gap-0.5"
    >
      {thumb ? (
        <span
          aria-hidden
          className={`pointer-events-none absolute top-0 left-0 h-6 rounded-md bg-selection ${
            thumb.glide
              ? "transition-[translate,width] duration-200 ease-out motion-reduce:transition-none"
              : ""
          } ${thumb.shown ? "" : "hidden"}`}
          style={{ width: thumb.width, translate: `${thumb.x}px 0` }}
        />
      ) : null}
      {TOOLS.map(({ id, label, Icon }) => {
        const selected = id === tool;
        return (
          <button
            key={id}
            ref={(node) => {
              if (node) tabs.current.set(id, node);
              else tabs.current.delete(id);
            }}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-label={label}
            title={label}
            data-shared-hover-item
            data-shared-hover-preserve={selected ? "" : undefined}
            data-tauri-drag-region="false"
            onClick={() => onToolChange(id)}
            className={`relative grid size-6 place-items-center rounded-md transition-colors duration-150 ${
              selected ? "text-content" : "text-content/50 hover:text-content"
            }`}
          >
            <Icon aria-hidden className="size-3.5" strokeWidth={1.75} />
          </button>
        );
      })}
    </div>
  );
}

/**
 * Mono buttons after a divider (L-230): the first three as mascots, the rest
 * under More. Each opens that Mono's chat across the panel.
 */
function ZenMonoButtons({
  monos,
  openId,
  onOpen,
}: {
  monos: readonly ZenMonoEntry[];
  openId: string | null;
  onOpen: (monoId: string) => void;
}): ReactNode {
  const [moreOpen, setMoreOpen] = useState(false);
  const more = useRef<HTMLButtonElement>(null);
  const shown = monos.slice(0, ZEN_MONO_BUTTONS);
  const rest = monos.slice(ZEN_MONO_BUTTONS);
  const restOpen = rest.some((entry) => entry.mono.id === openId);
  const button = ({ mono, look }: ZenMonoEntry) => {
    const selected = mono.id === openId;
    return (
      <button
        key={mono.id}
        type="button"
        aria-label={`${look.name} chat`}
        aria-pressed={selected}
        title={look.name}
        data-shared-hover-item
        data-shared-hover-preserve={selected ? "" : undefined}
        data-tauri-drag-region="false"
        onClick={() => onOpen(mono.id)}
        className={`relative grid size-6 shrink-0 place-items-center rounded-md transition-colors duration-150 ${
          selected ? "bg-selection" : ""
        }`}
      >
        <MonoRailMascot name={look.mascot} color={look.color} className="size-4" />
      </button>
    );
  };
  return (
    <>
      <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-stroke" />
      <div role="group" aria-label="Monos" className="flex min-w-0 items-center gap-0.5 overflow-hidden">
        {shown.map(button)}
        {rest.length > 0 ? (
          <button
            ref={more}
            type="button"
            aria-label={`${rest.length} more Monos`}
            aria-haspopup="menu"
            aria-expanded={moreOpen}
            title="More Monos"
            data-shared-hover-item
            data-shared-hover-preserve={restOpen ? "" : undefined}
            data-tauri-drag-region="false"
            onClick={() => setMoreOpen((open) => !open)}
            className={`relative grid size-6 shrink-0 place-items-center rounded-md transition-colors duration-150 ${
              restOpen || moreOpen
                ? "bg-selection text-content"
                : "text-content/50 hover:text-content"
            }`}
          >
            <MoreHorizontal aria-hidden className="size-3.5" strokeWidth={1.75} />
          </button>
        ) : null}
      </div>
      {moreOpen ? (
        <Popover
          anchor={more}
          side="bottom"
          align="start"
          width={220}
          maxHeight={320}
          onDismiss={(reason) => {
            setMoreOpen(false);
            if (reason === "escape") more.current?.focus();
          }}
          role="menu"
          aria-label="More Monos"
          className="overflow-y-auto p-1"
        >
          {rest.map(({ mono, look }) => (
            <button
              key={mono.id}
              type="button"
              role="menuitem"
              onClick={() => {
                setMoreOpen(false);
                onOpen(mono.id);
              }}
              className={`${MENU_ROW} ${mono.id === openId ? "bg-selection text-content" : ""}`}
            >
              <MonoRailMascot name={look.mascot} color={look.color} className="size-4 shrink-0" />
              <span className="min-w-0 truncate">{look.name}</span>
            </button>
          ))}
        </Popover>
      ) : null}
    </>
  );
}

/** Picks a chat for an empty spot: New chat, or one from the recent list. */
function ZenChooser({
  title,
  chats,
  byId,
  marks,
  shown,
  onPick,
  onNewChat,
}: {
  title?: string;
  chats: readonly ZenChat[];
  byId: ReadonlyMap<string, Session>;
  marks: ProjectMarks;
  /** Every chat in Zen now. */
  shown: readonly string[];
  onPick: (sessionId: string) => void;
  onNewChat: () => void;
}): ReactNode {
  const byProject = useZenChatsByProject();
  const items = useMemo(
    () => zenChatItems(chats, byId, marks, undefined, shown, byProject),
    [chats, byId, marks, shown, byProject],
  );
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-col items-start gap-2 px-3 py-3">
        {title ? <p className="text-[13px] text-content/55">{title}</p> : null}
        <button
          type="button"
          onClick={onNewChat}
          className="inline-flex h-7 items-center gap-1.5 rounded-md bg-content/6 px-2.5 text-[12px] font-medium text-content/80 transition-[background-color,color,scale] duration-100 hover:bg-content/10 hover:text-content active:scale-96 motion-reduce:active:scale-100"
        >
          <Plus aria-hidden className="size-3.5" strokeWidth={1.75} />
          New chat
        </button>
      </div>
      <FocusSearchList
        className="min-h-0 flex-1 border-t border-stroke"
        items={items.all}
        idleItems={items.recent}
        groupDividers={byProject}
        label="Chats"
        placeholder="Search all chats"
        emptyLabel={
          items.all.length > 0 ? "No matching chats" : "No recent chats"
        }
        actions={<ZenGroupToggle />}
        autoFocus={false}
        onPick={onPick}
      />
    </div>
  );
}

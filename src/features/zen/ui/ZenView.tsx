import {
  Suspense,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
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
  MessageSquare,
  MoreHorizontal,
  PanelBottom,
  Pin,
  PinOff,
  Plus,
  Target,
  X,
  Zap,
} from "../../../shared/ui/icons";
import {
  focusChatInfo,
  focusContinueItems,
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
import {
  sessionDisplayTitle,
  type Session,
} from "../../sessions/model/session";
import { SharedHoverHighlight } from "../../sessions/ui/SharedHoverHighlight";
import { SessionMetadataHover } from "../../sessions/ui/SessionMetadataHoverCard";
import { startZenChatDrag, useZenChatDrag } from "../model/zenChatDrag";
import { ZEN_MAX_PANES, type ZenTool } from "../model/zenPanes";
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

function chatTitle(session: Session | undefined, card?: BoardCard): string {
  if (session)
    return sessionDisplayTitle(session.title, session.harness) || "New session";
  return card?.title || "Chat";
}

/** Running chats first (newest first), then Focus's Continue groups. */
function chatItems(
  runningIds: readonly string[],
  byId: ReadonlyMap<string, Session>,
  cards: ReadonlyMap<string, BoardCard>,
  boardCards: readonly BoardCard[],
  marks: ProjectMarks,
  except: string | undefined,
): FocusPickItem[] {
  const running: FocusPickItem[] = runningIds.flatMap((id) => {
    const session = byId.get(id);
    if (!session || id === except) return [];
    return [
      {
        id,
        label: chatTitle(session),
        detail: projectName(session.cwd),
        icon: <ProjectIcon cwd={session.cwd} {...marks} />,
        group: "Running",
        project: { key: projectKey(session.cwd), cwd: session.cwd },
        chat: focusChatInfo({
          ...session,
          updatedAt: cards.get(id)?.updatedAt,
        }),
      },
    ];
  });
  const shown = new Set(runningIds);
  if (except) shown.add(except);
  return [
    ...running,
    ...focusContinueItems(
      boardCards,
      (id) => shown.has(id),
      marks,
      (id) => byId.get(id)?.providerAccountId,
    ),
  ];
}

export type ZenViewProps = {
  /** Zen's chats, top first (one or two). */
  ids: readonly string[];
  sessions: readonly Session[];
  boardCards: readonly BoardCard[];
  recents: readonly RecentProject[];
  /** Running chats Zen can show, newest first. */
  runningIds: readonly string[];
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
  /** Shows a chat in pane `slot` (0 top, 1 bottom; 1 adds the second pane). */
  onShow: (slot: number, sessionId: string) => void;
  /** A new chat in pane `slot`, in `cwd` or the pane's own project. */
  onNewChat: (slot: number, cwd?: string) => void;
  /** Takes a chat out of Zen (the other pane fills the panel). */
  onClosePane: (sessionId: string) => void;
  onExit: () => void;
  /** App's hidden mounts (project terminals) that must stay attached. */
  keepMounted?: ReactNode;
};

/**
 * Zen mode (fork, L-230): the window as a narrow panel beside other apps.
 * One chat, or two stacked; Tasks, Notes, Automations and Monos in slim
 * layouts from the top bar.
 */
export function ZenView({
  ids,
  sessions,
  boardCards,
  recents,
  runningIds,
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
  onExit,
  keepMounted,
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
  // Split waits for the second chat to be picked; it ends once there is one.
  const [splitPending, setSplitPending] = useState(false);
  const pending = splitPending && ids.length === 1;
  const split = ids.length >= ZEN_MAX_PANES || pending;

  const toggleSplit = () => {
    if (ids.length >= ZEN_MAX_PANES) onClosePane(ids[1]!);
    else setSplitPending(!pending);
  };

  const pane = (id: string, slot: number) => {
    const session = byId.get(id);
    const focused = id === focusedId;
    return (
      <section
        key={id}
        data-zen-pane={id}
        aria-label={chatTitle(session, cards.get(id))}
        onPointerDownCapture={() => {
          if (!focused) onFocusPane(id);
        }}
        className="flex min-h-0 min-w-0 flex-1 flex-col"
      >
        <ZenPaneHeader
          id={id}
          session={session}
          card={cards.get(id)}
          focused={focused && split}
          marks={marks}
          items={chatItems(runningIds, byId, cards, boardCards, marks, id)}
          projectItems={projectItems}
          onPick={(next) => {
            // Already in the other pane: go there instead of showing it twice.
            if (next !== id && ids.includes(next)) onFocusPane(next);
            else onShow(slot, next);
          }}
          onNewChat={(cwd) => onNewChat(slot, cwd)}
          onClose={split ? () => onClosePane(id) : undefined}
          onDropBelow={dropBelow}
        />
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          {slot === 1 ? <ZenDropBelow label="Show here" className="inset-0" /> : null}
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
      </section>
    );
  };

  /** A chat dragged from a dropdown onto the lower half: the second chat. */
  const dropBelow = (next: string): void => {
    setSplitPending(false);
    onShow(1, next);
  };

  const chats =
    ids.length === 0 ? (
      <ZenChooser
        title="No running chats"
        items={chatItems(runningIds, byId, cards, boardCards, marks, undefined)}
        onPick={(id) => onShow(0, id)}
        onNewChat={() => onNewChat(0)}
      />
    ) : (
      <ZenSplit
        name="chats"
        label="Resize chats"
        top={pane(ids[0]!, 0)}
        bottom={
          ids[1] ? (
            pane(ids[1], 1)
          ) : pending ? (
            <>
              <div className="flex h-8 shrink-0 items-center gap-1 border-b border-stroke pl-3 pr-1.5 text-[12px] text-content/55">
                <span className="min-w-0 flex-1 truncate">Second chat</span>
                <button
                  type="button"
                  title="Cancel split"
                  aria-label="Cancel split"
                  onClick={() => setSplitPending(false)}
                  className="grid size-6 shrink-0 place-items-center rounded-md text-content/45 hover:bg-content/10 hover:text-content"
                >
                  <X className="size-3.5" strokeWidth={1.75} />
                </button>
              </div>
              <ZenChooser
                items={chatItems(runningIds, byId, cards, boardCards, marks, ids[0])}
                onPick={(id) => {
                  setSplitPending(false);
                  onShow(1, id);
                }}
                onNewChat={() => {
                  setSplitPending(false);
                  onNewChat(1);
                }}
              />
            </>
          ) : null
        }
      />
    );

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
            label={ids.length >= ZEN_MAX_PANES ? "Show one chat" : "Split into two chats"}
            active={split}
            disabled={ids.length === 0}
            onClick={toggleSplit}
          >
            <PanelBottom className="size-3.5" strokeWidth={1.75} />
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
        {IS_MAC ? <div className="w-1.5 shrink-0" /> : <WindowControls />}
      </header>
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        {/* Chats stay mounted under a tool, so coming back finds them as left. */}
        <div
          className={tool === "chat" ? "flex min-h-0 min-w-0 flex-1 flex-col" : "hidden"}
          inert={tool !== "chat" || undefined}
        >
          {chats}
          {tool === "chat" && ids.length === 1 ? (
            <ZenDropBelow
              label="Open below"
              className="inset-x-0 bottom-0 h-1/2"
            />
          ) : null}
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
      {keepMounted ? <div className="hidden">{keepMounted}</div> : null}
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
  items,
  projectItems,
  onPick,
  onNewChat,
  onClose,
  onDropBelow,
}: {
  id: string;
  session: Session | undefined;
  card: BoardCard | undefined;
  focused: boolean;
  marks: ProjectMarks;
  items: readonly FocusPickItem[];
  projectItems: readonly FocusPickItem[];
  onPick: (sessionId: string) => void;
  onNewChat: (cwd?: string) => void;
  onClose?: () => void;
  /** A chat dragged out of the dropdown, dropped on the lower half. */
  onDropBelow: (sessionId: string) => void;
}): ReactNode {
  const dragging = useZenChatDrag() !== null;
  const [view, setView] = useState<
    "chats" | "projects" | "continue-projects" | "continue" | null
  >(null);
  const [continueCwd, setContinueCwd] = useState<string | null>(null);
  const anchor = useRef<HTMLButtonElement>(null);
  const title = chatTitle(session, card);
  const cwd = session?.cwd ?? card?.cwd;
  const close = (restore: boolean) => {
    setView(null);
    if (restore) anchor.current?.focus();
  };
  // Pressing a chat can drag it to the lower half; the dropdown steps aside.
  const dragOut = (
    item: FocusPickItem,
    event: Parameters<typeof startZenChatDrag>[0],
  ): void =>
    startZenChatDrag(event, item.id, item.label, (next) => {
      close(false);
      onDropBelow(next);
    });
  return (
    <header
      data-zen-pane-header
      className={`flex h-8 shrink-0 select-none items-center gap-1.5 border-b border-stroke pr-1 pl-2 text-[12px] transition-colors duration-100 ${
        focused ? "bg-content/5" : ""
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
            aria-expanded={view !== null}
            title="Show another chat"
            onClick={() => (view ? close(false) : setView("chats"))}
            className={`flex h-6 min-w-0 flex-1 items-center gap-1 rounded-md px-1.5 text-left transition-colors duration-100 hover:bg-content/8 ${
              view ? "bg-content/8 text-content" : "text-content/80 hover:text-content"
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
              items={items}
              label="Chats"
              placeholder="Search chats"
              emptyLabel="No other chats"
              onChatPointerDown={dragOut}
              onPick={(next) => {
                close(false);
                onPick(next);
              }}
              actions={
                <>
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
                    <MessageSquare aria-hidden className="size-3.5" strokeWidth={1.75} />
                  </button>
                </>
              }
            />
          ) : (
            <>
              <ZenBackRow
                label={view === "projects" ? "New chat in…" : "Continue a chat in…"}
                onBack={() => setView("chats")}
              />
              <FocusSearchList
                className="h-[320px]"
                items={focusProjectsActiveFirst(
                  projectItems,
                  [
                    ...(cwd ? [cwd] : []),
                    ...items.flatMap((item) =>
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

/** Where a chat dragged out of a dropdown can land (L-230). */
function ZenDropBelow({
  label,
  className,
}: {
  label: string;
  className: string;
}): ReactNode {
  const drag = useZenChatDrag();
  if (!drag) return null;
  return (
    <div
      data-zen-drop-below
      className={`absolute z-20 m-1.5 grid place-items-center rounded-lg border border-dashed text-[12px] font-medium transition-colors duration-100 ${className} ${
        drag.over
          ? "border-accent bg-accent/20 text-content"
          : "border-content/25 bg-surface/70 text-content/60"
      }`}
    >
      {label}
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

/** Picks a chat for an empty pane: New chat, or one from the list. */
function ZenChooser({
  title,
  items,
  onPick,
  onNewChat,
}: {
  title?: string;
  items: readonly FocusPickItem[];
  onPick: (sessionId: string) => void;
  onNewChat: () => void;
}): ReactNode {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-col items-start gap-2 px-3 py-3">
        {title ? (
          <p className="text-[13px] text-content/55">{title}</p>
        ) : null}
        <button
          type="button"
          onClick={onNewChat}
          className="inline-flex h-7 items-center gap-1.5 rounded-md bg-content/6 px-2.5 text-[12px] font-medium text-content/80 transition-[background-color,color,scale] duration-100 hover:bg-content/10 hover:text-content active:scale-96 motion-reduce:active:scale-100"
        >
          <Plus aria-hidden className="size-3.5" strokeWidth={1.75} />
          New chat
        </button>
      </div>
      {items.length > 0 ? (
        <FocusSearchList
          className="min-h-0 flex-1 border-t border-stroke"
          items={items}
          label="Chats"
          placeholder="Search chats"
          emptyLabel="No chats"
          autoFocus={false}
          onPick={onPick}
        />
      ) : null}
    </div>
  );
}

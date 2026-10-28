import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { GlassBackdrop } from "../../../app/shell/GlassBackdrop";
import { MOD, SHIFT } from "../../../platform/tauri/platform";
import { Loader, PanelRight, Pencil, Sparkles, X } from "../../../shared/ui/icons";
import { ResizeHandle } from "../../../shared/ui/ResizeHandle";
import type { Block, Session } from "../model/session";
import { requestSessionMetadataEdit } from "../model/sessionMetadata";
import {
  clampPanelWidth,
  editBookmark,
  editPoint,
  EMPTY_SESSION_PANEL,
  loadSessionPanelView,
  removeBookmark,
  removePoint,
  saveSessionPanelView,
  SESSION_PANEL_MAX_WIDTH,
  SESSION_PANEL_MIN_WIDTH,
  SESSION_PANEL_TABS,
  sessionFileTouches,
  sessionPanelSnapshot,
  subscribeSessionPanel,
  subscribeSessionPanelView,
  updateSessionPanel,
  type SessionPanelData,
  type SessionPanelTab,
  type SessionPanelView,
} from "../model/sessionPanel";
import { AgentMarkdown } from "./AgentMarkdown";
import {
  sessionPanelUpdating,
  updateSessionPanelWithAi,
} from "./SessionMetadataAutoWriter";
import {
  BookmarkRow,
  FileRow,
  LeftOffCard,
  PanelRow,
  PointIcon,
  POINT_LOOK,
  type RowLink,
} from "./SessionPanelItems";
import { useSessionMetadata } from "./useSessionMetadata";

/**
 * Session panel (fork, L-191): a glass panel docked on the right of a chat
 * pane. Timeline, Decisions, Files, Notes and Bookmarks; rows jump to their
 * message. Below `DOCK_MIN_CHAT` of room for the chat it folds into a button
 * that opens it over the chat instead.
 */
const TAB_LABEL: Record<SessionPanelTab, string> = {
  timeline: "Timeline",
  decisions: "Decisions",
  files: "Files",
  notes: "Notes",
  bookmarks: "Bookmarks",
};
const DOCK_MIN_CHAT = 440;
const DEFAULT_WIDTH = 320;
const NOT_LOADED = { data: EMPTY_SESSION_PANEL, loaded: false };

export function useSessionPanelView(): SessionPanelView {
  return useSyncExternalStore(subscribeSessionPanelView, loadSessionPanelView, loadSessionPanelView);
}

function useSessionPanelData(sessionId: string): { data: SessionPanelData; loaded: boolean } {
  const subscribe = useCallback(
    (listener: () => void) => subscribeSessionPanel(sessionId, listener),
    [sessionId],
  );
  return useSyncExternalStore(subscribe, () => sessionPanelSnapshot(sessionId), () => NOT_LOADED);
}

/** The first line of a message, for bookmarks saved without text. */
export function messageLine(block: Block | undefined): string {
  const line = block?.text.split("\n").map((part) => part.trim()).find(Boolean) ?? "";
  return line.length > 90 ? `${line.slice(0, 89)}…` : line;
}

type DockProps = {
  session: Session;
  /** The transcript as shown (with provider history), for links and files. */
  blocks: readonly Block[];
  title: string;
  /** The row the panel docks into; its width decides docked or folded. */
  row: React.RefObject<HTMLElement | null>;
  onNavigate: (blockId: string) => Promise<boolean>;
  onOpenFile: (path: string) => void;
};

/** Docks the panel when there is room, otherwise a button that opens it over the chat. */
export function SessionPanelDock(props: DockProps): ReactNode {
  const view = useSessionPanelView();
  const [rowWidth, setRowWidth] = useState(0);
  const [overlay, setOverlay] = useState(false);
  useEffect(() => {
    const row = props.row.current;
    if (!row) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setRowWidth(Math.round(entry.contentRect.width));
    });
    observer.observe(row);
    return () => observer.disconnect();
  }, [props.row]);
  if (!view.open) return null;
  const folded = rowWidth > 0 && rowWidth - view.width < DOCK_MIN_CHAT;
  if (!folded)
    return <SessionPanel {...props} view={view} onClose={() => saveSessionPanelView({ open: false })} />;
  if (!overlay)
    return (
      <button
        type="button"
        onClick={() => setOverlay(true)}
        title="Show the Session panel"
        aria-label="Show the Session panel"
        className="absolute right-2 top-2 z-20 isolate grid size-8 place-items-center overflow-hidden rounded-lg border border-content/10 text-content/60 shadow-xl transition-colors duration-100 hover:text-content focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
      >
        <GlassBackdrop />
        <PanelRight aria-hidden className="relative z-[1] size-4" strokeWidth={1.75} />
      </button>
    );
  return (
    <div className="absolute inset-y-0 right-0 z-20 flex">
      <SessionPanel
        {...props}
        view={{ ...view, width: Math.min(view.width, Math.max(SESSION_PANEL_MIN_WIDTH, rowWidth - 16)) }}
        onClose={() => setOverlay(false)}
      />
    </div>
  );
}

function SessionPanel({
  session,
  blocks,
  title,
  view,
  onNavigate,
  onOpenFile,
  onClose,
}: DockProps & { view: SessionPanelView; onClose: () => void }): ReactNode {
  const { data, loaded } = useSessionPanelData(session.id);
  const metadata = useSessionMetadata(session.id);
  const frame = useRef<HTMLElement>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [running, setRunning] = useState(() => sessionPanelUpdating(session.id));
  const tab = view.tab;

  const blocksById = useMemo(
    () => new Map(blocks.map((block) => [block.id, block])),
    [blocks],
  );
  const files = useMemo(
    () => (tab === "files" ? sessionFileTouches(blocks) : []),
    [tab, blocks],
  );
  const linkOf = (blockId: string | undefined): RowLink =>
    !blockId ? "none" : blocksById.has(blockId) ? "jump" : "earlier";

  useEffect(() => {
    setRunning(sessionPanelUpdating(session.id));
    setStatus(null);
  }, [session.id]);

  const jump = (blockId: string | undefined): void => {
    if (!blockId) return;
    setStatus(null);
    void onNavigate(blockId).then((found) => {
      if (!found) setStatus("That message isn't in the loaded chat.");
    });
  };
  const change = (update: (current: SessionPanelData) => SessionPanelData): void => {
    void updateSessionPanel(session.id, update).catch((error: unknown) =>
      setStatus(`Couldn't save: ${String(error)}`),
    );
  };
  const runAi = (): void => {
    if (running) return;
    setRunning(true);
    setStatus(null);
    void updateSessionPanelWithAi(session)
      .then((result) => {
        if (!result.ok) setStatus(result.message || null);
        else if (result.added === 0) setStatus("Nothing new since the last update.");
      })
      .catch((error: unknown) => setStatus(`Couldn't update: ${String(error)}`))
      .finally(() => setRunning(false));
  };
  const selectTab = (next: SessionPanelTab): void => saveSessionPanelView({ tab: next });
  const onTabKey = (event: KeyboardEvent<HTMLDivElement>): void => {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const index = SESSION_PANEL_TABS.indexOf(tab);
    const next = SESSION_PANEL_TABS[(index + step + SESSION_PANEL_TABS.length) % SESSION_PANEL_TABS.length]!;
    selectTab(next);
    event.currentTarget.querySelector<HTMLElement>(`[data-tab="${next}"]`)?.focus();
  };

  const points = [...data.points].reverse();
  const decisions = points.filter((point) => point.kind === "decision");
  const bookmarks = [...data.bookmarks].reverse();
  const busy = !!session.busy;

  const pointList = (list: typeof points, empty: ReactNode): ReactNode =>
    list.length === 0 ? (
      empty
    ) : (
      <ul role="list" className="flex flex-col gap-0.5">
        {list.map((point) => (
          <PanelRow
            key={point.id}
            icon={<PointIcon kind={point.kind} />}
            text={point.text}
            meta={`${POINT_LOOK[point.kind].label}${point.edited ? " · edited" : ""}`}
            link={linkOf(point.blockId)}
            editLabel="Edit point"
            onJump={() => jump(point.blockId)}
            onEdit={(text) => change((current) => editPoint(current, point.id, text))}
            onDelete={() => change((current) => removePoint(current, point.id))}
          />
        ))}
      </ul>
    );

  const aiEmpty = (what: string): ReactNode => (
    <EmptyState
      text={`No ${what} yet. Update with AI reads this chat and logs what happened, what was decided and what came up.`}
      action={
        <button
          type="button"
          onClick={runAi}
          disabled={running || busy}
          className="inline-flex h-7 items-center gap-1.5 rounded-md bg-content/10 px-2.5 text-xs text-content transition-colors duration-100 hover:bg-content/15 disabled:opacity-50"
        >
          <Sparkles aria-hidden className="size-3.5" />
          Update with AI
        </button>
      }
    />
  );

  let body: ReactNode;
  if (!loaded && (tab === "timeline" || tab === "decisions" || tab === "bookmarks"))
    body = (
      <ul aria-busy="true" aria-label="Loading" className="flex flex-col gap-2 px-2">
        {[0, 1, 2].map((key) => (
          <li key={key} className="h-9 rounded-lg bg-content/5 motion-safe:animate-pulse" />
        ))}
      </ul>
    );
  else if (tab === "timeline")
    body = (
      <div className="flex flex-col gap-2">
        {data.leftOff ? (
          <LeftOffCard
            text={data.leftOff.text}
            link={linkOf(data.leftOff.blockId)}
            onJump={() => jump(data.leftOff?.blockId)}
          />
        ) : null}
        {pointList(points, data.leftOff ? null : aiEmpty("timeline"))}
      </div>
    );
  else if (tab === "decisions")
    body = pointList(decisions, aiEmpty("decisions"));
  else if (tab === "files")
    body =
      files.length === 0 ? (
        <EmptyState text="No files edited in this chat yet." />
      ) : (
        <ul role="list" className="flex flex-col gap-0.5">
          {files.map((touch) => (
            <FileRow
              key={touch.path}
              touch={touch}
              cwd={session.cwd}
              link={linkOf(touch.lastBlockId)}
              onJump={() => jump(touch.lastBlockId)}
              onOpen={() => onOpenFile(touch.path)}
            />
          ))}
        </ul>
      );
  else if (tab === "notes")
    body = (
      <div className="flex flex-col gap-2">
        {metadata?.notes.trim() ? (
          <div className="px-1 text-[12px]">
            <AgentMarkdown text={metadata.notes} hardBreaks />
          </div>
        ) : (
          <EmptyState text="No notes yet. Notes are yours: write anything you want to keep for this chat." />
        )}
        <button
          type="button"
          onClick={() => requestSessionMetadataEdit(session.id, title)}
          className="inline-flex h-7 items-center gap-1.5 self-start rounded-md px-2 text-xs text-content/60 transition-colors duration-100 hover:bg-content/10 hover:text-content"
        >
          <Pencil aria-hidden className="size-3.5" strokeWidth={1.75} />
          Edit notes
        </button>
      </div>
    );
  else
    body =
      bookmarks.length === 0 ? (
        <EmptyState text="No bookmarks yet. Use the bookmark button under a reply to keep it here." />
      ) : (
        <ul role="list" className="flex flex-col gap-0.5">
          {bookmarks.map((bookmark) => (
            <BookmarkRow
              key={bookmark.id}
              bookmark={bookmark}
              fallback={messageLine(blocksById.get(bookmark.blockId)) || "Bookmarked message"}
              link={linkOf(bookmark.blockId)}
              onJump={() => jump(bookmark.blockId)}
              onEdit={(text) => change((current) => editBookmark(current, bookmark.id, text))}
              onDelete={() => change((current) => removeBookmark(current, bookmark.id))}
            />
          ))}
        </ul>
      );

  return (
    <aside
      ref={frame}
      aria-label="Session panel"
      style={{ width: view.width }}
      className="relative isolate my-2 mr-2 flex shrink-0 flex-col overflow-hidden rounded-xl border border-content/10 shadow-xl"
    >
      <GlassBackdrop />
      <ResizeHandle
        label="Resize Session panel"
        value={view.width}
        min={SESSION_PANEL_MIN_WIDTH}
        max={SESSION_PANEL_MAX_WIDTH}
        defaultValue={DEFAULT_WIDTH}
        placement="inset-y-0 left-0"
        reverse
        onLive={(width) => {
          if (frame.current) frame.current.style.width = `${width ?? view.width}px`;
        }}
        onCommit={(width) => saveSessionPanelView({ width: clampPanelWidth(width) })}
      />
      <div className="relative z-[1] flex min-h-0 flex-1 flex-col">
        <header className="flex shrink-0 items-center gap-1 px-3 pt-2.5 pb-1.5">
          <h2 className="min-w-0 flex-1 truncate text-[13px] font-semibold text-content">
            Session
          </h2>
          <button
            type="button"
            onClick={runAi}
            disabled={running || busy}
            title={
              running
                ? "Updating…"
                : busy
                  ? "Wait for the turn to finish"
                  : "Update with AI: log what is new in this chat"
            }
            aria-label="Update with AI"
            className="grid size-7 place-items-center rounded-md text-content/55 transition-colors duration-100 hover:bg-content/10 hover:text-content disabled:opacity-50 disabled:hover:bg-transparent"
          >
            {running ? (
              <Loader aria-hidden className="size-3.5 motion-safe:animate-spin" />
            ) : (
              <Sparkles aria-hidden className="size-3.5" />
            )}
          </button>
          <button
            type="button"
            onClick={onClose}
            title={`Close (${MOD}${SHIFT}O)`}
            aria-label="Close Session panel"
            className="grid size-7 place-items-center rounded-md text-content/55 transition-colors duration-100 hover:bg-content/10 hover:text-content"
          >
            <X aria-hidden className="size-3.5" />
          </button>
        </header>
        <div
          role="tablist"
          aria-label="Session panel views"
          onKeyDown={onTabKey}
          className="flex shrink-0 gap-0.5 overflow-x-auto px-2 pb-2 [scrollbar-width:none]"
        >
          {SESSION_PANEL_TABS.map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              data-tab={id}
              id={`session-panel-tab-${session.id}-${id}`}
              aria-selected={tab === id}
              aria-controls={`session-panel-body-${session.id}`}
              tabIndex={tab === id ? 0 : -1}
              onClick={() => selectTab(id)}
              className={`h-7 shrink-0 rounded-md px-2 text-xs transition-colors duration-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent ${
                tab === id
                  ? "bg-content/10 text-content"
                  : "text-content/50 hover:bg-content/5 hover:text-content/80"
              }`}
            >
              {TAB_LABEL[id]}
            </button>
          ))}
        </div>
        {status ? (
          <p role="status" className="mx-3 mb-2 shrink-0 text-[11px] leading-4 text-content/55">
            {status}
          </p>
        ) : null}
        <div
          role="tabpanel"
          id={`session-panel-body-${session.id}`}
          aria-labelledby={`session-panel-tab-${session.id}-${tab}`}
          className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-3"
        >
          {body}
        </div>
      </div>
    </aside>
  );
}

function EmptyState({ text, action }: { text: string; action?: ReactNode }): ReactNode {
  return (
    <div className="flex flex-col items-start gap-2.5 px-2 py-3">
      <p className="text-[12px] leading-[18px] text-content/50">{text}</p>
      {action}
    </div>
  );
}

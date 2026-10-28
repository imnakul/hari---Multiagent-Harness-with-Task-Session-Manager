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
import { Toggle } from "../../../shared/ui/Toggle";
import type { Block, Session } from "../model/session";
import {
  saveSessionMetadata,
  SESSION_LABEL_MAX,
  sessionMetadataError,
} from "../model/sessionMetadata";
import {
  autoNotesOn,
  notesSummary,
  setAutoNotes,
  subscribeAutoNotes,
  subscribeSessionMetadataAi,
} from "../model/sessionMetadataAi";
import {
  clampPanelWidth,
  editBookmark,
  EMPTY_SESSION_PANEL,
  loadSessionPanelView,
  removeBookmark,
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
import type { MarkdownViewMode } from "./MarkdownModeToggle";
import type { MarkdownCaretTarget } from "./markdownCaret";
import { MarkdownEditorPanel } from "./MarkdownEditorPanel";
import {
  rewriteSessionLabel,
  sessionLabelUpdating,
  sessionSummaryUpdating,
  setSummaryEditing,
  subscribeSummaryRuns,
  updateSessionSummary,
  type SummaryUpdateResult,
} from "./SessionMetadataAutoWriter";
import {
  BookmarkRow,
  FileRow,
  LeftOffCard,
  SummaryGroupRow,
  type RowLink,
} from "./SessionPanelItems";
import { useSessionMetadata } from "./useSessionMetadata";

/**
 * Session overview (fork, L-191; reworked in L-192): a glass panel docked on
 * the right of a chat pane. Header: the chat's label and Auto; tabs Summary
 * (the chat's AI notes, grouped by heading), Bookmarks and Files changed.
 * Below `DOCK_MIN_CHAT` of room for the chat it folds into a button that
 * opens it over the chat instead.
 */
const TAB_LABEL: Record<SessionPanelTab, string> = {
  summary: "Summary",
  bookmarks: "Bookmarks",
  files: "Files changed",
};
const DOCK_MIN_CHAT = 440;
const DEFAULT_WIDTH = 320;
const NOT_LOADED = { data: EMPTY_SESSION_PANEL, loaded: false };
const ICON_BUTTON =
  "grid size-7 shrink-0 place-items-center rounded-md text-content/55 transition-colors duration-100 hover:bg-content/10 hover:text-content focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent disabled:opacity-50 disabled:hover:bg-transparent";

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

function useAutoNotes(sessionId: string): boolean {
  const subscribe = useCallback((listener: () => void) => {
    const stopAuto = subscribeAutoNotes(listener);
    const stopSettings = subscribeSessionMetadataAi(listener);
    return () => {
      stopAuto();
      stopSettings();
    };
  }, []);
  return useSyncExternalStore(subscribe, () => autoNotesOn(sessionId), () => false);
}

function useRunning(sessionId: string): { summary: boolean; label: boolean } {
  const summary = useSyncExternalStore(
    subscribeSummaryRuns,
    () => sessionSummaryUpdating(sessionId),
    () => false,
  );
  const label = useSyncExternalStore(
    subscribeSummaryRuns,
    () => sessionLabelUpdating(sessionId),
    () => false,
  );
  return { summary, label };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
        title="Show the Session overview"
        aria-label="Show the Session overview"
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

/** The chat's label, saved on Enter or blur; its sparkle always rewrites it with AI. */
function LabelField({
  session,
  title,
  label,
  notes,
  running,
  onResult,
}: {
  session: Session;
  title: string;
  label: string;
  notes: string;
  running: boolean;
  onResult: (message: string | null) => void;
}): ReactNode {
  const [draft, setDraft] = useState(label);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setDraft(label);
  }, [label]);

  const commit = (): void => {
    const next = draft.trim();
    if (next === label.trim()) return;
    const invalid = sessionMetadataError(next, notes);
    if (invalid) {
      onResult(invalid);
      return;
    }
    void saveSessionMetadata(session.id, next, notes).catch((error: unknown) =>
      onResult(`Couldn't save the label: ${errorText(error)}`),
    );
  };
  const rewrite = (): void => {
    onResult(null);
    void rewriteSessionLabel(session)
      .then((result) => {
        if (!result.ok) onResult(result.message || null);
      })
      .catch((error: unknown) => onResult(`Couldn't write the label: ${errorText(error)}`));
  };

  return (
    <div className="relative min-w-0 flex-1">
      <input
        value={draft}
        maxLength={SESSION_LABEL_MAX}
        disabled={running}
        aria-label="Chat label"
        title="Shown in place of the chat title"
        placeholder={title || "Label"}
        autoComplete="off"
        onFocus={() => {
          focused.current = true;
        }}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          focused.current = false;
          commit();
        }}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Enter") event.currentTarget.blur();
          else if (event.key === "Escape") {
            setDraft(label);
            focused.current = false;
            requestAnimationFrame(() => event.currentTarget?.blur());
          }
        }}
        className="h-7 w-full rounded-md border border-transparent bg-transparent pl-2 pr-8 text-[13px] font-semibold text-content outline-none transition-colors duration-100 placeholder:font-normal placeholder:text-content/40 hover:border-content/10 focus:border-content/25 focus:bg-content/5 disabled:opacity-60"
      />
      <button
        type="button"
        onClick={rewrite}
        disabled={running || !!session.busy}
        title={running ? "Writing the label…" : "Write the label with AI"}
        aria-label="Write the label with AI"
        className={`absolute right-0.5 top-0.5 ${ICON_BUTTON} size-6`}
      >
        {running ? (
          <Loader aria-hidden className="size-3 motion-safe:animate-spin" />
        ) : (
          <Sparkles aria-hidden className="size-3" />
        )}
      </button>
    </div>
  );
}

/** The chat's notes as grouped Summary, or the in-panel editor. */
function SummaryTab({
  sessionId,
  label,
  notes,
  editing,
  onEdit,
  onDone,
  generate,
  generating,
  busy,
  onStatus,
}: {
  sessionId: string;
  label: string;
  notes: string;
  editing: boolean;
  onEdit: () => void;
  onDone: () => void;
  generate: () => void;
  generating: boolean;
  busy: boolean;
  onStatus: (message: string | null) => void;
}): ReactNode {
  const summary = useMemo(() => notesSummary(notes), [notes]);
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const [draft, setDraft] = useState(notes);
  const [mode, setMode] = useState<MarkdownViewMode>("live");
  const [saving, setSaving] = useState(false);
  const caret = useRef<MarkdownCaretTarget | null>(null);

  useEffect(() => setOpen(new Set()), [sessionId]);
  useEffect(() => {
    if (editing) setDraft(notes);
    // Only when the editor opens; later saves must not reset the draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  const toggle = (key: string): void =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  if (editing) {
    const save = (): void => {
      const invalid = sessionMetadataError(label, draft);
      if (invalid) {
        onStatus(invalid);
        return;
      }
      setSaving(true);
      void saveSessionMetadata(sessionId, label, draft)
        .then(onDone)
        .catch((error: unknown) => onStatus(`Couldn't save: ${errorText(error)}`))
        .finally(() => setSaving(false));
    };
    return (
      <div
        className="flex min-h-0 flex-col gap-2 px-1.5"
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            save();
          } else if (event.key === "Escape") {
            event.preventDefault();
            onDone();
          }
        }}
      >
        <div className="rounded-md border border-content/10">
          <MarkdownEditorPanel
            mode={mode}
            onModeChange={setMode}
            value={draft}
            onChange={setDraft}
            caretRef={caret}
            label="Summary Markdown"
            placeholder="**Heading (kind)**, then a point per line…"
            autoFocus
            lineNumbers={false}
            minHeightClass="min-h-48"
            paddingClass="py-2 pl-2.5 pr-2.5"
            sourceEndPadClass="pr-2.5"
            preview={<AgentMarkdown text={draft} hardBreaks />}
            emptyPreview={<p className="text-[12px] text-content/45">No summary</p>}
          />
        </div>
        <div className="flex items-center justify-end gap-1.5">
          <button
            type="button"
            onClick={onDone}
            className="h-7 rounded-md px-2.5 text-xs text-content/60 transition-colors duration-100 hover:bg-content/10 hover:text-content"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="h-7 rounded-md bg-accent px-2.5 text-xs text-white transition-[opacity,transform] duration-100 hover:opacity-90 active:scale-96 disabled:opacity-50"
          >
            Save
          </button>
        </div>
      </div>
    );
  }

  const editButton = (
    <button
      type="button"
      onClick={onEdit}
      disabled={generating}
      className="inline-flex h-7 items-center gap-1.5 self-start rounded-md px-2 text-xs text-content/60 transition-colors duration-100 hover:bg-content/10 hover:text-content disabled:opacity-50"
    >
      <Pencil aria-hidden className="size-3.5" strokeWidth={1.75} />
      {notes.trim() ? "Edit summary" : "Write my own"}
    </button>
  );

  if (!summary.leftOff && summary.groups.length === 0)
    return (
      <div className="flex flex-col items-start gap-2.5 px-2 py-3">
        <p className="text-[12px] leading-[18px] text-content/50">
          No summary yet. AI reads this chat and writes what was worked on, grouped by topic, plus
          where you left off.
        </p>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={generate}
            disabled={generating || busy}
            className="inline-flex h-7 items-center gap-1.5 rounded-md bg-content/10 px-2.5 text-xs text-content transition-colors duration-100 hover:bg-content/15 disabled:opacity-50"
          >
            {generating ? (
              <Loader aria-hidden className="size-3.5 motion-safe:animate-spin" />
            ) : (
              <Sparkles aria-hidden className="size-3.5" />
            )}
            Write summary
          </button>
          {editButton}
        </div>
      </div>
    );

  return (
    <div className="flex flex-col gap-2">
      {summary.leftOff ? (
        <div className="px-1.5">
          <LeftOffCard text={summary.leftOff} />
        </div>
      ) : null}
      {summary.groups.length > 0 ? (
        <ul role="list" className="flex flex-col gap-0.5">
          {summary.groups.map((group, index) => {
            const key = `${group.heading}\u0000${summary.groups.length - index}`;
            return (
              <SummaryGroupRow
                key={key}
                heading={group.heading}
                body={group.body}
                open={open.has(key)}
                onToggle={() => toggle(key)}
              />
            );
          })}
        </ul>
      ) : null}
      <div className="px-0.5">{editButton}</div>
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
  const autoOn = useAutoNotes(session.id);
  const running = useRunning(session.id);
  const frame = useRef<HTMLElement>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const tab = view.tab;
  const label = metadata?.label ?? "";
  const notes = metadata?.notes ?? "";

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
    setStatus(null);
    setEditing(false);
  }, [session.id]);
  // Auto waits while the Summary editor is open, so a save cannot drop its points.
  useEffect(() => {
    if (!editing) return;
    setSummaryEditing(session.id);
    return () => setSummaryEditing(null);
  }, [editing, session.id]);

  const jump = (blockId: string | undefined): void => {
    if (!blockId) return;
    setStatus(null);
    void onNavigate(blockId).then((found) => {
      if (!found) setStatus("That message isn't in the loaded chat.");
    });
  };
  const change = (update: (current: SessionPanelData) => SessionPanelData): void => {
    void updateSessionPanel(session.id, update).catch((error: unknown) =>
      setStatus(`Couldn't save: ${errorText(error)}`),
    );
  };
  const generate = (): void => {
    if (running.summary || editing) return;
    setStatus(null);
    if (tab !== "summary") saveSessionPanelView({ tab: "summary" });
    void updateSessionSummary(session)
      .then((result: SummaryUpdateResult) => {
        if (!result.ok) setStatus(result.message || null);
        else if (!result.added) setStatus("Nothing new since the last update.");
      })
      .catch((error: unknown) => setStatus(`Couldn't update: ${errorText(error)}`));
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

  const bookmarks = [...data.bookmarks].reverse();
  const busy = !!session.busy;

  let body: ReactNode;
  if (tab === "summary")
    body = (
      <SummaryTab
        sessionId={session.id}
        label={label}
        notes={notes}
        editing={editing}
        onEdit={() => {
          setStatus(null);
          setEditing(true);
        }}
        onDone={() => setEditing(false)}
        generate={generate}
        generating={running.summary}
        busy={busy}
        onStatus={setStatus}
      />
    );
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
  else if (!loaded)
    body = (
      <ul aria-busy="true" aria-label="Loading" className="flex flex-col gap-2 px-2">
        {[0, 1, 2].map((key) => (
          <li key={key} className="h-9 rounded-lg bg-content/5 motion-safe:animate-pulse" />
        ))}
      </ul>
    );
  else
    body =
      bookmarks.length === 0 ? (
        <EmptyState text="No bookmarks yet. Use the bookmark button under a reply, or select text in a reply and choose Bookmark." />
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
      aria-label="Session overview"
      style={{ width: view.width }}
      className="relative isolate my-2 mr-2 flex shrink-0 flex-col overflow-hidden rounded-xl border border-content/10 shadow-xl"
    >
      <GlassBackdrop />
      <ResizeHandle
        label="Resize Session overview"
        value={view.width}
        min={SESSION_PANEL_MIN_WIDTH}
        max={SESSION_PANEL_MAX_WIDTH}
        defaultValue={DEFAULT_WIDTH}
        placement="inset-y-0 left-0"
        reverse
        look="line"
        onLive={(width) => {
          if (frame.current) frame.current.style.width = `${width ?? view.width}px`;
        }}
        onCommit={(width) => saveSessionPanelView({ width: clampPanelWidth(width) })}
      />
      <div className="relative z-[1] flex min-h-0 flex-1 flex-col">
        <header className="flex shrink-0 items-center gap-1 px-2 pt-2 pb-1.5">
          <LabelField
            session={session}
            title={title}
            label={label}
            notes={notes}
            running={running.label}
            onResult={setStatus}
          />
          <label
            className="ml-1 flex shrink-0 items-center gap-1.5 text-[11px] text-content/55"
            title="A minute after each turn ends, AI adds what is new to the Summary. It writes the label only while the chat has none"
          >
            Auto
            <Toggle
              label="Auto summary for this chat"
              on={autoOn}
              onChange={(on) => setAutoNotes(session.id, on)}
            />
          </label>
          <button
            type="button"
            onClick={generate}
            disabled={running.summary || busy || editing}
            title={
              running.summary
                ? "Updating the summary…"
                : busy
                  ? "Wait for the turn to finish"
                  : editing
                    ? "Close the editor first"
                    : "Update the summary with AI"
            }
            aria-label="Update the summary with AI"
            className={ICON_BUTTON}
          >
            {running.summary ? (
              <Loader aria-hidden className="size-3.5 motion-safe:animate-spin" />
            ) : (
              <Sparkles aria-hidden className="size-3.5" />
            )}
          </button>
          <button
            type="button"
            onClick={onClose}
            title={`Close (${MOD}${SHIFT}O)`}
            aria-label="Close Session overview"
            className={ICON_BUTTON}
          >
            <X aria-hidden className="size-3.5" />
          </button>
        </header>
        <div
          role="tablist"
          aria-label="Session overview views"
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

function EmptyState({ text }: { text: string }): ReactNode {
  return (
    <div className="flex flex-col items-start gap-2.5 px-2 py-3">
      <p className="text-[12px] leading-[18px] text-content/50">{text}</p>
    </div>
  );
}

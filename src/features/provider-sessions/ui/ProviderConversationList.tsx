import { continueCostNote } from "../../providers/model/continueOnAccount";
import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
} from "react";
import {
  ExplorerMenu,
  type ExplorerMenuItem,
} from "../../files/ui/ExplorerMenu";
import { HarnessIcon } from "../../sessions/ui/HarnessIcon";
import { SessionCard } from "../../sessions/ui/SessionCard";
import { RemoteControlIndicator } from "./RemoteControlIndicator";
import {
  SessionListItem,
  type SessionInsertMotion,
} from "../../sessions/ui/SessionListItem";
import { Cloud, ListFilter, RefreshCw } from "../../../shared/ui/icons";
import type { Session } from "../../sessions/model/session";
import { conversationRemoteControl } from "../model/conversationRemoteControl";
import type { CloudSession } from "../model/cloudSessions";
import type { ProviderListState } from "../model/conversationStore";
import {
  conversationSummary,
  folderName,
  PROVIDER_LABEL,
} from "../model/conversationSummary";
import type {
  NativeProvider,
  ProviderConversation,
} from "../model/providerSessions";

type Props = {
  provider: NativeProvider;
  cloudOnly?: boolean;
  state: ProviderListState;
  showArchived: boolean;
  /** Key of the row being opened, if any. */
  openingKey: string | null;
  /** Failure from the last open/archive attempt. */
  actionError: string | null;
  /** Failure to refresh MonoCode-retained cloud task metadata. */
  cloudError?: string | null;
  cloudRefreshing?: boolean;
  activeSessionId?: string;
  sessions?: readonly Session[];
  remoteControlDesired?: ReadonlySet<string>;
  onShowArchivedChange: (value: boolean) => void;
  onRefresh: () => void;
  onLoadMore: () => void;
  onOpen: (row: ProviderConversation) => void;
  onArchive: (row: ProviderConversation, archived: boolean) => void;
  /** Other accounts a Claude row can be resumed on (fork L-102). */
  resumeOnAccounts?: readonly { id: string; label: string }[];
  onResumeOn?: (row: ProviderConversation, accountId: string) => void;
  onDismissActionError: () => void;
  /** Cloud tasks MonoCode launched for this provider. */
  cloudRecords?: readonly CloudSession[];
  onOpenCloud?: (record: CloudSession) => void;
  /** Stacking layer for menus when this list is rendered inside a dialog. */
  menuLayer?: number;
};

const SKELETON_ROWS = [0, 1, 2, 3];

function ListSkeleton({ label }: { label: string }): ReactElement {
  return (
    <ul aria-busy="true" aria-label={label} className="flex flex-col gap-0.5">
      {SKELETON_ROWS.map((row) => (
        <li
          key={row}
          className="mx-0.5 h-[66px] animate-pulse rounded-md bg-content/5"
        />
      ))}
    </ul>
  );
}

/**
 * Secondary-sidebar list of one provider's discovered local conversations.
 * Presentational: loading, paging and archive state come from the caller.
 */
export function ProviderConversationList({
  provider,
  cloudOnly = false,
  state,
  showArchived,
  openingKey,
  actionError,
  cloudError = null,
  cloudRefreshing = false,
  activeSessionId,
  sessions = [],
  remoteControlDesired = new Set(),
  onShowArchivedChange,
  onRefresh,
  onLoadMore,
  onOpen,
  onArchive,
  resumeOnAccounts = [],
  onResumeOn,
  onDismissActionError,
  cloudRecords = [],
  onOpenCloud,
  menuLayer,
}: Props): ReactElement {
  const label = PROVIDER_LABEL[provider];
  const motionScope = `provider:${provider}`;
  const motion = useRef<SessionInsertMotion>({ cwd: "", seen: new Set() });
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    key: string;
  } | null>(null);
  const [filterAnchor, setFilterAnchor] = useState<HTMLElement | null>(null);
  const [notesOpen, setNotesOpen] = useState(false);
  const filterButton = useRef<HTMLButtonElement>(null);
  const now = Date.now();
  const summaries = useMemo(
    () =>
      state.rows.map((row) => ({ row, summary: conversationSummary(row) })),
    [state.rows],
  );
  useLayoutEffect(() => {
    if (state.status !== "ready") return;
    const current = motion.current;
    if (current.cwd !== motionScope) {
      current.cwd = motionScope;
      current.seen = new Set(summaries.map(({ summary }) => summary.id));
    } else {
      for (const { summary } of summaries) current.seen.add(summary.id);
    }
  }, [motionScope, state.status, summaries]);
  const menuRow = menu
    ? state.rows.find((row) => row.key === menu.key)
    : undefined;
  const menuItems: ExplorerMenuItem[] = menuRow
    ? [
        { kind: "item", id: "open", label: "Open" },
        ...(onResumeOn && menuRow.provider === "claude"
          ? resumeOnAccounts
              .filter((account) => account.id !== menuRow.providerAccountId)
              .map(
                (account): ExplorerMenuItem => ({
                  kind: "item",
                  id: `resume-on:${account.id}`,
                  label: `Resume on ${account.label}`,
                  description: continueCostNote(account.label),
                }),
              )
          : []),
        { kind: "sep" },
        {
          kind: "item",
          id: "archive",
          label: menuRow.archived ? "Unarchive" : "Archive",
          description: `Hides it in MonoCode only. ${label} keeps the original.`,
        },
      ]
    : [];

  const onRowContextMenu = (
    key: string,
    event: ReactMouseEvent<HTMLButtonElement>,
  ): void => {
    event.preventDefault();
    event.stopPropagation();
    setMenu({ x: event.clientX, y: event.clientY, key });
  };

  const initialLoading = state.status === "idle" || state.status === "loading";
  const showEmpty = state.status === "ready" && state.rows.length === 0;
  const hasDiagnostics = state.diagnostics.length > 0;

  return (
    <div
      data-provider-conversation-list={provider}
      className="flex h-full min-h-0 min-w-0 flex-1 flex-col"
    >
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-content/10 px-3">
        <HarnessIcon harness={provider} className="size-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
          {label} {cloudOnly ? "cloud sessions" : "conversations"}
        </span>
        {!cloudOnly ? <button
          ref={filterButton}
          type="button"
          title="Filter conversations"
          aria-label="Filter conversations"
          aria-haspopup="menu"
          aria-expanded={filterAnchor !== null}
          onClick={(event) => setFilterAnchor(event.currentTarget)}
          className={`grid size-6 shrink-0 place-items-center rounded-md hover:bg-content/10 hover:text-content ${
            showArchived || filterAnchor
              ? "bg-selection text-content"
              : "text-content/50"
          }`}
        >
          <ListFilter className="size-3.5" />
        </button> : null}
        <button
          type="button"
          title={`Refresh ${label} ${cloudOnly ? "cloud sessions" : "conversations and cloud tasks"}`}
          aria-label={`Refresh ${label} ${cloudOnly ? "cloud sessions" : "conversations and cloud tasks"}`}
          disabled={
            state.refreshing || state.status === "loading" || cloudRefreshing
          }
          onClick={onRefresh}
          className="grid size-6 shrink-0 place-items-center rounded-md text-content/50 hover:bg-content/10 hover:text-content disabled:opacity-60"
        >
          <RefreshCw
            className={`size-3.5 ${
              state.refreshing || state.status === "loading" || cloudRefreshing
                ? "animate-spin motion-reduce:animate-none"
                : ""
            }`}
          />
        </button>
      </div>
      <div className="sr-only" role="status" aria-live="polite">
        {state.refreshing || cloudRefreshing
          ? `Refreshing ${label} conversations and cloud tasks`
          : ""}
        {openingKey ? "Opening conversation" : ""}
      </div>
      {state.error ? (
        <div
          role="alert"
          className="flex shrink-0 items-start gap-2 border-b border-content/10 px-3 py-1.5 text-[12px] text-red-400/90"
        >
          <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">
            Could not read {label} conversations. {state.error}
          </span>
          <button
            type="button"
            disabled={state.refreshing || cloudRefreshing}
            onClick={onRefresh}
            className="shrink-0 rounded px-1 text-content/70 underline-offset-2 hover:text-content hover:underline"
          >
            Retry
          </button>
        </div>
      ) : null}
      {cloudError ? (
        <div
          role="alert"
          className="flex shrink-0 items-start gap-2 border-b border-content/10 px-3 py-1.5 text-[12px] text-red-400/90"
        >
          <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">
            Could not read retained {label} cloud tasks. {cloudError}
          </span>
          <button
            type="button"
            disabled={state.refreshing || cloudRefreshing}
            onClick={onRefresh}
            className="shrink-0 rounded px-1 text-content/70 underline-offset-2 hover:text-content hover:underline"
          >
            Retry
          </button>
        </div>
      ) : null}
      {actionError ? (
        <div
          role="alert"
          className="flex shrink-0 items-start gap-2 border-b border-content/10 px-3 py-1.5 text-[12px] text-red-400/90"
        >
          <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">
            {actionError}
          </span>
          <button
            type="button"
            aria-label="Dismiss message"
            onClick={onDismissActionError}
            className="shrink-0 rounded px-1 text-content/70 underline-offset-2 hover:text-content hover:underline"
          >
            Dismiss
          </button>
        </div>
      ) : null}
      {hasDiagnostics ? (
        <div className="shrink-0 border-b border-content/10 px-3 py-1.5 text-[11px] text-content/50">
          <button
            type="button"
            aria-expanded={notesOpen}
            onClick={() => setNotesOpen((open) => !open)}
            className="rounded text-left text-content/60 hover:text-content"
          >
            {state.diagnostics.length === 1
              ? "1 item could not be read"
              : `${state.diagnostics.length} items could not be read`}
          </button>
          {notesOpen ? (
            <ul className="mt-1 flex flex-col gap-0.5">
              {state.diagnostics.map((note) => (
                <li key={note} className="break-words">
                  {note}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-none p-1.5">
        {cloudRecords.length > 0 && onOpenCloud ? (
          <section aria-label={`${label} cloud tasks`} className="mb-1.5">
            <p className="px-2 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-content/40">
              Cloud tasks
            </p>
            <ul data-session-list data-shared-hover-continuity className="flex flex-col gap-0.5">
              {cloudRecords.map((record) => (
                <li key={`${record.providerAccountId}:${record.id}`}>
                  <button
                    type="button"
                    data-shared-hover-item
                    title={record.url}
                    aria-label={`Cloud task ${record.id}`}
                    onClick={() => onOpenCloud(record)}
                    className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-content/80 hover:bg-content/5 hover:text-content"
                  >
                    <Cloud aria-hidden className="size-3.5 shrink-0 text-content/55" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-semibold leading-snug text-content">
                        {record.id}
                      </span>
                      <span className="block truncate text-[11px] text-content/45">
                        {folderName(record.cwd)}
                        {record.environmentId ? ` · ${record.environmentId}` : ""}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {cloudOnly ? (cloudRecords.length === 0 ? <p className="px-3 py-2 text-[12px] text-content/50">No MonoCode-created {label} cloud sessions.</p> : null) : initialLoading ? (
          <ListSkeleton label={`Loading ${label} conversations`} />
        ) : showEmpty ? (
          <p className="px-3 py-2 text-[12px] text-content/50">
            {state.error
              ? ""
              : showArchived
                ? `No ${label} conversations found on this computer.`
                : `No ${label} conversations found on this computer. Archived ones are hidden; use the filter to show them.`}
          </p>
        ) : state.rows.length > 0 ? (
          <ul data-session-list data-shared-hover-continuity className="flex flex-col gap-0.5">
            {summaries.map(({ row, summary }) => {
              const rc = conversationRemoteControl(row, sessions, remoteControlDesired);
              return (
              <SessionListItem
                key={row.key}
                session={summary}
                cwd={motionScope}
                motion={motion}
              >
                <SessionCard
                  session={summary}
                  isActive={
                    !!activeSessionId && row.monocodeSessionId === activeSessionId
                  }
                  busy={openingKey === row.key}
                  done={false}
                  needsApproval={false}
                  now={now}
                  badge={
                    rc && rc.label !== "Off" ? (
                      <RemoteControlIndicator label={rc.label} detail={rc.detail} />
                    ) : undefined
                  }
                  onSelect={() => onOpen(row)}
                  onArchive={() => onArchive(row, !row.archived)}
                  onContextMenu={(event) => onRowContextMenu(row.key, event)}
                />
              </SessionListItem>
              );
            })}
          </ul>
        ) : null}
        {state.hasMore ? (
          <div className="flex justify-center p-2">
            <button
              type="button"
              disabled={state.loadingMore || state.refreshing}
              onClick={onLoadMore}
              className="rounded-md px-3 py-1 text-[12px] text-content/60 hover:bg-content/10 hover:text-content disabled:opacity-60"
            >
              {state.loadingMore ? "Loading…" : "Show more"}
            </button>
          </div>
        ) : null}
      </div>
      {menu && menuRow ? (
        <ExplorerMenu
          x={menu.x}
          y={menu.y}
          layer={menuLayer}
          ariaLabel="Conversation actions"
          items={menuItems}
          onPick={(id) => {
            setMenu(null);
            if (id === "open") onOpen(menuRow);
            else if (id.startsWith("resume-on:"))
              onResumeOn?.(menuRow, id.slice("resume-on:".length));
            else if (id === "archive") onArchive(menuRow, !menuRow.archived);
          }}
          onClose={() => setMenu(null)}
        />
      ) : null}
      {filterAnchor ? (
        <ExplorerMenu
          anchor={filterAnchor}
          width={168}
          layer={menuLayer}
          ariaLabel="Conversation filters"
          items={[
            {
              kind: "item",
              id: "archived",
              label: "Show archived",
              checked: showArchived,
            },
          ]}
          onPick={(id) => {
            setFilterAnchor(null);
            if (id === "archived") onShowArchivedChange(!showArchived);
          }}
          onClose={() => {
            setFilterAnchor(null);
            filterButton.current?.focus();
          }}
        />
      ) : null}
    </div>
  );
}

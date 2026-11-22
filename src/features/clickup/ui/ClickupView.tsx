import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from "react";
import { OverlayNav } from "../../../app/shell/TitleBar";
import { WindowControls } from "../../../app/shell/WindowControls";
import { IS_MAC } from "../../../platform/tauri/platform";
import { ArrowUp, Plus, RefreshCw, Settings, UserRound, X } from "../../../shared/ui/icons";
import { ResizeHandle } from "../../../shared/ui/ResizeHandle";
import { useWindowWidth } from "../../../shared/hooks/useWindowWidth";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { SegmentedSwitch, type SegmentedOption } from "../../../shared/ui/SegmentedSwitch";
import { SlidePanel } from "../../../shared/ui/SlidePanel";
import { Toggle } from "../../../shared/ui/Toggle";
import { ClickupError, clickupApi, type ClickupMember, type ClickupTask } from "../model/clickupApi";
import { useClickupConfig } from "../model/clickupConfig";
import { describeClickupError } from "../model/clickupMessages";
import { clickupSessionContext } from "../model/clickupSessionContext";
import { clickupStore, useClickupSnapshot } from "../model/clickupStore";
import {
  createInput,
  dueBeforeStart,
  type ClickupTaskDraft,
} from "../model/clickupTasks";
import {
  CLICKUP_GROUP_BYS,
  CLICKUP_PANEL_DEFAULT,
  CLICKUP_PANEL_MAX,
  CLICKUP_PANEL_MIN,
  CLICKUP_GROUP_LABELS,
  CLICKUP_SORT_FIELDS,
  CLICKUP_SORT_LABELS,
  boardGroupBy,
  filterByStatus,
  firstName,
  groupClickupTasks,
  loadClickupViewState,
  mergeStatuses,
  saveClickupViewState,
  sortClickupTasks,
  statusKey,
  type ClickupGroupBy,
  type ClickupViewState,
} from "../model/clickupViewState";
import { TasksViewSwitch } from "../../tasks/ui/TasksViewSwitch";
import { ClickupSetup } from "./ClickupSetup";
import { ClickupTaskForm } from "./ClickupTaskForm";
import { ClickupTaskPanel, type ClickupMonoChoice } from "./ClickupTaskPanel";
import { ClickupBoardView, ClickupListView, ClickupTableView } from "./ClickupTaskViews";

const BUTTON =
  "inline-flex h-8 items-center gap-1.5 rounded-md bg-content/10 px-3 text-[13px] text-content transition-colors hover:bg-content/15 active:scale-96 disabled:opacity-50";
const ICON_BUTTON =
  "grid size-8 place-items-center rounded-md text-content/65 transition-colors hover:bg-content/10 hover:text-content active:scale-96 disabled:opacity-40";

export interface ClickupMonoSource {
  id: string;
  name: string;
  sessionId?: string;
  projects: readonly string[];
}

type Connection = "checking" | "connected" | "notConnected";

const EMPTY_DRAFT: ClickupTaskDraft = {
  name: "",
  description: "",
  status: "",
  priority: null,
  assigneeIds: [],
  startDate: null,
  dueDate: null,
};

/**
 * Fork (L-381): ClickUp tasks of the lists set up for one project. The token
 * stays in Rust; this view only sees tasks. Agent writes land in the same
 * store, so they show up here without a refresh.
 */
function countBy(keys: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const key of keys) counts[key] = (counts[key] ?? 0) + 1;
  return counts;
}

export function ClickupView({
  tabbed = false,
  besideRail = false,
  compactRail = false,
  projects,
  currentProject,
  monos,
  samePath,
  onClose,
  onToggleSidebar,
  onStartSession,
  onGiveToMono,
}: {
  tabbed?: boolean;
  besideRail?: boolean;
  compactRail?: boolean;
  projects: readonly string[];
  currentProject: string | null;
  monos: readonly ClickupMonoSource[];
  samePath: (a: string, b: string) => boolean;
  onClose: () => void;
  onToggleSidebar?: () => void;
  /** `filePaths`: local copies of the task's files, attached to the composer. */
  onStartSession: (text: string, projectPath: string, filePaths: readonly string[]) => void;
  onGiveToMono: (monoId: string, text: string, filePaths: readonly string[]) => void;
}): JSX.Element {
  const config = useClickupConfig();
  const snapshot = useClickupSnapshot();
  const [connection, setConnection] = useState<Connection>("checking");
  const [setupOpen, setSetupOpen] = useState(false);
  const [listTab, setListTab] = useState("all");
  const [showDone, setShowDone] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  // What the side panel holds: one task, or the New task form (same panel, same width).
  const [panelKind, setPanelKind] = useState<"task" | "create">("task");
  const [createKey, setCreateKey] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [viewState, setViewState] = useState<ClickupViewState>(loadClickupViewState);
  const panelFrame = useRef<HTMLDivElement>(null);
  // The task panel never takes more than 70% of the window, so the tasks stay in view.
  const panelMax = Math.max(CLICKUP_PANEL_MIN, Math.min(CLICKUP_PANEL_MAX, Math.round(useWindowWidth() * 0.7)));
  /** The connected ClickUp user; null until known, or when the lookup failed (the filter is hidden then). */
  const [me, setMe] = useState<ClickupMember | null>(null);
  const updateView = useCallback((patch: Partial<ClickupViewState>) => {
    setViewState((current) => {
      const next = { ...current, ...patch };
      saveClickupViewState(next);
      return next;
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    clickupApi
      .isConnected()
      .then((connected) => {
        if (!cancelled) setConnection(connected ? "connected" : "notConnected");
      })
      .catch(() => {
        if (!cancelled) setConnection("notConnected");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const connected = connection === "connected" && !snapshot.needsConnect;
  const listIds = config.lists.map((list) => list.id).join(",");
  useEffect(() => {
    if (!connected || setupOpen) return;
    for (const list of config.lists) {
      void clickupStore.loadMeta(list.id);
      void clickupStore.refresh(list.id, { includeClosed: showDone });
    }
    // The lists are a stable join of IDs; `config.lists` itself changes identity per save.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, setupOpen, listIds, showDone]);

  const waitSeconds = Math.max(0, Math.ceil((snapshot.retryAt - now) / 1000));
  useEffect(() => {
    if (snapshot.retryAt <= Date.now()) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [snapshot.retryAt]);

  const activeLists = listTab === "all" ? config.lists : config.lists.filter((list) => list.id === listTab);
  const listName = useCallback(
    (id: string) => config.lists.find((list) => list.id === id)?.name ?? "",
    [config.lists],
  );
  const multipleLists = activeLists.length > 1;
  const groupBy: ClickupGroupBy = viewState.view === "board"
    ? boardGroupBy(viewState.groupBy)
    : viewState.groupBy === "list" && !multipleLists
      ? "status"
      : viewState.groupBy;
  useEffect(() => {
    if (!connected) {
      setMe(null);
      return;
    }
    let cancelled = false;
    clickupApi
      .me()
      .then((member) => {
        if (!cancelled && member.id) setMe(member);
      })
      .catch((error: unknown) => {
        // The filter is optional: without the user it stays hidden and every task shows.
        if (!cancelled) console.warn("Couldn't look up the ClickUp user", describeClickupError(error));
      });
    return () => {
      cancelled = true;
    };
  }, [connected]);

  const mineOnly = viewState.mine && me !== null;
  const { rows, groups, openCount, mineCount, statusChoices, statusCounts, listCounts } = useMemo(() => {
    const created = new Set(snapshot.createdIds);
    const all = activeLists
      .flatMap((list) => snapshot.lists[list.id]?.tasks ?? [])
      .filter((task) => showDone || task.status.type !== "closed");
    const isMine = (task: ClickupTask): boolean => me !== null && task.assignees.some((member) => member.id === me.id);
    const statuses = mergeStatuses(
      activeLists.map((list) => snapshot.lists[list.id]?.meta?.statuses ?? []),
      all,
    );
    const choices = statuses.filter((status) => showDone || status.type !== "closed");
    const shown = filterByStatus(
      mineOnly ? all.filter(isMine) : all,
      viewState.statuses,
      choices.map((status) => statusKey(status.status)),
    );
    const sorted = sortClickupTasks(shown, viewState.sort, statuses);
    // Tasks made here this session stay on top of their group, so a new one is easy to find.
    const ordered = [...sorted.filter((task) => created.has(task.id)), ...sorted.filter((task) => !created.has(task.id))];
    return {
      openCount: all.length,
      mineCount: all.filter(isMine).length,
      statusChoices: choices,
      // Counts follow Show done and "Assignee: me" but not the status pick itself, so each option says what picking it adds.
      statusCounts: countBy((mineOnly ? all.filter(isMine) : all).map((task) => statusKey(task.status.status))),
      // Each list tab: what you'd see after switching to it, with every other filter kept.
      listCounts: Object.fromEntries(
        config.lists.map((list) => {
          const tasks = (snapshot.lists[list.id]?.tasks ?? []).filter(
            (task) => (showDone || task.status.type !== "closed") && (!mineOnly || isMine(task)),
          );
          const available = mergeStatuses([snapshot.lists[list.id]?.meta?.statuses ?? []], tasks)
            .filter((status) => showDone || status.type !== "closed")
            .map((status) => statusKey(status.status));
          return [list.id, filterByStatus(tasks, viewState.statuses, available).length];
        }),
      ),
      rows: ordered,
      groups: groupClickupTasks(ordered, groupBy, {
        statuses,
        lists: activeLists,
        // Empty groups stay hidden in every view (Board too): only statuses with tasks get a column.
        includeEmpty: false,
        hideClosed: !showDone,
      }),
    };
  }, [activeLists, config.lists, snapshot.lists, snapshot.createdIds, showDone, viewState.sort, viewState.statuses, groupBy, me, mineOnly]);

  const loads = activeLists.map((list) => snapshot.lists[list.id]?.load ?? { kind: "idle" as const });
  const loading = loads.some((load) => load.kind === "loading" || load.kind === "idle");
  const failure = loads.find((load) => load.kind === "error");
  const selected = rows.find((task) => task.id === selectedId) ?? null;
  const selectedList = selected ? snapshot.lists[selected.listId] : undefined;
  const linkedProject = config.projectPath;

  const monoChoices: ClickupMonoChoice[] = linkedProject
    ? monos
        .filter((mono) => mono.projects.some((path) => samePath(path, linkedProject)))
        .map((mono) => ({ id: mono.id, name: mono.name, started: Boolean(mono.sessionId) }))
    : [];

  const tabOptions: SegmentedOption<string>[] = [
    { id: "all", label: "All", count: config.lists.reduce((sum, list) => sum + (listCounts[list.id] ?? 0), 0) },
    ...config.lists.map((list) => ({ id: list.id, label: list.name, count: listCounts[list.id] ?? 0 })),
  ];

  const groupOptions = CLICKUP_GROUP_BYS.filter(
    (value) => !(value === "none" && viewState.view === "board") && !(value === "list" && !multipleLists),
  ).map((value) => ({ value, label: CLICKUP_GROUP_LABELS[value] }));
  const sortOptions = CLICKUP_SORT_FIELDS.filter((field) => field !== "dateClosed" || showDone).map((value) => ({
    value,
    label: `Sort: ${CLICKUP_SORT_LABELS[value]}`,
  }));
  const toggleGroup = (key: string): void =>
    updateView({
      collapsed: viewState.collapsed.includes(key)
        ? viewState.collapsed.filter((entry) => entry !== key)
        : [...viewState.collapsed, key],
    });
  const taskListName = (task: ClickupTask): string | null => (multipleLists ? listName(task.listId) : null);
  const selectedRowId = panelOpen && panelKind === "task" ? selectedId : null;

  const refresh = (): void => {
    for (const list of activeLists) void clickupStore.refresh(list.id, { force: true, includeClosed: showDone });
  };

  const openTask = (task: ClickupTask): void => {
    setPanelKind("task");
    setSelectedId(task.id);
    setPanelOpen(true);
  };
  const openCreate = (): void => {
    // A form already open keeps what was typed; anything else starts fresh.
    if (!(panelOpen && panelKind === "create")) setCreateKey((key) => key + 1);
    setPanelKind("create");
    setPanelOpen(true);
  };

  const topBar = (
    <div className="flex min-w-0 flex-1 items-center gap-2 px-3">
      <span className="text-[13px] font-medium text-content">ClickUp</span>
      <span className="flex-1" />
      {connected && config.lists.length > 0 && !setupOpen ? (
        <>
          <Toggle label="Show done" on={showDone} onChange={setShowDone} />
          <span className="text-[12px] text-content/60">Show done</span>
          <button
            type="button"
            aria-label="Refresh"
            title="Refresh"
            className={ICON_BUTTON}
            disabled={loading || waitSeconds > 0}
            onClick={refresh}
          >
            <RefreshCw className="size-4" aria-hidden />
          </button>
          <button type="button" className={BUTTON} onClick={openCreate}>
            <Plus className="size-3.5" aria-hidden />
            New task
          </button>
        </>
      ) : null}
      {connection !== "checking" ? (
        <button
          type="button"
          aria-label="ClickUp settings"
          title="ClickUp settings"
          className={ICON_BUTTON}
          onClick={() => setSetupOpen((open) => !open)}
        >
          <Settings className="size-4" aria-hidden />
        </button>
      ) : null}
    </div>
  );

  const needsSetup = connection === "notConnected" || snapshot.needsConnect || config.lists.length === 0;
  const showViews = connected && config.lists.length > 0 && !setupOpen && !needsSetup;
  // Table and Board scroll inside themselves (sticky header, sideways columns).
  const fillsPane = showViews && rows.length > 0 && viewState.view !== "list";

  return (
    <div
      role="region"
      aria-label="ClickUp"
      data-session-empty="false"
      data-project-chat-background="false"
      className="chat-pane-background relative isolate flex min-h-0 min-w-0 flex-1 flex-col text-content"
    >
      {tabbed ? (
        <div className="flex h-10 shrink-0 items-center border-b border-stroke">{topBar}</div>
      ) : (
        <div
          data-app-view-header
          className="flex h-10 shrink-0 select-none items-center border-b border-stroke"
          data-tauri-drag-region="deep"
        >
          {IS_MAC && compactRail ? <div className="w-4 shrink-0" /> : null}
          {IS_MAC && !besideRail ? <div className="w-[78px] shrink-0" /> : null}
          {besideRail ? null : <OverlayNav onBack={onClose} onToggleSidebar={onToggleSidebar} />}
          {topBar}
          {IS_MAC ? null : <WindowControls />}
        </div>
      )}

      {showViews ? (
        <div className="flex h-11 shrink-0 items-center gap-1.5 overflow-x-auto px-3">
          <div className="mr-1 shrink-0">
            <SegmentedSwitch options={tabOptions} value={listTab} onChange={setListTab} ariaLabel="Lists" />
          </div>
          <SearchableSelect
            variant="pill"
            label="Group"
            value={groupBy}
            options={groupOptions}
            searchable={false}
            onChange={(value) => {
              const next = CLICKUP_GROUP_BYS.find((entry) => entry === value);
              if (next) updateView({ groupBy: next });
            }}
          />
          <SearchableSelect
            variant="pill"
            label="Sort"
            value={viewState.sort.field}
            options={sortOptions}
            searchable={false}
            onChange={(value) => {
              const field = CLICKUP_SORT_FIELDS.find((entry) => entry === value);
              if (field) updateView({ sort: { ...viewState.sort, field } });
            }}
          />
          <SearchableSelect
            variant="pill"
            label="Status"
            value=""
            options={[
              { value: "", label: "All statuses" },
              ...statusChoices.map((status) => ({
                value: statusKey(status.status),
                label: status.status,
                count: statusCounts[statusKey(status.status)] ?? 0,
              })),
            ]}
            searchable={statusChoices.length > 8}
            searchPlaceholder="Search statuses"
            emptyLabel="No statuses"
            multiple={{
              values: viewState.statuses.filter((key) => statusChoices.some((status) => statusKey(status.status) === key)),
              summary: (count) => `${count} statuses`,
              onToggle: (key) =>
                updateView({
                  statuses: viewState.statuses.includes(key)
                    ? viewState.statuses.filter((entry) => entry !== key)
                    : [...viewState.statuses, key],
                }),
            }}
            onChange={() => updateView({ statuses: [] })}
          />
          <button
            type="button"
            aria-label={viewState.sort.dir === "asc" ? "Ascending, switch to descending" : "Descending, switch to ascending"}
            title={viewState.sort.dir === "asc" ? "Ascending" : "Descending"}
            className={ICON_BUTTON}
            onClick={() => updateView({ sort: { ...viewState.sort, dir: viewState.sort.dir === "asc" ? "desc" : "asc" } })}
          >
            <ArrowUp
              aria-hidden
              className={`size-3.5 transition-transform duration-150 motion-reduce:transition-none ${viewState.sort.dir === "desc" ? "rotate-180" : ""}`}
            />
          </button>
          <div className="flex min-w-0 flex-1 justify-center px-2">
            {me ? (
              <button
                type="button"
                aria-pressed={mineOnly}
                aria-label={`Assignee: ${me.username}, ${mineCount} of ${openCount} tasks`}
                title={mineOnly ? "Show everyone's tasks" : "Show only tasks assigned to you"}
                onClick={() => updateView({ mine: !viewState.mine })}
                className={`inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-[12px] transition-colors duration-150 ${
                  mineOnly
                    ? "bg-amber-400/15 text-amber-200 hover:bg-amber-400/25"
                    : "text-content/60 hover:bg-content/10 hover:text-content"
                }`}
              >
                <UserRound aria-hidden className="size-3.5" strokeWidth={1.75} />
                Assignee: {firstName(me.username)}
                <span className="tabular-nums text-[11px] opacity-70">
                  {mineCount}/{openCount}
                </span>
              </button>
            ) : null}
          </div>
          <TasksViewSwitch view={viewState.view} onChange={(view) => updateView({ view })} />
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1">
        <div className={`flex min-h-0 min-w-0 flex-1 flex-col ${fillsPane ? "overflow-hidden" : "overflow-y-auto"}`}>
          {connection === "checking" ? (
            <p role="status" className="p-6 text-[13px] text-content/55">
              Checking ClickUp…
            </p>
          ) : setupOpen || needsSetup ? (
            <>
              {snapshot.needsConnect && connection === "connected" ? (
                <p role="alert" className="px-6 pt-6 text-[12.5px] text-red-400">
                  Your ClickUp token stopped working. Connect again.
                </p>
              ) : null}
              <ClickupSetup
                connected={connection === "connected" && !snapshot.needsConnect}
                config={config}
                projects={projects}
                currentProject={currentProject}
                onConnected={() => {
                  clickupStore.setNeedsConnect(false);
                  setConnection("connected");
                }}
                onDisconnected={() => {
                  clickupStore.clear();
                  setConnection("notConnected");
                  setSetupOpen(false);
                  setPanelOpen(false);
                }}
                onDone={() => setSetupOpen(false)}
              />
            </>
          ) : (
            <>
              {waitSeconds > 0 ? (
                <p role="status" className="px-4 pt-3 text-[12.5px] text-content/60">
                  ClickUp is busy. Try again in {waitSeconds} s.
                </p>
              ) : null}
              {failure && failure.kind === "error" && waitSeconds === 0 ? (
                <div role="alert" className="flex items-center gap-3 px-4 pt-3 text-[12.5px] text-red-400">
                  <span>{describeClickupError(failure.error)}</span>
                  <button type="button" className="text-content/80 hover:underline" onClick={refresh}>
                    Try again
                  </button>
                </div>
              ) : null}
              {rows.length === 0 && loading ? (
                <ul aria-busy="true" aria-label="Loading tasks" className="space-y-1 p-4">
                  {[0, 1, 2, 3].map((n) => (
                    <li key={n} className="h-10 animate-pulse rounded-md bg-content/[0.06]" />
                  ))}
                </ul>
              ) : rows.length === 0 ? (
                !failure ? (
                  <p className="p-6 text-center text-[13px] text-content/55">
                    {mineOnly ? (showDone ? "No tasks assigned to you in" : "No open tasks assigned to you in") : showDone ? "No tasks in" : "No open tasks in"}{" "}
                    {listTab === "all" && config.lists.length !== 1
                      ? "these lists"
                      : listName(listTab === "all" ? (config.lists[0]?.id ?? "") : listTab)}
                    .
                  </p>
                ) : null
              ) : viewState.view === "table" ? (
                <ClickupTableView
                  groups={groups}
                  groupBy={groupBy}
                  selectedId={selectedRowId}
                  now={now}
                  listName={taskListName}
                  collapsed={viewState.collapsed}
                  onToggleGroup={toggleGroup}
                  onOpen={openTask}
                  sort={viewState.sort}
                  onSortChange={(sort) => updateView({ sort })}
                />
              ) : viewState.view === "board" ? (
                <ClickupBoardView
                  groups={groups}
                  groupBy={groupBy}
                  selectedId={selectedRowId}
                  now={now}
                  listName={taskListName}
                  onOpen={openTask}
                  columnWeights={viewState.boardColumnWeights}
                  onColumnWeightsChange={(changed) =>
                    updateView({
                      boardColumnWeights:
                        Object.keys(changed).length === 0 ? {} : { ...viewState.boardColumnWeights, ...changed },
                    })
                  }
                />
              ) : (
                <ClickupListView
                  groups={groups}
                  groupBy={groupBy}
                  selectedId={selectedRowId}
                  now={now}
                  listName={taskListName}
                  collapsed={viewState.collapsed}
                  onToggleGroup={toggleGroup}
                  onOpen={openTask}
                />
              )}
            </>
          )}
        </div>
        <SlidePanel
          open={panelOpen && (panelKind === "create" || selected !== null)}
          motion="slide"
          onGone={() => setSelectedId(null)}
        >
          {panelKind === "create" || selected ? (
            <div
              ref={panelFrame}
              style={{ width: Math.min(viewState.panelWidth, panelMax) }}
              // The board's own padding (p-3) already spaces it from the last column, so the
              // panel matches the column gap there: 12px on every side.
              className={`relative flex flex-col overflow-hidden rounded-xl border border-stroke bg-content/[0.04] ${
                viewState.view === "board" ? "my-3 mr-3 h-[calc(100%-1.5rem)]" : "m-2 h-[calc(100%-1rem)]"
              }`}
            >
              <ResizeHandle
                label={panelKind === "create" ? "Resize new task panel" : "Resize task panel"}
                value={Math.min(viewState.panelWidth, panelMax)}
                min={CLICKUP_PANEL_MIN}
                max={panelMax}
                defaultValue={CLICKUP_PANEL_DEFAULT}
                placement="inset-y-0 left-0"
                reverse
                look="line"
                onLive={(next) => {
                  if (panelFrame.current)
                    panelFrame.current.style.width = `${next ?? Math.min(viewState.panelWidth, panelMax)}px`;
                }}
                onCommit={(next) => updateView({ panelWidth: next })}
              />
              {panelKind === "create" ? (
                <CreateTaskPanel
                  key={`create-${createKey}`}
                  listIds={config.lists}
                  defaultListId={listTab === "all" ? (config.lists[0]?.id ?? "") : listTab}
                  onClose={() => setPanelOpen(false)}
                />
              ) : selected ? (
                <ClickupTaskPanel
                  key={selected.id}
                  task={selected}
                  listName={listName(selected.listId)}
                  meta={selectedList?.meta ?? null}
                  members={selectedList?.members ?? []}
                  readOnly={snapshot.readOnlyLists.includes(selected.listId)}
                  saving={snapshot.savingTaskIds.includes(selected.id)}
                  monos={monoChoices}
                  onClose={() => setPanelOpen(false)}
                  onSave={(patch) => clickupStore.updateTask(selected.id, selected.listId, patch)}
                  onNewSession={async () => {
                    if (!linkedProject) return;
                    const context = await clickupSessionContext(selected, listName(selected.listId));
                    onStartSession(context.text, linkedProject, context.filePaths);
                  }}
                  onGiveToMono={async (monoId) => {
                    const context = await clickupSessionContext(selected, listName(selected.listId));
                    onGiveToMono(monoId, context.text, context.filePaths);
                  }}
                />
              ) : null}
            </div>
          ) : null}
        </SlidePanel>
      </div>
    </div>
  );
}

/** Fork (L-381): the New task form, in the task side panel. */
function CreateTaskPanel({
  listIds,
  defaultListId,
  onClose,
}: {
  listIds: readonly { id: string; name: string }[];
  defaultListId: string;
  onClose: () => void;
}): JSX.Element {
  const snapshot = useClickupSnapshot();
  const [listId, setListId] = useState(defaultListId);
  const [draft, setDraft] = useState<ClickupTaskDraft>(EMPTY_DRAFT);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const state = snapshot.lists[listId];
  const readOnly = snapshot.readOnlyLists.includes(listId);

  useEffect(() => {
    void clickupStore.loadMeta(listId);
  }, [listId]);

  // Start on the list's first open status once its statuses arrive.
  useEffect(() => {
    const first = [...(state?.meta?.statuses ?? [])].sort((a, b) => a.orderindex - b.orderindex)[0];
    setDraft((current) => (first && !state?.meta?.statuses.some((s) => s.status === current.status)
      ? { ...current, status: first.status }
      : current));
  }, [state?.meta]);

  const create = async (): Promise<void> => {
    if (creating) return;
    setCreating(true);
    setError(null);
    try {
      await clickupStore.createTask(listId, createInput(draft));
      onClose();
    } catch (failure) {
      setError(failure instanceof ClickupError ? describeClickupError(failure) : "Couldn't reach ClickUp.");
      setCreating(false);
    }
  };

  return (
    <aside aria-label="New task" className="flex h-full min-h-0 w-full flex-col">
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-stroke px-3">
        <h2 className="min-w-0 flex-1 truncate text-[13px] font-medium text-content">New task</h2>
        <button type="button" aria-label="Close new task" title="Close" className={ICON_BUTTON} onClick={onClose}>
          <X aria-hidden className="size-4" />
        </button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
        {readOnly ? (
          <p role="status" className="text-[12px] text-content/55">
            You can view this list but not edit it.
          </p>
        ) : null}
        <ClickupTaskForm
          lists={listIds}
          listId={listId}
          onListChange={setListId}
          draft={draft}
          onChange={setDraft}
          meta={state?.meta ?? null}
          members={state?.members ?? []}
          disabled={creating || readOnly}
        />
        {error ? (
          <p role="alert" className="text-[12.5px] text-red-400">
            {error}
          </p>
        ) : null}
      </div>
      <footer className="flex shrink-0 items-center gap-2 border-t border-stroke p-3">
        <button
          type="button"
          className={BUTTON}
          disabled={creating || readOnly || !draft.name.trim() || dueBeforeStart(draft)}
          onClick={() => void create()}
        >
          {creating ? "Creating…" : "Create task"}
        </button>
        <button type="button" className={BUTTON} disabled={creating} onClick={onClose}>
          Cancel
        </button>
      </footer>
    </aside>
  );
}

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Archive,
  CheckCircle,
  LoaderCircle,
  Plus,
  Target,
} from "../../../shared/ui/icons";
import { listen } from "@tauri-apps/api/event";
import { copyText } from "../../../platform/tauri/clipboard";
import {
  CelebrationBurst,
  burstAt,
  type BurstTarget,
} from "../../../shared/ui/CelebrationBurst";
import { taskMenuAction, taskMenuItems } from "./taskContextMenu";
import { OverlayNav } from "../../../app/shell/TitleBar";
import { WindowControls } from "../../../app/shell/WindowControls";
import { IS_MAC } from "../../../platform/tauri/platform";
import { pathKey, projectName } from "../../../shared/lib/paths";
import {
  ExplorerMenu,
} from "../../files/ui/ExplorerMenu";
import {
  looksLikeProject,
  type RecentProject,
} from "../../projects/model/recents";
import { useProjectMarks } from "../../projects/ui/ProjectMark";
import {
  TASK_GROUP_BYS,
  TASK_GROUP_LABELS,
  loadBoardState,
  loadGrouping,
  saveGrouping,
  loadTableState,
  loadTaskView,
  saveBoardState,
  saveTableState,
  saveTaskView,
  type TaskBoardState,
  type TaskGrouping,
  type TaskTableState,
  type TaskViewId,
} from "../taskViewState";
import {
  completedOn,
  createTask,
  deleteTask,
  filterTasks,
  inFocusOn,
  isInFocus,
  loadTasks,
  localDay,
  peekTasks,
  taskMarkdown,
  TASKS_CHANGED_EVENT,
  TASKS_CHANGED_TAURI_EVENT,
  TASK_STATUSES,
  updateTask,
  type Task,
  type TaskFilters,
  type TaskStatus,
} from "../tasks";
import { useLocalDay } from "../../../shared/hooks/useLocalDay";
import { TaskBoard } from "./TaskBoard";
import { TaskList } from "./TaskList";
import { TaskPeekPane } from "./TaskPeekPane";
import { describeDay, TaskWeekStrip } from "./TaskWeekStrip";
import { usePresence } from "../../../shared/hooks/usePresence";
import type { TaskGroup } from "../taskViewState";
import { TaskTable } from "./TaskTable";
import { hasActiveFilters, TasksToolbar } from "./TasksToolbar";
import { ResultCount } from "../../../shared/ui/ResultCount";
import { TasksViewSwitch } from "./TasksViewSwitch";
import {
  SearchableSelect,
  type SearchableSelectOption,
} from "../../../shared/ui/SearchableSelect";

const GROUP_OPTIONS: Record<TaskViewId, SearchableSelectOption[]> = {
  list: (["none", "status", "project"] as const).map((value) => ({
    value,
    label: TASK_GROUP_LABELS[value],
  })),
  table: (["status", "project", "none"] as const).map((value) => ({
    value,
    label: TASK_GROUP_LABELS[value],
  })),
  board: (["status", "project"] as const).map((value) => ({
    value,
    label: TASK_GROUP_LABELS[value],
  })),
};

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

type TaskMenu = { task: Task; x: number; y: number };
/** Location value for Personal; project values are absolute paths, never ":"-led. */
const PERSONAL_LOCATION = ":personal";

const FOCUS_KEY = "monocode.tasks.focus";
const SHOW_ARCHIVED_KEY = "monocode.tasks.showArchived";
function loadFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === "true";
  } catch {
    return false;
  }
}
function saveFlag(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    /* storage unavailable: the choice just won't persist */
  }
}

export function TasksView({
  besideRail = false,
  compactRail = false,
  cwd,
  recents = [],
  onClose,
  onToggleSidebar,
  onOpenSource,
  onOpenBeside,
  onWorkOn,
}: {
  besideRail?: boolean;
  compactRail?: boolean;
  cwd?: string;
  recents?: RecentProject[];
  onClose: () => void;
  onToggleSidebar?: () => void;
  onOpenSource: (sessionId: string, blockId?: string) => void | Promise<void>;
  onOpenBeside: (task: Task) => void;
  /** Open the session composer prefilled from a task ("Work on…"). */
  onWorkOn?: (task: Task) => void;
}) {
  const [tasks, setTasks] = useState<Task[]>(() => peekTasks() ?? []);
  const [loading, setLoading] = useState(() => peekTasks() == null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [filters, setFilters] = useState<TaskFilters>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<TaskViewId>(loadTaskView);
  const [table, setTable] = useState<TaskTableState>(loadTableState);
  const [board, setBoard] = useState<TaskBoardState>(loadBoardState);
  const [grouping, setGrouping] = useState<TaskGrouping>(loadGrouping);
  // List group collapsing is a per-visit convenience; it is not persisted.
  const [listCollapsed, setListCollapsed] = useState<string[]>([]);
  const [taskMenu, setTaskMenu] = useState<TaskMenu | null>(null);
  // Week-strip day (`null` means All). Starts on Today when the Focus flag
  // is set; a past or future day is never restored.
  const [selectedDay, setSelectedDay] = useState<string | null>(() =>
    loadFlag(FOCUS_KEY) ? localDay() : null,
  );
  const [recenterSignal, setRecenterSignal] = useState(0);
  const [showArchived, setShowArchived] = useState(() =>
    loadFlag(SHOW_ARCHIVED_KEY),
  );
  const [burst, setBurst] = useState<BurstTarget | null>(null);
  const [newTaskId, setNewTaskId] = useState<string | null>(null);
  const focusButton = useRef<HTMLButtonElement>(null);
  const today = useLocalDay();
  const focusSelected = selectedDay === today;
  const selectDay = (day: string | null) => {
    setSelectedDay(day);
    if (day === today) saveFlag(FOCUS_KEY, true);
    else if (day === null) saveFlag(FOCUS_KEY, false);
  };
  const marks = useProjectMarks();
  const root = useRef<HTMLDivElement>(null);
  const alive = useRef(true);
  const refreshId = useRef(0);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const menuRef = useRef<TaskMenu | null>(taskMenu);
  menuRef.current = taskMenu;

  const refresh = useCallback(async () => {
    const id = ++refreshId.current;
    try {
      const rows = await loadTasks();
      if (!alive.current || id !== refreshId.current) return;
      setTasks(rows);
      setError(null);
      setLoading(false);
    } catch (error) {
      if (!alive.current || id !== refreshId.current) return;
      setError(message(error));
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    alive.current = true;
    void refresh();
    window.addEventListener(TASKS_CHANGED_EVENT, refresh);
    // Tasks saved from the floating composer arrive from another window.
    let unlisten: (() => void) | undefined;
    let disposed = false;
    void listen(TASKS_CHANGED_TAURI_EVENT, () => void refresh())
      .then((stop) => {
        if (disposed) stop();
        else unlisten = stop;
      })
      .catch(() => {});
    return () => {
      alive.current = false;
      disposed = true;
      unlisten?.();
      window.removeEventListener(TASKS_CHANGED_EVENT, refresh);
    };
  }, [refresh]);

  /** User filters plus the week-strip day and Show archived. */
  const effectiveFilters = useMemo<TaskFilters>(
    () => ({
      ...filters,
      archived: showArchived ? "all" : false,
      day: selectedDay ?? undefined,
    }),
    [filters, showArchived, selectedDay],
  );
  const visible = useMemo(
    () => filterTasks(tasks, effectiveFilters),
    [tasks, effectiveFilters],
  );
  /** List view on a strip day: Completed and In focus groups. */
  const dayGroups = useMemo<TaskGroup[] | null>(() => {
    if (selectedDay === null) return null;
    const completed = visible.filter((task) => completedOn(task, selectedDay));
    const inFocus = visible.filter(
      (task) => !completedOn(task, selectedDay) && inFocusOn(task, selectedDay),
    );
    const groups: TaskGroup[] = [];
    if (completed.length)
      groups.push({
        key: "day:completed",
        label: "Completed",
        status: "completed",
        tasks: completed,
      });
    if (inFocus.length)
      groups.push({ key: "day:in-focus", label: "In focus", tasks: inFocus });
    return groups;
  }, [visible, selectedDay]);
  const activeTasks = useMemo(
    () => tasks.filter((task) => showArchived || task.archivedAt === undefined),
    [tasks, showArchived],
  );
  const focusCount = useMemo(
    () => activeTasks.filter((task) => isInFocus(task, today)).length,
    [activeTasks, today],
  );
  /** Pinned on an earlier day, unfinished, and not in today's focus. */
  const carryOver = useMemo(
    () =>
      tasks.filter(
        (task) =>
          task.focusDate !== undefined &&
          task.focusDate < today &&
          task.status !== "completed" &&
          task.archivedAt === undefined &&
          !isInFocus(task, today),
      ),
    [tasks, today],
  );
  // The selection survives filters and view switches; only deletion clears it.
  const selected = useMemo(
    () => tasks.find((task) => task.id === selectedId) ?? null,
    [tasks, selectedId],
  );
  useEffect(() => {
    if (selectedId && !loading && !selected) setSelectedId(null);
  }, [selectedId, selected, loading]);
  const selectedRef = useRef(selectedId);
  selectedRef.current = selected ? selectedId : null;
  // Keep the last task on screen while the peek pane slides out.
  const lastSelected = useRef<Task | null>(selected);
  if (selected) lastSelected.current = selected;
  const peek = usePresence(Boolean(selected));
  const peekTask = selected ?? lastSelected.current;

  const closePeek = useCallback(() => {
    const id = selectedRef.current;
    setSelectedId(null);
    if (!id) return;
    requestAnimationFrame(() =>
      root.current
        ?.querySelector<HTMLElement>(`[data-task-id="${CSS.escape(id)}"]`)
        ?.focus(),
    );
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      // Menus and pickers dismiss themselves; don't close the view under them.
      if (menuRef.current) return;
      event.preventDefault();
      event.stopPropagation();
      if (selectedRef.current) closePeek();
      else onCloseRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closePeek]);

  const projects = useMemo(() => {
    const paths = [
      ...recents.map((project) => project.path),
      ...tasks.flatMap((task) => (task.projectCwd ? [task.projectCwd] : [])),
      ...(cwd && looksLikeProject(cwd) ? [cwd] : []),
    ];
    return [...new Map(paths.map((path) => [pathKey(path), path])).values()];
  }, [recents, tasks, cwd]);

  const creatingRef = useRef(false);
  const create = async (projectCwd?: string) => {
    if (creatingRef.current || !alive.current) return;
    creatingRef.current = true;
    setCreating(true);
    setActionError(null);
    try {
      const task = await createTask({ projectCwd, status: "todo" });
      if (!alive.current) return;
      // Always show the new task: clear every filter that could hide it (Today
      // keeps it, as a task created today is in today's focus), and put it in
      // the list ourselves. `refresh()` can be superseded by the change-event
      // refresh and return before the row is loaded; the selection effect
      // would then see an unknown id and close the open pane.
      setFilters({});
      if (selectedDay !== null && !inFocusOn(task, selectedDay))
        setSelectedDay(null);
      setTasks((current) => [
        task,
        ...current.filter((item) => item.id !== task.id),
      ]);
      setNewTaskId(task.id);
      setSelectedId(task.id);
      await refresh();
    } catch (error) {
      if (alive.current) setActionError(message(error));
    } finally {
      creatingRef.current = false;
      if (alive.current) setCreating(false);
    }
  };
  const remove = async (id: string) => {
    await deleteTask(id);
    if (alive.current)
      setSelectedId((current) => (current === id ? null : current));
    await refresh();
  };
  /** Sparkles over a task that just became Completed. */
  const celebrateTask = (id: string) =>
    requestAnimationFrame(() => {
      const element = root.current?.querySelector(
        `[data-task-card="${CSS.escape(id)}"], [data-task-row="${CSS.escape(id)}"], button[data-task-id="${CSS.escape(id)}"]`,
      );
      const target = burstAt(element);
      if (target) setBurst(target);
    });
  const changeStatus = (task: Task, status: TaskStatus) => {
    setActionError(null);
    if (status === "completed" && task.status !== "completed")
      celebrateTask(task.id);
    updateTask(task.id, { status }).catch((reason: unknown) => {
      if (alive.current)
        setActionError(`Could not move "${task.title}": ${message(reason)}`);
    });
  };
  const changeTask = (
    task: Task,
    changes: Parameters<typeof updateTask>[1],
    verb: string,
  ) => {
    setActionError(null);
    // Every `focusDate` change carries `today` so history is recorded (R2/R3).
    const dated =
      changes.focusDate !== undefined && changes.today === undefined
        ? { ...changes, today }
        : changes;
    updateTask(task.id, dated).catch((reason: unknown) => {
      if (alive.current)
        setActionError(`Could not ${verb} "${task.title}": ${message(reason)}`);
    });
  };
  const toggleFocus = () => {
    if (focusSelected) {
      selectDay(null);
      return;
    }
    // Jump to today: select it and re-centre the strip on it.
    selectDay(today);
    setRecenterSignal((signal) => signal + 1);
    const target = burstAt(focusButton.current);
    if (target) setBurst(target);
  };
  const toggleArchived = () => {
    const next = !showArchived;
    setShowArchived(next);
    saveFlag(SHOW_ARCHIVED_KEY, next);
  };
  const openTaskMenu = (task: Task, x: number, y: number) => {
    setTaskMenu({ task, x, y });
  };
  const onPickTaskMenu = (id: string) => {
    const current = taskMenu;
    setTaskMenu(null);
    if (!current) return;
    const { task } = current;
    const action = taskMenuAction(id);
    if (!action) return;
    switch (action.kind) {
      case "work":
        onWorkOn?.(task);
        return;
      case "focus":
        changeTask(
          task,
          action.on
            ? { focusDate: action.day ?? today, today }
            : { focusDate: null, today },
          action.on ? "focus" : "unfocus",
        );
        return;
      case "move":
        if (action.status !== task.status) changeStatus(task, action.status);
        return;
      case "copy":
        void copyText(taskMarkdown(task, projectName))
          .catch((reason: unknown) => setActionError(message(reason)));
        return;
      case "archive":
        changeTask(
          task,
          { archived: action.on },
          action.on ? "archive" : "unarchive",
        );
        return;
      case "delete":
        void remove(task.id).catch((reason: unknown) =>
          setActionError(`Could not delete "${task.title}": ${message(reason)}`),
        );
    }
  };
  const saveView = (next: TaskViewId) => {
    setView(next);
    saveTaskView(next);
  };
  const updateTable = (next: TaskTableState) => {
    setTable(next);
    saveTableState(next);
  };
  const changeGrouping = (value: string) => {
    const by = TASK_GROUP_BYS.find((id) => id === value);
    if (!by) return;
    const next: TaskGrouping =
      view === "board"
        ? { ...grouping, board: by === "project" ? "project" : "status" }
        : { ...grouping, [view]: by };
    setGrouping(next);
    saveGrouping(next);
  };
  const toggleListGroup = (key: string) =>
    setListCollapsed((current) =>
      current.includes(key)
        ? current.filter((item) => item !== key)
        : [...current, key],
    );
  const updateBoard = (next: TaskBoardState) => {
    setBoard(next);
    saveBoardState(next);
  };
  const addTagFilter = (tag: string) =>
    setFilters((current) => ({
      ...current,
      tags: [...new Set([...(current.tags ?? []), tag])],
    }));
  const patchTask = (saved: Task) =>
    setTasks((current) =>
      current.map((task) => (task.id === saved.id ? saved : task)),
    );

  // Same searchable list as the Project filter: current project first, then
  // recents and task projects, then Personal.
  const locationOptions = useMemo<SearchableSelectOption[]>(() => {
    const options: SearchableSelectOption[] = [];
    const seen = new Set<string>();
    for (const path of [cwd, ...projects]) {
      if (!path || !looksLikeProject(path)) continue;
      const fingerprint = pathKey(path);
      if (seen.has(fingerprint)) continue;
      seen.add(fingerprint);
      options.push({ value: path, label: projectName(path), keywords: path });
    }
    options.push({ value: PERSONAL_LOCATION, label: "Personal" });
    return options;
  }, [cwd, projects]);
  const currentLocation =
    cwd && looksLikeProject(cwd) ? cwd : PERSONAL_LOCATION;

  const filteredEmpty = tasks.length > 0 && visible.length === 0;
  const resetFilters = () => {
    setFilters({});
    selectDay(null);
  };
  const body =
    loading && tasks.length === 0 ? (
      <div className="flex justify-center py-10 text-content/40">
        <LoaderCircle
          aria-label="Loading tasks"
          className="size-4 animate-spin"
          strokeWidth={1.75}
        />
      </div>
    ) : error && tasks.length === 0 ? (
      <p role="alert" className="px-4 py-3 text-[12px] text-red-400/90">
        Could not load tasks: {error}{" "}
        <button
          type="button"
          className="underline hover:no-underline"
          onClick={() => void refresh()}
        >
          Retry
        </button>
      </p>
    ) : tasks.length === 0 ? (
      <EmptyState>
        No tasks yet. Capture a selection from a transcript, or create one here.
      </EmptyState>
    ) : filteredEmpty ? (
      <EmptyState>
        {selectedDay !== null && selectedDay !== today
          ? selectedDay < today
            ? `Nothing recorded for ${describeDay(selectedDay)}.`
            : `Nothing planned for ${describeDay(selectedDay)}.`
          : selectedDay === today && !hasActiveFilters(filters)
            ? "Nothing in focus today. Pin a task with Focus today, or create one."
            : "No tasks match these filters"}
        <button
          type="button"
          onClick={resetFilters}
          className="mt-2 h-7 rounded-md px-3 text-[12px] text-content/70 hover:bg-content/10 hover:text-content"
        >
          Reset filters
        </button>
      </EmptyState>
    ) : view === "list" ? (
      <TaskList
        tasks={visible}
        groupBy={grouping.list}
        collapsed={listCollapsed}
        selectedId={selected?.id ?? null}
        marks={marks}
        today={today}
        selectedDay={selectedDay}
        groups={dayGroups ?? undefined}
        groupIcon={(group) =>
          group.key === "day:in-focus" ? (
            <Target aria-hidden className="size-3.5" strokeWidth={1.75} />
          ) : undefined
        }
        onSelect={setSelectedId}
        onTagClick={addTagFilter}
        onToggleGroup={toggleListGroup}
        onContextMenu={openTaskMenu}
      />
    ) : view === "table" ? (
      <TaskTable
        tasks={visible}
        state={table}
        groupBy={grouping.table}
        selectedId={selected?.id ?? null}
        marks={marks}
        onStateChange={updateTable}
        onSelect={setSelectedId}
        onTagClick={addTagFilter}
        onStatusChange={changeStatus}
        onContextMenu={openTaskMenu}
      />
    ) : (
      <TaskBoard
        tasks={visible}
        statuses={filters.statuses?.length ? filters.statuses : TASK_STATUSES}
        state={board}
        groupBy={grouping.board}
        selectedId={selected?.id ?? null}
        marks={marks}
        today={today}
        selectedDay={selectedDay}
        onStateChange={updateBoard}
        onSelect={setSelectedId}
        onTagClick={addTagFilter}
        onSaved={patchTask}
        onContextMenu={openTaskMenu}
        onCompleted={(task) => celebrateTask(task.id)}
      />
    );

  return (
    <div
      ref={root}
      role="region"
      aria-label="Task Manager"
      data-app-tasks
      className="flex min-h-0 min-w-0 flex-1 flex-col text-content"
    >
      <div
        className="flex h-10 shrink-0 select-none items-center border-b border-stroke"
        data-tauri-drag-region="deep"
      >
        {IS_MAC && compactRail ? <div className="w-4 shrink-0" /> : null}
        {IS_MAC && !besideRail ? <div className="w-[78px] shrink-0" /> : null}
        {besideRail ? null : (
          <OverlayNav onBack={onClose} onToggleSidebar={onToggleSidebar} />
        )}
        <div className="flex min-w-0 flex-1 items-center gap-2 px-3 text-[13px]">
          <CheckCircle
            className="size-3.5 shrink-0 text-content/45"
            strokeWidth={1.75}
          />
          <span className="min-w-0 truncate text-content">Task Manager</span>
          {loading && tasks.length === 0 ? null : (
            <ResultCount
              shown={visible.length}
              total={activeTasks.length}
              filtered={hasActiveFilters(filters) || selectedDay !== null}
              noun="tasks"
            />
          )}
        </div>
        {IS_MAC ? null : <WindowControls />}
      </div>
      <TasksToolbar
        boardBelow={view === "board" && !(filters.tags?.length ?? 0)}
        filters={filters}
        tasks={tasks}
        projects={projects}
        onChange={setFilters}
        leading={
          <NewTaskButton
            creating={creating}
            locations={locationOptions}
            currentLocation={currentLocation}
            onCreate={() => void create(undefined)}
            onChooseLocation={(value) =>
              void create(value === PERSONAL_LOCATION ? undefined : value)
            }
          />
        }
        center={
          <TaskWeekStrip
            tasks={tasks}
            today={today}
            selectedDay={selectedDay}
            onSelect={selectDay}
            recenterSignal={recenterSignal}
            center={
              <button
                ref={focusButton}
                type="button"
                data-shared-hover-item
                aria-pressed={focusSelected}
                aria-label={`Focus: ${focusCount} of ${activeTasks.length} tasks are in today's focus`}
                title="Show only today's focus: tasks created today or pinned to today"
                onClick={toggleFocus}
                className={`relative z-[2] inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-[12px] transition-colors duration-150 ${
                  focusSelected
                    ? "bg-amber-400/15 text-amber-200 hover:bg-amber-400/25"
                    : "text-content/60 hover:text-content"
                }`}
              >
                <Target
                  aria-hidden
                  className="size-3.5"
                  strokeWidth={1.75}
                />
                Focus
                <span className="tabular-nums text-[11px] opacity-70">
                  {focusCount}/{activeTasks.length}
                </span>
              </button>
            }
          />
        }
        trailing={
          <>
            <button
              type="button"
              aria-pressed={showArchived}
              title={showArchived ? "Hide archived tasks" : "Show archived tasks"}
              onClick={toggleArchived}
              className={`inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-[12px] transition-colors duration-150 ${
                showArchived
                  ? "bg-selection text-content"
                  : "text-content/60 hover:bg-content/10 hover:text-content"
              }`}
            >
              <Archive aria-hidden className="size-3.5" strokeWidth={1.75} />
              Archived
            </button>
            <SearchableSelect
              variant="pill"
              label="Group tasks"
              value={grouping[view]}
              options={GROUP_OPTIONS[view]}
              searchable={false}
              align="end"
              onChange={changeGrouping}
            />
            <TasksViewSwitch view={view} onChange={saveView} />
          </>
        }
      />
      {taskMenu ? (
        <ExplorerMenu
          x={taskMenu.x}
          y={taskMenu.y}
          ariaLabel={`Actions for ${taskMenu.task.title}`}
          items={taskMenuItems(taskMenu.task, today, Boolean(onWorkOn))}
          onPick={onPickTaskMenu}
          onClose={() => setTaskMenu(null)}
        />
      ) : null}
      {burst ? (
        <CelebrationBurst
          target={burst}
          onDone={() => setBurst(null)}
        />
      ) : null}
      {focusSelected && carryOver.length ? (
        <div className="flex shrink-0 items-center gap-2 px-3 pb-1 pt-2 text-[12px] text-content/60">
          <Target
            aria-hidden
            className="size-3.5 text-amber-300"
            strokeWidth={1.75}
          />
          <span>
            {carryOver.length} unfinished from earlier focus
          </span>
          <button
            type="button"
            onClick={() => {
              for (const task of carryOver)
                changeTask(task, { focusDate: today }, "carry over");
            }}
            className="h-6 rounded-md px-2 text-[12px] text-content/75 hover:bg-content/10 hover:text-content"
          >
            Carry over
          </button>
        </div>
      ) : null}
      {error && tasks.length > 0 ? (
        <p
          role="alert"
          className="shrink-0 px-4 py-1 text-[12px] text-red-400/90"
        >
          Could not refresh tasks: {error}{" "}
          <button
            type="button"
            className="underline hover:no-underline"
            onClick={() => void refresh()}
          >
            Retry
          </button>
        </p>
      ) : null}
      {actionError ? (
        <p
          role="alert"
          className="shrink-0 px-4 py-1 text-[12px] text-red-400/90"
        >
          {actionError}
        </p>
      ) : null}
      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">{body}</div>
        {peek.mounted && peekTask ? (
          <TaskPeekPane
            task={peekTask}
            shown={peek.shown}
            closing={!selected}
            recents={recents}
            cwd={cwd}
            onClose={closePeek}
            onDelete={remove}
            onOpenSource={onOpenSource}
            onOpenBeside={onOpenBeside}
            onCreateAnother={create}
            autoFocusTitle={peekTask.id === newTaskId}
          />
        ) : null}
      </div>
    </div>
  );
}

function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 text-center">
      <CheckCircle className="mb-3 size-6 text-content/30" strokeWidth={1.75} />
      <div className="flex flex-col items-center text-[13px] text-content/45">
        {children}
      </div>
    </div>
  );
}

/**
 * Primary "New task" split button: the main part files the task under the
 * current project (or Personal); the chevron chooses where it is filed.
 */
function NewTaskButton({
  creating,
  locations,
  currentLocation,
  onCreate,
  onChooseLocation,
}: {
  creating: boolean;
  locations: readonly SearchableSelectOption[];
  currentLocation: string;
  onCreate: () => void;
  onChooseLocation: (location: string) => void;
}): ReactNode {
  return (
    <div className="flex h-7 shrink-0 items-stretch overflow-hidden rounded-md bg-content text-background-base">
      <button
        type="button"
        title="New task"
        aria-label="New task"
        disabled={creating}
        onClick={onCreate}
        className="inline-flex items-center gap-1.5 pl-2.5 pr-2 text-[12px] font-medium transition-colors duration-100 hover:bg-background-base/10 active:bg-background-base/20 disabled:opacity-60"
      >
        {creating ? (
          <LoaderCircle
            aria-hidden
            className="size-3.5 animate-spin"
            strokeWidth={1.75}
          />
        ) : (
          <Plus aria-hidden className="size-3.5" strokeWidth={1.75} />
        )}
        New task
      </button>
      <span aria-hidden className="my-1.5 w-px bg-background-base/20" />
      <SearchableSelect
        variant="icon"
        label="Choose where the task is filed"
        value={currentLocation}
        options={locations}
        onChange={onChooseLocation}
        searchPlaceholder="Search projects…"
        disabled={creating}
        align="end"
        triggerClassName="grid w-6 place-items-center transition-colors duration-100 hover:bg-background-base/10 active:bg-background-base/20 disabled:opacity-60"
      />
    </div>
  );
}

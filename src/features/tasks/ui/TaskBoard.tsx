import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { suppressTextSelection } from "../../../shared/lib/drag";
import { SharedHoverHighlight } from "../../sessions/ui/SharedHoverHighlight";
import { GripVertical, X } from "../../../shared/ui/icons";
import {
  BoardColumn,
  BoardColumns,
} from "../../../shared/ui/board/BoardColumns";
import type { ProjectMarks } from "../../projects/ui/ProjectMark";
import {
  BOARD_COLUMN_FILL_MIN,
  groupTasksByProject,
  moveGroupKey,
  orderGroups,
  projectGroupKey,
  reorderColumn,
  sortForBoard,
  type BoardGroupBy,
  type TaskBoardState,
} from "../taskViewState";
import {
  TASK_STATUS_LABELS,
  type Task,
  type TaskStatus,
} from "../tasks";
import { TaskGroupIcon } from "./TaskGroupHeader";
import { TaskStatusIcon, TaskStatusMenu } from "./TaskStatusIcon";
import {
  relativeTime,
  TaskDoneChip,
  taskDayChip,
  TaskFocusChip,
  TaskProjectMark,
  TaskStatusLabel,
  TaskTagChips,
} from "./TaskTags";
import { SubtaskReveal, SubtaskToggle, useSubtasksExpanded } from "./SubtaskTree";
import { useOptimisticTask, type TaskMovePatch } from "./useOptimisticTask";

const DRAG_THRESHOLD = 4;

type DragView = {
  task: Task;
  x: number;
  y: number;
  offsetX: number;
  offsetY: number;
  width: number;
  over: string | null;
  /** Insertion index in the target column, counted without the dragged card. */
  index: number;
};

type ColumnDrag = { key: string; over: string | null; after: boolean };

/** One board column: a status, or a project (Personal included). */
type ColumnDef = {
  key: string;
  label: string;
  icon: ReactNode;
  /** What dropping a card here changes. */
  patch: TaskMovePatch;
  tasks: Task[];
};

function columnAtPoint(x: number, y: number): HTMLElement | null {
  return (
    document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-task-column]") ??
    null
  );
}

/** Where a dragged card would land among the other cards of a column. */
function insertionIndex(
  column: HTMLElement,
  y: number,
  draggedId: string,
): number {
  const cards = [
    ...column.querySelectorAll<HTMLElement>("[data-task-card]"),
  ].filter((card) => card.dataset.taskCard !== draggedId);
  const at = cards.findIndex((card) => {
    const rect = card.getBoundingClientRect();
    return y < rect.top + rect.height / 2;
  });
  return at === -1 ? cards.length : at;
}

export function TaskBoard({
  tasks,
  statuses,
  state,
  groupBy,
  selectedId,
  marks,
  today,
  selectedDay = null,
  onStateChange,
  onSelect,
  onTagClick,
  onSaved,
  onContextMenu,
  onCompleted,
}: {
  tasks: readonly Task[];
  /** Status columns to show (the Status filter), in default order. */
  statuses: readonly TaskStatus[];
  state: TaskBoardState;
  groupBy: BoardGroupBy;
  selectedId: string | null;
  marks: ProjectMarks;
  /** Local day (YYYY-MM-DD) for the focus chips. */
  today: string;
  /** Week-strip day; completed cards on a past day show their Done time. */
  selectedDay?: string | null;
  onStateChange: (state: TaskBoardState) => void;
  onSelect: (id: string) => void;
  onTagClick: (tag: string) => void;
  onSaved: (task: Task) => void;
  onContextMenu: (task: Task, x: number, y: number) => void;
  /** A card was dropped into Completed (for the celebration). */
  onCompleted?: (task: Task) => void;
}) {
  const { view, move, error, dismissError } = useOptimisticTask(onSaved);
  const [drag, setDrag] = useState<DragView | null>(null);
  const [columnDrag, setColumnDrag] = useState<ColumnDrag | null>(null);
  const suppressClick = useRef(false);
  const abortDrag = useRef<(() => void) | null>(null);
  const shown = useMemo(() => tasks.map(view), [tasks, view]);
  const columns = useMemo<ColumnDef[]>(() => {
    const groups: ColumnDef[] =
      groupBy === "project"
        ? groupTasksByProject(shown)
            .map((group) => ({
              key: group.key,
              label: group.label,
              icon: <TaskGroupIcon group={group} marks={marks} />,
              patch: { projectCwd: group.projectCwd ?? null },
              tasks: sortForBoard(group.tasks),
            }))
        : statuses
            .map((status) => ({
              key: status,
              label: TASK_STATUS_LABELS[status],
              icon: <TaskStatusIcon status={status} />,
              patch: { status },
              tasks: sortForBoard(shown.filter((task) => task.status === status)),
            }));
    return orderGroups(groups, state.order);
  }, [groupBy, shown, statuses, state.order, marks]);
  /** Column key a task currently belongs to, with pending moves applied. */
  const keyOf = (task: Task) =>
    groupBy === "project" ? projectGroupKey(task.projectCwd) : task.status;
  const dropRef = useRef({ columns, keyOf, view, move, state, onStateChange, onCompleted });
  dropRef.current = { columns, keyOf, view, move, state, onStateChange, onCompleted };
  useEffect(() => () => abortDrag.current?.(), []);

  /** Persist a new column order, keeping keys of hidden columns after it. */
  const saveColumnOrder = (key: string, beforeKey: string | null) => {
    const latest = dropRef.current;
    const visible = latest.columns.map((column) => column.key);
    const moved = moveGroupKey(visible, key, beforeKey);
    const rest = latest.state.order.filter((item) => !moved.includes(item));
    latest.onStateChange({ ...latest.state, order: [...moved, ...rest] });
  };

  const drop = (task: Task, columnKey: string, index: number) => {
    const latest = dropRef.current;
    const target = latest.columns.find((column) => column.key === columnKey);
    if (!target) return;
    const current = latest.view(task);
    const changesColumn = columnKey !== latest.keyOf(current);
    // Dropped back where it was: nothing to save.
    if (
      !changesColumn &&
      target.tasks.findIndex((entry) => entry.id === task.id) === index
    )
      return;
    const updates = reorderColumn(
      target.tasks.filter((entry) => entry.id !== task.id),
      task.id,
      index,
      current,
    );
    const own = updates.find((update) => update.id === task.id);
    if (changesColumn || own)
      latest.move(task, {
        ...(changesColumn ? target.patch : {}),
        ...(own ? { sortOrder: own.sortOrder } : {}),
      });
    for (const update of updates) {
      if (update.id === task.id) continue;
      const other = target.tasks.find((entry) => entry.id === update.id);
      if (other) latest.move(other, { sortOrder: update.sortOrder });
    }
    if (
      changesColumn &&
      target.patch.status === "completed" &&
      current.status !== "completed"
    )
      latest.onCompleted?.(current);
  };

  const beginDrag = (event: ReactPointerEvent<HTMLElement>, task: Task) => {
    if (event.button !== 0) return;
    if (
      event.target instanceof Element &&
      event.target.closest("[data-no-drag]")
    )
      return;
    abortDrag.current?.();
    const element = event.currentTarget;
    const rect = element.getBoundingClientRect();
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startY = event.clientY;
    let active = false;
    let last: { key: string; index: number } | null = null;
    let restoreSelection: () => void = () => {};
    let previousCursor = "";

    const stop = (commit: boolean) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onKey, true);
      abortDrag.current = null;
      if (active) {
        restoreSelection();
        document.body.style.cursor = previousCursor;
        try {
          element.releasePointerCapture(pointerId);
        } catch {
          /* already released */
        }
        setDrag(null);
        // The click that follows a drag must not open the peek.
        suppressClick.current = true;
        window.setTimeout(() => {
          suppressClick.current = false;
        }, 0);
      }
      if (commit && active && last) drop(task, last.key, last.index);
    };
    const onMove = (pointer: globalThis.PointerEvent) => {
      if (pointer.pointerId !== pointerId) return;
      if (!active) {
        if (
          Math.hypot(pointer.clientX - startX, pointer.clientY - startY) <
          DRAG_THRESHOLD
        )
          return;
        active = true;
        try {
          element.setPointerCapture(pointerId);
        } catch {
          /* capture is best effort */
        }
        restoreSelection = suppressTextSelection();
        previousCursor = document.body.style.cursor;
        document.body.style.cursor = "grabbing";
      }
      const column = columnAtPoint(pointer.clientX, pointer.clientY);
      const key = column?.dataset.taskColumn ?? null;
      last =
        column && key
          ? { key, index: insertionIndex(column, pointer.clientY, task.id) }
          : null;
      setDrag({
        task,
        x: pointer.clientX,
        y: pointer.clientY,
        offsetX: startX - rect.left,
        offsetY: startY - rect.top,
        width: rect.width,
        over: last?.key ?? null,
        index: last?.index ?? 0,
      });
    };
    const onUp = (up: globalThis.PointerEvent) => {
      if (up.pointerId !== pointerId) return;
      stop(true);
    };
    const onCancel = (cancel: globalThis.PointerEvent) => {
      if (cancel.pointerId !== pointerId) return;
      stop(false);
    };
    const onKey = (key: KeyboardEvent) => {
      if (key.key !== "Escape" || !active) return;
      key.preventDefault();
      key.stopPropagation();
      stop(false);
    };
    abortDrag.current = () => stop(false);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKey, true);
  };

  const beginColumnDrag = (
    event: ReactPointerEvent<HTMLButtonElement>,
    key: string,
  ) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    abortDrag.current?.();
    const pointerId = event.pointerId;
    const handle = event.currentTarget;
    const restoreSelection = suppressTextSelection();
    let target: ColumnDrag = { key, over: null, after: false };
    try {
      handle.setPointerCapture(pointerId);
    } catch {
      /* capture is best effort */
    }
    setColumnDrag(target);
    const stop = (commit: boolean) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      abortDrag.current = null;
      restoreSelection();
      setColumnDrag(null);
      if (!commit || !target.over || target.over === key) return;
      const keys = dropRef.current.columns.map((column) => column.key);
      const overAt = keys.indexOf(target.over);
      const beforeKey = target.after ? (keys[overAt + 1] ?? null) : target.over;
      saveColumnOrder(key, beforeKey === key ? null : beforeKey);
    };
    const onMove = (pointer: globalThis.PointerEvent) => {
      if (pointer.pointerId !== pointerId) return;
      const column = columnAtPoint(pointer.clientX, pointer.clientY);
      const rect = column?.getBoundingClientRect();
      target = {
        key,
        over: column?.dataset.taskColumn ?? null,
        after: rect ? pointer.clientX > rect.left + rect.width / 2 : false,
      };
      setColumnDrag(target);
    };
    const onUp = (up: globalThis.PointerEvent) => {
      if (up.pointerId === pointerId) stop(true);
    };
    const onCancel = (cancel: globalThis.PointerEvent) => {
      if (cancel.pointerId === pointerId) stop(false);
    };
    abortDrag.current = () => stop(false);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
  };

  /** Arrow keys on a column grip move that column one place. */
  const onGripKey = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    key: string,
  ) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const keys = columns.map((column) => column.key);
    const at = keys.indexOf(key);
    if (event.key === "ArrowLeft" && at > 0) saveColumnOrder(key, keys[at - 1]);
    if (event.key === "ArrowRight" && at < keys.length - 1)
      saveColumnOrder(key, keys[at + 2] ?? null);
  };

  const openMenu = (event: ReactMouseEvent, task: Task) => {
    event.preventDefault();
    onContextMenu(task, event.clientX, event.clientY);
  };

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {error ? (
        <div
          role="alert"
          className="flex shrink-0 items-center gap-2 px-4 py-1.5 text-[12px] text-red-400/90"
        >
          <span className="min-w-0 flex-1 truncate">{error}</span>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={dismissError}
            className="grid size-5 shrink-0 place-items-center rounded text-content/45 hover:bg-content/10 hover:text-content"
          >
            <X className="size-3" strokeWidth={1.75} />
          </button>
        </div>
      ) : null}
      <div className="min-h-0 flex-1">
        <BoardColumns wrapBelow={BOARD_COLUMN_FILL_MIN} fit>
          {columns.map((column) => {
            const rest = drag
              ? column.tasks.filter((task) => task.id !== drag.task.id)
              : column.tasks;
            const indicatorAt =
              drag && drag.over === column.key ? drag.index : null;
            return (
              <BoardColumn
                key={column.key}
                id={column.key}
                label={column.label}
                icon={column.icon}
                handle={
                  <button
                    type="button"
                    aria-label={`Move ${column.label} column`}
                    title="Drag to reorder (or use ← →)"
                    onPointerDown={(event) => beginColumnDrag(event, column.key)}
                    onKeyDown={(event) => onGripKey(event, column.key)}
                    className="-ml-1.5 grid size-5 shrink-0 cursor-grab touch-none place-items-center rounded text-content/30 opacity-0 transition-opacity duration-100 hover:bg-content/10 hover:text-content/70 focus-visible:opacity-100 group-hover/column-header:opacity-100 active:cursor-grabbing"
                  >
                    <GripVertical aria-hidden className="size-3.5" strokeWidth={1.75} />
                  </button>
                }
                count={column.tasks.length}
                fillMin={BOARD_COLUMN_FILL_MIN}
                highlighted={
                  drag?.over === column.key ||
                  (columnDrag !== null &&
                    columnDrag.over === column.key &&
                    columnDrag.key !== column.key)
                }
                dimmed={columnDrag?.key === column.key}
                columnProps={{ "data-task-column": column.key }}
              >
                {column.tasks.length === 0 && indicatorAt === null ? (
                  <p className="px-2 py-3 text-center text-[12px] text-content/35">
                    No tasks
                  </p>
                ) : (
                  <div className="relative">
                    <SharedHoverHighlight />
                    <ul
                      data-shared-hover-continuity
                      className="flex flex-col gap-1.5"
                      role="list"
                    >
                      {column.tasks.map((task) => {
                        const restIndex = rest.indexOf(task);
                        return (
                          <li key={task.id}>
                            {indicatorAt !== null && restIndex === indicatorAt ? (
                              <DropLine />
                            ) : null}
                            <TaskCard
                              task={task}
                              status={task.status}
                              active={selectedId === task.id}
                              dragging={drag?.task.id === task.id}
                              marks={marks}
                              groupBy={groupBy}
                              today={today}
                              selectedDay={selectedDay}
                              onPointerDown={(event) => beginDrag(event, task)}
                              onContextMenu={(event) => openMenu(event, task)}
                              onSelect={() => {
                                if (suppressClick.current) return;
                                onSelect(task.id);
                              }}
                              onTagClick={onTagClick}
                              onStatusChange={(next) => {
                                move(task, { status: next });
                                if (next === "completed" && task.status !== "completed")
                                  onCompleted?.(task);
                              }}
                            />
                          </li>
                        );
                      })}
                      {indicatorAt !== null && indicatorAt >= rest.length ? (
                        <li aria-hidden>
                          <DropLine />
                        </li>
                      ) : null}
                    </ul>
                  </div>
                )}
              </BoardColumn>
            );
          })}
          {columns.length === 0 ? (
            <p className="m-auto text-[12px] text-content/45">
              {groupBy === "project"
                ? "No project columns to show."
                : "No columns shown. Choose statuses in the Status filter."}
            </p>
          ) : null}
        </BoardColumns>
      </div>
      {drag ? (
        <div
          aria-hidden
          className="pointer-events-none fixed top-0 left-0 z-50 opacity-90 shadow-xl"
          style={{
            width: drag.width,
            transform: `translate(${drag.x - drag.offsetX}px, ${drag.y - drag.offsetY}px)`,
          }}
        >
          <TaskCard
            task={view(drag.task)}
            status={view(drag.task).status}
            active={false}
            dragging={false}
            marks={marks}
            groupBy={groupBy}
            today={today}
            selectedDay={selectedDay}
            ghost
          />
        </div>
      ) : null}
    </div>
  );
}

/** Where a dragged card will land. */
function DropLine(): ReactNode {
  return (
    <span
      aria-hidden
      data-drop-line
      className="mb-1.5 block h-0.5 rounded-full bg-accent/80"
    />
  );
}

/** Fork (L-373): a card's subtask count, and its steps sliding open as a tree. */
function TaskCardSubtasks({ task }: { task: Task }): ReactNode {
  const [open, toggle] = useSubtasksExpanded(task.id);
  if (!task.subtasks?.length) return null;
  return (
    <div data-no-drag className="cursor-default px-2.5 pb-1.5">
      <SubtaskToggle subtasks={task.subtasks} open={open} onToggle={toggle} className="-ml-1.5" />
      <SubtaskReveal task={task} open={open} className="ml-1.5 pb-0.5" />
    </div>
  );
}

function TaskCard({
  task,
  status,
  active,
  dragging,
  marks,
  groupBy,
  today,
  selectedDay = null,
  ghost = false,
  onPointerDown,
  onContextMenu,
  onSelect,
  onTagClick,
  onStatusChange,
}: {
  task: Task;
  status: TaskStatus;
  active: boolean;
  dragging: boolean;
  marks: ProjectMarks;
  groupBy: BoardGroupBy;
  today: string;
  selectedDay?: string | null;
  ghost?: boolean;
  onPointerDown?: (event: ReactPointerEvent<HTMLElement>) => void;
  onContextMenu?: (event: ReactMouseEvent<HTMLElement>) => void;
  onSelect?: () => void;
  onTagClick?: (tag: string) => void;
  onStatusChange?: (status: TaskStatus) => void;
}) {
  const time = relativeTime(task.updatedAt);
  const archived = task.archivedAt !== undefined;
  return (
    <div
      data-task-card={ghost ? undefined : task.id}
      data-archived={archived ? "" : undefined}
      data-shared-hover-item={ghost ? undefined : ""}
      data-shared-hover-preserve={active ? "" : undefined}
      onPointerDown={onPointerDown}
      onContextMenu={onContextMenu}
      className={`group relative touch-none rounded-md ${
        active ? "bg-selection" : "surface-tint"
      } ${dragging ? "opacity-40" : archived ? "opacity-55" : ""}`}
    >
      <button
        type="button"
        tabIndex={ghost ? -1 : undefined}
        data-task-id={ghost ? undefined : task.id}
        aria-current={active ? "true" : undefined}
        aria-label={archived ? `${task.title} (archived)` : undefined}
        onClick={onSelect}
        className="block w-full rounded-md px-2.5 py-2 text-left"
      >
        <span
          className={`line-clamp-2 block pr-6 text-[13px] font-medium text-content ${
            archived ? "line-through decoration-content/40" : ""
          }`}
        >
          {task.title}
        </span>
        <span className="mt-1.5 flex min-w-0 items-center gap-2 text-[11px] text-content/50">
          <span className="min-w-0 max-w-28 shrink">
            {groupBy === "project" ? (
              <TaskStatusLabel status={status} />
            ) : (
              <TaskProjectMark task={task} marks={marks} />
            )}
          </span>
          {taskDayChip(task, selectedDay ?? null, today) && task.completedAt !== undefined ? (
            <TaskDoneChip completedAt={task.completedAt} />
          ) : (
            <TaskFocusChip task={task} today={today} />
          )}
          <TaskTagChips
            tags={task.tags}
            max={2}
            onTagClick={onTagClick ?? (() => {})}
          />
          {time ? (
            <span className="ml-auto shrink-0 tabular-nums text-content/45">
              {time}
            </span>
          ) : null}
        </span>
      </button>
      {ghost ? null : <TaskCardSubtasks task={task} />}
      {ghost ? null : (
        <div className="absolute top-1 right-1 opacity-0 transition-opacity duration-100 group-focus-within:opacity-100 group-hover:opacity-100">
          <TaskStatusMenu
            status={status}
            iconOnly
            onChange={(next) => onStatusChange?.(next)}
          />
        </div>
      )}
    </div>
  );
}

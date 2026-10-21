import { useMemo, useRef, type MouseEvent, type ReactNode } from "react";
import { ChevronDown } from "../../../shared/ui/icons";
import { useLockOverscroll } from "../../../shared/hooks/useLockOverscroll";
import type { ProjectMarks } from "../../projects/ui/ProjectMark";
import {
  TASK_COLUMNS,
  TASK_COLUMN_IDS,
  TASK_COLUMN_MAX_WIDTH,
  clampColumnWidth,
  groupTasks,
  nextSort,
  sortTasks,
  type TaskColumnId,
  type TaskGroupBy,
  type TaskTableState,
} from "../taskViewState";
import type { Task, TaskStatus } from "../tasks";
import { ResizeHandle } from "../../../shared/ui/ResizeHandle";
import { SharedHoverHighlight } from "../../sessions/ui/SharedHoverHighlight";
import { TaskGroupHeader } from "./TaskGroupHeader";
import { TaskStatusMenu } from "./TaskStatusIcon";
import { relativeTime, TaskProjectMark, TaskTagChips } from "./TaskTags";

export function TaskTable({
  tasks,
  state,
  groupBy,
  selectedId,
  marks,
  onStateChange,
  onSelect,
  onTagClick,
  onStatusChange,
  onContextMenu,
}: {
  tasks: readonly Task[];
  state: TaskTableState;
  groupBy: TaskGroupBy;
  selectedId: string | null;
  marks: ProjectMarks;
  onStateChange: (state: TaskTableState) => void;
  onSelect: (id: string) => void;
  onTagClick: (tag: string) => void;
  onStatusChange: (task: Task, status: TaskStatus) => void;
  onContextMenu: (task: Task, x: number, y: number) => void;
}) {
  const lock = useLockOverscroll<HTMLDivElement>();
  const table = useRef<HTMLTableElement>(null);
  const columns = TASK_COLUMN_IDS.filter((id) => !state.hidden.includes(id));
  const widthOf = (id: TaskColumnId) => state.widths[id];
  const total = columns.reduce((sum, id) => sum + widthOf(id), 0);
  /**
   * Fork (L-176): a column drag writes its `<col>` and the table width on
   * the DOM each frame, so cells re-wrap live without re-rendering every row;
   * `null` puts the saved widths back before the commit renders.
   */
  const previewWidth = (column: TaskColumnId, width: number | null) => {
    const element = table.current;
    if (!element) return;
    const widths = columns.map((id) =>
      id === column && width !== null ? width : widthOf(id),
    );
    element.style.setProperty(
      "width",
      `${widths.reduce((sum, value) => sum + value, 0)}px`,
    );
    element
      .querySelector<HTMLElement>(`col[data-column="${column}"]`)
      ?.style.setProperty("width", `${width ?? widthOf(column)}px`);
  };
  const groups = useMemo(
    () => groupTasks(sortTasks(tasks, state.sort), groupBy),
    [tasks, state.sort, groupBy],
  );
  const toggleGroup = (key: string) =>
    onStateChange({
      ...state,
      collapsed: state.collapsed.includes(key)
        ? state.collapsed.filter((item) => item !== key)
        : [...state.collapsed, key],
    });

  const cell = (task: Task, id: TaskColumnId): ReactNode => {
    switch (id) {
      case "title":
        return (
          <button
            type="button"
            data-task-id={task.id}
            className={`block w-full truncate text-left text-[12px] font-medium text-content ${
              task.archivedAt !== undefined
                ? "line-through decoration-content/40"
                : ""
            }`}
          >
            {task.title}
          </button>
        );
      case "status":
        return (
          <TaskStatusMenu
            status={task.status}
            onChange={(status) => onStatusChange(task, status)}
          />
        );
      case "project":
        return (
          <span className="block min-w-0 text-content/60">
            <TaskProjectMark task={task} marks={marks} />
          </span>
        );
      case "tags":
        return (
          <TaskTagChips tags={task.tags} max={3} onTagClick={onTagClick} />
        );
      case "updated":
        return (
          <span className="tabular-nums text-content/50">
            {relativeTime(task.updatedAt)}
          </span>
        );
      case "completed":
        return (
          <span className="tabular-nums text-content/50">
            {relativeTime(task.completedAt)}
          </span>
        );
    }
  };

  return (
    <div
      ref={lock}
      className="relative min-h-0 min-w-0 flex-1 overflow-auto overscroll-none"
    >
      <SharedHoverHighlight />
      <table
        ref={table}
        aria-label="Tasks table"
        className="table-fixed border-separate border-spacing-0 text-[12px]"
        style={{ width: total, minWidth: "100%" }}
      >
        <colgroup>
          {columns.map((id) => (
            <col key={id} data-column={id} style={{ width: widthOf(id) }} />
          ))}
        </colgroup>
        {/* One sticky, blurred header layer instead of a blur per cell: each
            backdrop-filter is its own GPU layer, recomputed on every scroll. */}
        <thead className="surface-tint surface-blur sticky top-0 z-20">
          <tr>
            {columns.map((id) => {
              const meta = TASK_COLUMNS[id];
              const sorted = state.sort.column === id;
              return (
                <th
                  key={id}
                  scope="col"
                  aria-sort={
                    sorted
                      ? state.sort.dir === "asc"
                        ? "ascending"
                        : "descending"
                      : undefined
                  }
                  className="h-8 border-b border-stroke px-3 text-left text-[11px] font-normal text-content/50"
                >
                  <button
                    type="button"
                    onClick={() =>
                      onStateChange({
                        ...state,
                        sort: nextSort(state.sort, id),
                      })
                    }
                    className="inline-flex max-w-full items-center gap-1 hover:text-content"
                  >
                    <span className="truncate">{meta.header}</span>
                    {sorted ? (
                      <ChevronDown
                        aria-hidden
                        className={`size-3 shrink-0 ${
                          state.sort.dir === "asc" ? "rotate-180" : ""
                        }`}
                      />
                    ) : null}
                  </button>
                  <ResizeHandle
                    label={`Resize ${meta.header} column`}
                    value={widthOf(id)}
                    min={meta.min}
                    max={TASK_COLUMN_MAX_WIDTH}
                    defaultValue={meta.width}
                    onLive={(width) => previewWidth(id, width)}
                    onCommit={(width) =>
                      onStateChange({
                        ...state,
                        widths: {
                          ...state.widths,
                          [id]: clampColumnWidth(id, width),
                        },
                      })
                    }
                  />
                </th>
              );
            })}
          </tr>
        </thead>
        {groups.map((group) => {
          const grouped = groupBy !== "none";
          const collapsed = grouped && state.collapsed.includes(group.key);
          return (
            <tbody key={group.key} data-shared-hover-continuity>
              {grouped ? (
                <tr>
                  <th
                    colSpan={columns.length}
                    scope="colgroup"
                    className="h-8 bg-content/2 px-2 text-left font-normal"
                  >
                    <TaskGroupHeader
                      group={group}
                      collapsed={collapsed}
                      marks={marks}
                      onToggle={() => toggleGroup(group.key)}
                    />
                  </th>
                </tr>
              ) : null}
              {collapsed
                ? null
                : group.tasks.map((task) => {
                    const active = selectedId === task.id;
                    return (
                      <tr
                        key={task.id}
                        aria-selected={active}
                        data-task-row={task.id}
                        data-archived={
                          task.archivedAt !== undefined ? "" : undefined
                        }
                        onContextMenu={(event) => {
                          event.preventDefault();
                          onContextMenu(task, event.clientX, event.clientY);
                        }}
                        data-shared-hover-item
                        data-shared-hover-preserve={active ? "" : undefined}
                        onClick={(event: MouseEvent<HTMLTableRowElement>) => {
                          if (
                            event.target instanceof Element &&
                            event.target.closest("[data-row-ignore]")
                          )
                            return;
                          onSelect(task.id);
                        }}
                        className={`h-9 cursor-pointer transition-colors duration-100 ${
                          active
                            ? "bg-selection text-content"
                            : "text-content/80 hover:bg-content/5"
                        } ${task.archivedAt !== undefined ? "opacity-55" : ""}`}
                      >
                        {columns.map((id) => (
                          <td key={id} className="min-w-0 truncate px-3">
                            {cell(task, id)}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
            </tbody>
          );
        })}
      </table>
    </div>
  );
}

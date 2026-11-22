import { useMemo, useRef, useState, type JSX, type MouseEvent, type ReactNode } from "react";
import { BoardColumn, BoardColumns } from "../../../shared/ui/board/BoardColumns";
import { ChevronDown, Flag } from "../../../shared/ui/icons";
import { ResizeHandle } from "../../../shared/ui/ResizeHandle";
import { RevealHeight, useRevealHeight } from "../../../shared/ui/RevealHeight";
import { BOARD_COLUMN_FILL_MIN } from "../../tasks/taskViewState";
import type { ClickupTask } from "../model/clickupApi";
import { dueLabel } from "../model/clickupTasks";
import {
  customFieldColumns,
  type ClickupGroup,
  type ClickupGroupBy,
  type ClickupSort,
  type ClickupSortField,
} from "../model/clickupViewState";
import {
  ClickupAvatars,
  ClickupFieldValue,
  ClickupGroupHeader,
  ClickupPriorityFlag,
  ClickupStatusPill,
  shortDate,
} from "./ClickupBits";
import { ClickupTaskRow } from "./ClickupTaskRow";

/**
 * Fork (L-381): the ClickUp page's List, Table and Board. They only render
 * the groups they are given; grouping, sorting and folding live in
 * `clickupViewState` and the page.
 */

interface ViewProps {
  groups: readonly ClickupGroup[];
  groupBy: ClickupGroupBy;
  selectedId: string | null;
  now: number;
  /** List name per task; null hides it (one list on screen). */
  listName: (task: ClickupTask) => string | null;
  onOpen: (task: ClickupTask) => void;
}

interface FoldProps {
  collapsed: readonly string[];
  onToggleGroup: (key: string) => void;
}

export function ClickupListView({
  groups,
  groupBy,
  selectedId,
  now,
  listName,
  collapsed,
  onToggleGroup,
  onOpen,
}: ViewProps & FoldProps): JSX.Element {
  const grouped = groupBy !== "none";
  return (
    <div className="py-1">
      {groups.map((group) => {
        const folded = grouped && collapsed.includes(group.key);
        return (
          <section key={group.key} aria-label={grouped ? group.label : "Tasks"} className={grouped ? "pb-2" : ""}>
            {grouped ? (
              <div className="sticky top-0 z-10 px-2 pt-2 pb-1 surface-tint surface-blur">
                <ClickupGroupHeader
                  group={group}
                  groupBy={groupBy}
                  collapsed={folded}
                  onToggle={() => onToggleGroup(group.key)}
                />
              </div>
            ) : null}
            {/* Same fold as the sidebar's folders and file tree: slides open and shut. */}
            <RevealHeight open={!folded}>
              <ul>
                {group.tasks.map((task) => (
                  <li key={task.id}>
                    <ClickupTaskRow
                      task={task}
                      listName={listName(task)}
                      now={now}
                      selected={selectedId === task.id}
                      onOpen={() => onOpen(task)}
                    />
                  </li>
                ))}
              </ul>
            </RevealHeight>
          </section>
        );
      })}
    </div>
  );
}

type FixedColumnId = "name" | "status" | "assignees" | "priority" | "due" | "start" | "created" | "updated" | "id" | "list" | "tags";

interface Column {
  id: string;
  header: string;
  width: number;
  /** Header click sorts by this field. */
  sort?: ClickupSortField;
  cell: (task: ClickupTask) => ReactNode;
}

const muted = (text: string): ReactNode =>
  text ? <span className="tabular-nums text-content/60">{text}</span> : <span className="text-content/25">–</span>;

function tableColumns(tasks: readonly ClickupTask[], now: number, listName: ViewProps["listName"]): Column[] {
  const showList = tasks.some((task) => listName(task) !== null);
  const showTags = tasks.some((task) => task.tags.length > 0);
  const fixed: Record<FixedColumnId, Column | null> = {
    name: {
      id: "name",
      header: "Name",
      width: 360,
      sort: "name",
      cell: (task) => <span className="block truncate text-[12.5px] text-content/90">{task.name}</span>,
    },
    status: {
      id: "status",
      header: "Status",
      width: 150,
      sort: "status",
      cell: (task) => <ClickupStatusPill name={task.status.status} color={task.status.color || null} />,
    },
    assignees: {
      id: "assignees",
      header: "Assignee",
      width: 110,
      sort: "assignee",
      cell: (task) => (task.assignees.length ? <ClickupAvatars members={task.assignees} /> : muted("")),
    },
    priority: {
      id: "priority",
      header: "Priority",
      width: 100,
      sort: "priority",
      cell: (task) => (task.priority === null ? muted("") : <ClickupPriorityFlag priority={task.priority} withLabel />),
    },
    due: {
      id: "due",
      header: "Due date",
      width: 110,
      sort: "dueDate",
      cell: (task) => {
        const due = dueLabel(task.dueDate, now);
        return due ? (
          <span className={`tabular-nums ${due.overdue ? "text-red-400" : "text-content/60"}`}>{due.text}</span>
        ) : (
          muted("")
        );
      },
    },
    start: { id: "start", header: "Start date", width: 110, sort: "startDate", cell: (task) => muted(shortDate(task.startDate, now)) },
    created: { id: "created", header: "Date created", width: 120, sort: "dateCreated", cell: (task) => muted(shortDate(task.dateCreated, now)) },
    updated: { id: "updated", header: "Date updated", width: 120, sort: "dateUpdated", cell: (task) => muted(shortDate(task.dateUpdated, now)) },
    id: {
      id: "id",
      header: "Task ID",
      width: 130,
      cell: (task) => <span className="tabular-nums text-content/55">#{task.customId ?? task.id}</span>,
    },
    list: showList ? { id: "list", header: "List", width: 130, cell: (task) => muted(listName(task) ?? "") } : null,
    tags: showTags
      ? {
          id: "tags",
          header: "Tags",
          width: 160,
          cell: (task) =>
            task.tags.length ? (
              <span className="flex min-w-0 gap-1 overflow-hidden">
                {task.tags.map((tag) => (
                  <span key={tag} className="shrink-0 rounded bg-content/8 px-1.5 text-[11px] text-content/70">
                    {tag}
                  </span>
                ))}
              </span>
            ) : (
              muted("")
            ),
        }
      : null,
  };
  const custom: Column[] = customFieldColumns(tasks).map((field) => ({
    id: `field:${field.id}`,
    header: field.name,
    width: 140,
    cell: (task) => {
      const value = task.customFields.find((entry) => entry.id === field.id);
      return value ? <ClickupFieldValue field={value} now={now} /> : muted("");
    },
  }));
  const order: FixedColumnId[] = ["name", "status", "assignees", "priority", "due", "start"];
  const tail: FixedColumnId[] = ["tags", "id", "created", "updated", "list"];
  const pick = (ids: FixedColumnId[]) => ids.map((id) => fixed[id]).filter((column): column is Column => column !== null);
  return [...pick(order), ...custom, ...pick(tail)];
}

/** Next sort when a header is clicked: a new field starts ascending, the same field flips. */
export function nextClickupSort(current: ClickupSort, field: ClickupSortField): ClickupSort {
  return current.field === field ? { field, dir: current.dir === "asc" ? "desc" : "asc" } : { field, dir: "asc" };
}

/**
 * A group's table rows, folding like the List's groups. Rows can't sit in a
 * wrapper element, so each cell's content slides (the same reveal-height
 * animation) and the rows unmount when the fold-out ends.
 */
function ClickupTableRows({
  tasks,
  open,
  columns,
  selectedId,
  onOpen,
}: {
  tasks: readonly ClickupTask[];
  open: boolean;
  columns: readonly Column[];
  selectedId: string | null;
  onOpen: (task: ClickupTask) => void;
}): JSX.Element | null {
  const { rendered, closing, revealClass, settle } = useRevealHeight(open);
  if (!rendered) return null;
  return (
    <>
      {tasks.map((task, index) => {
        const active = selectedId === task.id;
        return (
          <tr
            key={task.id}
            aria-selected={active}
            data-clickup-row={task.id}
            inert={closing || undefined}
            onClick={(event: MouseEvent<HTMLTableRowElement>) => {
              // The name button handles its own click (and keyboard).
              if (event.target instanceof Element && event.target.closest("button")) return;
              onOpen(task);
            }}
            className={`cursor-pointer transition-colors duration-100 ${
              active ? "bg-selection text-content" : "text-content/80 hover:bg-content/5"
            }`}
          >
            {columns.map((column, at) => (
              <td
                key={column.id}
                className={`min-w-0 px-3 transition-[border-color] duration-200 ${
                  closing ? "border-b border-transparent" : "border-b border-content/5"
                }`}
              >
                <div
                  className={revealClass}
                  // Every cell animates the same; one cell is enough to end the fold.
                  onAnimationEnd={index === 0 && at === 0 ? (event) => {
                    if (event.target === event.currentTarget) settle();
                  } : undefined}
                >
                  <div className="flex h-9 min-w-0 items-center">
                    {column.id === "name" ? (
                      <button
                        type="button"
                        onClick={() => onOpen(task)}
                        aria-current={active ? "true" : undefined}
                        className="block w-full min-w-0 truncate text-left outline-none focus-visible:underline"
                      >
                        {column.cell(task)}
                      </button>
                    ) : (
                      <div className="min-w-0 truncate">{column.cell(task)}</div>
                    )}
                  </div>
                </div>
              </td>
            ))}
          </tr>
        );
      })}
    </>
  );
}

export function ClickupTableView({
  groups,
  groupBy,
  selectedId,
  now,
  listName,
  collapsed,
  onToggleGroup,
  onOpen,
  sort,
  onSortChange,
}: ViewProps &
  FoldProps & {
    sort: ClickupSort;
    onSortChange: (sort: ClickupSort) => void;
  }): JSX.Element {
  const columns = tableColumns(
    groups.flatMap((group) => group.tasks),
    now,
    listName,
  );
  const total = columns.reduce((sum, column) => sum + column.width, 0);
  const grouped = groupBy !== "none";
  return (
    <div className="relative min-h-0 min-w-0 flex-1 overflow-auto overscroll-none">
      <table
        aria-label="ClickUp tasks"
        className="table-fixed border-separate border-spacing-0 text-[12px]"
        style={{ width: total, minWidth: "100%" }}
      >
        <colgroup>
          {columns.map((column) => (
            <col key={column.id} style={{ width: column.width }} />
          ))}
        </colgroup>
        <thead className="surface-tint surface-blur sticky top-0 z-20">
          <tr>
            {columns.map((column) => {
              const sorted = column.sort !== undefined && sort.field === column.sort;
              return (
                <th
                  key={column.id}
                  scope="col"
                  aria-sort={sorted ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}
                  className="h-8 border-b border-stroke px-3 text-left text-[11px] font-normal text-content/50"
                >
                  {column.sort ? (
                    <button
                      type="button"
                      onClick={() => column.sort && onSortChange(nextClickupSort(sort, column.sort))}
                      className="inline-flex max-w-full items-center gap-1 hover:text-content"
                    >
                      <span className="truncate">{column.header}</span>
                      {sorted ? (
                        <ChevronDown aria-hidden className={`size-3 shrink-0 ${sort.dir === "asc" ? "rotate-180" : ""}`} />
                      ) : null}
                    </button>
                  ) : (
                    <span className="block truncate">{column.header}</span>
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        {groups.map((group) => {
          const folded = grouped && collapsed.includes(group.key);
          return (
            <tbody key={group.key}>
              {grouped ? (
                <tr>
                  <th
                    colSpan={columns.length}
                    scope="colgroup"
                    className="h-9 cursor-pointer px-2 pt-2 text-left font-normal transition-colors duration-100 hover:bg-content/[0.03]"
                    // The whole row folds the group; the header button inside keeps keyboard access.
                    onClick={(event) => {
                      if (event.target instanceof Element && event.target.closest("button")) return;
                      onToggleGroup(group.key);
                    }}
                  >
                    <span className="sticky left-2 inline-block max-w-full">
                      <ClickupGroupHeader
                        group={group}
                        groupBy={groupBy}
                        collapsed={folded}
                        onToggle={() => onToggleGroup(group.key)}
                      />
                    </span>
                  </th>
                </tr>
              ) : null}
              <ClickupTableRows
                tasks={group.tasks}
                open={!folded}
                columns={columns}
                selectedId={selectedId}
                onOpen={onOpen}
              />
            </tbody>
          );
        })}
      </table>
    </div>
  );
}

/** Narrowest a column gets when a divider is dragged. */
const SPLIT_MIN = 140;

interface BoardSplitProps {
  /** Saved column shares by group key; missing keys are 1. */
  columnWeights: Readonly<Record<string, number>>;
  /** Saves new shares for the given keys; an empty object resets them all. */
  onColumnWeightsChange: (weights: Record<string, number>) => void;
}

/**
 * Widths after moving the divider right of column `index` so that column is
 * `next` px wide; its right neighbour gives or takes the difference, so the
 * row's total never changes (the board never scrolls sideways).
 */
export function splitWidths(widths: readonly number[], index: number, next: number): number[] {
  const left = widths[index];
  const right = widths[index + 1];
  if (left === undefined || right === undefined) return [...widths];
  const pair = left + right;
  const low = Math.min(SPLIT_MIN, pair / 2);
  const leftWidth = Math.min(pair - low, Math.max(low, next));
  const result = [...widths];
  result[index] = leftWidth;
  result[index + 1] = pair - leftWidth;
  return result;
}

/** Column shares by key, relative to the average column (1). */
function weightsFor(keys: readonly string[], widths: readonly number[]): Record<string, number> {
  const mean = widths.reduce((sum, width) => sum + width, 0) / Math.max(1, widths.length);
  const weights: Record<string, number> = {};
  keys.forEach((key, at) => {
    weights[key] = mean > 0 ? Number(((widths[at] ?? mean) / mean).toFixed(3)) : 1;
  });
  return weights;
}

export function ClickupBoardView({
  groups,
  groupBy,
  selectedId,
  now,
  listName,
  onOpen,
  columnWeights,
  onColumnWeightsChange,
}: ViewProps & BoardSplitProps): JSX.Element {
  const boardRef = useRef<HTMLDivElement>(null);
  // Column widths when a drag (or arrow key press) starts; each move is measured against them.
  const startWidths = useRef<number[]>([]);
  // Shares while dragging; saved once on release so the drag doesn't write storage every frame.
  const [liveWeights, setLiveWeights] = useState<Record<string, number> | null>(null);
  const weights = liveWeights ?? columnWeights;
  const keys = groups.map((group) => group.key);

  const measure = (): number[] =>
    [...(boardRef.current?.querySelectorAll<HTMLElement>("[data-board-column]") ?? [])].map(
      (column) => column.getBoundingClientRect().width,
    );
  const sharesAfter = (index: number, next: number): Record<string, number> =>
    weightsFor(keys, splitWidths(startWidths.current, index, next));

  // Cards don't depend on column widths: keep them out of the per-frame drag renders.
  const bodies = useMemo(
    () =>
      groups.map((group) =>
        group.tasks.length === 0 ? (
          <p className="px-1.5 py-3 text-center text-[11.5px] text-content/35">No tasks</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {group.tasks.map((task) => (
              <li key={task.id}>
                <ClickupCard
                  task={task}
                  now={now}
                  listName={listName(task)}
                  showStatus={groupBy !== "status"}
                  active={selectedId === task.id}
                  onOpen={() => onOpen(task)}
                />
              </li>
            ))}
          </ul>
        ),
      ),
    [groups, groupBy, selectedId, now, listName, onOpen],
  );

  return (
    // Pinned to the pane (like the Task Manager board): columns never grow past it, cards scroll inside them.
    <div ref={boardRef} className="relative min-h-0 min-w-0 flex-1">
      <div className="absolute inset-0 flex flex-col">
      <BoardColumns fit>
        {groups.map((group, index) => (
          <BoardColumn
            key={group.key}
            id={group.key}
            label={group.label}
            icon={<ColumnMark group={group} groupBy={groupBy} />}
            count={group.tasks.length}
            fillMin={BOARD_COLUMN_FILL_MIN}
            grow={weights[group.key] ?? 1}
            edge={
              index < groups.length - 1 ? (
                <ResizeHandle
                  label={`Resize ${group.label} column`}
                  value={Math.round(startWidths.current[index] ?? 0)}
                  min={0}
                  max={100_000}
                  defaultValue={0}
                  placement="inset-y-2 -right-2.5 rounded-full"
                  getStartValue={() => {
                    startWidths.current = measure();
                    return startWidths.current[index] ?? 0;
                  }}
                  onLive={(next) => {
                    if (next !== null) setLiveWeights(sharesAfter(index, next));
                  }}
                  onCommit={(next) => {
                    setLiveWeights(null);
                    onColumnWeightsChange(sharesAfter(index, next));
                  }}
                  onReset={() => {
                    setLiveWeights(null);
                    onColumnWeightsChange({});
                  }}
                />
              ) : undefined
            }
          >
            {bodies[index]}
          </BoardColumn>
        ))}
      </BoardColumns>
      </div>
    </div>
  );
}

/** Status colour dot or priority flag before a board column's name. */
function ColumnMark({ group, groupBy }: { group: ClickupGroup; groupBy: ClickupGroupBy }): JSX.Element | null {
  if (groupBy === "priority") return <Flag aria-hidden className="size-3.5 shrink-0" style={{ color: group.color ?? undefined }} strokeWidth={2} />;
  if (groupBy !== "status") return null;
  return (
    <span
      aria-hidden
      className="size-2.5 shrink-0 rounded-full bg-content/30"
      style={group.color ? { backgroundColor: group.color } : undefined}
    />
  );
}

function ClickupCard({
  task,
  now,
  listName,
  showStatus,
  active,
  onOpen,
}: {
  task: ClickupTask;
  now: number;
  listName: string | null;
  showStatus: boolean;
  active: boolean;
  onOpen: () => void;
}): JSX.Element {
  const due = dueLabel(task.dueDate, now);
  const chips = task.customFields.filter((field) => field.color).slice(0, 2);
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-current={active ? "true" : undefined}
      className={`block w-full rounded-md px-2.5 py-2 text-left transition-[background-color,transform] duration-100 active:scale-[0.99] motion-reduce:active:scale-100 ${
        active ? "bg-selection" : "surface-tint hover:bg-content/8"
      }`}
    >
      {showStatus ? (
        <span className="mb-1 flex">
          <ClickupStatusPill name={task.status.status} color={task.status.color || null} />
        </span>
      ) : null}
      <span className="line-clamp-2 block text-[13px] font-medium text-content">{task.name}</span>
      {chips.length || listName ? (
        <span className="mt-1.5 flex min-w-0 flex-wrap items-center gap-1">
          {chips.map((field) => (
            <ClickupFieldValue key={field.id} field={field} now={now} />
          ))}
          {listName ? <span className="truncate text-[11px] text-content/45">{listName}</span> : null}
        </span>
      ) : null}
      <span className="mt-1.5 flex min-w-0 items-center gap-2 text-[11px] text-content/50">
        <ClickupPriorityFlag priority={task.priority} />
        {due ? <span className={`tabular-nums ${due.overdue ? "text-red-400" : ""}`}>{due.text}</span> : null}
        <span className="ml-auto">
          <ClickupAvatars members={task.assignees} />
        </span>
      </span>
    </button>
  );
}

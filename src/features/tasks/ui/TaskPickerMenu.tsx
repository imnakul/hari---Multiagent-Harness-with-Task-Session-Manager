import { useLayoutEffect, useRef, type ReactNode, type RefObject } from "react";
import { SharedHoverHighlight } from "../../sessions/ui/SharedHoverHighlight";
import {
  TASK_PICKER_GROUP_LABELS,
  type TaskPickerGroup,
  type TaskPickerRow,
} from "../taskPicker";
import { TaskStatusIcon } from "./TaskStatusIcon";
import type { TaskPickerMenuState } from "./useTaskPickerMenu";

/**
 * The `#` task list (L-180), styled like the `!` saved-prompt list.
 * `floating` draws its own card (above a composer); without it the list sits
 * inside the host's panel.
 */
export function TaskPickerMenu({
  state,
  floating = true,
}: {
  state: TaskPickerMenuState;
  floating?: boolean;
}): ReactNode {
  const activeRef = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    activeRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [state.active, state.query]);

  if (!state.open) return null;
  return (
    <div
      data-task-picker-menu
      className={
        floating
          ? "relative overflow-hidden rounded-lg border border-content/10 bg-content/5 backdrop-blur-xl"
          : "relative border-t border-stroke"
      }
    >
      <SharedHoverHighlight />
      {state.matches.length === 0 ? (
        <p className="px-3 py-2.5 text-[12px] text-content/50">
          No Todo tasks for this project or Personal. Add them in Tasks.
        </p>
      ) : (
        <div
          role="listbox"
          aria-label="Tasks"
          className="max-h-[min(240px,40vh)] overflow-y-auto overscroll-none px-1 py-1"
        >
          {TASK_PICKER_GROUPS.map((group) => {
            const rows = state.matches.flatMap((row, index) =>
              row.group === group ? [{ row, index }] : [],
            );
            if (rows.length === 0) return null;
            const labelId = `task-picker-group-${group}`;
            return (
              <div key={group} role="group" aria-labelledby={labelId}>
                <p
                  id={labelId}
                  className="px-2 pb-0.5 pt-1.5 text-[11px] font-medium text-content/40"
                >
                  {TASK_PICKER_GROUP_LABELS[group]}
                </p>
                {rows.map(({ row, index }) => (
                  <TaskPickerOption
                    key={row.task.id}
                    state={state}
                    row={row}
                    index={index}
                    activeRef={activeRef}
                  />
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const TASK_PICKER_GROUPS: readonly TaskPickerGroup[] = ["project", "personal"];

function TaskPickerOption({
  state,
  row,
  index,
  activeRef,
}: {
  state: TaskPickerMenuState;
  row: TaskPickerRow;
  index: number;
  activeRef: RefObject<HTMLButtonElement | null>;
}): ReactNode {
  const highlighted = index === state.active;
  const body = row.task.body.trim();
  return (
    <button
      ref={highlighted ? activeRef : undefined}
      type="button"
      role="option"
      aria-selected={highlighted}
      tabIndex={-1}
      onMouseDown={(event) => event.preventDefault()}
      onMouseEnter={() => state.setActive(index)}
      onClick={() => state.pick(row)}
      className={`flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left text-content ${
        highlighted ? "bg-content/10" : ""
      }`}
    >
      <span className="flex w-full min-w-0 items-center gap-1.5">
        <TaskStatusIcon status={row.task.status} className="size-3" />
        <span className="truncate text-[13px]">
          {row.task.title || "Untitled"}
        </span>
      </span>
      {body ? (
        <span className="line-clamp-2 whitespace-pre-line text-[11px] leading-4 text-content/50">
          {body}
        </span>
      ) : null}
    </button>
  );
}

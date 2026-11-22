import type { JSX } from "react";
import type { ClickupTask } from "../model/clickupApi";
import { dueLabel } from "../model/clickupTasks";
import { ClickupAvatars, ClickupPriorityFlag } from "./ClickupBits";

/** Fork (L-381): one task in the List view. */
export function ClickupTaskRow({
  task,
  listName,
  now,
  selected,
  onOpen,
}: {
  task: ClickupTask;
  /** Shown when several lists are on screen. */
  listName: string | null;
  now: number;
  selected: boolean;
  onOpen: () => void;
}): JSX.Element {
  const due = dueLabel(task.dueDate, now);
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-current={selected ? "true" : undefined}
      className={`flex w-full min-w-0 items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-content/[0.06] active:bg-content/10 ${selected ? "bg-content/[0.08]" : ""}`}
    >
      <span
        className="size-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: task.status.color || undefined }}
        title={task.status.status}
        aria-label={`Status ${task.status.status}`}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] text-content/90">{task.name}</span>
        {listName ? <span className="block truncate text-[11px] text-content/45">{listName}</span> : null}
      </span>
      <ClickupPriorityFlag priority={task.priority} />
      <ClickupAvatars members={task.assignees} />
      {due ? (
        <span className={`w-20 shrink-0 text-right text-[11.5px] ${due.overdue ? "text-red-400" : "text-content/55"}`}>
          {due.text}
        </span>
      ) : null}
    </button>
  );
}

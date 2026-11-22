import type { JSX } from "react";
import type { ClickupListInfo, ClickupMember } from "../model/clickupApi";
import type { ClickupListRef } from "../model/clickupConfig";
import { dueBeforeStart, fromLocalMidnight, toLocalMidnight, type ClickupTaskDraft } from "../model/clickupTasks";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { ClickupAssigneePicker } from "./ClickupAssigneePicker";

const FIELD =
  "h-8 w-full rounded-md border border-stroke bg-content/[0.04] px-2.5 text-[13px] text-content outline-none transition-colors placeholder:text-content/35 focus-visible:border-accent disabled:opacity-50";
const LABEL = "flex flex-col gap-1 text-[12px] text-content/65";

const PRIORITIES = [
  { value: "", label: "No priority" },
  { value: "1", label: "Urgent" },
  { value: "2", label: "High" },
  { value: "3", label: "Normal" },
  { value: "4", label: "Low" },
] as const;

/** Fork (L-381): the fields of a task, shared by "New task" and the detail panel. */
export function ClickupTaskForm({
  lists,
  listId,
  onListChange,
  draft,
  onChange,
  meta,
  members,
  disabled,
}: {
  lists: readonly ClickupListRef[];
  listId: string;
  /** Present only while creating; an existing task can't move lists here. */
  onListChange?: (id: string) => void;
  draft: ClickupTaskDraft;
  onChange: (draft: ClickupTaskDraft) => void;
  meta: ClickupListInfo | null;
  members: readonly ClickupMember[];
  disabled: boolean;
}): JSX.Element {
  const set = (patch: Partial<ClickupTaskDraft>): void => onChange({ ...draft, ...patch });
  const statuses = [...(meta?.statuses ?? [])].sort((a, b) => a.orderindex - b.orderindex);
  const badDates = dueBeforeStart(draft);
  return (
    <div className="flex flex-col gap-3">
      {onListChange ? (
        <div className={LABEL}>
          List
          <SearchableSelect
            label="List"
            value={listId}
            disabled={disabled}
            searchable={lists.length > 7}
            options={lists.map((list) => ({ value: list.id, label: list.name }))}
            onChange={onListChange}
          />
        </div>
      ) : null}
      <label className={LABEL}>
        Name
        <input
          value={draft.name}
          maxLength={1000}
          disabled={disabled}
          onChange={(event) => set({ name: event.target.value })}
          className={FIELD}
        />
      </label>
      <label className={LABEL}>
        Description (Markdown)
        <textarea
          value={draft.description}
          rows={5}
          maxLength={20000}
          disabled={disabled}
          onChange={(event) => set({ description: event.target.value })}
          className="w-full resize-y rounded-md border border-stroke bg-content/[0.04] px-2.5 py-1.5 text-[13px] text-content outline-none transition-colors focus-visible:border-accent disabled:opacity-50"
        />
      </label>
      <div className={LABEL}>
        Assignees
        <ClickupAssigneePicker
          members={members}
          value={draft.assigneeIds}
          disabled={disabled}
          onChange={(assigneeIds) => set({ assigneeIds })}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className={LABEL}>
          Start date
          <input
            type="date"
            value={fromLocalMidnight(draft.startDate)}
            disabled={disabled}
            onChange={(event) => set({ startDate: toLocalMidnight(event.target.value) })}
            className={FIELD}
          />
        </label>
        <label className={LABEL}>
          Due date
          <input
            type="date"
            value={fromLocalMidnight(draft.dueDate)}
            disabled={disabled}
            onChange={(event) => set({ dueDate: toLocalMidnight(event.target.value) })}
            className={FIELD}
          />
        </label>
      </div>
      {badDates ? (
        <p role="alert" className="text-[12px] text-red-400">
          Due date is before the start date.
        </p>
      ) : null}
      <div className="grid grid-cols-2 gap-3">
        <div className={LABEL}>
          Priority
          <SearchableSelect
            label="Priority"
            value={draft.priority === null ? "" : String(draft.priority)}
            disabled={disabled}
            searchable={false}
            options={PRIORITIES}
            onChange={(picked) => {
              const value = Number(picked);
              set({ priority: value === 1 || value === 2 || value === 3 || value === 4 ? value : null });
            }}
          />
        </div>
        <div className={LABEL}>
          Status
          <SearchableSelect
            label="Status"
            value={draft.status}
            disabled={disabled || statuses.length === 0}
            searchable={statuses.length > 7}
            options={[
              ...(draft.status && !statuses.some((status) => status.status === draft.status)
                ? [{ value: draft.status, label: draft.status }]
                : []),
              ...statuses.map((status) => ({ value: status.status, label: status.status })),
            ]}
            onChange={(status) => set({ status })}
          />
        </div>
      </div>
    </div>
  );
}

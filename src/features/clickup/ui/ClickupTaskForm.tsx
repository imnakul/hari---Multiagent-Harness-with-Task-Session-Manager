import type { JSX } from "react";
import type { ClickupListInfo, ClickupMember } from "../model/clickupApi";
import type { ClickupListRef } from "../model/clickupConfig";
import { dueBeforeStart, fromLocalMidnight, toLocalMidnight, type ClickupTaskDraft } from "../model/clickupTasks";
import type { ClickupPendingFile } from "../model/clickupUpload";
import { Paperclip } from "../../../shared/ui/icons";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { ClickupAssigneePicker } from "./ClickupAssigneePicker";
import { ClickupAttachmentChips } from "./ClickupAttachmentChips";
import { ClickupDateField } from "./ClickupDateField";

const FIELD =
  "h-9 w-full rounded-md border border-content/10 bg-transparent px-2.5 text-[13px] text-content outline-none transition-colors placeholder:text-content/35 hover:border-content/20 focus:border-content/25 disabled:opacity-50";
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
  attachments,
  onAddFiles,
  onRemoveFile,
  attachmentError,
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
  /** Fork (L-395): the Attachments row shows only when `onAddFiles` is given (New task). */
  attachments?: readonly ClickupPendingFile[];
  onAddFiles?: () => void;
  onRemoveFile?: (id: string) => void;
  attachmentError?: string | null;
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
            variant="transparent"
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
          className="w-full resize-y rounded-md border border-content/10 bg-transparent px-2.5 py-1.5 text-[13px] text-content outline-none transition-colors hover:border-content/20 focus:border-content/25 disabled:opacity-50"
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
        <div className={LABEL}>
          Start date
          <ClickupDateField
            label="Start date"
            value={fromLocalMidnight(draft.startDate)}
            disabled={disabled}
            onChange={(value) => set({ startDate: toLocalMidnight(value) })}
          />
        </div>
        <div className={LABEL}>
          Due date
          <ClickupDateField
            label="Due date"
            value={fromLocalMidnight(draft.dueDate)}
            min={fromLocalMidnight(draft.startDate) || undefined}
            disabled={disabled}
            onChange={(value) => set({ dueDate: toLocalMidnight(value) })}
          />
        </div>
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
            variant="transparent"
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
            variant="transparent"
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
      {onAddFiles ? (
        <div className={LABEL}>
          Attachments
          <button
            type="button"
            aria-label="Attach files"
            disabled={disabled}
            className="flex h-9 w-full items-center gap-2 rounded-md border border-dashed border-content/15 bg-transparent px-2.5 text-left text-[13px] text-content/65 transition-colors hover:border-content/30 hover:text-content disabled:opacity-50 active:scale-[0.99]"
            onClick={onAddFiles}
          >
            <Paperclip aria-hidden className="size-4" />
            Attach files
          </button>
          <ClickupAttachmentChips files={attachments ?? []} disabled={disabled} onRemove={(id) => onRemoveFile?.(id)} />
          {attachmentError ? (
            <p role="alert" className="text-[12px] text-red-400">
              {attachmentError}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

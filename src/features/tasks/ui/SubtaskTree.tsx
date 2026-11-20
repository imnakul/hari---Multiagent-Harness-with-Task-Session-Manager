import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Check, ChevronDown, ChevronUp, Plus, Trash2 } from "../../../shared/ui/icons";
import { RevealHeight } from "../../../shared/ui/RevealHeight";
import {
  changeSubtask,
  moveSubtask,
  newSubtask,
  removeSubtask,
  subtaskProgress,
  SUBTASKS_MAX,
  toggleSubtask,
  type Subtask,
} from "../subtasks";
import { TASK_STATUS_LABELS, updateTask, type Task } from "../tasks";
import { TaskStatusMenu } from "./TaskStatusIcon";

/*
 * Fork (L-373): a task's subtasks drawn as a tree under it: one rail down
 * from the parent, an elbow into each step, a rounded corner into the last.
 */

const EXPANDED_KEY = "monocode.tasks.expandedSubtasks";
const listeners = new Set<() => void>();
let expanded: ReadonlySet<string> = readExpanded();

function readExpanded(): ReadonlySet<string> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(EXPANDED_KEY) ?? "[]");
    return new Set(Array.isArray(parsed) ? parsed.filter((id) => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

/** Whether a task's subtasks are open in the List and Board; shared by both, remembered. */
export function useSubtasksExpanded(taskId: string): [boolean, () => void] {
  const open = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => expanded.has(taskId),
    () => false,
  );
  const toggle = () => {
    const next = new Set(expanded);
    if (next.has(taskId)) next.delete(taskId);
    else next.add(taskId);
    expanded = next;
    try {
      localStorage.setItem(EXPANDED_KEY, JSON.stringify([...next]));
    } catch {
      // Kept for this run only when storage is full or blocked.
    }
    for (const listener of listeners) listener();
  };
  return [open, toggle];
}

/** "3/7" toggle that opens a task's subtasks; nothing when it has none. */
export function SubtaskToggle({
  subtasks,
  open,
  onToggle,
  className = "",
}: {
  subtasks: readonly Subtask[] | undefined;
  open: boolean;
  onToggle: () => void;
  className?: string;
}): ReactNode {
  const { done, total } = subtaskProgress(subtasks);
  if (!total) return null;
  const complete = done === total;
  return (
    <button
      type="button"
      data-no-drag
      aria-expanded={open}
      aria-label={`${done} of ${total} subtasks done. ${open ? "Hide" : "Show"} subtasks`}
      title={open ? "Hide subtasks" : "Show subtasks"}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
      className={`${className} inline-flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 text-[11px] tabular-nums transition-[background-color,color,transform] duration-100 hover:bg-content/10 active:scale-95 ${
        complete ? "text-emerald-400" : "text-content/55 hover:text-content"
      }`}
    >
      <span>
        {done}/{total}
      </span>
      <ChevronDown
        aria-hidden
        strokeWidth={1.75}
        className={`size-3 transition-transform duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none ${
          open ? "rotate-180" : ""
        }`}
      />
    </button>
  );
}

/**
 * A task's subtasks sliding open under it (List and Board). Ticks show at
 * once and save in the background; a failed save puts the list back and says so.
 */
export function SubtaskReveal({
  task,
  open,
  className = "",
}: {
  task: Task;
  open: boolean;
  className?: string;
}): ReactNode {
  const [pending, setPending] = useState<Subtask[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const token = useRef(0);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const stored = task.subtasks ?? [];
  const shown = pending ?? stored;
  if (!shown.length) return null;
  const save = (next: Subtask[]) => {
    const mine = ++token.current;
    setPending(next);
    setError(null);
    updateTask(task.id, { subtasks: next }).then(
      () => {
        if (alive.current && token.current === mine) setPending(null);
      },
      (reason: unknown) => {
        if (!alive.current || token.current !== mine) return;
        setPending(null);
        setError(`Couldn't save the subtask: ${reason instanceof Error ? reason.message : String(reason)}`);
      },
    );
  };
  return (
    <RevealHeight open={open}>
      <div className={className}>
        <SubtaskTree subtasks={shown} onChange={save} />
        {error ? (
          <p role="alert" className="mt-1 text-[11px] text-red-400/90">
            {error}
          </p>
        ) : null}
      </div>
    </RevealHeight>
  );
}

/**
 * The steps as a tree. With `onChange`, each can be ticked and its status
 * changed; with `editable`, also renamed, reordered, removed and added to.
 */
export function SubtaskTree({
  subtasks,
  onChange,
  editable = false,
}: {
  subtasks: readonly Subtask[];
  onChange?: (next: Subtask[]) => void;
  editable?: boolean;
}): ReactNode {
  const [draft, setDraft] = useState("");
  const full = subtasks.length >= SUBTASKS_MAX;
  const add = () => {
    const title = draft.trim();
    if (!title || !onChange || full) return;
    onChange([...subtasks, newSubtask(title)]);
    setDraft("");
  };
  const rows = editable && onChange ? [...subtasks, null] : subtasks;
  return (
    <ul role="list" aria-label="Subtasks" className="flex flex-col">
      {rows.map((subtask, index) => {
        const last = index === rows.length - 1;
        return (
          <li key={subtask?.id ?? "add"} className="relative pl-5">
            {/* Rail continues past every step but the last, which turns in. */}
            {last ? (
              <span
                aria-hidden
                className="pointer-events-none absolute top-0 left-0 h-3.5 w-3 rounded-bl-md border-b border-l border-content/15"
              />
            ) : (
              <>
                <span aria-hidden className="pointer-events-none absolute inset-y-0 left-0 w-px bg-content/15" />
                <span aria-hidden className="pointer-events-none absolute top-3.5 left-0 h-px w-3 bg-content/15" />
              </>
            )}
            {subtask ? (
              <SubtaskRow
                subtask={subtask}
                first={index === 0}
                last={index === subtasks.length - 1}
                editable={editable}
                onChange={
                  onChange
                    ? (change) => onChange(changeSubtask(subtasks, subtask.id, change))
                    : undefined
                }
                onToggle={onChange ? () => onChange(toggleSubtask(subtasks, subtask.id)) : undefined}
                onMove={onChange ? (delta) => onChange(moveSubtask(subtasks, subtask.id, delta)) : undefined}
                onRemove={onChange ? () => onChange(removeSubtask(subtasks, subtask.id)) : undefined}
              />
            ) : (
              <div className="flex h-7 items-center gap-2">
                <Plus aria-hidden strokeWidth={1.75} className="size-4 shrink-0 text-content/40" />
                <input
                  value={draft}
                  disabled={full}
                  maxLength={200}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
                    event.preventDefault();
                    add();
                  }}
                  onBlur={add}
                  aria-label="Add subtask"
                  placeholder={full ? `Up to ${SUBTASKS_MAX} subtasks` : "Add subtask"}
                  className="min-w-0 flex-1 border-0 bg-transparent p-0 text-[13px] text-content outline-none placeholder:text-content/35"
                />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function SubtaskRow({
  subtask,
  first,
  last,
  editable,
  onChange,
  onToggle,
  onMove,
  onRemove,
}: {
  subtask: Subtask;
  first: boolean;
  last: boolean;
  editable: boolean;
  onChange?: (change: Partial<Omit<Subtask, "id">>) => void;
  onToggle?: () => void;
  onMove?: (delta: -1 | 1) => void;
  onRemove?: () => void;
}): ReactNode {
  const done = subtask.status === "completed";
  const [title, setTitle] = useState(subtask.title);
  const [lastSaved, setLastSaved] = useState(subtask.title);
  // A rename from elsewhere (an agent, the phone) shows unless one is being typed.
  if (subtask.title !== lastSaved) {
    setLastSaved(subtask.title);
    setTitle(subtask.title);
  }
  const commitTitle = () => {
    const next = title.trim();
    if (!next) setTitle(subtask.title);
    else if (next !== subtask.title) onChange?.({ title: next });
  };
  const iconButton =
    "grid size-6 shrink-0 place-items-center rounded-md text-content/45 transition-[background-color,color,transform] duration-100 hover:bg-content/10 hover:text-content active:scale-90 disabled:pointer-events-none disabled:opacity-30";
  return (
    <div className="group/subtask flex h-7 min-w-0 items-center gap-2">
      <button
        type="button"
        role="checkbox"
        aria-checked={done}
        aria-label={subtask.title}
        disabled={!onToggle}
        data-no-drag
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          onToggle?.();
        }}
        className={`grid size-4 shrink-0 place-items-center rounded-[5px] border transition-[background-color,border-color,transform] duration-150 active:scale-90 motion-reduce:transition-none ${
          done
            ? "border-emerald-400/80 bg-emerald-400/20 text-emerald-400"
            : "border-content/30 hover:border-content/60"
        }`}
      >
        <Check
          aria-hidden
          strokeWidth={2.5}
          className={`size-3 transition-[opacity,transform] duration-150 motion-reduce:transition-none ${
            done ? "scale-100 opacity-100" : "scale-50 opacity-0"
          }`}
        />
      </button>
      {editable && onChange ? (
        <input
          value={title}
          maxLength={200}
          onChange={(event) => setTitle(event.target.value)}
          onBlur={commitTitle}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.nativeEvent.isComposing) {
              event.preventDefault();
              event.currentTarget.blur();
            } else if (event.key === "Escape") {
              setTitle(subtask.title);
            }
          }}
          aria-label="Subtask title"
          className={`min-w-0 flex-1 border-0 bg-transparent p-0 text-[13px] outline-none transition-colors duration-150 ${
            done ? "text-content/45 line-through decoration-content/30" : "text-content"
          }`}
        />
      ) : (
        <span
          className={`min-w-0 flex-1 truncate text-[12.5px] transition-colors duration-150 ${
            done ? "text-content/45 line-through decoration-content/30" : "text-content/85"
          }`}
        >
          {subtask.title}
        </span>
      )}
      {editable && onMove && onRemove ? (
        <span className="flex items-center opacity-0 transition-opacity duration-100 group-focus-within/subtask:opacity-100 group-hover/subtask:opacity-100">
          <button type="button" aria-label="Move subtask up" title="Move up" disabled={first} onClick={() => onMove(-1)} className={iconButton}>
            <ChevronUp aria-hidden strokeWidth={1.75} className="size-3.5" />
          </button>
          <button type="button" aria-label="Move subtask down" title="Move down" disabled={last} onClick={() => onMove(1)} className={iconButton}>
            <ChevronDown aria-hidden strokeWidth={1.75} className="size-3.5" />
          </button>
          <button type="button" aria-label="Delete subtask" title="Delete" onClick={onRemove} className={iconButton}>
            <Trash2 aria-hidden strokeWidth={1.75} className="size-3.5" />
          </button>
        </span>
      ) : null}
      {onChange ? (
        <TaskStatusMenu
          status={subtask.status}
          iconOnly={!editable && (subtask.status === "todo" || done)}
          onChange={(status) => onChange({ status })}
          className="shrink-0"
        />
      ) : subtask.status !== "todo" && !done ? (
        <span className="shrink-0 text-[11px] text-content/50">{TASK_STATUS_LABELS[subtask.status]}</span>
      ) : null}
    </div>
  );
}

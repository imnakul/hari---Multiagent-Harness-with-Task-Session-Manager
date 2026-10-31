import {
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import {
  Check,
  CheckCircle,
  Copy,
  FilePlusCorner,
  MessageMultiple,
} from "../../../shared/ui/icons";
import { copyFormattedText, copyText } from "../../../platform/tauri/clipboard";
import { SessionManagerCaptureContext } from "../../session-board/ui/SessionManagerCapture";
import { MarkdownTableContext } from "./markdownBlockContext";

type Action = "task" | "note" | "draft" | "copy";

export type BlockContent = { text: string; html?: string };

/**
 * One row of actions shared by every block in an agent reply: code, tables,
 * quotes, diagrams and images (fork, L-197). Same order, size and colour
 * everywhere: Add Task, Add to notes, Add Draft to Sessions (when the
 * workspace offers it), Copy.
 */
export function BlockActions({
  label,
  content,
  anchor,
  disabled = false,
  className,
}: {
  /** What the block is, for labels: "code", "table", "quote", "diagram", "image". */
  label: string;
  /** Read at click time so streaming and DOM-derived blocks stay current. */
  content: () => BlockContent | null;
  /** Any element inside the reply, to find which reply a task came from. */
  anchor?: RefObject<HTMLElement | null>;
  disabled?: boolean;
  className?: string;
}) {
  const { onSaveNote, onAddToTask, streaming } = useContext(MarkdownTableContext);
  const compose = useContext(SessionManagerCaptureContext);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [pending, setPending] = useState<Action | null>(null);
  const [complete, setComplete] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => () => clearTimeout(timer.current), []);

  const done: Record<Action, string> = {
    task: `Task added from ${label}`,
    note: `${capitalize(label)} saved to Notes`,
    draft: `${capitalize(label)} added as a draft`,
    copy: `${capitalize(label)} copied`,
  };

  const run = async (action: Action) => {
    if (pending || streaming || disabled) return;
    const value = content();
    if (!value?.text.trim()) return;
    setPending(action);
    setComplete(null);
    setError(null);
    try {
      if (action === "copy") {
        if (value.html) await copyFormattedText(value.text, value.html);
        else await copyText(value.text);
      } else if (action === "note") await onSaveNote?.(value.text);
      else if (action === "draft") compose?.(value.text);
      else {
        const response = anchor?.current?.closest<HTMLElement>(
          "[data-selectable-agent-response]",
        );
        await onAddToTask?.(
          value.text,
          response?.dataset.selectableAgentResponse || undefined,
        );
      }
      setComplete(action);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setComplete(null), 2000);
    } catch (failure) {
      setError(
        `Could not ${
          action === "copy"
            ? `copy ${label}`
            : action === "note"
              ? `save ${label} to Notes`
              : action === "draft"
                ? `add ${label} as a draft`
                : `add a task from ${label}`
        }. ${failure instanceof Error ? failure.message : String(failure)}`,
      );
    } finally {
      setPending(null);
    }
  };

  const off = !!pending || !!streaming || disabled;
  const title = (text: string, action: Action) =>
    streaming
      ? "Wait for the response to finish"
      : complete === action
        ? done[action]
        : text;
  return (
    <div
      role="group"
      aria-label={`${capitalize(label)} actions`}
      data-block-actions=""
      className={`flex items-center gap-0.5 not-italic select-none ${className ?? ""}`}
    >
      {onAddToTask ? (
        <BlockActionButton
          label={"Add Task"}
          title={title("Add Task", "task")}
          done={complete === "task"}
          disabled={off}
          onClick={() => void run("task")}
        >
          <CheckCircle aria-hidden className="size-3.5" strokeWidth={1.75} />
        </BlockActionButton>
      ) : null}
      {onSaveNote ? (
        <BlockActionButton
          label={"Add to notes"}
          title={title("Add to notes", "note")}
          done={complete === "note"}
          disabled={off}
          onClick={() => void run("note")}
        >
          <FilePlusCorner aria-hidden className="size-3.5" strokeWidth={1.75} />
        </BlockActionButton>
      ) : null}
      {compose ? (
        <BlockActionButton
          label={"Add Draft to Sessions"}
          title={title("Add Draft to Sessions", "draft")}
          done={complete === "draft"}
          disabled={off}
          onClick={() => void run("draft")}
        >
          <MessageMultiple aria-hidden className="size-3.5" strokeWidth={1.75} />
        </BlockActionButton>
      ) : null}
      <BlockActionButton
        label={`Copy ${label}`}
          title={title(`Copy ${label}`, "copy")}
        done={complete === "copy"}
        disabled={off}
        onClick={() => void run("copy")}
      >
        <Copy aria-hidden className="size-3.5" strokeWidth={1.75} />
      </BlockActionButton>
      <span role="status" className="sr-only">
        {complete ? done[complete] : ""}
      </span>
      {error ? (
        <span role="alert" className="max-w-60 px-1 text-[11px] leading-tight text-content/70">
          {error}
        </span>
      ) : null}
    </div>
  );
}

/** How many buttons a row shows here, so a code header can leave room. */
export function useBlockActionCount(): number {
  const { onSaveNote, onAddToTask } = useContext(MarkdownTableContext);
  const compose = useContext(SessionManagerCaptureContext);
  return 1 + (onSaveNote ? 1 : 0) + (onAddToTask ? 1 : 0) + (compose ? 1 : 0);
}

function BlockActionButton({
  label,
  title,
  done,
  disabled,
  onClick,
  children,
}: {
  /** Stable name; the result is announced by the group's status region. */
  label: string;
  title: string;
  done: boolean;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={label}
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className="grid size-6 place-items-center rounded-md text-content/50 transition-[color,background-color,scale] duration-100 hover:bg-content/8 hover:text-content active:scale-96 focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40"
    >
      {done ? <Check aria-hidden className="size-3.5" strokeWidth={1.75} /> : children}
    </button>
  );
}

function capitalize(value: string): string {
  return value ? value[0].toUpperCase() + value.slice(1) : value;
}

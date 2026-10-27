import {
  useContext,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import {
  Check,
  CheckCircle,
  Copy,
  FilePlusCorner,
} from "../../../shared/ui/icons";
import { copyText } from "../../../platform/tauri/clipboard";
import { quoteText } from "../model/quoteContent";
import { MarkdownTableContext } from "./MarkdownTable";

type Action = "copy" | "note" | "task";

const DONE: Record<Action, string> = {
  copy: "Quote copied",
  note: "Quote saved to Notes",
  task: "Task added from quote",
};

const FAILED: Record<Action, string> = {
  copy: "Could not copy quote.",
  note: "Could not save quote to Notes.",
  task: "Could not add task from quote.",
};

/**
 * A quote in an agent reply, with Copy, Add to notes and Add Task on hover or
 * keyboard focus, like code blocks and tables have (fork, L-188). Keeps
 * Streamdown's own blockquote classes and attribute so styling is unchanged.
 */
export function MarkdownQuote({
  children,
  className,
  node,
  ...props
}: ComponentProps<"blockquote"> & { node?: unknown }) {
  const { onSaveNote, onAddToTask, streaming } =
    useContext(MarkdownTableContext);
  const quote = useRef<HTMLQuoteElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [pending, setPending] = useState<Action | null>(null);
  const [complete, setComplete] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => () => clearTimeout(timer.current), []);

  const run = async (action: Action) => {
    const text = quoteText(node);
    if (pending || streaming || !text) return;
    setPending(action);
    setComplete(null);
    setError(null);
    try {
      if (action === "copy") await copyText(text);
      else if (action === "note") await onSaveNote?.(text);
      else {
        const response = quote.current?.closest<HTMLElement>(
          "[data-selectable-agent-response]",
        );
        await onAddToTask?.(
          text,
          response?.dataset.selectableAgentResponse || undefined,
        );
      }
      setComplete(action);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setComplete(null), 2000);
    } catch (error) {
      setError(
        `${FAILED[action]} ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setPending(null);
    }
  };

  const disabled = !!pending || !!streaming;
  const title = (label: string, action: Action) =>
    streaming
      ? "Wait for the response to finish"
      : complete === action
        ? DONE[action]
        : label;
  return (
    <blockquote
      {...props}
      ref={quote}
      data-streamdown="blockquote"
      data-quote-actions=""
      className={`group/quote relative my-4 border-muted-foreground/30 border-l-4 pl-4 text-muted-foreground italic ${className ?? ""}`}
    >
      {children}
      <div
        role="group"
        aria-label="Quote actions"
        className="markdown-quote-actions absolute top-0 right-0 flex items-center gap-0.5 rounded-lg border border-content/10 bg-surface p-0.5 not-italic shadow-sm select-none"
      >
        {onAddToTask ? (
          <QuoteButton
            label={title("Add Task", "task")}
            done={complete === "task"}
            disabled={disabled}
            onClick={() => void run("task")}
          >
            <CheckCircle aria-hidden className="size-3.5" strokeWidth={1.75} />
          </QuoteButton>
        ) : null}
        {onSaveNote ? (
          <QuoteButton
            label={title("Add to notes", "note")}
            done={complete === "note"}
            disabled={disabled}
            onClick={() => void run("note")}
          >
            <FilePlusCorner
              aria-hidden
              className="size-3.5"
              strokeWidth={1.75}
            />
          </QuoteButton>
        ) : null}
        <QuoteButton
          label={title("Copy quote", "copy")}
          done={complete === "copy"}
          disabled={disabled}
          onClick={() => void run("copy")}
        >
          <Copy aria-hidden className="size-3.5" strokeWidth={1.75} />
        </QuoteButton>
        <span role="status" className="sr-only">
          {complete ? DONE[complete] : ""}
        </span>
      </div>
      {error ? (
        <p role="alert" className="text-xs not-italic text-content/70">
          {error}
        </p>
      ) : null}
    </blockquote>
  );
}

function QuoteButton({
  label,
  done,
  disabled,
  onClick,
  children,
}: {
  label: string;
  done: boolean;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className="rounded-md p-1 text-content/50 transition-[color,background-color,scale] duration-100 hover:bg-content/8 hover:text-content active:scale-96 focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40"
    >
      {done ? (
        <Check aria-hidden className="size-3.5" strokeWidth={1.75} />
      ) : (
        children
      )}
    </button>
  );
}

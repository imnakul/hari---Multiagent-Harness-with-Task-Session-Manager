import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
} from "react";
import { Check, Copy, FilePlusCorner } from "../../../shared/ui/icons";
import { copyFormattedText } from "../../../platform/tauri/clipboard";
import { tableContent } from "../model/tableContent";
import { AddToSessionManagerButton } from "../../session-board/ui/SessionManagerCapture";

export const MarkdownTableContext = createContext<{
  onSaveNote?: (text: string) => void | Promise<void>;
  /** Add Task on quotes (fork, L-188); `blockId` is the reply it came from. */
  onAddToTask?: (text: string, blockId?: string) => void | Promise<void>;
  streaming?: boolean;
}>({});

export function MarkdownTable({
  children,
  className,
  node: _node,
  ...props
}: ComponentProps<"table"> & { node?: unknown }) {
  const { onSaveNote, streaming } = useContext(MarkdownTableContext);
  const table = useRef<HTMLTableElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [pending, setPending] = useState<"copy" | "note" | null>(null);
  const [complete, setComplete] = useState<"copy" | "note" | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => () => clearTimeout(timer.current), []);

  const run = async (action: "copy" | "note") => {
    if (pending || streaming || !table.current) return;
    setPending(action);
    setComplete(null);
    setError(null);
    try {
      const content = tableContent(table.current);
      if (action === "copy")
        await copyFormattedText(content.markdown, content.html);
      else await onSaveNote?.(content.markdown);
      setComplete(action);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setComplete(null), 2000);
    } catch (error) {
      setError(
        `Could not ${action === "copy" ? "copy table" : "save table to Notes"}. ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setPending(null);
    }
  };

  const buttonClass =
    "rounded-md p-1 text-content/40 transition-colors duration-100 hover:bg-content/8 hover:text-content/70 focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40";
  const status =
    complete === "copy"
      ? "Table copied"
      : complete === "note"
        ? "Table saved to Notes"
        : "";
  return (
    <div
      data-streamdown="table-wrapper"
      className="my-4 min-w-0 rounded-lg border border-content/10"
    >
      <div
        role="group"
        aria-label="Table actions"
        className="flex flex-wrap items-center justify-end gap-0.5 px-1.5 py-1 select-none"
      >
        {onSaveNote ? (
          <button
            type="button"
            className={buttonClass}
            aria-label="Add table to Note"
            title={
              streaming
                ? "Wait for the response to finish"
                : complete === "note"
                  ? "Saved to Notes"
                  : "Add table to Note"
            }
            disabled={!!pending || streaming}
            onClick={() => void run("note")}
          >
            {complete === "note" ? (
              <Check aria-hidden className="size-3.5" strokeWidth={1.75} />
            ) : (
              <FilePlusCorner
                aria-hidden
                className="size-3.5"
                strokeWidth={1.75}
              />
            )}
          </button>
        ) : null}
        <AddToSessionManagerButton
          text={() =>
            table.current ? tableContent(table.current).markdown : ""
          }
          disabled={!!pending || streaming}
        />
        <button
          type="button"
          className={buttonClass}
          aria-label="Copy table"
          title={
            streaming
              ? "Wait for the response to finish"
              : complete === "copy"
                ? "Copied"
                : "Copy table as Markdown and formatted text"
          }
          disabled={!!pending || streaming}
          onClick={() => void run("copy")}
        >
          {complete === "copy" ? (
            <Check aria-hidden className="size-3.5" strokeWidth={1.75} />
          ) : (
            <Copy aria-hidden className="size-3.5" strokeWidth={1.75} />
          )}
        </button>
        <span role="status" className="sr-only">
          {status}
        </span>
      </div>
      {error ? (
        <p role="alert" className="px-3 pb-2 text-xs text-content/70">
          {error}
        </p>
      ) : null}
      <div className="overflow-x-auto">
        <table
          {...props}
          ref={table}
          data-streamdown="table"
          className={`w-full border-collapse ${className ?? ""}`}
        >
          {children}
        </table>
      </div>
    </div>
  );
}

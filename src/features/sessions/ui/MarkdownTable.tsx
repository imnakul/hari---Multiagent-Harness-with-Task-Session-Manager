import { useLayoutEffect, useRef, type ComponentProps } from "react";
import { tableContent } from "../model/tableContent";
import { BlockActions } from "./BlockActions";

export { MarkdownTableContext } from "./markdownBlockContext";

/** A column whose every cell is this short shrinks to its content (fork, L-197). */
const SHORT_CELL = 18;

export function MarkdownTable({
  children,
  className,
  node: _node,
  ...props
}: ComponentProps<"table"> & { node?: unknown }) {
  const table = useRef<HTMLTableElement>(null);
  useLayoutEffect(() => markNarrowColumns(table.current));
  return (
    <div
      data-streamdown="table-wrapper"
      className="my-4 min-w-0 rounded-lg border border-content/10"
    >
      <div className="flex justify-end px-1.5 py-1">
        <BlockActions
          label="table"
          anchor={table}
          content={() => {
            if (!table.current) return null;
            const value = tableContent(table.current);
            return { text: value.markdown, html: value.html };
          }}
        />
      </div>
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

function markNarrowColumns(table: HTMLTableElement | null) {
  if (!table) return;
  const widest: number[] = [];
  for (const row of Array.from(table.rows))
    Array.from(row.cells).forEach((cell, index) => {
      widest[index] = Math.max(
        widest[index] ?? 0,
        (cell.textContent ?? "").trim().length,
      );
    });
  for (const row of Array.from(table.rows))
    Array.from(row.cells).forEach((cell, index) => {
      const narrow = (widest[index] ?? 0) <= SHORT_CELL;
      if (narrow !== cell.hasAttribute("data-narrow"))
        cell.toggleAttribute("data-narrow", narrow);
    });
}

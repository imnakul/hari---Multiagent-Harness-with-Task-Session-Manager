import { useRef, type ComponentProps } from "react";
import { quoteText } from "../model/quoteContent";
import { BlockActions } from "./BlockActions";

/**
 * A quote in an agent reply, with the shared block actions on hover or
 * keyboard focus (fork, L-188, L-197). Keeps Streamdown's own blockquote
 * classes and attribute so styling is unchanged.
 */
export function MarkdownQuote({
  children,
  className,
  node,
  ...props
}: ComponentProps<"blockquote"> & { node?: unknown }) {
  const quote = useRef<HTMLQuoteElement>(null);
  return (
    <blockquote
      {...props}
      ref={quote}
      data-streamdown="blockquote"
      data-quote-actions=""
      className={`group/quote relative flow-root my-4 border-muted-foreground/30 border-l-4 pl-4 text-muted-foreground italic ${className ?? ""}`}
    >
      {/* Floated first so the first line wraps around it instead of under it. */}
      <BlockActions
        label="quote"
        anchor={quote}
        content={() => {
          const text = quoteText(node);
          return text ? { text } : null;
        }}
        className="markdown-quote-actions float-right -mt-1 -mb-1 ml-2 rounded-lg border border-content/10 bg-surface p-0.5 shadow-sm"
      />
      {children}
    </blockquote>
  );
}

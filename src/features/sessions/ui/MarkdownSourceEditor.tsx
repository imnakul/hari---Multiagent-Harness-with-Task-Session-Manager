import { Fragment, type Ref } from "react";
import { MarkdownSourceHighlight } from "./AgentMarkdown";

/** Editable markdown source with highlighting and an optional line-number gutter. */
export function MarkdownSourceEditor({
  value,
  onChange,
  textareaRef,
  autoFocus = false,
  label,
  placeholder = "Write markdown…",
  onBlur,
  lineNumbers = true,
  className = "min-h-[448px]",
  endPadClass = "pr-3",
}: {
  value: string;
  onChange: (value: string) => void;
  textareaRef?: Ref<HTMLTextAreaElement>;
  autoFocus?: boolean;
  label?: string;
  placeholder?: string;
  onBlur?: () => void;
  lineNumbers?: boolean;
  className?: string;
  /** Right inset of the text, e.g. room for a button over the corner. */
  endPadClass?: string;
}) {
  const lines = value.split("\n");
  const gutterWidth = `calc(${Math.max(String(lines.length).length, 2)}ch + 0.75rem)`;
  const textOffset = lineNumbers ? `calc(${gutterWidth} + 0.75rem)` : "0.75rem";

  return (
    <div className={`relative ${className}`}>
      <div
        aria-hidden
        className={`pointer-events-none grid font-mono text-[13px] leading-5 text-content/85${lineNumbers ? "" : " py-3"}`}
        style={{
          gridTemplateColumns: lineNumbers
            ? `${gutterWidth} minmax(0, 1fr)`
            : "minmax(0, 1fr)",
        }}
      >
        {lines.map((line, index) => (
          <Fragment key={index}>
            {lineNumbers ? (
              <div className="select-none pr-2 text-right tabular-nums whitespace-nowrap text-content/40">
                {index + 1}
              </div>
            ) : null}
            <div
              data-source-line={index}
              className={`min-h-5 min-w-0 whitespace-pre-wrap wrap-break-word ${lineNumbers ? "pl-3" : `pl-3 ${endPadClass}`}`}
            >
              {line ? <MarkdownSourceHighlight text={line} /> : "\u00a0"}
            </div>
          </Fragment>
        ))}
      </div>
      {lineNumbers ? (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 w-px bg-content/10"
          style={{ left: gutterWidth }}
        />
      ) : null}
      <textarea
        ref={textareaRef}
        aria-label={label}
        value={value}
        autoFocus={autoFocus}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
        spellCheck={false}
        placeholder={placeholder}
        className={`markdown-source-field absolute inset-0 h-full w-full resize-none overflow-hidden border-0 bg-transparent font-mono text-[13px] leading-5 whitespace-pre-wrap wrap-break-word outline-none ${lineNumbers ? "py-0 pr-0" : `py-3 ${endPadClass}`}`}
        style={{ paddingLeft: textOffset }}
      />
    </div>
  );
}

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Bookmark,
  Bulb,
  ChevronRight,
  CircleDot,
  ExternalLink,
  File,
  Flag,
  Pencil,
  Pin,
  Trash2,
} from "../../../shared/ui/icons";
import type {
  SessionBookmark,
  SessionFileTouch,
  SessionPoint,
  SessionPointKind,
} from "../model/sessionPanel";
import { AgentMarkdown } from "./AgentMarkdown";

/** Session overview rows (fork, L-191; reworked in L-192). */

/** Timeline point kinds: icon, colour and name (L-192). */
export const POINT_LOOK: Record<
  SessionPointKind,
  { label: string; Icon: typeof Flag; tone: string }
> = {
  event: { label: "Event", Icon: CircleDot, tone: "text-content/45" },
  decision: { label: "Decision", Icon: Flag, tone: "text-accent" },
  found: { label: "Found", Icon: Bulb, tone: "text-amber-400" },
};

/** Where a row's message is: jump to it, gone (compacted), or none named. */
export type RowLink = "jump" | "earlier" | "none";

const ACTION =
  "grid size-6 shrink-0 place-items-center rounded-md text-content/40 transition-colors duration-100 hover:bg-content/10 hover:text-content focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent";

/** One line of text edited in place: Enter saves, Escape cancels. */
function InlineEdit({
  value,
  label,
  placeholder,
  onSave,
  onCancel,
}: {
  value: string;
  label: string;
  placeholder?: string;
  onSave: (text: string) => void;
  onCancel: () => void;
}): ReactNode {
  const [text, setText] = useState(value);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const input = ref.current;
    if (!input) return;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }, []);
  return (
    <textarea
      ref={ref}
      aria-label={label}
      value={text}
      placeholder={placeholder}
      rows={2}
      onChange={(event) => setText(event.target.value)}
      onBlur={() => onSave(text)}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape") {
          event.preventDefault();
          onCancel();
        } else if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          onSave(text);
        }
      }}
      className="w-full resize-none rounded-md border border-content/15 bg-content/5 px-2 py-1 text-[12px] leading-[18px] text-content outline-none placeholder:text-content/35 focus:border-accent/60"
    />
  );
}

/**
 * A clickable row (jumps to its message) with edit and delete on hover.
 * Rows with no message to jump to are plain text. `quote` shows saved
 * selected text above the row's own text.
 */
export function PanelRow({
  icon,
  text,
  quote,
  meta,
  metaTitle,
  link,
  editLabel,
  editPlaceholder,
  onJump,
  onEdit,
  onDelete,
  trailing,
}: {
  icon: ReactNode;
  text: string;
  quote?: string;
  meta?: string;
  /** Hover text for the meta line, e.g. the full date and time. */
  metaTitle?: string;
  link: RowLink;
  editLabel: string;
  editPlaceholder?: string;
  onJump: () => void;
  onEdit?: (text: string) => void;
  onDelete?: () => void;
  trailing?: ReactNode;
}): ReactNode {
  const [editing, setEditing] = useState(false);
  const metaText =
    link === "earlier" ? (meta ? `${meta} · Earlier in this chat` : "Earlier in this chat") : meta;
  const content = (
    <>
      {quote ? (
        <span className="line-clamp-4 border-l-2 border-accent/50 pl-2 text-content/80 [overflow-wrap:anywhere]">
          {quote}
        </span>
      ) : null}
      {text ? (
        <span className={`block [overflow-wrap:anywhere] ${quote ? "mt-1 text-content/60" : "text-content/85"}`}>
          {text}
        </span>
      ) : quote ? null : (
        <span className="text-content/40">Untitled</span>
      )}
    </>
  );
  return (
    <li className="group relative flex items-start gap-2 rounded-lg px-2 py-1.5 transition-colors duration-100 hover:bg-content/5 has-[button:focus-visible]:bg-content/5">
      <span aria-hidden className="mt-[3px] shrink-0">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        {editing && onEdit ? (
          <InlineEdit
            value={text}
            label={editLabel}
            placeholder={editPlaceholder}
            onCancel={() => setEditing(false)}
            onSave={(next) => {
              setEditing(false);
              if (next.trim() !== text) onEdit(next);
            }}
          />
        ) : link === "jump" ? (
          <button
            type="button"
            onClick={onJump}
            title="Jump to this message"
            className="block w-full text-left text-[12px] leading-[18px] outline-none after:absolute after:inset-0 after:rounded-lg after:content-['']"
          >
            {content}
          </button>
        ) : (
          <p className="text-[12px] leading-[18px]">{content}</p>
        )}
        {metaText && !editing ? (
          <p title={metaTitle} className="mt-0.5 truncate text-[11px] leading-4 text-content/40">
            {metaText}
          </p>
        ) : null}
      </div>
      {!editing && (onEdit || onDelete || trailing) ? (
        <span className="relative z-[1] -mr-1 flex shrink-0 items-center opacity-0 transition-opacity duration-100 group-hover:opacity-100 group-has-[button:focus-visible]:opacity-100">
          {trailing}
          {onEdit ? (
            <button
              type="button"
              aria-label={editLabel}
              title={editLabel}
              onClick={() => setEditing(true)}
              className={ACTION}
            >
              <Pencil className="size-3.5" strokeWidth={1.75} />
            </button>
          ) : null}
          {onDelete ? (
            <button
              type="button"
              aria-label="Delete"
              title="Delete"
              onClick={onDelete}
              className={ACTION}
            >
              <Trash2 className="size-3.5" strokeWidth={1.75} />
            </button>
          ) : null}
        </span>
      ) : null}
    </li>
  );
}

/** The notes' "Left off" line, pinned above the Summary groups. */
export function LeftOffCard({ text }: { text: string }): ReactNode {
  return (
    <div className="rounded-lg border border-content/10 bg-content/5 px-2.5 py-2">
      <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-content/45">
        <Pin aria-hidden className="size-3" strokeWidth={1.75} />
        Left off
      </span>
      <div className="mt-1 text-[12px] leading-[18px] text-content/90 [overflow-wrap:anywhere]">
        <AgentMarkdown text={text} hardBreaks />
      </div>
    </div>
  );
}

/**
 * One heading of the notes, collapsed until clicked; the body slides open
 * by animating the grid row from 0 to its full height.
 */
export function SummaryGroupRow({
  heading,
  body,
  open,
  onToggle,
}: {
  heading: string;
  body: string;
  open: boolean;
  onToggle: () => void;
}): ReactNode {
  return (
    <li className="rounded-lg">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="flex w-full items-start gap-1.5 rounded-lg px-2 py-1.5 text-left text-[12px] font-medium leading-[18px] text-content/85 transition-colors duration-100 hover:bg-content/5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
      >
        <ChevronRight
          aria-hidden
          strokeWidth={1.75}
          className={`mt-[2px] size-3.5 shrink-0 text-content/45 transition-transform duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none ${
            open ? "rotate-90" : ""
          }`}
        />
        <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{heading}</span>
      </button>
      <div
        className={`grid transition-[grid-template-rows,opacity] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none ${
          open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
        }`}
      >
        <div className="min-h-0 overflow-hidden" inert={!open || undefined}>
          <div className="pb-2 pl-7 pr-2 text-[12px] leading-[18px] text-content/80">
            <AgentMarkdown text={body} hardBreaks />
          </div>
        </div>
      </div>
    </li>
  );
}

export function BookmarkIcon(): ReactNode {
  return <Bookmark className="size-3.5 text-accent" strokeWidth={1.75} />;
}

/** `path` shown relative to the chat's folder when it is inside it. */
export function displayPath(path: string, cwd: string): { name: string; dir: string } {
  const normal = path.replace(/\\/g, "/");
  const root = cwd.replace(/\\/g, "/").replace(/\/+$/, "");
  const relative =
    root && normal.toLowerCase().startsWith(`${root.toLowerCase()}/`)
      ? normal.slice(root.length + 1)
      : normal;
  const cut = relative.lastIndexOf("/");
  return cut < 0
    ? { name: relative, dir: "" }
    : { name: relative.slice(cut + 1), dir: relative.slice(0, cut) };
}

export function FileRow({
  touch,
  cwd,
  link,
  onJump,
  onOpen,
}: {
  touch: SessionFileTouch;
  cwd: string;
  link: RowLink;
  onJump: () => void;
  onOpen: () => void;
}): ReactNode {
  const { name, dir } = displayPath(touch.path, cwd);
  const edits = touch.edits === 1 ? "1 edit" : `${touch.edits} edits`;
  return (
    <PanelRow
      icon={<File className="size-3.5 text-content/45" strokeWidth={1.75} />}
      text={name}
      meta={dir ? `${dir} · ${edits}` : edits}
      link={link}
      editLabel=""
      onJump={onJump}
      trailing={
        <button
          type="button"
          aria-label={`Open ${name}`}
          title="Open file"
          onClick={onOpen}
          className={ACTION}
        >
          <ExternalLink className="size-3.5" strokeWidth={1.75} />
        </button>
      }
    />
  );
}

export function BookmarkRow({
  bookmark,
  fallback,
  link,
  onJump,
  onEdit,
  onDelete,
}: {
  bookmark: SessionBookmark;
  /** The message's own first line, when a whole-reply bookmark has no text. */
  fallback: string;
  link: RowLink;
  onJump: () => void;
  onEdit: (text: string) => void;
  onDelete: () => void;
}): ReactNode {
  const quoted = !!bookmark.quote;
  return (
    <PanelRow
      icon={<BookmarkIcon />}
      text={quoted ? bookmark.text : bookmark.text || fallback}
      quote={bookmark.quote}
      meta={new Date(bookmark.at).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      })}
      link={link}
      editLabel={quoted ? "Edit note" : "Edit bookmark"}
      editPlaceholder={quoted ? "Add a note" : undefined}
      onJump={onJump}
      onEdit={onEdit}
      onDelete={onDelete}
    />
  );
}

/** A Timeline point: kind icon, text, and "11:47 AM · Decision" (L-192). */
export function PointRow({
  point,
  time,
  link,
  onJump,
  onEdit,
  onDelete,
}: {
  point: SessionPoint;
  /** When its message was sent; the point's own time when unknown. */
  time: number;
  link: RowLink;
  onJump: () => void;
  onEdit: (text: string) => void;
  onDelete: () => void;
}): ReactNode {
  const { label, Icon, tone } = POINT_LOOK[point.kind];
  const date = new Date(time);
  const meta = [
    date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }),
    label,
    point.edited ? "edited" : "",
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <PanelRow
      icon={<Icon className={`size-3.5 ${tone}`} strokeWidth={1.75} />}
      text={point.text}
      meta={meta}
      metaTitle={date.toLocaleString(undefined, { dateStyle: "full", timeStyle: "short" })}
      link={link}
      editLabel="Edit point"
      onJump={onJump}
      onEdit={onEdit}
      onDelete={onDelete}
    />
  );
}

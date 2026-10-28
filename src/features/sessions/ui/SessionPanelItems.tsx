import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Bookmark,
  Bulb,
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
  SessionPointKind,
} from "../model/sessionPanel";

/** Session panel rows (fork, L-191). */
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
  onSave,
  onCancel,
}: {
  value: string;
  label: string;
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
      className="w-full resize-none rounded-md border border-content/15 bg-content/5 px-2 py-1 text-[12px] leading-[18px] text-content outline-none focus:border-accent/60"
    />
  );
}

/**
 * A clickable row (jumps to its message) with edit and delete on hover.
 * Rows with no message to jump to are plain text.
 */
export function PanelRow({
  icon,
  text,
  meta,
  link,
  editLabel,
  onJump,
  onEdit,
  onDelete,
  trailing,
}: {
  icon: ReactNode;
  text: string;
  meta?: string;
  link: RowLink;
  editLabel: string;
  onJump: () => void;
  onEdit?: (text: string) => void;
  onDelete?: () => void;
  trailing?: ReactNode;
}): ReactNode {
  const [editing, setEditing] = useState(false);
  const metaText = link === "earlier" ? "Earlier in this chat" : meta;
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
            className="block w-full text-left text-[12px] leading-[18px] text-content/85 outline-none [overflow-wrap:anywhere] after:absolute after:inset-0 after:rounded-lg after:content-['']"
          >
            {text || <span className="text-content/40">Untitled</span>}
          </button>
        ) : (
          <p className="text-[12px] leading-[18px] text-content/85 [overflow-wrap:anywhere]">
            {text || <span className="text-content/40">Untitled</span>}
          </p>
        )}
        {metaText && !editing ? (
          <p className="mt-0.5 truncate text-[11px] leading-4 text-content/40">
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
              title="Edit"
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

export function PointIcon({ kind }: { kind: SessionPointKind }): ReactNode {
  const { Icon, tone } = POINT_LOOK[kind];
  return <Icon className={`size-3.5 ${tone}`} strokeWidth={1.75} />;
}

/** The "left off" line, pinned above the timeline. */
export function LeftOffCard({
  text,
  link,
  onJump,
}: {
  text: string;
  link: RowLink;
  onJump: () => void;
}): ReactNode {
  const body = (
    <>
      <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-content/45">
        <Pin aria-hidden className="size-3" strokeWidth={1.75} />
        Left off
      </span>
      <span className="mt-1 block text-[12px] leading-[18px] text-content/90 [overflow-wrap:anywhere]">
        {text}
      </span>
    </>
  );
  const frame =
    "block w-full rounded-lg border border-content/10 bg-content/5 px-2.5 py-2 text-left";
  return link === "jump" ? (
    <button
      type="button"
      onClick={onJump}
      title="Jump to this message"
      className={`${frame} transition-colors duration-100 hover:bg-content/8 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent`}
    >
      {body}
    </button>
  ) : (
    <div className={frame}>{body}</div>
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
  /** The message's own first line, when the bookmark has no text. */
  fallback: string;
  link: RowLink;
  onJump: () => void;
  onEdit: (text: string) => void;
  onDelete: () => void;
}): ReactNode {
  return (
    <PanelRow
      icon={<BookmarkIcon />}
      text={bookmark.text || fallback}
      meta={new Date(bookmark.at).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      })}
      link={link}
      editLabel="Edit bookmark"
      onJump={onJump}
      onEdit={onEdit}
      onDelete={onDelete}
    />
  );
}

import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState, type JSX, type ReactNode } from "react";
import { copyText } from "../../../platform/tauri/clipboard";
import { openPathWithDefaultApp, readBinaryFile, revealPath } from "../../../platform/tauri/fs";
import {
  Bookmark,
  Check,
  Copy,
  File,
  FolderOpen,
  Pin,
  PinOff,
  Send,
  X,
} from "../../../shared/ui/icons";
import { openWebLink } from "../../browser/model/openWebLink";
import { formatFileSize, isImagePath, sniffImageMime } from "../../files/model/filePreview";
import { AgentMarkdown } from "../../sessions/ui/AgentMarkdown";
import { WebLinkCardLink } from "../../sessions/ui/ChatHoverPreviews";
import { LocalMedia } from "../../sessions/ui/LocalMedia";
import type { ShareEntry } from "../model/mobileShare";
import { isLongShareText, isShareMedia, shareTime, type ShareRow } from "../model/shareView";
import { shareErrorMessage } from "./PhoneStatus";

const ICON_BUTTON =
  "grid size-6 place-items-center rounded-md text-content/45 transition-[background-color,color,transform] duration-100 hover:bg-content/10 hover:text-content active:scale-[0.94] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60";

/** An icon button that briefly shows a tick once its action worked. */
function FlashIcon({
  icon,
  label,
  onRun,
  onError,
}: {
  icon: ReactNode;
  label: string;
  onRun: () => Promise<void>;
  onError: (error: string) => void;
}): JSX.Element {
  const [flashed, setFlashed] = useState(false);
  const timer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (timer.current != null) window.clearTimeout(timer.current);
    },
    [],
  );
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={() =>
        void onRun().then(
          () => {
            setFlashed(true);
            if (timer.current != null) window.clearTimeout(timer.current);
            timer.current = window.setTimeout(() => setFlashed(false), 1400);
          },
          (reason: unknown) => onError(shareErrorMessage(reason)),
        )
      }
      className={ICON_BUTTON}
    >
      {flashed ? <Check className="size-3.5" strokeWidth={2} aria-hidden /> : icon}
    </button>
  );
}

/**
 * A picture at its own shape (at most 280 wide and 360 tall), or a square
 * tile in a group's grid. Click opens it in the default app.
 */
function ShareImage({ path, label, tile }: { path: string; label: string; tile: boolean }): JSX.Element {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    let created: string | null = null;
    readBinaryFile(path).then(
      (bytes) => {
        if (cancelled) return;
        const mime = sniffImageMime(bytes);
        if (!mime) {
          setFailed(true);
          return;
        }
        created = URL.createObjectURL(new Blob([bytes], { type: mime }));
        setUrl(created);
      },
      () => {
        if (!cancelled) setFailed(true);
      },
    );
    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [path]);
  const open = () => void openPathWithDefaultApp(path).catch(() => undefined);
  if (failed) return <FileCard name={label} onOpen={open} />;
  return (
    <button
      type="button"
      title={`Open ${label}`}
      onClick={open}
      className={`block overflow-hidden rounded-xl bg-content/[0.05] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60 ${
        tile ? "aspect-square w-full" : "max-w-[280px]"
      }`}
    >
      {url ? (
        <img
          src={url}
          alt={label}
          className={tile ? "size-full object-cover" : "block max-h-[360px] max-w-[280px] object-contain"}
        />
      ) : (
        <span className={`block animate-pulse ${tile ? "size-full" : "h-40 w-56"}`} />
      )}
    </button>
  );
}

function FileCard({ name, size, onOpen }: { name: string; size?: number; onOpen?: () => void }): JSX.Element {
  const body = (
    <>
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-content/[0.07] text-content/55">
        <File className="size-4" strokeWidth={1.75} aria-hidden />
      </span>
      <span className="min-w-0 text-left">
        <span className="block truncate text-[13px] text-content">{name}</span>
        {size !== undefined ? (
          <span className="block text-[11.5px] tabular-nums text-content/45">{formatFileSize(size)}</span>
        ) : null}
      </span>
    </>
  );
  return onOpen ? (
    <button
      type="button"
      title={`Open ${name}`}
      onClick={onOpen}
      className="flex min-w-0 items-center gap-2.5 rounded-lg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60"
    >
      {body}
    </button>
  ) : (
    <span className="flex min-w-0 items-center gap-2.5">{body}</span>
  );
}

function ShareText({ text }: { text: string }): JSX.Element {
  const long = isLongShareText(text);
  const [open, setOpen] = useState(false);
  return (
    <div>
      <div className={long && !open ? "max-h-56 overflow-hidden [mask-image:linear-gradient(to_bottom,black_70%,transparent)]" : ""}>
        <AgentMarkdown text={text} hardBreaks linkPreviews className="text-[13px] leading-[1.45] text-content" />
      </div>
      {long ? (
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="mt-1 text-[12px] text-accent hover:underline"
        >
          {open ? "Show less" : "Show more"}
        </button>
      ) : null}
    </div>
  );
}

const isPicture = (entry: ShareEntry) => entry.kind === "file" && isImagePath(entry.path ?? entry.name ?? "");

/**
 * Fork (Hari, L-287, L-290): one Share message as a chat bubble: a single
 * item, or files sent together (pictures in a grid, other files listed under
 * it) with their caption. From the phone on the left, to the phone on the
 * right; the time sits in the bubble's corner. Copy stays visible under the
 * bubble; pin, save and remove show on hover.
 */
export function ShareBubble({
  row,
  paired,
  onError,
}: {
  row: ShareRow;
  paired: boolean;
  onError: (error: string) => void;
}): JSX.Element {
  const first = row.items[0];
  const outgoing = first?.direction === "out";
  const ids = row.items.map((entry) => entry.id);
  const pinned = row.items.some((entry) => entry.pinned);
  const saved = row.items.some((entry) => entry.saved);
  const pictures = row.items.filter((entry) => isPicture(entry) && entry.path);
  const videos = row.items.filter((entry) => !isPicture(entry) && isShareMedia(entry) && entry.path);
  const files = row.items.filter((entry) => entry.kind === "file" && !pictures.includes(entry) && !videos.includes(entry));
  const texts = row.items.filter((entry) => entry.kind !== "file" && entry.text !== undefined);
  const copyable = texts.map((entry) => entry.text ?? "").join("\n\n");
  const link = texts.length === 1 && texts[0]?.kind === "link" ? texts[0].text?.trim() : undefined;
  const waiting = row.items.some((entry) => entry.direction === "out" && entry.status === "queued");
  const last = row.items[row.items.length - 1];
  const run = (action: () => Promise<void>) =>
    void action().catch((reason: unknown) => onError(shareErrorMessage(reason)));
  const mark = (change: { pinned?: boolean; saved?: boolean }) =>
    run(() => invoke<void>("mobile_share_mark", { ids, ...change }));

  return (
    <li
      data-share-ids={ids.join(" ")}
      className={`group/bubble flex flex-col ${outgoing ? "items-end" : "items-start"}`}
    >
      <div
        className={`relative max-w-[min(30rem,88%)] overflow-hidden rounded-2xl border-[0.5px] ${
          outgoing
            ? "rounded-br-md border-accent/25 bg-accent/[0.12]"
            : "rounded-bl-md border-content/10 bg-content/[0.05]"
        } ${pictures.length || videos.length ? "p-1" : "px-3 py-2"}`}
      >
        {pictures.length === 1 && pictures[0]?.path ? (
          <ShareImage path={pictures[0].path} label={pictures[0].name ?? "picture"} tile={false} />
        ) : pictures.length > 1 ? (
          <div className="grid w-[280px] max-w-full grid-cols-2 gap-1">
            {pictures.map((entry) =>
              entry.path ? <ShareImage key={entry.id} path={entry.path} label={entry.name ?? "picture"} tile /> : null,
            )}
          </div>
        ) : null}
        {videos.map((entry) =>
          entry.path ? (
            <LocalMedia
              key={entry.id}
              path={entry.path}
              label={entry.name ?? "video"}
              onOpen={() => {
                const path = entry.path;
                if (path) run(() => openPathWithDefaultApp(path));
              }}
              fallback={<FileCard name={entry.name ?? "video"} size={entry.size} />}
            />
          ) : null,
        )}
        {files.length ? (
          <ul className={`space-y-1.5 ${pictures.length || videos.length ? "px-2 pb-1 pt-1.5" : ""}`}>
            {files.map((entry) => {
              const path = entry.path;
              return (
                <li key={entry.id} className="flex items-center gap-1.5">
                  <FileCard
                    name={entry.name ?? "file"}
                    size={entry.size}
                    onOpen={path ? () => run(() => openPathWithDefaultApp(path)) : undefined}
                  />
                  {path ? (
                    <button
                      type="button"
                      title="Show in folder"
                      aria-label={`Show ${entry.name ?? "file"} in folder`}
                      onClick={() => run(() => revealPath(path))}
                      className={ICON_BUTTON}
                    >
                      <FolderOpen className="size-3.5" strokeWidth={1.75} aria-hidden />
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : null}
        {texts.map((entry) =>
          entry.kind === "link" && entry.text ? (
            <div key={entry.id} className={pictures.length || videos.length ? "px-2 pt-1" : ""}>
              <WebLinkCardLink url={entry.text.trim()} label={null} />
            </div>
          ) : (
            <div key={entry.id} className={pictures.length || videos.length || files.length ? "px-2 pt-1" : ""}>
              <ShareText text={entry.text ?? ""} />
            </div>
          ),
        )}
        <span
          className={`float-right ml-3 mt-0.5 flex items-center gap-1 text-[10.5px] tabular-nums ${
            (pictures.length || videos.length) && !texts.length && !files.length
              ? "absolute bottom-2 right-2.5 rounded-full bg-black/45 px-1.5 py-px text-white/90"
              : "text-content/40"
          }`}
        >
          {pinned ? <Pin className="size-3" strokeWidth={1.75} aria-label="Pinned" /> : null}
          {saved ? <Bookmark className="size-3" strokeWidth={1.75} aria-label="Saved" /> : null}
          {last ? shareTime(last.at) : null}
          {waiting ? " · waiting" : null}
        </span>
      </div>
      <div className={`mt-0.5 flex items-center gap-0.5 px-0.5 ${outgoing ? "flex-row-reverse" : ""}`}>
        {copyable ? (
          <FlashIcon
            icon={<Copy className="size-3.5" strokeWidth={1.75} aria-hidden />}
            label="Copy"
            onRun={() => copyText(copyable)}
            onError={onError}
          />
        ) : null}
        <span className="flex items-center gap-0.5 opacity-0 transition-opacity duration-100 group-hover/bubble:opacity-100 group-focus-within/bubble:opacity-100 motion-reduce:transition-none">
          {link && paired ? (
            <FlashIcon
              icon={<Send className="size-3.5" strokeWidth={1.75} aria-hidden />}
              label="Open on phone"
              onRun={() => invoke<void>("mobile_share_send_text", { text: link, clipboard: false, open: true })}
              onError={onError}
            />
          ) : null}
          <button
            type="button"
            title={pinned ? "Unpin" : "Pin"}
            aria-label={pinned ? "Unpin" : "Pin"}
            onClick={() => mark({ pinned: !pinned })}
            className={ICON_BUTTON}
          >
            {pinned ? (
              <PinOff className="size-3.5" strokeWidth={1.75} aria-hidden />
            ) : (
              <Pin className="size-3.5" strokeWidth={1.75} aria-hidden />
            )}
          </button>
          <button
            type="button"
            title={saved ? "Unsave" : "Save (kept when the history is full or deleted)"}
            aria-label={saved ? "Unsave" : "Save"}
            aria-pressed={saved}
            onClick={() => mark({ saved: !saved })}
            className={`${ICON_BUTTON} ${saved ? "text-accent" : ""}`}
          >
            <Bookmark className="size-3.5" strokeWidth={1.75} aria-hidden />
          </button>
          {link ? (
            <button type="button" title="Open" aria-label="Open link" onClick={() => openWebLink(link)} className={ICON_BUTTON}>
              <Send className="size-3.5 rotate-[-45deg]" strokeWidth={1.75} aria-hidden />
            </button>
          ) : null}
          <button
            type="button"
            title="Remove from history (a file stays where it is)"
            aria-label="Remove from history"
            onClick={() => run(() => invoke<void>("mobile_share_remove", { ids }))}
            className={`${ICON_BUTTON} text-content/30`}
          >
            <X className="size-3" strokeWidth={1.75} aria-hidden />
          </button>
        </span>
      </div>
    </li>
  );
}

import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState, useSyncExternalStore, type JSX, type MouseEvent, type ReactNode } from "react";
import { copyImage, copyText } from "../../../platform/tauri/clipboard";
import { openPathWithDefaultApp, readBinaryFile, revealPath } from "../../../platform/tauri/fs";
import {
  Bookmark,
  Check,
  CheckCircle,
  Copy,
  ExternalLink,
  File,
  FilePlusCorner,
  FolderOpen,
  Globe,
  Pin,
  PinOff,
  Send,
  Trash2,
} from "../../../shared/ui/icons";
import { ExplorerMenu, type ExplorerMenuItem } from "../../files/ui/ExplorerMenu";
import { createNote, noteTitle } from "../../notes";
import { loadNotesEnabled, subscribeNotesEnabled } from "../../settings/model/settings";
import { createTask } from "../../tasks/tasks";
import { openWebLink } from "../../browser/model/openWebLink";
import { openInMonoBrowser } from "../../browser/model/browserRequest";
import { openUrl } from "@tauri-apps/plugin-opener";
import { formatFileSize, isImagePath, sniffImageMime } from "../../files/model/filePreview";
import { AgentMarkdown } from "../../sessions/ui/AgentMarkdown";
import { WebLinkCardLink } from "../../sessions/ui/ChatHoverPreviews";
import { LocalMedia } from "../../sessions/ui/LocalMedia";
import type { ShareEntry } from "../model/mobileShare";
import { isLongShareText, isShareMedia, shareStamp, type ShareRow } from "../model/shareView";
import { shareErrorMessage } from "./PhoneStatus";

const ICON_BUTTON =
  "grid size-6 place-items-center rounded-md text-content/45 transition-[background-color,color,transform] duration-100 hover:bg-content/10 hover:text-content active:scale-[0.94] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60";

/** One size and colour for every icon in a message's row (L-302). */
const ICON = "size-3.5";

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
export function ShareImage({ path, label, tile }: { path: string; label: string; tile: boolean }): JSX.Element {
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

export function ShareText({ text }: { text: string }): JSX.Element {
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

export const isPicture = (entry: ShareEntry) => entry.kind === "file" && isImagePath(entry.path ?? entry.name ?? "");

/**
 * Fork (Hari, L-287, L-290): one Share message as a chat bubble: a single
 * item, or files sent together (pictures in a grid, other files listed under
 * it) with their caption. From the phone on the left, to the phone on the
 * right. L-317: one card: Copy at its bottom left (Save and Pin join it on
 * hover), the time at its bottom right; the rest is in the right-click menu.
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
  const remove = () => run(() => invoke<void>("mobile_share_remove", { ids }));
  const notesEnabled = useSyncExternalStore(subscribeNotesEnabled, loadNotesEnabled, () => true);
  // Fork (Hari, L-302): what a note or task gets: the text, then each file by
  // name and where it is on this computer.
  const fileLines = row.items
    .filter((entry) => entry.kind === "file")
    .map((entry) => (entry.path ? `- ${entry.name ?? "file"}: \`${entry.path}\`` : `- ${entry.name ?? "file"}`));
  const body = [copyable, fileLines.join("\n")].filter(Boolean).join("\n\n");
  const addNote = () => createNote({ title: noteTitle(body), body }).then(() => undefined);
  const addTask = () => createTask({ body }).then(() => undefined);
  // Copy: the words; else a picture as a picture; else the files' paths.
  const copyAll = async () => {
    if (copyable) return copyText(copyable);
    const picture = pictures[0]?.path;
    if (picture) {
      const bytes = await readBinaryFile(picture);
      return copyImage(new Blob([bytes], { type: sniffImageMime(bytes) ?? "image/png" }));
    }
    const paths = row.items.map((entry) => entry.path).filter(Boolean).join("\n");
    return copyText(paths || body);
  };
  const [menu, setMenu] = useState<{ x: number; y: number; href?: string } | null>(null);
  const onContextMenu = (event: MouseEvent<HTMLLIElement>) => {
    // Selected text keeps the native menu. A web link gets its open and copy
    // items first (fork, L-355); a left-click still follows Web links.
    if (!(window.getSelection()?.isCollapsed ?? true)) return;
    const anchor = (event.target as Element).closest("a[href]");
    const href = anchor?.getAttribute("href")?.trim();
    const web = href && /^https?:\/\//i.test(href) ? href : undefined;
    if (anchor && !web) return;
    event.preventDefault();
    setMenu({ x: event.clientX, y: event.clientY, href: web });
  };
  const linkItems: ExplorerMenuItem[] = menu?.href
    ? [
        { kind: "item", id: "link-default", label: "Open in default browser", icon: <ExternalLink className={ICON} aria-hidden /> },
        { kind: "item", id: "link-mono", label: "Open in MonoCode browser", icon: <Globe className={ICON} aria-hidden /> },
        { kind: "item", id: "link-copy", label: "Copy link", icon: <Copy className={ICON} aria-hidden /> },
        { kind: "sep" },
      ]
    : [];
  const menuItems: ExplorerMenuItem[] = [
    ...linkItems,
    { kind: "item", id: "copy", label: pictures.length && !copyable ? "Copy picture" : "Copy", icon: <Copy className={ICON} aria-hidden /> },
    ...(notesEnabled && body
      ? [{ kind: "item", id: "note", label: "Add to notes", icon: <FilePlusCorner className={ICON} aria-hidden /> } as const]
      : []),
    ...(body ? [{ kind: "item", id: "task", label: "Add task", icon: <CheckCircle className={ICON} aria-hidden /> } as const] : []),
    ...(link && paired
      ? [{ kind: "item", id: "phone", label: "Open on phone", icon: <Send className={ICON} aria-hidden /> } as const]
      : []),
    { kind: "item", id: "pin", label: pinned ? "Unpin" : "Pin", icon: pinned ? <PinOff className={ICON} aria-hidden /> : <Pin className={ICON} aria-hidden /> },
    { kind: "item", id: "save", label: saved ? "Unsave" : "Save", icon: <Bookmark className={ICON} aria-hidden /> },
    { kind: "sep" },
    { kind: "item", id: "remove", label: "Remove from history", danger: true, icon: <Trash2 className={ICON} aria-hidden /> },
  ];
  const pick = (id: string) => {
    const href = menu?.href;
    setMenu(null);
    if (id === "link-default" && href) run(() => openUrl(href));
    else if (id === "link-mono" && href) openInMonoBrowser(href);
    else if (id === "link-copy" && href) run(() => copyText(href));
    else if (id === "copy") run(copyAll);
    else if (id === "note") run(addNote);
    else if (id === "task") run(addTask);
    else if (id === "phone" && link)
      run(() => invoke<void>("mobile_share_send_text", { text: link, clipboard: false, open: true }));
    else if (id === "pin") mark({ pinned: !pinned });
    else if (id === "save") mark({ saved: !saved });
    else if (id === "remove") remove();
  };

  return (
    <li
      data-share-ids={ids.join(" ")}
      onContextMenu={onContextMenu}
      className={`group/bubble flex flex-col ${outgoing ? "items-end" : "items-start"}`}
    >
      {/* Fork (L-365): the card and the row under it share one width, so Copy
          and the time sit at its two ends. */}
      <div
        className={`flex ${link ? "w-[min(30rem,88%)]" : "max-w-[min(30rem,88%)]"} flex-col ${outgoing ? "items-end" : "items-start"}`}
      >
        <div
          className={`relative ${link ? "w-full" : "max-w-full"} overflow-hidden rounded-2xl border-[0.5px] ${
            outgoing
              ? "share-bubble-out rounded-br-md"
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
                {/* Fork (Hari, L-317): the card opens its page; no separate Open button. */}
                <button
                  type="button"
                  title={entry.text.trim()}
                  onClick={() => openWebLink(entry.text?.trim() ?? "")}
                  className="block w-full rounded-xl text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60"
                >
                  <WebLinkCardLink url={entry.text.trim()} label={null} bare />
                </button>
              </div>
            ) : (
              <div key={entry.id} className={pictures.length || videos.length || files.length ? "px-2 pt-1" : ""}>
                <ShareText text={entry.text ?? ""} />
              </div>
            ),
          )}
        </div>
        {/* Fork (Hari, L-317, L-358): under the card, on its side, as on the phone:
            Copy, with Save and Pin sliding in on hover (transform and opacity
            only), and the day and time. Everything else is in the right-click
            menu; clicking the picture, file or link opens it. */}
        <div className={`mt-0.5 flex items-center justify-between gap-2 self-stretch px-1 ${outgoing ? "flex-row-reverse" : ""}`}>
          <span className="flex items-center gap-0.5">
            <FlashIcon
              icon={<Copy className={ICON} strokeWidth={1.75} aria-hidden />}
              label={copyable ? "Copy" : pictures.length ? "Copy picture" : "Copy paths"}
              onRun={copyAll}
              onError={onError}
            />
            <span className="pointer-events-none flex -translate-x-1 items-center gap-0.5 opacity-0 transition-[transform,opacity] duration-150 ease-out group-focus-within/bubble:pointer-events-auto group-focus-within/bubble:translate-x-0 group-focus-within/bubble:opacity-100 group-hover/bubble:pointer-events-auto group-hover/bubble:translate-x-0 group-hover/bubble:opacity-100 motion-reduce:transition-none">
              <button
                type="button"
                title={saved ? "Unsave" : "Save (kept when the history is full or deleted)"}
                aria-label={saved ? "Unsave" : "Save"}
                aria-pressed={saved}
                onClick={() => mark({ saved: !saved })}
                className={ICON_BUTTON}
              >
                <Bookmark className={ICON} strokeWidth={1.75} aria-hidden />
              </button>
              <button
                type="button"
                title={pinned ? "Unpin" : "Pin"}
                aria-label={pinned ? "Unpin" : "Pin"}
                onClick={() => mark({ pinned: !pinned })}
                className={ICON_BUTTON}
              >
                {pinned ? (
                  <PinOff className={ICON} strokeWidth={1.75} aria-hidden />
                ) : (
                  <Pin className={ICON} strokeWidth={1.75} aria-hidden />
                )}
              </button>
            </span>
          </span>
          <span className="flex items-center gap-1 text-[10.5px] tabular-nums text-content/40">
            {pinned ? <Pin className="size-3" strokeWidth={1.75} aria-label="Pinned" /> : null}
            {saved ? <Bookmark className="size-3" strokeWidth={1.75} aria-label="Saved" /> : null}
            {last ? shareStamp(last.at) : null}
            {waiting ? " · waiting" : null}
          </span>
        </div>
      </div>
      {menu ? (
        <ExplorerMenu
          x={menu.x}
          y={menu.y}
          ariaLabel="Message actions"
          items={menuItems}
          onPick={pick}
          onClose={() => setMenu(null)}
        />
      ) : null}
    </li>
  );
}

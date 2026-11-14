/**
 * Fork (L-273): Settings → Storage. A gallery of the files MonoCode saved for
 * chat attachments (pasted files and the copies Interactive Claude read),
 * grouped by chat or project, with open, copy, show in folder and delete.
 */
import { invoke } from "@tauri-apps/api/core";
import { ask } from "@tauri-apps/plugin-dialog";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type ReactNode,
  type RefObject,
} from "react";
import { readBinaryFile, revealPath } from "../../../platform/tauri/fs";
import { copyImage } from "../../../platform/tauri/clipboard";
import { formatFileSize } from "../../files/model/filePreview";
import { FileTypeIcon } from "../../files/ui/FileTypeIcon";
import {
  holdAttachmentPreviewUrl,
  loadAttachmentPreviewUrl,
  sniffImageMime,
} from "../../sessions/model/attachments";
import { isHarnessId } from "../../sessions/model/models";
import { sessionDisplayTitle } from "../../sessions/model/session";
import { usePathPointerDrag } from "../../sessions/hooks/usePathPointerDrag";
import { HarnessIcon } from "../../sessions/ui/HarnessIcon";
import { ImageLightbox } from "../../../shared/ui/ImageLightbox";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { Copy, FolderOpen, RefreshCw, Trash2 } from "../../../shared/ui/icons";
import {
  attachmentDisplayName,
  dateRangeBounds,
  deleteConfirmation,
  filterByDate,
  filterByProjects,
  groupStorage,
  isDateFiltered,
  STORAGE_DATE_PRESETS,
  toDateInput,
  isImageAttachment,
  storageProjects,
  storageTotals,
  withoutDeleted,
  type AttachmentStorageScan,
  type StorageDatePreset,
  type StorageDateRange,
  type StorageGroup,
  type StorageSession,
  type StorageView,
  type StoredAttachment,
} from "../model/attachmentStorage";
import { forgetStorageThumbnails, storageThumbnail } from "./storageThumbnails";

type DeleteResult = {
  deleted: string[];
  freedBytes: number;
  failed: { path: string; message: string }[];
};

type ScanState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; scan: AttachmentStorageScan };

const VIEWS: { id: StorageView; label: string }[] = [
  { id: "chat", label: "By chat" },
  { id: "project", label: "By project" },
  { id: "all", label: "All" },
];

/** Tiles a group shows before "Show all", so a big chat stays scannable. */
const GROUP_PREVIEW = 24;

function chatTitle(session: StorageSession): string {
  return isHarnessId(session.harness)
    ? sessionDisplayTitle(session.title, session.harness)
    : session.title;
}

function formatStamp(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "";
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(ms));
  } catch {
    return "";
  }
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

export function StorageSettings({
  onOpenSession,
}: {
  onOpenSession: (sessionId: string) => void;
}): JSX.Element {
  const [state, setState] = useState<ScanState>({ status: "loading" });
  const [view, setView] = useState<StorageView>("chat");
  const [range, setRange] = useState<StorageDateRange>({ preset: "all", from: "", to: "" });
  const [pickedProjects, setPickedProjects] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "info" | "error"; text: string } | null>(null);
  const scanRequest = useRef(0);

  const refresh = useCallback(async () => {
    const request = ++scanRequest.current;
    setState({ status: "loading" });
    try {
      const scan = await invoke<AttachmentStorageScan>("attachment_storage_scan");
      if (request === scanRequest.current) setState({ status: "ready", scan });
    } catch (cause) {
      if (request === scanRequest.current) {
        setState({ status: "error", message: String(cause) });
      }
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const scan = state.status === "ready" ? state.scan : null;
  const datesFiltered = isDateFiltered(range);
  // "Today" and friends are read against the clock when the range changes.
  const dated = useMemo(
    () => (scan ? filterByDate(scan, range, Date.now()) : null),
    [scan, range],
  );
  // Fork (L-289): the Project filter, after the dates so its counts match them.
  const projectOptions = useMemo(
    () => (scan && dated ? storageProjects(scan, dated) : []),
    [scan, dated],
  );
  // A picked project whose files were all deleted drops out of the filter.
  const projects = useMemo(
    () => pickedProjects.filter((key) => projectOptions.some((option) => option.key === key)),
    [pickedProjects, projectOptions],
  );
  const shown = useMemo(
    () => (dated ? filterByProjects(dated, projects) : null),
    [dated, projects],
  );
  const filtered = datesFiltered || projects.length > 0;
  const filterScope = [
    datesFiltered ? "saved in the chosen dates" : "",
    projects.length ? (projects.length === 1 ? "in the chosen project" : "in the chosen projects") : "",
  ]
    .filter(Boolean)
    .join(" ");
  const projectSelectOptions = useMemo(
    () => [
      { value: "", label: "All projects", count: dated?.files.length ?? 0 },
      ...projectOptions.map((option) => ({
        value: option.key,
        label: option.label,
        keywords: option.detail,
        count: option.count,
      })),
    ],
    [projectOptions, dated],
  );
  const groups = useMemo(
    () => (shown ? groupStorage(shown, view, chatTitle) : []),
    [shown, view],
  );
  const totals = useMemo(() => storageTotals(scan?.files ?? []), [scan]);
  const shownTotals = useMemo(() => storageTotals(shown?.files ?? []), [shown]);

  const choosePreset = (preset: StorageDatePreset) => {
    setRange((current) => {
      if (preset !== "custom") return { ...current, preset };
      // Custom starts from the dates the last preset covered ("Older than
      // 30 days" keeps an open start), or today for All time.
      const { start, end } = dateRangeBounds(current, Date.now());
      const today = toDateInput(Date.now());
      const open = start == null && end == null;
      return {
        preset,
        from: current.from || (start != null ? toDateInput(start) : open ? today : ""),
        to: current.to || (end != null ? toDateInput(end - 1) : today),
      };
    });
  };

  const deleteFiles = async (files: StoredAttachment[], scope: string) => {
    if (!files.length || busy) return;
    const confirmed = await ask(deleteConfirmation(files, scope), {
      title: "Delete saved files",
      kind: "warning",
      okLabel: "Delete",
      cancelLabel: "Cancel",
    });
    if (!confirmed) return;
    setBusy(true);
    setNotice(null);
    try {
      const result = await invoke<DeleteResult>("attachment_storage_delete", {
        paths: files.map((file) => file.path),
      });
      forgetStorageThumbnails(result.deleted);
      setState((current) =>
        current.status === "ready"
          ? { status: "ready", scan: withoutDeleted(current.scan, result.deleted) }
          : current,
      );
      const parts = [
        `Deleted ${plural(result.deleted.length, "file")}, freed ${formatFileSize(result.freedBytes)}.`,
      ];
      if (result.failed.length) {
        parts.push(
          `${plural(result.failed.length, "file")} couldn't be deleted (in use or already gone).`,
        );
      }
      setNotice({ tone: result.failed.length ? "error" : "info", text: parts.join(" ") });
    } catch (cause) {
      setNotice({ tone: "error", text: `Couldn't delete: ${String(cause)}` });
    } finally {
      setBusy(false);
    }
  };

  const copyFile = async (file: StoredAttachment) => {
    try {
      const bytes = await readBinaryFile(file.path);
      const mime = sniffImageMime(bytes);
      if (!mime) throw new Error("not an image");
      await copyImage(new Blob([bytes], { type: mime }));
      setNotice({ tone: "info", text: "Image copied." });
    } catch {
      setNotice({ tone: "error", text: "Couldn't copy that image." });
    }
  };

  const reveal = (path: string) => {
    revealPath(path).catch(() =>
      setNotice({ tone: "error", text: "Couldn't open the folder." }),
    );
  };

  return (
    <section data-setting-id="storage-attachments" className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">Saved attachments</h2>
          <p className="mt-1 text-xs text-content/55">
            Files you pasted or attached to chats, and the copies Interactive
            Claude read. Chats show their images from these files.
          </p>
          {scan ? (
            <p className="mt-2 text-xs tabular-nums text-content/70">
              {plural(totals.count, "file")} · {formatFileSize(totals.bytes)}
              <span className="text-content/45">
                {" "}
                (pasted {formatFileSize(totals.pastedBytes)}, Claude copies{" "}
                {formatFileSize(totals.interactiveBytes)})
              </span>
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {scan ? (
            <>
              <ToolbarButton onClick={() => reveal(scan.pastedRoot)}>
                <FolderOpen className="size-3.5" />
                Pasted folder
              </ToolbarButton>
              <ToolbarButton onClick={() => reveal(scan.interactiveRoot)}>
                <FolderOpen className="size-3.5" />
                Claude copies folder
              </ToolbarButton>
            </>
          ) : null}
          <ToolbarButton
            onClick={() => void refresh()}
            disabled={busy || state.status === "loading"}
          >
            <RefreshCw className="size-3.5" />
            Refresh
          </ToolbarButton>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          role="group"
          aria-label="Group saved files"
          className="inline-flex gap-0.5 rounded-md border border-content/10 p-0.5 text-[12px]"
        >
          {VIEWS.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={view === option.id}
              onClick={() => setView(option.id)}
              className={`rounded-[5px] px-2.5 py-1 transition-colors ${
                view === option.id
                  ? "bg-selection text-content"
                  : "text-content/50 hover:text-content"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {projectOptions.length ? (
            <SearchableSelect
              variant="pill"
              label="Project"
              value=""
              options={projectSelectOptions}
              searchable={projectOptions.length > 6}
              searchPlaceholder="Search projects…"
              multiple={{
                values: projects,
                summary: (count) => `${count} projects`,
                onToggle: (key) =>
                  setPickedProjects(
                    projects.includes(key)
                      ? projects.filter((entry) => entry !== key)
                      : [...projects, key],
                  ),
              }}
              onChange={() => setPickedProjects([])}
            />
          ) : null}
          <DateRangeControls
            range={range}
            onPreset={choosePreset}
            onDates={(from, to) => setRange({ preset: "custom", from, to })}
          />
        </div>
        {shown && shown.files.length ? (
          <ToolbarButton
            danger
            disabled={busy}
            onClick={() =>
              void deleteFiles(
                shown.files,
                filtered ? filterScope : "saved by MonoCode (all of them)",
              )
            }
          >
            <Trash2 className="size-3.5" />
            {filtered ? `Delete ${shown.files.length} shown…` : "Delete all…"}
          </ToolbarButton>
        ) : null}
      </div>
      {filtered && scan ? (
        <p className="-mt-2 text-xs tabular-nums text-content/55" role="status">
          Showing {plural(shownTotals.count, "file")} · {formatFileSize(shownTotals.bytes)} of{" "}
          {plural(totals.count, "file")}
          <button
            type="button"
            onClick={() => {
              setRange((current) => ({ ...current, preset: "all" }));
              setPickedProjects([]);
            }}
            className="ml-2 underline underline-offset-2 hover:text-content"
          >
            Clear filters
          </button>
        </p>
      ) : null}

      {notice ? (
        <p
          role={notice.tone === "error" ? "alert" : "status"}
          className={`rounded-md border p-3 text-xs ${
            notice.tone === "error"
              ? "border-red-500/30 bg-red-500/10 text-red-400"
              : "border-content/10 bg-content/5 text-content/75"
          }`}
        >
          {notice.text}
        </p>
      ) : null}

      {state.status === "loading" ? (
        <StorageSkeleton />
      ) : state.status === "error" ? (
        <div role="alert" className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-400">
          Couldn't read the saved files: {state.message}
          <button
            type="button"
            onClick={() => void refresh()}
            className="ml-2 underline underline-offset-2 hover:text-red-300"
          >
            Try again
          </button>
        </div>
      ) : groups.length === 0 ? (
        <p className="rounded-xl border border-content/10 bg-content/3 px-4 py-6 text-center text-[12px] text-content/45">
          {filtered && scan?.files.length
            ? "No files match these filters."
            : "No saved attachments. Files you paste into a chat show up here."}
        </p>
      ) : (
        <div className="space-y-6" aria-busy={busy}>
          {groups.map((group) => (
            <StorageGroupCard
              key={`${view}:${group.key}`}
              group={group}
              filterScope={filtered ? filterScope : ""}
              busy={busy}
              onOpenSession={onOpenSession}
              onDelete={(files, scope) => void deleteFiles(files, scope)}
              onCopy={(file) => void copyFile(file)}
              onReveal={reveal}
            />
          ))}
        </div>
      )}
    </section>
  );
}

/** `scope`: what the filters leave ("saved in the chosen dates"), or "" for none. */
function deleteScope(group: StorageGroup, scope: string): string {
  const dates = scope ? ` ${scope}` : "";
  switch (group.kind) {
    case "chat":
      return `from "${group.title}"${dates}`;
    case "project":
      return `from chats in ${group.title}${dates}`;
    case "unlinked":
      return `not linked to a chat${dates}`;
    case "all":
      return scope || "saved by MonoCode (all of them)";
  }
}

function StorageGroupCard({
  group,
  filterScope,
  busy,
  onOpenSession,
  onDelete,
  onCopy,
  onReveal,
}: {
  group: StorageGroup;
  filterScope: string;
  busy: boolean;
  onOpenSession: (sessionId: string) => void;
  onDelete: (files: StoredAttachment[], scope: string) => void;
  onCopy: (file: StoredAttachment) => void;
  onReveal: (path: string) => void;
}): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? group.files : group.files.slice(0, GROUP_PREVIEW);
  const session = group.session;
  const fileScope = (file: StoredAttachment) =>
    file.sessionIds.length ? deleteScope(group, "") : "not linked to a chat";

  return (
    <section aria-label={group.title}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pb-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {session && isHarnessId(session.harness) ? (
            <HarnessIcon harness={session.harness} className="size-3.5 shrink-0" />
          ) : null}
          <div className="min-w-0">
            {session ? (
              <button
                type="button"
                onClick={() => onOpenSession(session.id)}
                title="Open this chat"
                className="block max-w-full truncate text-left text-[13px] font-medium text-content hover:underline hover:underline-offset-2"
              >
                {group.title}
              </button>
            ) : (
              <h3 className="truncate text-[13px] font-medium text-content">{group.title}</h3>
            )}
            {group.subtitle ? (
              <p className="truncate text-[11px] text-content/40">{group.subtitle}</p>
            ) : null}
          </div>
        </div>
        <span className="shrink-0 text-[11px] tabular-nums text-content/45">
          {plural(group.files.length, "file")} · {formatFileSize(group.bytes)}
        </span>
        <ToolbarButton
          danger
          disabled={busy}
          onClick={() => onDelete(group.files, deleteScope(group, filterScope))}
        >
          <Trash2 className="size-3.5" />
          {group.kind === "all" && !filterScope ? "Delete all" : group.files.length === 1 ? "Delete" : `Delete ${group.files.length}`}
        </ToolbarButton>
      </div>
      <ul
        role="list"
        className="grid grid-cols-[repeat(auto-fill,minmax(104px,1fr))] gap-2 rounded-xl border border-content/10 bg-content/3 p-2"
      >
        {shown.map((file) => (
          <StorageTile
            key={file.path}
            file={file}
            busy={busy}
            onDelete={() => onDelete([file], fileScope(file))}
            onCopy={() => onCopy(file)}
            onReveal={() => onReveal(file.path)}
          />
        ))}
      </ul>
      {group.files.length > GROUP_PREVIEW ? (
        <button
          type="button"
          onClick={() => setExpanded((open) => !open)}
          className="mt-2 text-[12px] text-content/55 hover:text-content"
        >
          {expanded ? "Show fewer" : `Show all ${group.files.length}`}
        </button>
      ) : null}
    </section>
  );
}

/** Loads a thumbnail only once the tile scrolls near the view. */
function useVisibleOnce<T extends Element>(): [RefObject<T | null>, boolean] {
  const ref = useRef<T | null>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element || visible) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [visible]);
  return [ref, visible];
}

function StorageTile({
  file,
  busy,
  onDelete,
  onCopy,
  onReveal,
}: {
  file: StoredAttachment;
  busy: boolean;
  onDelete: () => void;
  onCopy: () => void;
  onReveal: () => void;
}): JSX.Element {
  const [ref, visible] = useVisibleOnce<HTMLLIElement>();
  const image = isImageAttachment(file);
  // `url` is the full picture (the lightbox); `small` the tile's square copy (L-289).
  const [thumb, setThumb] = useState<
    { status: "idle" | "missing" } | { status: "ready"; url: string; small: string }
  >({
    status: "idle",
  });
  const [open, setOpen] = useState(false);
  const name = attachmentDisplayName(file);
  const stamp = formatStamp(file.modifiedMs);
  const drag = usePathPointerDrag(file.path, name);

  useEffect(() => {
    if (!visible || !image) return;
    let cancelled = false;
    const release = holdAttachmentPreviewUrl(file.path);
    void loadAttachmentPreviewUrl(file.path).then(async (url) => {
      const small = url ? await storageThumbnail(file.path, url) : null;
      if (!cancelled) setThumb(url && small ? { status: "ready", url, small } : { status: "missing" });
    });
    return () => {
      cancelled = true;
      release();
    };
  }, [visible, image, file.path]);

  const label = `${name}, ${stamp}, ${formatFileSize(file.size)}`;

  return (
    // Off-screen tiles skip layout and paint (content-visibility), L-289.
    <li
      ref={ref}
      className="group relative aspect-square overflow-hidden rounded-lg bg-content/5 [content-visibility:auto] [contain-intrinsic-size:auto_104px]"
    >
      <button
        type="button"
        aria-label={image ? `Open ${label}` : `Show ${label} in its folder`}
        title={`${name} · ${formatFileSize(file.size)}`}
        onClick={() => (image && thumb.status === "ready" ? setOpen(true) : onReveal())}
        onPointerDown={drag.onPointerDown}
        onClickCapture={drag.onClickCapture}
        className={`absolute inset-0 grid place-items-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent ${
          image && thumb.status === "ready" ? "cursor-zoom-in" : ""
        }`}
      >
        {image && thumb.status === "ready" ? (
          <img
            src={thumb.small}
            decoding="async"
            alt=""
            draggable={false}
            className="size-full object-cover outline outline-1 -outline-offset-1 outline-content/10"
          />
        ) : image && thumb.status === "idle" ? (
          <span aria-hidden className="size-full animate-pulse bg-content/5 motion-reduce:animate-none" />
        ) : (
          <span className="flex flex-col items-center gap-1 px-2 text-center">
            <FileTypeIcon name={file.name} isDir={false} size={22} />
            <span className="line-clamp-2 break-all text-[10px] text-content/55">
              {thumb.status === "missing" ? "Can't preview" : name}
            </span>
          </span>
        )}
      </button>
      <span className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center gap-1 bg-linear-to-t from-black/60 to-transparent px-1.5 pb-1 pt-4 text-[10px] tabular-nums text-white/90">
        <span className="truncate">{stamp}</span>
        {file.store === "interactive" ? (
          <span className="ml-auto shrink-0 rounded bg-white/20 px-1">Copy</span>
        ) : null}
      </span>
      <div className="absolute right-1 top-1 flex gap-0.5 opacity-0 transition-opacity duration-150 group-focus-within:opacity-100 group-hover:opacity-100">
        {image ? (
          <TileAction label={`Copy ${name}`} onClick={onCopy}>
            <Copy className="size-3.5" />
          </TileAction>
        ) : null}
        <TileAction label={`Show ${name} in its folder`} onClick={onReveal}>
          <FolderOpen className="size-3.5" />
        </TileAction>
        <TileAction label={`Delete ${name}`} onClick={onDelete} disabled={busy} danger>
          <Trash2 className="size-3.5" />
        </TileAction>
      </div>
      {open && thumb.status === "ready" ? (
        <ImageLightbox src={thumb.url} alt={name} onClose={() => setOpen(false)} />
      ) : null}
    </li>
  );
}

function TileAction({
  label,
  onClick,
  disabled = false,
  danger = false,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className={`grid size-6 place-items-center rounded-md bg-black/70 text-white/90 transition-[transform,background-color] duration-100 active:scale-96 disabled:opacity-50 ${
        danger ? "hover:bg-red-600/80" : "hover:bg-black/75"
      }`}
    >
      {children}
    </button>
  );
}

function ToolbarButton({
  onClick,
  disabled = false,
  danger = false,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-colors disabled:opacity-50 ${
        danger
          ? "border-red-500/30 text-red-400 hover:bg-red-500/10"
          : "border-stroke hover:bg-content/5"
      }`}
    >
      {children}
    </button>
  );
}

const DATE_OPTIONS = STORAGE_DATE_PRESETS.map((option) => ({ value: option.id, label: option.label }));

const FIELD =
  "rounded-md border border-content/10 bg-content/5 px-2 py-1 text-[12px] text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

function DateRangeControls({
  range,
  onPreset,
  onDates,
}: {
  range: StorageDateRange;
  onPreset: (preset: StorageDatePreset) => void;
  onDates: (from: string, to: string) => void;
}): JSX.Element {
  const today = toDateInput(Date.now());
  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* L-289: the app's own dropdown, like the Project filter beside it. */}
      <SearchableSelect
        variant="pill"
        label="Saved"
        value={range.preset}
        options={DATE_OPTIONS}
        searchable={false}
        onChange={(value) => {
          const preset = STORAGE_DATE_PRESETS.find((option) => option.id === value);
          if (preset) onPreset(preset.id);
        }}
      />
      {range.preset === "custom" ? (
        <>
          <label className="flex items-center gap-1.5 text-[12px] text-content/55">
            From
            <input
              type="date"
              value={range.from}
              max={today}
              onChange={(event) => onDates(event.target.value, range.to)}
              className={FIELD}
            />
          </label>
          <label className="flex items-center gap-1.5 text-[12px] text-content/55">
            To
            <input
              type="date"
              value={range.to}
              max={today}
              onChange={(event) => onDates(range.from, event.target.value)}
              className={FIELD}
            />
          </label>
        </>
      ) : null}
    </div>
  );
}

function StorageSkeleton(): JSX.Element {
  return (
    <div aria-busy="true" aria-label="Counting saved files" className="space-y-2">
      <p className="text-xs text-content/45">Counting saved files…</p>
      <ul role="list" className="grid grid-cols-[repeat(auto-fill,minmax(104px,1fr))] gap-2">
        {Array.from({ length: 8 }, (_, index) => (
          <li
            key={index}
            className="aspect-square animate-pulse rounded-lg bg-content/5 motion-reduce:animate-none"
          />
        ))}
      </ul>
    </div>
  );
}

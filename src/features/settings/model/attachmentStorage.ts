/**
 * Fork (L-273): grouping and labels for Settings → Storage, the gallery of
 * files MonoCode saved for chat attachments. The scan comes from the
 * `attachment_storage_scan` command; this module stays pure for tests.
 */
import { pathKey, projectName, prettyCwd } from "../../../shared/lib/paths";

export type AttachmentStore = "pasted" | "interactive";

export type StoredAttachment = {
  path: string;
  name: string;
  size: number;
  modifiedMs: number;
  /** `pasted`: the file chats show. `interactive`: the copy Claude read. */
  store: AttachmentStore;
  /** Chats that point at this file; empty when none does any more. */
  sessionIds: string[];
};

export type StorageSession = {
  id: string;
  title: string;
  cwd: string;
  harness: string;
  updatedAt: number;
  archived: boolean;
};

export type AttachmentStorageScan = {
  pastedRoot: string;
  interactiveRoot: string;
  files: StoredAttachment[];
  sessions: StorageSession[];
};

export type StorageView = "chat" | "project" | "all";

export type StorageGroup = {
  key: string;
  kind: "chat" | "project" | "unlinked" | "all";
  title: string;
  subtitle: string;
  /** The chat a `chat` group belongs to. */
  session?: StorageSession;
  files: StoredAttachment[];
  bytes: number;
  /** Files here that another chat also shows. */
  sharedCount: number;
};

export const UNLINKED_GROUP_KEY = "unlinked";

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp"]);

export function isImageAttachment(file: Pick<StoredAttachment, "name">): boolean {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  return IMAGE_EXTENSIONS.has(extension);
}

/**
 * Name the user gave the file. Pasted files carry a `<pid>-<nanos>-` prefix;
 * Interactive copies are random ids, so they read as "Claude copy".
 */
export function attachmentDisplayName(file: Pick<StoredAttachment, "name" | "store">): string {
  if (file.store === "interactive") {
    const extension = file.name.split(".").pop()?.toLowerCase();
    return extension ? `Claude copy (.${extension})` : "Claude copy";
  }
  return file.name.replace(/^\d+-\d+-/, "") || file.name;
}

/** The chat a file is filed under: the most recently updated one using it. */
function primarySession(
  file: StoredAttachment,
  sessions: Map<string, StorageSession>,
): StorageSession | undefined {
  let best: StorageSession | undefined;
  for (const id of file.sessionIds) {
    const session = sessions.get(id);
    if (session && (!best || session.updatedAt > best.updatedAt)) best = session;
  }
  return best;
}

function sumBytes(files: StoredAttachment[]): number {
  return files.reduce((total, file) => total + file.size, 0);
}

function makeGroup(
  base: Omit<StorageGroup, "bytes" | "sharedCount" | "files">,
  files: StoredAttachment[],
): StorageGroup {
  const sorted = [...files].sort((a, b) => b.modifiedMs - a.modifiedMs);
  return {
    ...base,
    files: sorted,
    bytes: sumBytes(sorted),
    sharedCount: sorted.filter((file) => file.sessionIds.length > 1).length,
  };
}

function newest(group: StorageGroup): number {
  return group.files[0]?.modifiedMs ?? 0;
}

/**
 * Groups for one view, newest first. A file used by several chats is filed
 * once, under the chat updated last, so a total never counts it twice. Files
 * no chat points at sit in one "Not linked to a chat" group at the end.
 */
export function groupStorage(
  scan: AttachmentStorageScan,
  view: StorageView,
  titleFor: (session: StorageSession) => string = (session) => session.title,
): StorageGroup[] {
  if (view === "all") {
    return scan.files.length
      ? [makeGroup({ key: "all", kind: "all", title: "All files", subtitle: "" }, scan.files)]
      : [];
  }
  const sessions = new Map(scan.sessions.map((session) => [session.id, session]));
  const buckets = new Map<string, { session: StorageSession; files: StoredAttachment[] }>();
  const unlinked: StoredAttachment[] = [];
  for (const file of scan.files) {
    const session = primarySession(file, sessions);
    if (!session) {
      unlinked.push(file);
      continue;
    }
    const key = view === "chat" ? session.id : pathKey(session.cwd);
    const bucket = buckets.get(key);
    if (bucket) bucket.files.push(file);
    else buckets.set(key, { session, files: [file] });
  }
  const groups = [...buckets.entries()].map(([key, { session, files }]) =>
    view === "chat"
      ? makeGroup(
          {
            key,
            kind: "chat",
            title: titleFor(session),
            subtitle: `${projectName(session.cwd)}${session.archived ? " · Archived" : ""}`,
            session,
          },
          files,
        )
      : makeGroup(
          { key, kind: "project", title: projectName(session.cwd), subtitle: prettyCwd(session.cwd) },
          files,
        ),
  );
  groups.sort((a, b) => newest(b) - newest(a));
  if (unlinked.length) {
    groups.push(
      makeGroup(
        {
          key: UNLINKED_GROUP_KEY,
          kind: "unlinked",
          title: "Not linked to a chat",
          subtitle: "From deleted chats, unsent drafts and other places",
        },
        unlinked,
      ),
    );
  }
  return groups;
}

export type StorageTotals = { count: number; bytes: number; pastedBytes: number; interactiveBytes: number };

export function storageTotals(files: StoredAttachment[]): StorageTotals {
  let pastedBytes = 0;
  let interactiveBytes = 0;
  for (const file of files) {
    if (file.store === "pasted") pastedBytes += file.size;
    else interactiveBytes += file.size;
  }
  return { count: files.length, bytes: pastedBytes + interactiveBytes, pastedBytes, interactiveBytes };
}

/** The scan without the files just deleted, and without chats left empty. */
export function withoutDeleted(
  scan: AttachmentStorageScan,
  deleted: readonly string[],
): AttachmentStorageScan {
  const gone = new Set(deleted);
  const files = scan.files.filter((file) => !gone.has(file.path));
  const linked = new Set(files.flatMap((file) => file.sessionIds));
  return { ...scan, files, sessions: scan.sessions.filter((session) => linked.has(session.id)) };
}

/** Words for a delete confirmation: what goes, and what the chats lose. */
export function deleteConfirmation(files: StoredAttachment[], scope: string): string {
  const count = files.length;
  const pasted = files.filter((file) => file.store === "pasted");
  const shared = files.filter((file) => file.sessionIds.length > 1).length;
  const lines = [`Delete ${count === 1 ? "this file" : `${count} files`} ${scope}?`];
  if (pasted.some((file) => file.sessionIds.length > 0)) {
    lines.push("These images disappear from the chats that show them.");
  }
  if (shared > 0) {
    lines.push(`${shared} ${shared === 1 ? "is" : "are"} also shown in another chat.`);
  }
  lines.push("This cannot be undone.");
  return lines.join("\n");
}

export type StorageDatePreset = "all" | "today" | "last-7" | "last-30" | "older-30" | "custom";

/** `from` and `to` are `YYYY-MM-DD` from a date input; either may be empty. */
export type StorageDateRange = { preset: StorageDatePreset; from: string; to: string };

export const STORAGE_DATE_PRESETS: { id: StorageDatePreset; label: string }[] = [
  { id: "all", label: "All time" },
  { id: "today", label: "Today" },
  { id: "last-7", label: "Last 7 days" },
  { id: "last-30", label: "Last 30 days" },
  { id: "older-30", label: "Older than 30 days" },
  { id: "custom", label: "Custom dates" },
];

/** Calendar days, not 24-hour steps, so a daylight-saving change can't shift a bound. */
function addDays(dayStart: number, days: number): number {
  const date = new Date(dayStart);
  date.setDate(date.getDate() + days);
  return date.getTime();
}

function startOfLocalDay(ms: number): number {
  const date = new Date(ms);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** Local midnight for a `YYYY-MM-DD` value, or null when it isn't one. */
export function parseDateInput(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(year, month - 1, day);
  return date.getMonth() === month - 1 && date.getDate() === day ? date.getTime() : null;
}

export function toDateInput(ms: number): string {
  const date = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Saved-time bounds for a range, in local days: `start` inclusive, `end`
 * exclusive, either open. "Last 7 days" is today and the six days before.
 * A custom range given backwards is read the right way round.
 */
export function dateRangeBounds(
  range: StorageDateRange,
  now: number,
): { start: number | null; end: number | null } {
  const today = startOfLocalDay(now);
  switch (range.preset) {
    case "all":
      return { start: null, end: null };
    case "today":
      return { start: today, end: null };
    case "last-7":
      return { start: addDays(today, -6), end: null };
    case "last-30":
      return { start: addDays(today, -29), end: null };
    case "older-30":
      return { start: null, end: addDays(today, -29) };
    case "custom": {
      let from = parseDateInput(range.from);
      let to = parseDateInput(range.to);
      if (from != null && to != null && from > to) [from, to] = [to, from];
      return { start: from, end: to == null ? null : addDays(to, 1) };
    }
  }
}

export function isDateFiltered(range: StorageDateRange): boolean {
  return range.preset !== "all" && (range.preset !== "custom" || Boolean(range.from || range.to));
}

/** The scan with only the files saved inside the range. */
export function filterByDate(
  scan: AttachmentStorageScan,
  range: StorageDateRange,
  now: number,
): AttachmentStorageScan {
  const { start, end } = dateRangeBounds(range, now);
  if (start == null && end == null) return scan;
  return {
    ...scan,
    files: scan.files.filter(
      (file) => (start == null || file.modifiedMs >= start) && (end == null || file.modifiedMs < end),
    ),
  };
}

// ---------------------------------------------------------------------------
// Fork (L-289): the Project filter. A file belongs to the project of the chat
// it's filed under (see `groupStorage`); files no chat points at are their own
// choice, so they can be picked or left out like a project.

export type StorageProjectOption = { key: string; label: string; detail: string; count: number };

function projectKeyOf(file: StoredAttachment, sessions: Map<string, StorageSession>): string {
  const session = primarySession(file, sessions);
  return session ? pathKey(session.cwd) : UNLINKED_GROUP_KEY;
}

/**
 * Every project that has saved files, by name, with "Not linked to a chat"
 * last. Counts come from `counted` (the files the dates leave), so the menu
 * matches what picking one would show; a project with none left still lists.
 */
export function storageProjects(
  scan: AttachmentStorageScan,
  counted: AttachmentStorageScan = scan,
): StorageProjectOption[] {
  const sessions = new Map(scan.sessions.map((session) => [session.id, session]));
  const options = new Map<string, StorageProjectOption>();
  for (const file of scan.files) {
    const key = projectKeyOf(file, sessions);
    if (options.has(key)) continue;
    const session = key === UNLINKED_GROUP_KEY ? undefined : primarySession(file, sessions);
    options.set(key, {
      key,
      label: session ? projectName(session.cwd) : "Not linked to a chat",
      detail: session ? prettyCwd(session.cwd) : "",
      count: 0,
    });
  }
  const countedSessions = new Map(counted.sessions.map((session) => [session.id, session]));
  for (const file of counted.files) {
    const option = options.get(projectKeyOf(file, countedSessions));
    if (option) option.count += 1;
  }
  return [...options.values()].sort((a, b) =>
    a.key === UNLINKED_GROUP_KEY
      ? 1
      : b.key === UNLINKED_GROUP_KEY
        ? -1
        : a.label.localeCompare(b.label, undefined, { sensitivity: "base" }),
  );
}

/** The scan with only the files in the picked projects; none picked keeps all. */
export function filterByProjects(
  scan: AttachmentStorageScan,
  keys: readonly string[],
): AttachmentStorageScan {
  if (!keys.length) return scan;
  const picked = new Set(keys);
  const sessions = new Map(scan.sessions.map((session) => [session.id, session]));
  return { ...scan, files: scan.files.filter((file) => picked.has(projectKeyOf(file, sessions))) };
}

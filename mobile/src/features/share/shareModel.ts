// Fork (Hari, L-279): Share between the phone and the paired computer. The
// shapes on the wire (`share` link items, `share.upload`, `share.download`)
// and the phone's own history, read defensively: anything of the wrong shape
// is dropped rather than shown half-broken.

export const MAX_SHARE_HISTORY = 100;
/** Fork (Hari, L-356): the history limits the computer offers; the chosen one is set from it. */
export const SHARE_LIMITS = [100, 250, 500, 1000] as const;
let historyLimit: number = MAX_SHARE_HISTORY;

export function shareHistoryLimit(): number {
  return historyLimit;
}

/** Takes one of `SHARE_LIMITS`; anything else is ignored. */
export function setShareHistoryLimit(limit: unknown): boolean {
  if (typeof limit !== "number" || !SHARE_LIMITS.some((value) => value === limit)) return false;
  historyLimit = limit;
  return true;
}
export const MAX_SHARE_TEXT = 30_000;
/** Fork (L-290): up to 1 GB, resumable. */
export const MAX_SHARE_FILE_BYTES = 1024 * 1024 * 1024;
/** Fork (L-290): files from the computer up to this arrive by themselves; bigger wait for Download. */
export const AUTO_DOWNLOAD_BYTES = 10 * 1024 * 1024;
/** One `share.upload` / `share.download` piece, before base64. */
export const SHARE_CHUNK_BYTES = 1024 * 1024;
export const MAX_SHARE_FILES = 20;

export type ShareKind = "text" | "link" | "clipboard" | "file";

export type ShareStatus =
  /** Fork (L-290): a big file from the computer, waiting for the user to tap Download. */
  | "offered"
  /** Waiting in the outbox, or a file not moved yet. */
  | "queued"
  /** A file on its way (`progress` says how far). */
  | "moving"
  | "done"
  /** Stopped with `error`; a file can be tried again. */
  | "failed";

export type PhoneShareEntry = {
  id: string;
  direction: "in" | "out";
  kind: ShareKind;
  text?: string;
  name?: string;
  size?: number;
  mimeType?: string;
  /** In: where the saved file is (a Downloads content URI). Out: the copy sent. */
  uri?: string;
  /** In: the computer's id for a file it offers, to fetch it again. */
  fileId?: string;
  /** Out: the outbox item that carries this text. */
  outboxId?: string;
  at: number;
  status: ShareStatus;
  progress?: number;
  error?: string;
  /** Fork (L-290): items sent together (files + caption). */
  groupId?: string;
  /** Pinned and saved never roll off; both sync with the computer. */
  pinned?: boolean;
  saved?: boolean;
};

/** Fork (L-290): a pin, save or Delete all made on the other device; L-317: or a remove. */
export type ShareMeta =
  | { type: "meta"; action: "pin" | "unpin" | "save" | "unsave"; ids: string[] }
  | { type: "meta"; action: "remove"; ids: string[] }
  | { type: "meta"; action: "clear" };

/** A `share` item from the computer. */
export type IncomingShare =
  | {
      type: "text" | "link" | "clipboard";
      text: string;
      /** Fork (L-287): "Open on phone": a web link the phone should open, not just keep. */
      open?: boolean;
      /** Fork (L-290): the computer's id for it, the same on both sides. */
      entryId?: string;
      groupId?: string;
    }
  | {
      type: "file";
      fileId: string;
      name: string;
      mimeType: string;
      size: number;
      groupId?: string;
      /** Fork (L-349): the phone asked for it (browsing the computer): fetch at once, any size. */
      auto?: boolean;
    };

const KINDS: readonly ShareKind[] = ["text", "link", "clipboard", "file"];
const STATUSES: readonly ShareStatus[] = ["offered", "queued", "moving", "done", "failed"];
const META_ACTIONS = ["pin", "unpin", "save", "unsave"] as const;
const isId = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const optionalId = (value: unknown): string | undefined => (isId(value) ? value : undefined);

const field = (value: unknown, name: string): unknown =>
  typeof value === "object" && value !== null ? Reflect.get(value, name) : undefined;
const optionalString = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;
const isSize = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

/** A single web address on one line is a link; anything else is text. */
export function kindForText(text: string): "text" | "link" {
  const trimmed = text.trim();
  return /^https?:\/\/\S+$/i.test(trimmed) ? "link" : "text";
}

export function parseIncomingShare(payload: unknown): IncomingShare | null {
  const type = field(payload, "type");
  if (type === "file") {
    const fileId = field(payload, "fileId");
    const name = field(payload, "name");
    const mimeType = field(payload, "mimeType");
    const size = field(payload, "size");
    if (typeof fileId !== "string" || !fileId || typeof name !== "string" || !name) return null;
    if (!isSize(size) || size > MAX_SHARE_FILE_BYTES) return null;
    const groupId = optionalId(field(payload, "groupId"));
    return {
      type,
      fileId,
      name: safeFileName(name),
      mimeType: typeof mimeType === "string" && mimeType.includes("/") ? mimeType : "application/octet-stream",
      size,
      ...(groupId ? { groupId } : {}),
      ...(field(payload, "auto") === true ? { auto: true } : {}),
    };
  }
  if (type !== "text" && type !== "link" && type !== "clipboard") return null;
  const text = field(payload, "text");
  if (typeof text !== "string" || !text.trim() || text.length > MAX_SHARE_TEXT) return null;
  const entryId = optionalId(field(payload, "entryId"));
  const groupId = optionalId(field(payload, "groupId"));
  const ids = { ...(entryId ? { entryId } : {}), ...(groupId ? { groupId } : {}) };
  // Only a single web address opens; anything else arrives as usual.
  if (field(payload, "open") === true && type !== "clipboard" && kindForText(text) === "link")
    return { type, text: text.trim(), open: true, ...ids };
  return { type, text, ...ids };
}

/** Fork (L-290): a `meta` share item, or null for anything else. */
export function parseShareMeta(payload: unknown): ShareMeta | null {
  if (field(payload, "type") !== "meta") return null;
  const action = field(payload, "action");
  if (action === "clear") return { type: "meta", action };
  const ids = field(payload, "ids");
  if (action === "remove") return Array.isArray(ids) ? { type: "meta", action, ids: ids.filter(isId) } : null;
  const known = META_ACTIONS.find((candidate) => candidate === action);
  if (!known || !Array.isArray(ids)) return null;
  return { type: "meta", action: known, ids: ids.filter(isId) };
}

/** Fork (L-290): what a meta action changes on an entry. */
export function metaChange(action: "pin" | "unpin" | "save" | "unsave"): { pinned?: boolean; saved?: boolean } {
  if (action === "pin") return { pinned: true };
  if (action === "unpin") return { pinned: false };
  if (action === "save") return { saved: true };
  return { saved: false };
}

/** Fork (L-290): applies a pin or save to the history. */
export function markShareEntries(
  history: PhoneShareEntry[],
  ids: readonly string[],
  change: { pinned?: boolean; saved?: boolean },
): PhoneShareEntry[] {
  return trimShareHistory(
    history.map((entry) => {
      if (!ids.includes(entry.id)) return entry;
      const next: PhoneShareEntry = { ...entry, ...change };
      if (!next.pinned) delete next.pinned;
      if (!next.saved) delete next.saved;
      return next;
    }),
  );
}

/** Past the limit the oldest go first, but never a pinned or saved one. */
export function trimShareHistory(history: PhoneShareEntry[]): PhoneShareEntry[] {
  const next = [...history];
  while (next.length > historyLimit) {
    let index = -1;
    for (let at = next.length - 1; at >= 0; at -= 1) {
      const entry = next[at];
      if (entry && !entry.pinned && !entry.saved) {
        index = at;
        break;
      }
    }
    if (index < 0) break;
    next.splice(index, 1);
  }
  return next;
}

/** Fork (L-290): Delete all keeps pinned and saved; the rest goes (with their received files). */
export function splitForClear(history: PhoneShareEntry[]): { keep: PhoneShareEntry[]; gone: PhoneShareEntry[] } {
  const keep: PhoneShareEntry[] = [];
  const gone: PhoneShareEntry[] = [];
  for (const entry of history) (entry.pinned || entry.saved ? keep : gone).push(entry);
  return { keep, gone };
}

/** Fork (L-290): files this phone received into Downloads/Hari, counted for Storage. */
export function receivedFiles(history: PhoneShareEntry[]): PhoneShareEntry[] {
  return history.filter(
    (entry) => entry.direction === "in" && entry.kind === "file" && entry.status === "done" && !!entry.uri,
  );
}

/** Whether a file from the computer arrives by itself or waits for Download. */
export function autoDownloads(size: number): boolean {
  return size <= AUTO_DOWNLOAD_BYTES;
}

/**
 * Fork (L-290): the timeline as rows: a group (files sent together and their
 * caption) becomes one row at the place of its newest item. Newest first;
 * inside a row oldest first, so files keep their order and the caption sits last.
 */
export type ShareRow = { key: string; items: PhoneShareEntry[] };

export function shareRows(history: PhoneShareEntry[]): ShareRow[] {
  const rows: ShareRow[] = [];
  const groups = new Map<string, ShareRow>();
  for (const entry of history) {
    if (!entry.groupId) {
      rows.push({ key: entry.id, items: [entry] });
      continue;
    }
    const row = groups.get(entry.groupId);
    if (row) {
      row.items.push(entry);
      continue;
    }
    const next = { key: entry.groupId, items: [entry] };
    groups.set(entry.groupId, next);
    rows.push(next);
  }
  for (const row of rows) row.items.reverse();
  return rows;
}

function parseEntry(raw: unknown): PhoneShareEntry | null {
  const id = field(raw, "id");
  const direction = field(raw, "direction");
  const kind = field(raw, "kind");
  const at = field(raw, "at");
  const status = field(raw, "status");
  if (typeof id !== "string" || !id) return null;
  if (direction !== "in" && direction !== "out") return null;
  if (!KINDS.some((known) => known === kind)) return null;
  if (typeof at !== "number" || !Number.isFinite(at)) return null;
  const knownStatus = STATUSES.find((known) => known === status);
  if (!knownStatus) return null;
  const knownKind = KINDS.find((known) => known === kind);
  if (!knownKind) return null;
  const entry: PhoneShareEntry = { id, direction, kind: knownKind, at, status: knownStatus };
  const strings = ["text", "name", "mimeType", "uri", "fileId", "outboxId", "error"] as const;
  for (const name of strings) {
    const value = optionalString(field(raw, name));
    if (value !== undefined) entry[name] = value;
  }
  const size = field(raw, "size");
  if (isSize(size)) entry.size = size;
  const progress = field(raw, "progress");
  if (typeof progress === "number" && progress >= 0 && progress <= 1) entry.progress = progress;
  const groupId = optionalId(field(raw, "groupId"));
  if (groupId) entry.groupId = groupId;
  if (field(raw, "pinned") === true) entry.pinned = true;
  if (field(raw, "saved") === true) entry.saved = true;
  if (knownKind === "file" ? !entry.name : entry.text === undefined) return null;
  return entry;
}

/**
 * Fork (Hari, L-317): the computer's history (`share.history`, already in
 * this phone's directions) as entries here. A file the computer sent can be
 * fetched again while it still offers it; a file this phone sent is kept by
 * name (the phone's own copy isn't known any more).
 */
export function parseComputerHistory(raw: unknown): PhoneShareEntry[] {
  const entries = field(raw, "entries");
  if (!Array.isArray(entries)) return [];
  return entries.flatMap((item): PhoneShareEntry[] => {
    const file = field(item, "kind") === "file";
    const incoming = field(item, "direction") === "in";
    const status = file && incoming ? (field(item, "offered") === true ? "offered" : "failed") : "done";
    const entry = parseEntry({
      ...(typeof item === "object" && item !== null ? item : {}),
      status,
      ...(file && incoming ? { fileId: field(item, "id") } : {}),
      ...(status === "failed" ? { error: "No longer on the computer" } : {}),
    });
    return entry ? [entry] : [];
  });
}

/**
 * Fork (Hari, L-323): the history is filled in from the computer once per
 * pairing (and whenever this phone has none, as after a reinstall), not on
 * every reconnect: while paired, new messages arrive over the link itself.
 */
export function shouldFillShareHistory(historyEmpty: boolean, filledFor: string | null, pairingKey: string): boolean {
  return historyEmpty || filledFor !== pairingKey;
}

/**
 * Fork (Hari, L-317): adds what the computer has and this phone lacks,
 * except what was removed here; newest first, trimmed as usual. Unchanged
 * (the same array) when there is nothing to add.
 */
export function fillShareHistory(
  history: PhoneShareEntry[],
  computer: PhoneShareEntry[],
  removed: ReadonlySet<string>,
): PhoneShareEntry[] {
  const have = new Set(history.map((entry) => entry.id));
  const missing = computer.filter((entry) => !have.has(entry.id) && !removed.has(entry.id));
  if (!missing.length) return history;
  return trimShareHistory([...history, ...missing].sort((a, b) => b.at - a.at));
}

export function parseShareHistory(raw: unknown): PhoneShareEntry[] {
  return Array.isArray(raw)
    ? raw.map(parseEntry).filter((entry): entry is PhoneShareEntry => entry !== null)
    : [];
}

/** Newest first, the oldest dropped past the limit. */
export function addShareEntry(history: PhoneShareEntry[], entry: PhoneShareEntry): PhoneShareEntry[] {
  return trimShareHistory([entry, ...history.filter((old) => old.id !== entry.id)]);
}

export function updateShareEntry(
  history: PhoneShareEntry[],
  id: string,
  change: Partial<Omit<PhoneShareEntry, "id">>,
): PhoneShareEntry[] {
  return history.map((entry) => {
    if (entry.id !== id) return entry;
    const next: PhoneShareEntry = { ...entry, ...change };
    if (next.status !== "moving") delete next.progress;
    if (next.status !== "failed") delete next.error;
    return next;
  });
}

/**
 * After a restart nothing is moving any more: a file left half-way is
 * failed, so it can be tried again.
 */
export function settleInterrupted(history: PhoneShareEntry[]): PhoneShareEntry[] {
  return history.map((entry) =>
    entry.status === "moving"
      ? { ...entry, status: "failed", error: "Stopped when Hari closed" }
      : entry,
  );
}

/** Fork (Hari, L-366): a text long enough to fold behind Show more, by the computer's rule. */
export function isLongShareText(text: string): boolean {
  return text.length > 700 || text.split("\n").length > 12;
}

/** "Clipboard from your computer", "File to your computer · waiting". */
export function shareCaption(entry: PhoneShareEntry): string {
  const what =
    entry.kind === "clipboard"
      ? "Clipboard"
      : entry.kind === "link"
        ? "Link"
        : entry.kind === "file"
          ? "File"
          : "Text";
  const where = entry.direction === "in" ? "from your computer" : "to your computer";
  const state =
    entry.status === "offered"
      ? " · tap to download"
      : entry.status === "queued"
      ? " · waiting"
      : entry.status === "moving"
        ? ` · ${Math.round((entry.progress ?? 0) * 100)}%`
        : entry.status === "failed"
          ? " · failed"
          : "";
  return `${what} ${where}${state}`;
}

/** "820 B", "14 KB", "3.2 MB". */
export function formatShareSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

/** A name safe to save under: no folders, no characters Android or Windows refuse. */
const EXTENSION_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "image/webp": "webp", "image/heic": "heic",
  "image/heif": "heic", "video/mp4": "mp4", "video/quicktime": "mov", "video/x-matroska": "mkv",
  "video/webm": "webm", "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/wav": "wav", "audio/ogg": "ogg",
  "application/pdf": "pdf", "application/zip": "zip", "text/plain": "txt",
  "application/vnd.android.package-archive": "apk",
};

/**
 * Fork (Hari, L-317): a name with an ending. A gallery can share a picture as
 * "image_8623"; with its type known it goes as "image_8623.jpg", so the
 * computer knows what it is.
 */
export function withExtension(name: string, mimeType: string): string {
  if (/\.[A-Za-z0-9]{1,15}$/.test(name)) return name;
  const ext = EXTENSION_BY_MIME[mimeType.split(";")[0].trim().toLowerCase()];
  return ext ? `${name}.${ext}` : name;
}

export function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const cleaned = base
    .replace(/[<>:"|?*]/g, "_")
    .split("")
    .filter((character) => character.charCodeAt(0) >= 32)
    .join("")
    .trim()
    .replace(/^\.+/, "");
  return (cleaned || "file").slice(0, 150);
}

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const LOOKUP = new Map([...ALPHABET].map((character, index) => [character, index]));

export function bytesToBase64(bytes: Uint8Array): string {
  const parts: string[] = [];
  for (let start = 0; start < bytes.length; start += 3 * 4096) {
    let out = "";
    const end = Math.min(bytes.length, start + 3 * 4096);
    for (let index = start; index < end; index += 3) {
      const a = bytes[index] ?? 0;
      const b = bytes[index + 1];
      const c = bytes[index + 2];
      const triple = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
      out += ALPHABET[(triple >> 18) & 63];
      out += ALPHABET[(triple >> 12) & 63];
      out += b === undefined ? "=" : ALPHABET[(triple >> 6) & 63];
      out += c === undefined ? "=" : ALPHABET[triple & 63];
    }
    parts.push(out);
  }
  return parts.join("");
}

/** @throws when the text isn't base64. */
export function base64ToBytes(text: string): Uint8Array {
  const clean = text.replace(/\s/g, "");
  if (clean.length % 4 !== 0) throw new Error("Invalid data from the computer");
  const padding = clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0;
  const bytes = new Uint8Array((clean.length / 4) * 3 - padding);
  let at = 0;
  for (let index = 0; index < clean.length; index += 4) {
    let triple = 0;
    for (let offset = 0; offset < 4; offset += 1) {
      const character = clean[index + offset] ?? "=";
      const value = character === "=" ? 0 : LOOKUP.get(character);
      if (value === undefined) throw new Error("Invalid data from the computer");
      triple = (triple << 6) | value;
    }
    if (at < bytes.length) bytes[at++] = (triple >> 16) & 255;
    if (at < bytes.length) bytes[at++] = (triple >> 8) & 255;
    if (at < bytes.length) bytes[at++] = triple & 255;
  }
  return bytes;
}

/** The computer's answer to one `share.download`. */
export function parseDownloadPiece(raw: unknown): { data: Uint8Array; size: number } {
  const data = field(raw, "data");
  const size = field(raw, "size");
  if (typeof data !== "string" || !isSize(size)) throw new Error("The computer sent a file Hari can't read");
  return { data: base64ToBytes(data), size };
}

/** The computer's answer to one `share.upload`. */
export function parseUploadAnswer(raw: unknown): { received: number; done: boolean } {
  const received = field(raw, "received");
  const done = field(raw, "done");
  if (!isSize(received) || typeof done !== "boolean") throw new Error("Unexpected answer from the computer");
  return { received, done };
}

/**
 * What the share sheet, the Quick Settings tile or the Share bubble left for
 * Hari, from the native side. Fork (L-321): the bubble gives each its `id`
 * (so its Undo can find it), and leaves an `undo` for one already taken.
 */
export type PendingShare =
  | { type: "text"; text: string; id?: string }
  | { type: "clipboard"; text: string; id?: string }
  | { type: "file"; uri: string; name: string; mimeType: string; size: number; id?: string }
  | { type: "undo"; ids: string[] };

export function parsePendingShares(raw: unknown): PendingShare[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item: unknown): PendingShare[] => {
    const type = field(item, "type");
    const id = optionalId(field(item, "id"));
    const withId = id ? { id } : {};
    if (type === "undo") {
      const ids = field(item, "ids");
      const valid = Array.isArray(ids) ? ids.filter(isId) : [];
      return valid.length ? [{ type, ids: valid }] : [];
    }
    if (type === "text" || type === "clipboard") {
      const text = field(item, "text");
      return typeof text === "string" && text.trim() ? [{ type, text: text.slice(0, MAX_SHARE_TEXT), ...withId }] : [];
    }
    if (type === "file") {
      const uri = field(item, "uri");
      const name = field(item, "name");
      const mimeType = field(item, "mimeType");
      const size = field(item, "size");
      if (typeof uri !== "string" || !uri || !isSize(size)) return [];
      return [
        {
          type,
          uri,
          name: safeFileName(typeof name === "string" ? name : "file"),
          mimeType: typeof mimeType === "string" && mimeType.includes("/") ? mimeType : "application/octet-stream",
          size,
          ...withId,
        },
      ];
    }
    return [];
  });
}

/**
 * Fork (L-288): where to draw a picture's thumbnail from; null for anything
 * else, or a picture not on the phone (yet).
 */
export function shareThumbnail(entry: PhoneShareEntry): string | null {
  if (entry.kind !== "file" || !entry.uri || !entry.mimeType?.startsWith("image/")) return null;
  if (entry.direction === "in" && entry.status !== "done") return null;
  return entry.uri;
}

/** Fork (Hari, L-357): a message matches a search when its texts and file names hold every word, in any case. */
export function matchesShareSearch(items: readonly PhoneShareEntry[], query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const haystack = items
    .flatMap((item) => [item.text, item.name])
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return words.every((word) => haystack.includes(word));
}

/** Fork (Hari, L-356): the items the limit counts (pinned and saved never roll off). */
export function shareCounted(history: readonly PhoneShareEntry[]): number {
  return history.filter((entry) => !entry.pinned && !entry.saved).length;
}

/** Fork (L-288): the day a timeline entry falls on, for its separator: Today, Yesterday or the date. */
export function shareDay(at: number, now = Date.now()): string {
  const start = new Date(now).setHours(0, 0, 0, 0);
  if (at >= start) return "Today";
  if (at >= start - 86_400_000) return "Yesterday";
  return new Date(at).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

/**
 * Fork (Hari, L-326): a message's day and time, under it on its action row:
 * "Today · 6:37 pm", "Yesterday · …", then the date.
 */
export function shareStamp(at: number, now = Date.now()): string {
  const time = new Date(at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${shareDay(at, now)} · ${time}`;
}

/**
 * Fork (Hari, L-326): where a message is on its way, for inside its bubble;
 * empty once it has arrived. Which way it went is shown once at the top.
 */
export function shareState(entry: PhoneShareEntry): string {
  switch (entry.status) {
    case "offered":
      return "Tap to download";
    case "queued":
      return "Waiting";
    case "moving":
      return `${Math.round((entry.progress ?? 0) * 100)}%`;
    case "failed":
      return "Failed";
    default:
      return "";
  }
}

/** Within this many points of the end, the Share chat counts as at its end. */
export const SHARE_AT_END = 80;

/**
 * Fork (Hari, L-409): whether the Share chat follows its end as it grows (new
 * messages, link cards and pictures filling in). A finger on the list always
 * wins: from the moment a drag starts until the list comes to rest, nothing
 * pulls it back down. Before this, a card that loaded or vanished (say, the
 * computer was off) while the first few points of a drag were still inside
 * the end zone snapped the list back, so it seemed stuck on the latest.
 */
export type ShareFollow = { following: boolean; dragging: boolean };

export type ShareScrollEvent =
  /** A drag or a fling started. */
  | { type: "drag" }
  /** The list moved; `below` is how far its end is under the visible part. */
  | { type: "scroll"; below: number }
  /** A drag or a fling ended here. */
  | { type: "settle"; below: number }
  /** The user sent something: show it. */
  | { type: "sent" };

export function nextShareFollow(state: ShareFollow, event: ShareScrollEvent): ShareFollow {
  switch (event.type) {
    case "drag":
      return { following: false, dragging: true };
    case "scroll":
      return state.dragging ? state : { following: event.below < SHARE_AT_END, dragging: false };
    case "settle":
      return { following: event.below < SHARE_AT_END, dragging: false };
    case "sent":
      return { following: true, dragging: false };
  }
}

/** Whether a size change should keep the end in view. */
export function sharePinsToEnd(state: ShareFollow): boolean {
  return state.following && !state.dragging;
}

/**
 * Fork (Hari, L-411): a size change moves the chat to its end only in the
 * moment after it opens or a message arrives (`holdUntil`), while it follows.
 * At other times (a link card or picture loading, a long text opening) it
 * stays where it is. The drag events L-409 relied on don't reach the app on
 * Android (the keyboard library takes them), so following alone kept every
 * scroll pinned to the bottom.
 */
export function sharePinsOnResize(state: ShareFollow, now: number, holdUntil: number): boolean {
  return sharePinsToEnd(state) && now < holdUntil;
}

// Fork (Hari, L-414): Share draws only its newest messages, more as the
// reader scrolls back. Drawing the whole history (up to 1,000) on every
// visit and every change held the screen for hundreds of ms.
/** How many messages Share draws at first, and adds each time. */
export const SHARE_PAGE = 20;
/** How near the top (pt) scrolling back draws the next page. */
export const SHARE_MORE_AT = 800;

/** How many of the newest messages to draw, scrolled `fromTop` pt from the top. */
export function nextShareWindow(shown: number, total: number, fromTop: number): number {
  if (shown >= total || fromTop > SHARE_MORE_AT) return shown;
  return Math.min(total, shown + SHARE_PAGE);
}

/** Enough of the newest messages to include row `index` (oldest first), with a few above it. */
export function shareWindowFor(index: number, total: number, shown: number): number {
  return Math.min(total, Math.max(shown, total - index + 5));
}

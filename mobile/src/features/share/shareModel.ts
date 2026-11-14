// Fork (Hari, L-279): Share between the phone and the paired computer. The
// shapes on the wire (`share` link items, `share.upload`, `share.download`)
// and the phone's own history, read defensively: anything of the wrong shape
// is dropped rather than shown half-broken.

export const MAX_SHARE_HISTORY = 100;
export const MAX_SHARE_TEXT = 30_000;
export const MAX_SHARE_FILE_BYTES = 100 * 1024 * 1024;
/** One `share.upload` / `share.download` piece, before base64. */
export const SHARE_CHUNK_BYTES = 1024 * 1024;
export const MAX_SHARE_FILES = 20;

export type ShareKind = "text" | "link" | "clipboard" | "file";

export type ShareStatus =
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
};

/** A `share` item from the computer. */
export type IncomingShare =
  | { type: "text" | "link" | "clipboard"; text: string }
  | { type: "file"; fileId: string; name: string; mimeType: string; size: number };

const KINDS: readonly ShareKind[] = ["text", "link", "clipboard", "file"];
const STATUSES: readonly ShareStatus[] = ["queued", "moving", "done", "failed"];

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
    return {
      type,
      fileId,
      name: safeFileName(name),
      mimeType: typeof mimeType === "string" && mimeType.includes("/") ? mimeType : "application/octet-stream",
      size,
    };
  }
  if (type !== "text" && type !== "link" && type !== "clipboard") return null;
  const text = field(payload, "text");
  if (typeof text !== "string" || !text.trim() || text.length > MAX_SHARE_TEXT) return null;
  return { type, text };
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
  if (knownKind === "file" ? !entry.name : entry.text === undefined) return null;
  return entry;
}

export function parseShareHistory(raw: unknown): PhoneShareEntry[] {
  return Array.isArray(raw)
    ? raw.map(parseEntry).filter((entry): entry is PhoneShareEntry => entry !== null)
    : [];
}

/** Newest first, the oldest dropped past the limit. */
export function addShareEntry(history: PhoneShareEntry[], entry: PhoneShareEntry): PhoneShareEntry[] {
  return [entry, ...history.filter((old) => old.id !== entry.id)].slice(0, MAX_SHARE_HISTORY);
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
    entry.status === "queued"
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
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

/** A name safe to save under: no folders, no characters Android or Windows refuse. */
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

/** A file shared to Hari (share sheet or the Quick Settings tile), from the native side. */
export type PendingShare =
  | { type: "text"; text: string }
  | { type: "clipboard"; text: string }
  | { type: "file"; uri: string; name: string; mimeType: string; size: number };

export function parsePendingShares(raw: unknown): PendingShare[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item: unknown): PendingShare[] => {
    const type = field(item, "type");
    if (type === "text" || type === "clipboard") {
      const text = field(item, "text");
      return typeof text === "string" && text.trim() ? [{ type, text: text.slice(0, MAX_SHARE_TEXT) }] : [];
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
        },
      ];
    }
    return [];
  });
}

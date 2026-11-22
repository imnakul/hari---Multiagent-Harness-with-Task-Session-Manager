/**
 * Fork (Hari, L-279): the computer's Share history as the Rust side keeps it
 * (`mobile_share_list`), read defensively: an entry with a field of the wrong
 * shape is dropped rather than shown half-broken.
 */

export type ShareKind = "text" | "link" | "clipboard" | "file";

export type ShareEntry = {
  id: string;
  direction: "in" | "out";
  kind: ShareKind;
  text?: string;
  name?: string;
  size?: number;
  mimeType?: string;
  /** Where the file is on this computer (saved copy, or the original sent). */
  path?: string;
  device?: string;
  at: number;
  /** Queued: the phone hasn't taken it yet (a file: hasn't fetched it). */
  status: "queued" | "done";
  /** Fork (L-290): items sent together (files + caption). */
  groupId?: string;
  /** Pinned and saved never roll off; both sync with the phone. */
  pinned?: boolean;
  saved?: boolean;
};

/** Fork (L-356): `limit` is how many items the history keeps (pinned and saved aside). */
export type ShareList = { items: ShareEntry[]; phones: number; limit: number };

/** Fork (L-356): the history limits Settings offers. */
export const SHARE_LIMITS = [100, 250, 500, 1000] as const;

export const SHARE_CHANGE_EVENT = "monocode-share-changed";
/** Sent when an arrival toast is clicked: Share opens. */
export const SHARE_OPEN_EVENT = "monocode-share-open";

/**
 * Fork (L-384): the payload of a clicked phone-notification banner,
 * `{ view: "notifications", key }`. Anything else (the plain Share toast sends
 * no payload) yields null.
 */
export function parseShareOpenTarget(raw: unknown): { key: string } | null {
  if (typeof raw !== "object" || raw === null) return null;
  const view: unknown = Reflect.get(raw, "view");
  const key: unknown = Reflect.get(raw, "key");
  return view === "notifications" && typeof key === "string" && key ? { key } : null;
}

const KINDS: readonly ShareKind[] = ["text", "link", "clipboard", "file"];
const isKind = (value: unknown): value is ShareKind =>
  typeof value === "string" && KINDS.some((kind) => kind === value);
const field = (value: unknown, name: string): unknown =>
  typeof value === "object" && value !== null ? Reflect.get(value, name) : undefined;
const optionalString = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

function parseEntry(raw: unknown): ShareEntry | null {
  const id = field(raw, "id");
  const direction = field(raw, "direction");
  const kind = field(raw, "kind");
  const at = field(raw, "at");
  const status = field(raw, "status");
  const size = field(raw, "size");
  if (typeof id !== "string" || !id) return null;
  if (direction !== "in" && direction !== "out") return null;
  if (!isKind(kind)) return null;
  if (typeof at !== "number" || !Number.isFinite(at)) return null;
  if (status !== "queued" && status !== "done") return null;
  const entry: ShareEntry = { id, direction, kind, at, status };
  const text = optionalString(field(raw, "text"));
  const name = optionalString(field(raw, "name"));
  const mimeType = optionalString(field(raw, "mimeType"));
  const path = optionalString(field(raw, "path"));
  const device = optionalString(field(raw, "device"));
  if (text !== undefined) entry.text = text;
  if (name !== undefined) entry.name = name;
  if (typeof size === "number" && Number.isFinite(size) && size >= 0) entry.size = size;
  if (mimeType !== undefined) entry.mimeType = mimeType;
  if (path !== undefined) entry.path = path;
  if (device !== undefined) entry.device = device;
  const groupId = optionalString(field(raw, "groupId"));
  if (groupId) entry.groupId = groupId;
  if (field(raw, "pinned") === true) entry.pinned = true;
  if (field(raw, "saved") === true) entry.saved = true;
  if (kind === "file" ? !entry.name : entry.text === undefined) return null;
  return entry;
}

export function parseShareList(raw: unknown): ShareList {
  const items = field(raw, "items");
  const phones = field(raw, "phones");
  const limit = field(raw, "limit");
  return {
    items: Array.isArray(items)
      ? items.map(parseEntry).filter((entry): entry is ShareEntry => entry !== null)
      : [],
    phones: typeof phones === "number" && phones > 0 ? Math.floor(phones) : 0,
    limit: typeof limit === "number" && limit > 0 ? Math.floor(limit) : 100,
  };
}

/** "Clipboard to Pixel 9 · waiting", "Link from phone" — the entry's caption. */
export function shareCaption(entry: ShareEntry): string {
  const what =
    entry.kind === "clipboard"
      ? "Clipboard"
      : entry.kind === "link"
        ? "Link"
        : entry.kind === "file"
          ? "File"
          : "Text";
  const device = entry.device ?? "phone";
  const where = entry.direction === "in" ? `from ${device}` : `to ${device}`;
  const waiting =
    entry.direction === "out" && entry.status === "queued"
      ? entry.kind === "file"
        ? " · not fetched yet"
        : " · waiting for the phone"
      : "";
  return `${what} ${where}${waiting}`;
}

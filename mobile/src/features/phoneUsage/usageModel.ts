/**
 * Fork (Hari, L-398): the pure parts of sending screen time to the computer.
 * The computer validates again; this keeps a bad native row from failing a chunk.
 */
export type UsageInterval = { package: string; label: string; start: number; end: number };

/** The computer takes this many intervals per call. */
export const CHUNK_SIZE = 500;
/** First sync, or a long gap: never read further back than this. */
export const MAX_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** Narrows the native module's JSON; anything malformed is dropped, never thrown. */
export function parseIntervals(json: string): UsageInterval[] {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const out: UsageInterval[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const pkg: unknown = Reflect.get(item, "package");
    const label: unknown = Reflect.get(item, "label");
    const start: unknown = Reflect.get(item, "start");
    const end: unknown = Reflect.get(item, "end");
    if (typeof pkg !== "string" || !/^[A-Za-z0-9._]{1,200}$/.test(pkg)) continue;
    if (typeof start !== "number" || typeof end !== "number") continue;
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    if (start <= 0 || end <= start || end - start > MAX_INTERVAL_MS) continue;
    out.push({
      package: pkg,
      label: typeof label === "string" && label.trim() ? label.trim().slice(0, 120) : pkg,
      start: Math.round(start),
      end: Math.round(end),
    });
  }
  return out;
}

export function chunk<T>(items: readonly T[], size: number = CHUNK_SIZE): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size) out.push(items.slice(index, index + size));
  return out;
}

/** Where to start reading: the computer's cursor, but never before the lookback. */
export function readSince(cursor: number | null, now: number): number {
  return Math.max(cursor ?? now - MAX_LOOKBACK_MS, now - MAX_LOOKBACK_MS);
}

/** Reads the computer's `{ since }` reply; anything else means "no cursor". */
export function parseCursor(reply: unknown): number | null {
  if (typeof reply !== "object" || reply === null) return null;
  const since: unknown = Reflect.get(reply, "since");
  return typeof since === "number" && Number.isFinite(since) ? since : null;
}

/** A random id for this phone, made once. Not a secret: it only names the phone's rows. */
export function newDeviceId(random: () => number = Math.random): string {
  const hex = () => Math.floor(random() * 0x10000).toString(16).padStart(4, "0");
  return `${hex()}${hex()}-${hex()}-${hex()}-${hex()}-${hex()}${hex()}${hex()}`;
}

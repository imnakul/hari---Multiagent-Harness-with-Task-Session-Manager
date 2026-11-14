// Fork (Hari, L-277): the always-open event stream's frames, the phone's
// cursor into the computer's outbox, and the phone's own outbox. Pure, so the
// rules are tested without a link.

/** An item the computer kept in its outbox until the phone acks it. */
export type LinkItem = {
  seq: number;
  id: string;
  kind: string;
  at: number;
  payload: unknown;
};

export type LinkFrame =
  /** First on every stream. `resume`: the phone's cursor still applies. */
  | { type: "hello"; epoch: string; last: number; resume: boolean }
  | { type: "item"; item: LinkItem }
  /** The latest value of something (for example the bell's list); not kept. */
  | { type: "signal"; kind: string; payload: unknown };

/** Where the phone is in one computer's outbox. */
export type LinkCursor = { epoch: string; after: number };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const isName = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= max;

/** A frame from the computer, or null when Hari can't read it. */
export function parseLinkFrame(value: unknown): LinkFrame | null {
  if (!isRecord(value)) return null;
  if (value.type === "hello") {
    if (!isName(value.epoch, 64) || !isCount(value.last)) return null;
    return { type: "hello", epoch: value.epoch, last: value.last, resume: value.resume === true };
  }
  if (value.type === "item") {
    const item = value.item;
    if (!isRecord(item)) return null;
    if (!isCount(item.seq) || !isName(item.id, 128) || !isName(item.kind, 64) || !isCount(item.at))
      return null;
    return {
      type: "item",
      item: { seq: item.seq, id: item.id, kind: item.kind, at: item.at, payload: item.payload },
    };
  }
  if (value.type === "signal") {
    if (!isName(value.kind, 64)) return null;
    return { type: "signal", kind: value.kind, payload: value.payload };
  }
  return null;
}

/** Reads a stored cursor; anything else is no cursor. */
export function parseCursor(value: unknown): LinkCursor | null {
  if (!isRecord(value) || !isName(value.epoch, 64) || !isCount(value.after)) return null;
  return { epoch: value.epoch, after: value.after };
}

/**
 * What a batch of frames means for the cursor: the items to run (new ones,
 * in order), the signals (latest per kind), and whether to ack.
 */
export function readFrames(
  cursor: LinkCursor | null,
  frames: LinkFrame[],
): {
  cursor: LinkCursor | null;
  items: LinkItem[];
  signals: Map<string, unknown>;
  ack: boolean;
} {
  let next = cursor;
  const items: LinkItem[] = [];
  const signals = new Map<string, unknown>();
  let ack = false;
  for (const frame of frames) {
    if (frame.type === "hello") {
      // A new outbox on the computer: its numbering starts again.
      if (!frame.resume || next?.epoch !== frame.epoch) next = { epoch: frame.epoch, after: 0 };
      continue;
    }
    if (frame.type === "signal") {
      signals.set(frame.kind, frame.payload);
      continue;
    }
    // Items before a hello can't be placed; resent ones are skipped.
    if (!next || frame.item.seq <= next.after) continue;
    items.push(frame.item);
    next = { ...next, after: frame.item.seq };
    ack = true;
  }
  return { cursor: next, items, signals, ack };
}

/** An item the phone sends; kept until the computer takes or refuses it. */
export type OutboxItem = {
  id: string;
  kind: string;
  at: number;
  payload: unknown;
  /** Send attempts that failed for the link (not refusals). */
  tries: number;
};

/** The phone keeps at most this many unsent items, and for this long. */
export const OUTBOX_LIMIT = 200;
export const OUTBOX_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** Items sent to the computer in one request. */
export const OUTBOX_BATCH = 20;

export function parseOutbox(value: unknown): OutboxItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry: unknown): OutboxItem[] => {
    if (!isRecord(entry) || !isName(entry.id, 128) || !isName(entry.kind, 64) || !isCount(entry.at))
      return [];
    return [
      {
        id: entry.id,
        kind: entry.kind,
        at: entry.at,
        payload: entry.payload,
        tries: isCount(entry.tries) ? entry.tries : 0,
      },
    ];
  });
}

/** Adds an item, dropping the oldest and expired ones past the limits. */
export function addToOutbox(outbox: OutboxItem[], item: OutboxItem, now: number): OutboxItem[] {
  return [...outbox, item]
    .filter((entry) => now - entry.at <= OUTBOX_MAX_AGE_MS)
    .slice(-OUTBOX_LIMIT);
}

/** The computer's answer to `events.send`. */
export type SendAnswer = { accepted: string[]; rejected: { id: string; error: string }[] };

export function parseSendAnswer(value: unknown): SendAnswer | null {
  if (!isRecord(value) || !Array.isArray(value.accepted) || !Array.isArray(value.rejected))
    return null;
  return {
    accepted: value.accepted.filter((id): id is string => typeof id === "string"),
    rejected: value.rejected.flatMap((entry: unknown) =>
      isRecord(entry) && typeof entry.id === "string"
        ? [{ id: entry.id, error: typeof entry.error === "string" ? entry.error : "Refused" }]
        : [],
    ),
  };
}

/**
 * The outbox after an answer: taken and refused items leave it (a refusal
 * won't change on a resend); anything the answer didn't name stays.
 */
export function settleOutbox(outbox: OutboxItem[], answer: SendAnswer): OutboxItem[] {
  const done = new Set([...answer.accepted, ...answer.rejected.map((entry) => entry.id)]);
  return outbox.filter((item) => !done.has(item.id));
}

/** Waits between reconnects: quick at first, then every 30 s. */
export function retryDelay(failures: number): number {
  const steps = [1_000, 2_000, 5_000, 15_000];
  return steps[Math.min(failures, steps.length)] ?? 30_000;
}

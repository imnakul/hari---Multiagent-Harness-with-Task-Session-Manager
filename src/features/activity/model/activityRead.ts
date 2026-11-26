/**
 * Fork (L-396): the `activity.read` app action. It reads the Activity data
 * (prompt log, hourly notes, ActivityWatch apps and sites, phone screen time)
 * for a range and returns a capped, privacy-trimmed summary for an Ask chat:
 * websites as domains only, never tab titles.
 */
import type { ActivityLog, AwSummary, Span } from "./activity";

export const READ_RANGE_MAX_MS = 32 * 24 * 60 * 60_000;
export const READ_EVENTS_DETAIL_MAX_MS = 3 * 24 * 60 * 60_000;
export const READ_NOTES_MAX = 200;
export const READ_EVENTS_MAX = 300;
export const READ_TOP_MAX = 30;
const EVENT_TEXT_MAX = 300;
export const RANGE_ERROR = "Use a start before end, at most 32 days apart.";

export const READ_SECTIONS = ["notes", "events", "apps", "sites", "meetings", "phone"] as const;
export type ReadSection = (typeof READ_SECTIONS)[number];

export type ActivityReadRequest = {
  range: Span;
  include: ReadonlySet<ReadSection>;
  /** True when the caller named `events` itself, so a long range still returns them. */
  eventsAsked: boolean;
  tzOffsetMin: number;
};

export type PhoneSummary = {
  available: boolean;
  apps: { app: string; ms: number }[];
};

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const LOCAL_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

function localMs(y: number, mo: number, d: number, h: number, mi: number): number | null {
  const date = new Date(y, mo - 1, d, h, mi, 0, 0);
  const ok = date.getFullYear() === y && date.getMonth() === mo - 1 && date.getDate() === d && date.getHours() === h;
  return ok ? date.getTime() : null;
}

/** One bound as epoch ms, or null if it is not a date this action accepts. */
function parseBound(value: unknown, isEnd: boolean): number | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  const dateOnly = DATE_ONLY.exec(text);
  if (dateOnly) {
    const start = localMs(Number(dateOnly[1]), Number(dateOnly[2]), Number(dateOnly[3]), 0, 0);
    if (start === null) return null;
    if (!isEnd) return start;
    const next = new Date(start);
    next.setDate(next.getDate() + 1);
    return next.getTime();
  }
  const local = LOCAL_DATE_TIME.exec(text);
  if (local) {
    return localMs(Number(local[1]), Number(local[2]), Number(local[3]), Number(local[4]), Number(local[5]));
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(text)) return null;
  const ms = Date.parse(text);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Validates the action input. Throws the user-facing message for anything the
 * agent should correct: a missing or unreadable date, or a range that is not
 * start-before-end within 32 days.
 */
export function parseActivityReadInput(input: unknown, tzOffsetMin: number): ActivityReadRequest {
  const raw = typeof input === "object" && input !== null ? input : {};
  const start = parseBound(Reflect.get(raw, "start"), false);
  const end = parseBound(Reflect.get(raw, "end"), true);
  if (start === null || end === null) {
    throw new Error("start and end are required: ISO 8601 with offset, or a local YYYY-MM-DD or YYYY-MM-DDTHH:mm.");
  }
  if (!(start < end) || end - start > READ_RANGE_MAX_MS) throw new Error(RANGE_ERROR);
  const includeRaw: unknown = Reflect.get(raw, "include");
  let include = new Set<ReadSection>(READ_SECTIONS);
  let eventsAsked = false;
  if (Array.isArray(includeRaw) && includeRaw.length > 0) {
    const named = includeRaw.filter((item): item is ReadSection => READ_SECTIONS.some((section) => section === item));
    if (named.length === 0) throw new Error(`include may list: ${READ_SECTIONS.join(", ")}.`);
    include = new Set(named);
    eventsAsked = include.has("events");
  }
  return { range: { start, end }, include, eventsAsked, tzOffsetMin };
}

function pad(value: number): string {
  return String(Math.abs(value)).padStart(2, "0");
}

/** `2026-11-26T14:05:00+05:30`: local wall time with the offset the user lives in. */
export function localIso(ms: number, tzOffsetMin: number): string {
  const shifted = new Date(ms + tzOffsetMin * 60_000);
  const sign = tzOffsetMin < 0 ? "-" : "+";
  const offset = `${sign}${pad(Math.trunc(Math.abs(tzOffsetMin) / 60))}:${pad(Math.abs(tzOffsetMin) % 60)}`;
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}T${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}:${pad(shifted.getUTCSeconds())}${offset}`;
}

function minutes(ms: number): number {
  return Math.round(ms / 60_000);
}

function top<T extends { ms: number }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => b.ms - a.ms).slice(0, READ_TOP_MAX);
}

export type ActivityReadResult = {
  range: { start: string; end: string; timezone: string };
  notes?: { time: string; kind: "prompts" | "hourly"; text: string }[];
  events?: { time: string; kind: string; project: string; branch: string; harness: string; text: string }[];
  apps?: { app: string; minutes: number }[];
  sites?: { domain: string; minutes: number }[];
  meetings?: { count: number; totalMinutes: number; list: { start: string; end: string; label: string }[] };
  phone?: { available: boolean; apps: { app: string; minutes: number }[] };
  truncated: boolean;
  note?: string;
};

function projectOf(cwd: string): string {
  const parts = cwd.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

/** Pure: shapes the loaded data into the capped result. Domains only; no tab titles. */
export function buildActivityReadResult(
  log: ActivityLog,
  aw: AwSummary | null,
  phone: PhoneSummary | null,
  request: ActivityReadRequest,
): ActivityReadResult {
  const { range, include, tzOffsetMin } = request;
  const iso = (ms: number): string => localIso(ms, tzOffsetMin);
  const sign = tzOffsetMin < 0 ? "-" : "+";
  const result: ActivityReadResult = {
    range: {
      start: iso(range.start),
      end: iso(range.end),
      timezone: `${sign}${pad(Math.trunc(Math.abs(tzOffsetMin) / 60))}:${pad(Math.abs(tzOffsetMin) % 60)}`,
    },
    truncated: false,
  };
  if (include.has("notes")) {
    const notes = [...log.notes].sort((a, b) => a.ts - b.ts);
    if (notes.length > READ_NOTES_MAX) result.truncated = true;
    result.notes = notes.slice(0, READ_NOTES_MAX).map((note) => ({ time: iso(note.ts), kind: note.kind ?? "prompts", text: note.body }));
  }
  const wantEvents = include.has("events") && (request.eventsAsked || range.end - range.start <= READ_EVENTS_DETAIL_MAX_MS);
  if (wantEvents) {
    const events = [...log.events].sort((a, b) => a.ts - b.ts);
    if (events.length > READ_EVENTS_MAX) result.truncated = true;
    result.events = events.slice(0, READ_EVENTS_MAX).map((event) => ({
      time: iso(event.ts),
      kind: event.kind,
      project: projectOf(event.cwd),
      branch: event.branch ?? "",
      harness: event.harness,
      text: event.text.slice(0, EVENT_TEXT_MAX),
    }));
  }
  const awWanted = include.has("apps") || include.has("sites") || include.has("meetings");
  if (awWanted && (!aw || !aw.available)) {
    result.note = "ActivityWatch is not available, so apps, sites and meetings are missing.";
  }
  if (aw?.available) {
    if (include.has("apps")) {
      if (aw.apps.length > READ_TOP_MAX) result.truncated = true;
      result.apps = top(aw.apps).map((row) => ({ app: row.app, minutes: minutes(row.ms) }));
    }
    if (include.has("sites")) {
      if (aw.sites.length > READ_TOP_MAX) result.truncated = true;
      result.sites = top(aw.sites).map((row) => ({ domain: row.domain, minutes: minutes(row.ms) }));
    }
    if (include.has("meetings")) {
      result.meetings = {
        count: aw.meetings.length,
        totalMinutes: minutes(aw.meetingMs),
        list: aw.meetings.slice(0, READ_TOP_MAX).map((meeting) => ({ start: iso(meeting.start), end: iso(meeting.end), label: meeting.label })),
      };
    }
  }
  if (include.has("phone")) {
    const apps = phone?.available ? top(phone.apps) : [];
    if (phone?.available && phone.apps.length > READ_TOP_MAX) result.truncated = true;
    result.phone = { available: phone?.available ?? false, apps: apps.map((row) => ({ app: row.app, minutes: minutes(row.ms) })) };
  }
  return result;
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

/** The instructions an Ask turn carries: today's date, how to resolve relative dates, and how to read activity. */
/** `cli` is the app CLI prefix, already ending in `app`. */
export function activityAskContext(cli: string, now: Date, tzOffsetMin: number): string {
  const sign = tzOffsetMin < 0 ? "-" : "+";
  const offset = `UTC${sign}${pad(Math.trunc(Math.abs(tzOffsetMin) / 60))}:${pad(Math.abs(tzOffsetMin) % 60)}`;
  const local = localIso(now.getTime(), tzOffsetMin).slice(0, 16).replace("T", " ");
  return [
    "<monocode_activity>",
    "You answer questions about the user's own activity (their coding prompts, apps, websites, meetings and phone screen time).",
    `Now: ${WEEKDAYS[new Date(now.getTime() + tzOffsetMin * 60_000).getUTCDay()]} ${local} (${offset}). All times are local to the user.`,
    'Resolve relative dates yourself: "7 October" means the most recent 7 October that is not after today; "last week" means the previous Monday to Sunday; "yesterday" is the day before today.',
    `Read data with: ${cli} activity.read '{"start":"YYYY-MM-DD","end":"YYYY-MM-DD","include":["notes","apps"]}'`,
    "start and end are local dates (YYYY-MM-DD or YYYY-MM-DDTHH:mm) or ISO 8601 with offset; a date-only end covers that whole day; at most 32 days per call, so split longer questions.",
    "include is optional and may list: notes, events, apps, sites, meetings, phone. Ranges over 3 days omit events unless you list them.",
    "Answer from the returned data only. If data is missing (no notes, ActivityWatch off, phone unavailable), say so plainly instead of guessing.",
    "Websites are domains only. This chat can only read activity; it cannot change anything.",
    "</monocode_activity>",
  ].join("\n");
}

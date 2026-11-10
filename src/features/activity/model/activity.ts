/**
 * Activity: a local log of prompts and agent turns, desktop context from
 * ActivityWatch, and short notes written by the Antigravity CLI (`agy`).
 *
 * The Rust side (`src-tauri/src/activity`) owns storage and the notes worker;
 * this module holds the typed IPC calls plus the pure logic the recorder hook
 * and the Activity view share, so both stay unit-testable.
 */
import { invoke } from "@tauri-apps/api/core";
import { projectName } from "../../../shared/lib/paths";
import { readFlag, writeFlag } from "../../settings/model/storageFlags";
import type { Block, Session } from "../../sessions/model/session";

/** Emitted by Rust (no payload) whenever events or notes change. */
export const ACTIVITY_CHANGED_EVENT = "activity-changed";
/** Emitted by Rust with an {@link AgentStatus} payload. */
export const ACTIVITY_AGENT_STATUS_EVENT = "activity-agent-status";

export type ActivityKind = "prompt" | "turn";

/** What the recorder sends for one prompt or finished turn. */
export type ActivityEventInput = {
  kind: ActivityKind;
  blockId: string;
  sessionId: string;
  harness: string;
  model: string;
  cwd: string;
  title: string;
  text: string;
  /** Epoch ms the event happened. */
  at: number;
  durationMs?: number;
  tzOffsetMin: number;
};

export type ActivityEvent = {
  id: number;
  ts: number;
  kind: ActivityKind;
  sessionId: string;
  harness: string;
  model: string;
  cwd: string;
  branch?: string;
  title: string;
  text: string;
  durationMs?: number;
};

export type ActivityNote = {
  id: number;
  ts: number;
  firstEventId: number;
  lastEventId: number;
  body: string;
};

export type ActivityLog = {
  events: ActivityEvent[];
  notes: ActivityNote[];
};

export type Span = { start: number; end: number };

export type AwSummary = {
  available: boolean;
  error?: string;
  hasAfk: boolean;
  activeMs: number;
  activeSpans: Span[];
  apps: { app: string; ms: number }[];
  /** Whether the ActivityWatch browser extension reported any tabs. */
  hasWeb: boolean;
  /** Time per website domain; `titles` are local-only tab titles. */
  sites: { domain: string; ms: number; titles: string[] }[];
  meetings: (Span & { label: string })[];
  meetingMs: number;
};

export type AgentPhase =
  "off" | "idle" | "queued" | "writing" | "backoff" | "paused";

export type AgentStatus = {
  phase: AgentPhase;
  enabled: boolean;
  engine: "agy";
  binary?: string;
  lastError?: string;
  lastNoteAt?: number;
  retryAt?: number;
};

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------

export function recordActivity(event: ActivityEventInput): Promise<ActivityEvent> {
  return invoke<ActivityEvent>("activity_record", { event });
}

export function loadActivityLog(range: Span): Promise<ActivityLog> {
  return invoke<ActivityLog>("activity_list", range);
}

export function loadActivityWatch(range: Span): Promise<AwSummary> {
  return invoke<AwSummary>("activity_watch_summary", range);
}

export function loadAgentStatus(): Promise<AgentStatus> {
  return invoke<AgentStatus>("activity_agent_status");
}

export function configureAgent(enabled: boolean): Promise<AgentStatus> {
  return invoke<AgentStatus>("activity_agent_configure", {
    enabled,
    tzOffsetMin: tzOffsetMinutes(),
  });
}

export function retryAgent(): Promise<AgentStatus> {
  return invoke<AgentStatus>("activity_agent_retry");
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/** A boolean setting persisted in localStorage and broadcast on `window`. */
function flagSetting(key: string, fallback: boolean, event: string) {
  return {
    load: (): boolean => readFlag(key) ?? fallback,
    save: (value: boolean): void => {
      writeFlag(key, value);
      if (typeof window === "undefined") return;
      window.dispatchEvent(new CustomEvent<boolean>(event, { detail: value }));
    },
    subscribe: (onChange: () => void): (() => void) => {
      if (typeof window === "undefined") return () => {};
      window.addEventListener(event, onChange);
      return () => window.removeEventListener(event, onChange);
    },
  };
}

/**
 * Master switch. Off means nothing runs: no prompts are logged, the notes
 * worker is stopped, ActivityWatch is never polled, and Activity leaves the rail.
 */
const tracker = flagSetting(
  "monocode.activityTrackerEnabled",
  true,
  "monocode:activity-tracker-change",
);
export const loadTrackerEnabled = tracker.load;
export const saveTrackerEnabled = tracker.save;
export const subscribeTrackerEnabled = tracker.subscribe;

/** Antigravity notes. On by default: the always-on scribe was the product choice. */
const aiNotes = flagSetting(
  "monocode.activityNotesEnabled",
  true,
  "monocode:activity-notes-change",
);
export const loadAiNotesEnabled = aiNotes.load;
export const saveAiNotesEnabled = aiNotes.save;
export const subscribeAiNotesEnabled = aiNotes.subscribe;

// ---------------------------------------------------------------------------
// Time helpers
// ---------------------------------------------------------------------------

/** UTC offset in minutes with the ISO sign (IST is +330). */
export function tzOffsetMinutes(
  date: Pick<Date, "getTimezoneOffset"> = new Date(),
): number {
  // getTimezoneOffset is inverted (IST is -330); `|| 0` avoids `-0`.
  return -date.getTimezoneOffset() || 0;
}

/** Local midnight-to-midnight range for the day containing `date`. */
export function dayRange(date: Date): Span {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start: start.getTime(), end: end.getTime() };
}

/** Shift a local day by `days`, keeping it at midnight across DST changes. */
export function shiftDay(date: Date, days: number): Date {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  next.setDate(next.getDate() + days);
  return next;
}

export function isSameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** Compact duration such as `45s`, `12m`, or `1h 05m`. */
export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

/** Local `HH:MM`. */
export function formatClock(ms: number): string {
  const date = new Date(ms);
  return `${String(date.getHours()).padStart(2, "0")}:${String(
    date.getMinutes(),
  ).padStart(2, "0")}`;
}

/** "Today", "Yesterday", or e.g. "Mon, 9 Nov". */
export function formatDayLabel(date: Date, now: Date = new Date()): string {
  if (isSameLocalDay(date, now)) return "Today";
  if (isSameLocalDay(date, shiftDay(now, -1))) return "Yesterday";
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

// ---------------------------------------------------------------------------
// Recorder
// ---------------------------------------------------------------------------

/** Events older than this when first seen are history being loaded, not new work. */
export const FRESH_MS = 2 * 60_000;
const PROMPT_TEXT_MAX = 1_200;
const REPLY_TEXT_MAX = 600;

/** Mutable bookkeeping kept by the recorder hook between renders. */
export type RecorderState = {
  /** Sessions observed at least once (steers only count after that). */
  seeded: Set<string>;
  /** `${kind}:${blockId}` keys already sent (or deliberately skipped). */
  recorded: Set<string>;
  /** Last observed `busy` per session, to catch turn ends. */
  busy: Map<string, boolean>;
  /** Last session object diffed; an identical reference has nothing new. */
  last: Map<string, Session>;
};

export function createRecorderState(): RecorderState {
  return {
    seeded: new Set(),
    recorded: new Set(),
    busy: new Map(),
    last: new Map(),
  };
}

function clipText(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max)}…`;
}

/**
 * Short, code-free excerpt of the agent's final answer for the user turn at
 * `userIndex`. Fenced code is dropped so source never reaches the notes AI.
 */
export function replyExcerpt(blocks: Block[], userIndex: number): string {
  let reply = "";
  for (let i = userIndex + 1; i < blocks.length; i++) {
    const block = blocks[i];
    if (block.role === "user") break;
    if (block.role === "assistant" && block.text.trim()) reply = block.text;
  }
  const withoutCode = reply.replace(/```[\s\S]*?(```|$)/g, " [code] ");
  return clipText(withoutCode, REPLY_TEXT_MAX);
}

function lastStartedUserIndex(blocks: Block[]): number {
  for (let i = blocks.length - 1; i >= 0; i--) {
    if (blocks[i].role === "user" && blocks[i].startedAt != null) return i;
  }
  return -1;
}

function baseInput(session: Session, tzOffsetMin: number) {
  return {
    sessionId: session.id,
    harness: session.harness,
    model: session.model,
    cwd: session.cwd,
    title: session.title,
    tzOffsetMin,
  };
}

/**
 * Diff the live sessions against what was already recorded and return the
 * new events. Mutates `state`.
 *
 * - Each user block is judged once. Opening an old chat never replays
 *   history because its prompts are older than {@link FRESH_MS}.
 * - A prompt is new when it started within {@link FRESH_MS}, or (a steer,
 *   which has no start time) arrived while an already-watched session was busy.
 * - Rust dedupes by block id, so an app restart that re-sees a fresh prompt
 *   cannot double-count it.
 * - A turn ends when `busy` goes from true to false.
 */
export function collectActivityEvents(
  state: RecorderState,
  sessions: readonly Session[],
  now: number,
  tzOffsetMin: number,
): ActivityEventInput[] {
  const out: ActivityEventInput[] = [];
  for (const session of sessions) {
    if (!session.cwd) continue;
    // Streaming updates replace only the sessions that changed.
    if (state.last.get(session.id) === session) continue;
    state.last.set(session.id, session);
    const firstSight = !state.seeded.has(session.id);
    if (firstSight) state.seeded.add(session.id);

    session.blocks.forEach((block) => {
      if (block.role !== "user") return;
      const key = `prompt:${block.id}`;
      if (state.recorded.has(key)) return;
      state.recorded.add(key);
      // Timed prompts are judged by age, so a brand-new chat whose first
      // prompt is already in place still counts. Steers carry no start time;
      // they only count once the session was already being watched.
      const fresh =
        block.startedAt != null
          ? now - block.startedAt < FRESH_MS
          : !firstSight && session.busy === true;
      const text = block.text.trim();
      if (!fresh || !text) return;
      out.push({
        ...baseInput(session, tzOffsetMin),
        kind: "prompt",
        blockId: block.id,
        text: clipText(text, PROMPT_TEXT_MAX),
        at: block.startedAt ?? now,
      });
    });

    const wasBusy = state.busy.get(session.id) === true;
    const isBusy = session.busy === true;
    state.busy.set(session.id, isBusy);
    if (!wasBusy || isBusy) continue;

    const userIndex = lastStartedUserIndex(session.blocks);
    if (userIndex < 0) continue;
    const user = session.blocks[userIndex];
    const key = `turn:${user.id}`;
    if (state.recorded.has(key)) continue;
    state.recorded.add(key);
    const startedAt = user.startedAt ?? now;
    out.push({
      ...baseInput(session, tzOffsetMin),
      kind: "turn",
      blockId: user.id,
      text: replyExcerpt(session.blocks, userIndex),
      at: now,
      durationMs: Math.max(0, user.durationMs ?? now - startedAt),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// View model
// ---------------------------------------------------------------------------

export type ProjectSummary = {
  cwd: string;
  name: string;
  prompts: number;
  agentMs: number;
  branches: string[];
  lastTs: number;
};

/** Per-project prompts and agent time, busiest first. */
export function summarizeProjects(events: readonly ActivityEvent[]): ProjectSummary[] {
  const byCwd = new Map<string, ProjectSummary>();
  for (const event of events) {
    const entry =
      byCwd.get(event.cwd) ??
      ({
        cwd: event.cwd,
        name: projectName(event.cwd),
        prompts: 0,
        agentMs: 0,
        branches: [],
        lastTs: 0,
      } satisfies ProjectSummary);
    if (event.kind === "prompt") entry.prompts += 1;
    if (event.kind === "turn") entry.agentMs += event.durationMs ?? 0;
    if (event.branch && !entry.branches.includes(event.branch)) {
      entry.branches.push(event.branch);
    }
    entry.lastTs = Math.max(entry.lastTs, event.ts);
    byCwd.set(event.cwd, entry);
  }
  return [...byCwd.values()].sort(
    (a, b) => b.agentMs - a.agentMs || b.prompts - a.prompts || b.lastTs - a.lastTs,
  );
}

export type ActivityTotals = {
  prompts: number;
  agentMs: number;
  sessions: number;
};

export function activityTotals(events: readonly ActivityEvent[]): ActivityTotals {
  const sessions = new Set<string>();
  let prompts = 0;
  let agentMs = 0;
  for (const event of events) {
    sessions.add(event.sessionId);
    if (event.kind === "prompt") prompts += 1;
    else agentMs += event.durationMs ?? 0;
  }
  return { prompts, agentMs, sessions: sessions.size };
}

/** Agent turns as timeline spans (`ts` is the turn end). */
export function agentSpans(events: readonly ActivityEvent[]): Span[] {
  return events
    .filter((event) => event.kind === "turn" && (event.durationMs ?? 0) > 0)
    .map((event) => ({ start: event.ts - (event.durationMs ?? 0), end: event.ts }));
}

export type LogItem =
  | { type: "note"; key: string; ts: number; note: ActivityNote }
  | { type: "event"; key: string; ts: number; event: ActivityEvent };

/** Notes and events interleaved, newest first. A note sorts above the events it covers. */
export function buildLogItems(log: ActivityLog): LogItem[] {
  const items: LogItem[] = [
    ...log.notes.map(
      (note): LogItem => ({ type: "note", key: `n${note.id}`, ts: note.ts, note }),
    ),
    ...log.events.map(
      (event): LogItem => ({ type: "event", key: `e${event.id}`, ts: event.ts, event }),
    ),
  ];
  return items.sort((a, b) => {
    if (b.ts !== a.ts) return b.ts - a.ts;
    if (a.type !== b.type) return a.type === "note" ? -1 : 1;
    return b.key.localeCompare(a.key);
  });
}

/**
 * Visible window for the day timeline: from the first to the last activity,
 * padded to whole hours, at least {@link MIN_WINDOW_HOURS} wide, clamped to
 * the day. Falls back to 08:00–20:00 when there is nothing to show.
 */
export const MIN_WINDOW_HOURS = 6;

export function timelineWindow(day: Span, spans: readonly Span[]): Span {
  const hour = 3_600_000;
  const relevant = spans.filter((s) => s.end > day.start && s.start < day.end);
  if (relevant.length === 0) {
    return { start: day.start + 8 * hour, end: day.start + 20 * hour };
  }
  const first = Math.max(day.start, Math.min(...relevant.map((s) => s.start)));
  const last = Math.min(day.end, Math.max(...relevant.map((s) => s.end)));
  let start = day.start + Math.floor((first - day.start) / hour) * hour;
  let end = day.start + Math.ceil((last - day.start) / hour) * hour;
  const minWidth = MIN_WINDOW_HOURS * hour;
  if (end - start < minWidth) {
    const need = minWidth - (end - start);
    const before = Math.floor(need / 2 / hour) * hour;
    start -= before;
    end += need - before;
  }
  if (start < day.start) {
    end = Math.min(day.end, end + (day.start - start));
    start = day.start;
  }
  if (end > day.end) {
    start = Math.max(day.start, start - (end - day.end));
    end = day.end;
  }
  return { start, end: Math.max(end, start + hour) };
}

/** Day length helper so callers do not hard-code 24h (DST days are 23/25h). */
export function spanLength(span: Span): number {
  return Math.max(0, span.end - span.start);
}

import type { ReactElement } from "react";
import { Bot, GitBranch, MessageSquare, RefreshCw, Sparkles } from "../../../shared/ui/icons";
import {
  formatClock,
  formatDuration,
  notesMissing,
  type ActivityEvent,
  type ActivityNote,
  type AgentStatus,
  type LogItem,
} from "../model/activity";
import { projectName } from "../../../shared/lib/paths";

/** Split an agy note into bullets; any non-bullet line stays a paragraph. */
function noteLines(body: string): { bullet: boolean; text: string }[] {
  return body
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = /^(?:[-*•]|\d+[.)])\s+(.*)$/.exec(line);
      return match ? { bullet: true, text: match[1] } : { bullet: false, text: line };
    });
}

function NoteCard({ note }: { note: ActivityNote }): ReactElement {
  return (
    <article className="motion-safe:animate-[zen-step-in_220ms_ease-out_both] relative rounded-md border border-accent/20 bg-accent/[0.06] px-3 py-2.5">
      <header className="mb-1.5 flex items-center gap-1.5 text-[11px] text-accent">
        <Sparkles className="size-3" strokeWidth={1.75} />
        <span className="font-medium">Note</span>
        <span className="text-content/35">· agy</span>
      </header>
      <ul className="flex flex-col gap-1 text-[12.5px] leading-relaxed text-content/90">
        {noteLines(note.body).map((line, index) => (
          <li key={index} className={line.bullet ? "flex gap-2" : ""}>
            {line.bullet ? (
              <>
                <span aria-hidden className="mt-[0.55em] size-1 shrink-0 rounded-full bg-content/40" />
                <span className="min-w-0">{line.text}</span>
              </>
            ) : (
              line.text
            )}
          </li>
        ))}
      </ul>
    </article>
  );
}

function EventMeta({ event }: { event: ActivityEvent }): ReactElement {
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-content/45">
      <span className="truncate font-medium text-content/70">{projectName(event.cwd)}</span>
      {event.branch ? (
        <span className="flex min-w-0 items-center gap-0.5">
          <GitBranch className="size-3 shrink-0" strokeWidth={1.75} />
          <span className="truncate">{event.branch}</span>
        </span>
      ) : null}
      <span aria-hidden>·</span>
      <span className="shrink-0">{event.harness}</span>
    </span>
  );
}

function EventRow({
  event,
  onOpenSession,
}: {
  event: ActivityEvent;
  onOpenSession?: (sessionId: string) => void;
}): ReactElement {
  const isPrompt = event.kind === "prompt";
  const Icon = isPrompt ? MessageSquare : Bot;
  const body = (
    <>
      <span className="flex items-center gap-2">
        <Icon
          className={`size-3.5 shrink-0 ${isPrompt ? "text-content/55" : "text-accent"}`}
          strokeWidth={1.75}
        />
        <EventMeta event={event} />
        {!isPrompt && event.durationMs != null ? (
          <span className="ml-auto shrink-0 rounded bg-accent/10 px-1.5 py-0.5 text-[10.5px] tabular-nums text-accent">
            {formatDuration(event.durationMs)}
          </span>
        ) : null}
      </span>
      {event.text ? (
        <span
          className={`mt-1 block pl-[22px] text-[12.5px] leading-snug ${
            isPrompt ? "line-clamp-3 text-content/90" : "line-clamp-2 text-content/50"
          }`}
        >
          {isPrompt ? event.text : `Finished: ${event.text}`}
        </span>
      ) : !isPrompt ? (
        <span className="mt-1 block pl-[22px] text-[12px] text-content/45">Turn finished</span>
      ) : null}
    </>
  );

  if (!onOpenSession) {
    return <div className="rounded-md px-2 py-1.5">{body}</div>;
  }
  return (
    <button
      type="button"
      onClick={() => onOpenSession(event.sessionId)}
      aria-label={`Open session: ${event.title || projectName(event.cwd)}`}
      title={event.title || undefined}
      className="block w-full rounded-md px-2 py-1.5 text-left outline-none transition-colors hover:bg-content/[0.05] focus-visible:ring-1 focus-visible:ring-accent/60"
    >
      {body}
    </button>
  );
}

function NotesBanner({
  status,
  onRetry,
}: {
  status: AgentStatus | null;
  onRetry: () => void;
}): ReactElement | null {
  if (!status) return null;
  if (status.phase !== "paused" && status.phase !== "backoff") {
    if (!notesMissing(status)) return null;
    return (
      <div
        role="alert"
        className="mb-3 flex items-start gap-3 rounded-md border border-skill/30 bg-skill/[0.07] px-3 py-2.5"
      >
        <Sparkles className="mt-0.5 size-3.5 shrink-0 text-skill" strokeWidth={1.75} />
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-medium text-content">
            agy ran {status.today?.calls} {status.today?.calls === 1 ? "time" : "times"} today
            but wrote no notes
          </p>
          <p className="mt-0.5 break-words text-[11.5px] leading-snug text-content/55">
            {status.lastRun?.summary ?? "No output was recorded."} Open the agy menu at the top
            and use Copy details to see what it returned.
          </p>
        </div>
        <button
          type="button"
          onClick={onRetry}
          className="flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-content/15 px-2.5 text-[12px] text-content/80 transition-colors hover:bg-content/10 hover:text-content focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60"
        >
          <RefreshCw className="size-3" strokeWidth={1.75} />
          Try again
        </button>
      </div>
    );
  }
  const paused = status.phase === "paused";
  return (
    <div
      role="alert"
      className="mb-3 flex items-start gap-3 rounded-md border border-skill/30 bg-skill/[0.07] px-3 py-2.5"
    >
      <Sparkles className="mt-0.5 size-3.5 shrink-0 text-skill" strokeWidth={1.75} />
      <div className="min-w-0 flex-1">
        <p className="text-[12px] font-medium text-content">
          {paused ? "AI notes are paused" : "AI notes will retry shortly"}
        </p>
        {status.lastError ? (
          <p className="mt-0.5 break-words text-[11.5px] leading-snug text-content/55">
            {status.lastError}
          </p>
        ) : null}
        <p className="mt-0.5 text-[11px] text-content/40">
          Prompts are still being logged; notes catch up once agy works.
        </p>
      </div>
      <button
        type="button"
        onClick={onRetry}
        className="flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-content/15 px-2.5 text-[12px] text-content/80 transition-colors hover:bg-content/10 hover:text-content focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60"
      >
        <RefreshCw className="size-3" strokeWidth={1.75} />
        Retry now
      </button>
    </div>
  );
}

/**
 * A long list fills its column and scrolls inside it (see `MatchLeftColumn` in
 * ActivityView). Stacked on a narrow window it stops at the height of the
 * Activity pane (`cqh` of its scroller). Focusable so the keyboard can scroll
 * it (WCAG 2.1.1).
 */
export const SCROLL_LIST =
  "min-h-0 flex-1 max-h-[calc(100cqh-2.5rem)] lg:max-h-none overflow-y-auto overscroll-contain rounded-md pr-1 outline-none focus-visible:ring-1 focus-visible:ring-accent/60";

/** What the day's log shows: everything, or only agy notes. */
export type LogFilter = "all" | "notes";

const LOG_FILTERS: { id: LogFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "notes", label: "Notes" },
];

/** Logbook of the day: agy notes interleaved with prompts and finished turns. */
export function ActivityLogFeed({
  items,
  agent,
  filter,
  onFilter,
  onRetry,
  onOpenSession,
}: {
  items: LogItem[];
  agent: AgentStatus | null;
  filter: LogFilter;
  onFilter: (filter: LogFilter) => void;
  onRetry: () => void;
  onOpenSession?: (sessionId: string) => void;
}): ReactElement {
  const noteCount = items.filter((item) => item.type === "note").length;
  const shown = filter === "notes" ? items.filter((item) => item.type === "note") : items;
  return (
    <section aria-label="Log" className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex items-center justify-between gap-2 px-1 pb-2">
        <h3 className="text-[11px] font-medium uppercase tracking-[0.08em] text-content/45">Log</h3>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-content/35">Newest first</span>
          <div
            role="radiogroup"
            aria-label="Show in the log"
            className="flex rounded-md border border-stroke p-0.5"
          >
            {LOG_FILTERS.map((option) => (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={filter === option.id}
                onClick={() => onFilter(option.id)}
                className={`flex h-5.5 items-center gap-1 rounded px-2 text-[11.5px] transition-[background-color,color,transform] duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60 active:scale-96 ${
                  filter === option.id
                    ? "bg-content/10 font-medium text-content"
                    : "text-content/55 hover:text-content"
                }`}
              >
                {option.label}
                {option.id === "notes" ? (
                  <span className="tabular-nums text-content/40">{noteCount}</span>
                ) : null}
              </button>
            ))}
          </div>
        </div>
      </header>
      <NotesBanner status={agent} onRetry={onRetry} />
      {shown.length === 0 ? (
        <p className="px-1 text-[12px] text-content/40">
          {filter === "notes" && items.length > 0
            ? "No agy notes on this day yet."
            : "Nothing yet. Send a prompt in any session and it lands here."}
        </p>
      ) : (
        <ol
          tabIndex={0}
          aria-label={filter === "notes" ? "Notes on this day" : "Log entries"}
          className={`relative flex flex-col ${SCROLL_LIST}`}
        >
          {shown.map((item) => (
            <li key={item.key} className="grid grid-cols-[42px_minmax(0,1fr)] gap-2 py-1">
              <time
                dateTime={new Date(item.ts).toISOString()}
                className="pt-2 text-right text-[11px] tabular-nums text-content/35"
              >
                {formatClock(item.ts)}
              </time>
              <div className="min-w-0 border-l border-stroke pl-2">
                {item.type === "note" ? (
                  <NoteCard note={item.note} />
                ) : (
                  <EventRow event={item.event} onOpenSession={onOpenSession} />
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

import { useCallback, useEffect, useState, type ReactElement } from "react";
import { LoaderCircle, RefreshCw, Sparkles } from "../../../shared/ui/icons";
import { AgentMarkdown } from "../../sessions/ui/AgentMarkdown";
import {
  formatClock,
  loadPeriodSummary,
  notesByDay,
  writePeriodSummary,
  type ActivityNote,
  type PeriodSummary,
  type Span,
} from "../model/activity";

const BUTTON =
  "flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-stroke px-2.5 text-[12px] text-content/80 transition-colors hover:bg-content/10 hover:text-content focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60 disabled:pointer-events-none disabled:opacity-40";

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * The week's or month's AI summary. Shows the cached one; writing (or
 * rewriting) runs one `agy` call on demand, never automatically, so a long
 * period never spends quota unasked.
 */
export function PeriodSummaryCard({
  periodKey,
  label,
  range,
  notesEnabled,
  hasActivity,
}: {
  periodKey: string;
  /** Prompt wording, e.g. "week of Mon, 9 Nov 2026". */
  label: string;
  range: Span;
  notesEnabled: boolean;
  hasActivity: boolean;
}): ReactElement {
  const [summary, setSummary] = useState<PeriodSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [writing, setWriting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSummary(null);
    setError(null);
    setLoading(true);
    loadPeriodSummary(periodKey).then(
      (cached) => {
        if (!cancelled) setSummary(cached);
      },
      (err: unknown) => {
        if (!cancelled) setError(message(err));
      },
    ).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [periodKey]);

  const write = useCallback(() => {
    setWriting(true);
    setError(null);
    writePeriodSummary({ key: periodKey, label, range })
      .then(setSummary, (err: unknown) => setError(message(err)))
      .finally(() => setWriting(false));
  }, [periodKey, label, range]);

  const canWrite = notesEnabled && hasActivity && !writing;
  const why = !notesEnabled
    ? "Turn on Activity notes to write summaries with agy."
    : !hasActivity
      ? "Nothing logged in this period yet."
      : undefined;

  return (
    <section
      aria-label="Summary"
      aria-busy={writing || loading}
      className="rounded-lg border border-accent/20 bg-accent/[0.05] px-4 py-3"
    >
      <header className="mb-2 flex items-center gap-2">
        <Sparkles className="size-3.5 text-accent" strokeWidth={1.75} />
        <h3 className="text-[12px] font-medium text-content">Summary</h3>
        {summary ? (
          <span className="text-[11px] text-content/40">
            agy · written {new Date(summary.createdAt).toLocaleDateString()}{" "}
            {formatClock(summary.createdAt)}
          </span>
        ) : null}
        <button
          type="button"
          disabled={!canWrite}
          title={why}
          onClick={write}
          className={`${BUTTON} ml-auto`}
        >
          {writing ? (
            <LoaderCircle className="size-3 motion-safe:animate-spin" strokeWidth={1.75} />
          ) : summary ? (
            <RefreshCw className="size-3" strokeWidth={1.75} />
          ) : (
            <Sparkles className="size-3" strokeWidth={1.75} />
          )}
          {writing ? "Writing…" : summary ? "Rewrite" : "Write summary"}
        </button>
      </header>
      {error ? (
        <p role="alert" className="mb-2 break-words text-[12px] text-content/60">
          {error}
        </p>
      ) : null}
      {loading ? (
        <div className="h-16 rounded-md bg-content/[0.05] motion-safe:animate-pulse" />
      ) : summary ? (
        <AgentMarkdown text={summary.body} className="text-[12.5px] leading-relaxed" />
      ) : (
        <p className="text-[12px] text-content/45">
          {why ??
            "No summary yet. Write one to get highlights, time per project and open threads for this period."}
        </p>
      )}
    </section>
  );
}

/** The period's agy notes, grouped by day, newest first. A day heading opens that day. */
export function PeriodNotes({
  notes,
  onOpenDay,
}: {
  notes: readonly ActivityNote[];
  onOpenDay: (start: number) => void;
}): ReactElement {
  const groups = notesByDay(notes);
  return (
    <section aria-label="Notes by day" className="flex min-w-0 flex-col">
      <header className="flex items-baseline justify-between px-1 pb-2">
        <h3 className="text-[11px] font-medium uppercase tracking-[0.08em] text-content/45">
          Notes by day
        </h3>
        <span className="text-[11px] text-content/35">{notes.length} notes</span>
      </header>
      {groups.length === 0 ? (
        <p className="px-1 text-[12px] text-content/40">No agy notes in this period.</p>
      ) : (
        <ol className="flex flex-col gap-4">
          {groups.map((group) => (
            <li key={group.day}>
              <button
                type="button"
                onClick={() => onOpenDay(group.day)}
                className="mb-1.5 rounded px-1 text-[12px] font-medium text-content/80 transition-colors hover:text-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60"
              >
                {new Date(group.day).toLocaleDateString(undefined, {
                  weekday: "long",
                  day: "numeric",
                  month: "short",
                })}
              </button>
              <ul className="flex flex-col gap-1.5 border-l border-stroke pl-3">
                {group.notes.map((note) => (
                  <li key={note.id} className="text-[12.5px] leading-relaxed text-content/85">
                    <time
                      dateTime={new Date(note.ts).toISOString()}
                      className="mr-2 text-[11px] tabular-nums text-content/35"
                    >
                      {formatClock(note.ts)}
                    </time>
                    <span className="whitespace-pre-line">{note.body}</span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

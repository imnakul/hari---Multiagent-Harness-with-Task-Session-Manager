import { useMemo, type ReactElement } from "react";
import { formatDuration, type DayTotals } from "../model/activity";

type Series = {
  key: "activeMs" | "agentMs" | "meetingMs";
  label: string;
  color: string;
};

const SERIES: Series[] = [
  { key: "activeMs", label: "You", color: "bg-content/35" },
  { key: "agentMs", label: "Agents", color: "bg-accent" },
  { key: "meetingMs", label: "Meetings", color: "bg-skill" },
];

/**
 * One column per day with up to three thin bars (you, agents, meetings).
 * Click a day to open it. Bar heights are data-driven, so they use inline
 * `style` — Tailwind cannot express runtime percentages.
 */
export function DailyBars({
  days,
  showDesktop,
  today,
  onOpenDay,
}: {
  days: DayTotals[];
  /** ActivityWatch data is available, so "You" and "Meetings" have values. */
  showDesktop: boolean;
  /** Local midnight of today, to mark it and leave later days empty. */
  today: number;
  onOpenDay: (start: number) => void;
}): ReactElement {
  const series = showDesktop ? SERIES : SERIES.filter((s) => s.key === "agentMs");
  const max = useMemo(
    () => Math.max(1, ...days.flatMap((day) => series.map((s) => day[s.key]))),
    [days, series],
  );
  const dense = days.length > 10;

  return (
    <figure
      aria-label="Time per day"
      className="rounded-lg border border-stroke px-4 pb-3 pt-3.5"
    >
      <figcaption className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-content/55">
        {series.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5">
            <span aria-hidden className={`size-1.5 rounded-full ${s.color}`} />
            {s.label}
          </span>
        ))}
        <span className="ml-auto text-content/35">Click a day to open it</span>
      </figcaption>
      <ol className="flex h-36 items-end gap-1">
        {days.map((day) => {
          const date = new Date(day.start);
          const future = day.start > today;
          const summary = series
            .map((s) => `${s.label} ${formatDuration(day[s.key])}`)
            .join(", ");
          const name = date.toLocaleDateString(undefined, {
            weekday: "long",
            day: "numeric",
            month: "long",
          });
          return (
            <li key={day.start} className="flex h-full min-w-0 flex-1">
              <button
                type="button"
                disabled={future}
                onClick={() => onOpenDay(day.start)}
                aria-label={`${name}: ${summary}, ${day.prompts} prompts`}
                title={`${name}\n${summary}\n${day.prompts} prompts`}
                className="group flex h-full min-w-0 flex-1 flex-col items-stretch justify-end gap-1 rounded-md px-0.5 pb-0.5 transition-colors hover:bg-content/[0.05] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60 disabled:pointer-events-none"
              >
                <span className="flex min-h-0 flex-1 items-end justify-center gap-px">
                  {series.map((s) => (
                    <span
                      key={s.key}
                      className={`w-full max-w-2 rounded-t-[2px] ${s.color} transition-[height] duration-500 ease-out motion-reduce:transition-none`}
                      style={{ height: `${(day[s.key] / max) * 100}%` }}
                    />
                  ))}
                </span>
                <span
                  className={`truncate text-center text-[10px] tabular-nums ${
                    day.start === today ? "font-semibold text-content" : "text-content/40"
                  }`}
                >
                  {dense
                    ? date.getDate()
                    : date.toLocaleDateString(undefined, { weekday: "short", day: "numeric" })}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </figure>
  );
}

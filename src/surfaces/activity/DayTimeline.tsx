import { useMemo, type ReactElement } from "react";
import {
  formatClock,
  formatDuration,
  spanLength,
  timelineWindow,
  type Span,
} from "../../lib/activity";

type Lane = {
  id: string;
  label: string;
  color: string;
  spans: (Span & { label?: string })[];
  /** Shown in the lane when it has no data, e.g. a setup hint. */
  emptyHint?: string;
};

const HOUR = 3_600_000;
/** Spans narrower than this would vanish; keep a hairline visible. */
const MIN_BAR_PERCENT = 0.35;

/**
 * Three-lane ribbon for one day: you (active), agents (turns), meetings.
 * Bar geometry is computed at runtime, so it is the one place this view uses
 * inline `style` — Tailwind cannot express data-driven percentages.
 */
export function DayTimeline({
  day,
  active,
  agents,
  meetings,
  now,
  awHint,
}: {
  day: Span;
  active: Span[];
  agents: Span[];
  meetings: (Span & { label: string })[];
  /** Epoch ms for the "now" marker, or null for past days. */
  now: number | null;
  awHint?: string;
}): ReactElement {
  const view = useMemo(
    () => timelineWindow(day, [...active, ...agents, ...meetings, ...(now ? [{ start: now, end: now }] : [])]),
    [day, active, agents, meetings, now],
  );
  const width = spanLength(view);
  const stepHours = width > 12 * HOUR ? 2 : 1;
  const ticks: number[] = [];
  for (let t = view.start; t <= view.end; t += stepHours * HOUR) ticks.push(t);

  const lanes: Lane[] = [
    { id: "you", label: "You", color: "bg-content/35", spans: active, emptyHint: awHint },
    { id: "agents", label: "Agents", color: "bg-accent", spans: agents },
    { id: "meetings", label: "Meetings", color: "bg-skill", spans: meetings, emptyHint: awHint },
  ];

  const place = (span: Span): { left: string; width: string } | null => {
    const start = Math.max(span.start, view.start);
    const end = Math.min(span.end, view.end);
    if (end <= start) return null;
    const left = ((start - view.start) / width) * 100;
    const w = Math.max(MIN_BAR_PERCENT, ((end - start) / width) * 100);
    return { left: `${left}%`, width: `${Math.min(w, 100 - left)}%` };
  };
  const nowLeft = now != null && now >= view.start && now <= view.end
    ? `${((now - view.start) / width) * 100}%`
    : null;

  return (
    <figure
      aria-label={`Timeline from ${formatClock(view.start)} to ${formatClock(view.end)}`}
      className="rounded-lg border border-content/10 px-4 pb-3 pt-3.5"
    >
      <div className="grid grid-cols-[64px_minmax(0,1fr)] items-center gap-x-3 gap-y-2">
        {lanes.map((lane) => (
          <LaneRow key={lane.id} lane={lane} place={place} nowLeft={nowLeft} />
        ))}
        <span aria-hidden />
        <div aria-hidden className="relative h-4">
          {ticks.map((tick, index) => (
            <span
              key={tick}
              // Narrow windows show every other label so they never collide.
              className={`absolute top-0 -translate-x-1/2 text-[10px] tabular-nums text-content/35 first:translate-x-0 last:-translate-x-full ${
                index % 2 === 1 && index !== ticks.length - 1 ? "max-md:hidden" : ""
              }`}
              style={{ left: `${((tick - view.start) / width) * 100}%` }}
            >
              {formatClock(tick)}
            </span>
          ))}
        </div>
      </div>
    </figure>
  );
}

function LaneRow({
  lane,
  place,
  nowLeft,
}: {
  lane: Lane;
  place: (span: Span) => { left: string; width: string } | null;
  nowLeft: string | null;
}): ReactElement {
  const total = lane.spans.reduce((sum, span) => sum + spanLength(span), 0);
  const showHint = lane.spans.length === 0 && Boolean(lane.emptyHint);
  return (
    <>
      <span className="flex items-center gap-1.5 text-[11px] text-content/55">
        <span aria-hidden className={`size-1.5 rounded-full ${lane.color}`} />
        {lane.label}
      </span>
      <div
        role="img"
        aria-label={`${lane.label}: ${total > 0 ? formatDuration(total) : "nothing"}`}
        className="relative h-5 overflow-hidden rounded-[5px] bg-content/[0.04]"
      >
        {lane.spans.map((span) => {
          const geometry = place(span);
          if (!geometry) return null;
          const range = `${formatClock(span.start)}–${formatClock(span.end)}`;
          return (
            <span
              key={`${span.start}-${span.end}`}
              title={`${"label" in span && span.label ? `${span.label} · ` : ""}${range} · ${formatDuration(spanLength(span))}`}
              className={`zen-step-in absolute inset-y-1 rounded-[3px] ${lane.color} transition-opacity hover:opacity-80`}
              style={geometry}
            />
          );
        })}
        {showHint ? (
          <span className="absolute inset-0 flex items-center px-2 text-[10.5px] text-content/35">
            {lane.emptyHint}
          </span>
        ) : null}
        {nowLeft && !showHint ? (
          <span
            aria-hidden
            className="absolute inset-y-0 w-px bg-content/50"
            style={{ left: nowLeft }}
          />
        ) : null}
      </div>
    </>
  );
}

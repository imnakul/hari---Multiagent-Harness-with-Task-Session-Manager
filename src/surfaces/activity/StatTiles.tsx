import type { ReactElement, ReactNode } from "react";
import { formatDuration, type ActivityTotals, type AwSummary } from "../../lib/activity";

type Tile = {
  label: string;
  value: ReactNode;
  caption: string;
  /** Small colour key matching the timeline lane. */
  swatch?: string;
};

function Value({ ms, empty }: { ms: number | null; empty?: string }): ReactElement {
  if (ms == null) return <span className="text-content/30">{empty ?? "—"}</span>;
  return <>{formatDuration(ms)}</>;
}

/** The four headline numbers for the day. */
export function StatTiles({
  totals,
  aw,
}: {
  totals: ActivityTotals;
  aw: AwSummary | null;
}): ReactElement {
  const awReady = aw?.available === true;
  const tiles: Tile[] = [
    {
      label: "You, active",
      value: <Value ms={awReady ? aw.activeMs : null} />,
      caption: awReady
        ? aw.hasAfk
          ? "Keyboard or mouse in use"
          : "From window focus"
        : "Needs ActivityWatch",
      swatch: "bg-content/35",
    },
    {
      label: "Agents working",
      value: <Value ms={totals.agentMs} />,
      caption: `${totals.sessions} ${totals.sessions === 1 ? "session" : "sessions"}`,
      swatch: "bg-accent",
    },
    {
      label: "Prompts",
      value: totals.prompts,
      caption: totals.prompts === 0 ? "None sent yet" : "Sent from Hari",
    },
    {
      label: "Meetings",
      value: <Value ms={awReady ? aw.meetingMs : null} />,
      caption: awReady
        ? `${aw.meetings.length} ${aw.meetings.length === 1 ? "call" : "calls"} detected`
        : "Needs ActivityWatch",
      swatch: "bg-skill",
    },
  ];

  return (
    <dl className="grid grid-cols-2 overflow-hidden rounded-lg border border-content/10 lg:grid-cols-4">
      {tiles.map((tile, index) => (
        <div
          key={tile.label}
          className={`zen-step-in flex min-w-0 flex-col gap-1 px-4 py-3.5 ${
            index % 2 === 1 ? "border-l border-content/10" : ""
          } ${index >= 2 ? "border-t border-content/10 lg:border-t-0" : ""} ${
            index === 2 ? "lg:border-l" : ""
          }`}
        >
          <dt className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-content/45">
            {tile.swatch ? (
              <span aria-hidden className={`size-1.5 rounded-full ${tile.swatch}`} />
            ) : null}
            {tile.label}
          </dt>
          <dd className="text-[24px] font-semibold leading-none tracking-tight tabular-nums text-content">
            {tile.value}
          </dd>
          <dd className="truncate text-[11px] text-content/40">{tile.caption}</dd>
        </div>
      ))}
    </dl>
  );
}

import type { ReactElement, ReactNode } from "react";
import { formatDuration, type ActivityTotals, type AwSummary } from "../model/activity";

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
  phoneMs = null,
  showAgents = true,
}: {
  totals: ActivityTotals;
  aw: AwSummary | null;
  /** Fork (L-398): phone time to add to "You, active"; null while Phone is off. */
  phoneMs?: number | null;
  /** Fork (L-398): false when MonoCode is off, which hides the agent tiles. */
  showAgents?: boolean;
}): ReactElement {
  const awReady = aw?.available === true;
  const activeMs = awReady || phoneMs != null ? (awReady ? aw.activeMs : 0) + (phoneMs ?? 0) : null;
  const tiles: Tile[] = [
    {
      label: "You, active",
      value: <Value ms={activeMs} />,
      caption: awReady
        ? phoneMs != null
          ? "Computer and phone"
          : aw.hasAfk
            ? "Keyboard or mouse in use"
            : "From window focus"
        : phoneMs != null
          ? "Phone only"
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
  ].filter((tile) => showAgents || (tile.label !== "Agents working" && tile.label !== "Prompts"));

  return (
    <dl
      className={`grid grid-cols-2 overflow-hidden rounded-lg border border-stroke ${tiles.length > 2 ? "lg:grid-cols-4" : ""}`}
    >
      {tiles.map((tile, index) => (
        <div
          key={tile.label}
          className={`motion-safe:animate-[zen-step-in_220ms_ease-out_both] flex min-w-0 flex-col gap-1 px-4 py-3.5 ${
            index % 2 === 1 ? "border-l border-stroke" : ""
          } ${index >= 2 ? "border-t border-stroke lg:border-t-0" : ""} ${
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

import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import {
  Activity,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  ExternalLink,
  RefreshCw,
} from "../chrome/icons";
import { OverlayNav } from "../chrome/TitleBar";
import { WindowControls } from "../chrome/WindowControls";
import { useAiNotesEnabled } from "../hooks/useActivityRecorder";
import { useLockOverscroll } from "../hooks/useLockOverscroll";
import {
  activityTotals,
  agentSpans,
  buildLogItems,
  formatDayLabel,
  saveAiNotesEnabled,
  shiftDay,
  summarizeProjects,
  type ActivityLog,
} from "../lib/activity";
import { IS_MAC } from "../lib/platform";
import { ActivityLogFeed } from "./activity/ActivityLogFeed";
import { AgentStatusPill } from "./activity/AgentStatusPill";
import { AppsBreakdown, ProjectBreakdown } from "./activity/Breakdown";
import { DayTimeline } from "./activity/DayTimeline";
import { StatTiles } from "./activity/StatTiles";
import { useActivityData } from "./activity/useActivityData";

const ACTIVITYWATCH_URL = "https://activitywatch.net/";
const EMPTY_LOG: ActivityLog = { events: [], notes: [] };
/** Remember the viewed day while the app runs, like Notes remembers its note. */
let rememberedDay: Date | null = null;

type Props = {
  besideRail?: boolean;
  onClose: () => void;
  onToggleSidebar?: () => void;
  /** Open the chat a logged prompt came from. */
  onOpenSession?: (sessionId: string) => void;
};

/**
 * Activity: what you and your agents did on one day — headline numbers, a
 * timeline, per-project time, top apps, and a log with Antigravity notes.
 */
export function ActivityView({
  besideRail = false,
  onClose,
  onToggleSidebar,
  onOpenSession,
}: Props): ReactElement {
  const [day, setDay] = useState<Date>(() => rememberedDay ?? shiftDay(new Date(), 0));
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const scrollLock = useLockOverscroll<HTMLDivElement>();
  const aiNotes = useAiNotesEnabled();
  const data = useActivityData(day);
  const { log, aw, agent, isToday } = data;

  useEffect(() => {
    rememberedDay = day;
  }, [day]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onCloseRef.current();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  const current = log.data ?? EMPTY_LOG;
  const totals = useMemo(() => activityTotals(current.events), [current]);
  const projects = useMemo(() => summarizeProjects(current.events), [current]);
  const items = useMemo(() => buildLogItems(current), [current]);
  const turns = useMemo(() => agentSpans(current.events), [current]);
  const awData = aw.data;
  const awHint = awData && !awData.available ? "ActivityWatch not running" : undefined;
  const firstLoad = log.data == null && log.loading;

  return (
    <div
      role="region"
      aria-label="Activity"
      data-app-activity
      className="flex min-h-0 min-w-0 flex-1 flex-col text-content"
    >
      <div
        className="flex h-10 shrink-0 select-none items-center border-b border-content/10"
        data-tauri-drag-region="deep"
      >
        {IS_MAC && !besideRail ? <div className="w-[78px] shrink-0" /> : null}
        {besideRail ? null : <OverlayNav onBack={onClose} onToggleSidebar={onToggleSidebar} />}
        <div className="flex min-w-0 flex-1 items-center gap-2 px-3 text-[13px]">
          <Activity className="size-3.5 shrink-0 text-content/45" strokeWidth={1.75} />
          <span className="min-w-0 truncate text-content">Activity</span>
        </div>
        <div className="flex shrink-0 items-center gap-2 pr-2">
          <AgentStatusPill status={agent} />
          <NotesSwitch on={aiNotes} />
        </div>
        {IS_MAC ? null : <WindowControls />}
      </div>

      <div ref={scrollLock} className="min-h-0 flex-1 overflow-y-auto overscroll-none">
        <div className="mx-auto flex w-full max-w-[1120px] flex-col gap-5 px-4 py-5 sm:px-6">
          <DayNav
            day={day}
            isToday={isToday}
            refreshing={log.loading || aw.loading}
            onShift={(delta) => setDay((d) => shiftDay(d, delta))}
            onToday={() => setDay(shiftDay(new Date(), 0))}
            onRefresh={data.refresh}
          />

          {log.error && !log.data ? (
            <ErrorState message={log.error} onRetry={data.refresh} />
          ) : firstLoad ? (
            <LoadingState />
          ) : (
            <>
              <StatTiles totals={totals} aw={awData?.available ? awData : null} />
              {awData && !awData.available ? <ActivityWatchHint reason={awData.error} /> : null}
              <DayTimeline
                day={data.range}
                active={awData?.activeSpans ?? []}
                agents={turns}
                meetings={awData?.meetings ?? []}
                now={isToday ? Date.now() : null}
                awHint={awHint}
              />
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
                <div className="flex min-w-0 flex-col gap-6">
                  <ProjectBreakdown projects={projects} />
                  <AppsBreakdown aw={awData} />
                </div>
                <ActivityLogFeed
                  items={items}
                  agent={agent}
                  onRetry={data.retryNotes}
                  onOpenSession={onOpenSession}
                />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function DayNav({
  day,
  isToday,
  refreshing,
  onShift,
  onToday,
  onRefresh,
}: {
  day: Date;
  isToday: boolean;
  refreshing: boolean;
  onShift: (delta: number) => void;
  onToday: () => void;
  onRefresh: () => void;
}): ReactElement {
  const iconButton =
    "grid size-7 place-items-center rounded-md text-content/55 transition-colors hover:bg-content/10 hover:text-content focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60 disabled:pointer-events-none disabled:opacity-30";
  return (
    <nav aria-label="Choose day" className="flex items-center gap-1">
      <button type="button" aria-label="Previous day" className={iconButton} onClick={() => onShift(-1)}>
        <ChevronLeft className="size-4" strokeWidth={1.75} />
      </button>
      <button
        type="button"
        aria-label="Next day"
        className={iconButton}
        disabled={isToday}
        onClick={() => onShift(1)}
      >
        <ChevronRight className="size-4" strokeWidth={1.75} />
      </button>
      <h2 className="ml-1.5 text-[17px] font-semibold tracking-tight" aria-live="polite">
        {formatDayLabel(day)}
      </h2>
      {isToday ? null : (
        <span className="ml-1 text-[12px] text-content/40">
          {day.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}
        </span>
      )}
      <div className="ml-auto flex items-center gap-1">
        {isToday ? null : (
          <button
            type="button"
            onClick={onToday}
            className="h-7 rounded-md px-2.5 text-[12px] text-content/60 transition-colors hover:bg-content/10 hover:text-content focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60"
          >
            Today
          </button>
        )}
        <button type="button" aria-label="Refresh" title="Refresh" className={iconButton} onClick={onRefresh}>
          <RefreshCw
            className={`size-3.5 ${refreshing ? "motion-safe:animate-spin" : ""}`}
            strokeWidth={1.75}
          />
        </button>
      </div>
    </nav>
  );
}

function NotesSwitch({ on }: { on: boolean }): ReactElement {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label="AI notes with Antigravity"
      title={on ? "Turn AI notes off" : "Turn AI notes on"}
      onClick={() => saveAiNotesEnabled(!on)}
      className={`relative h-4 w-7 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60 ${
        on ? "bg-accent" : "bg-content/20"
      }`}
    >
      <span
        aria-hidden
        className={`absolute top-0.5 size-3 rounded-full bg-white shadow-sm transition-transform duration-200 ${
          on ? "translate-x-3.5" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

function ActivityWatchHint({ reason }: { reason?: string }): ReactElement {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-dashed border-content/15 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-[12.5px] font-medium text-content/85">
          Add your own time, apps, and meetings
        </p>
        <p className="mt-0.5 text-[11.5px] leading-snug text-content/45">
          {reason ?? "ActivityWatch is not running."} It is free, open source, and keeps data on
          this machine. Hari reads it locally.
        </p>
      </div>
      <button
        type="button"
        onClick={() => {
          openUrl(ACTIVITYWATCH_URL).catch((err: unknown) =>
            console.warn("activity: could not open ActivityWatch site", err),
          );
        }}
        className="flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-content/15 px-2.5 text-[12px] text-content/80 transition-colors hover:bg-content/10 hover:text-content focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60"
      >
        Get ActivityWatch
        <ExternalLink className="size-3" strokeWidth={1.75} />
      </button>
    </div>
  );
}

function LoadingState(): ReactElement {
  return (
    <div aria-busy="true" aria-label="Loading activity" className="flex flex-col gap-5">
      <div className="h-[86px] rounded-lg bg-content/[0.05] motion-safe:animate-pulse" />
      <div className="h-[104px] rounded-lg bg-content/[0.05] motion-safe:animate-pulse" />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
        <div className="h-40 rounded-lg bg-content/[0.04] motion-safe:animate-pulse" />
        <div className="h-64 rounded-lg bg-content/[0.04] motion-safe:animate-pulse" />
      </div>
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }): ReactElement {
  return (
    <div role="alert" className="flex flex-col items-center gap-3 py-16 text-center">
      <CircleAlert className="size-6 text-content/35" strokeWidth={1.75} />
      <div>
        <p className="text-[13px] font-medium text-content">Could not load activity</p>
        <p className="mt-1 max-w-sm text-[12px] text-content/45">{message}</p>
      </div>
      <button
        type="button"
        onClick={onRetry}
        className="h-7 rounded-md border border-content/15 px-3 text-[12px] text-content/80 transition-colors hover:bg-content/10 hover:text-content focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60"
      >
        Try again
      </button>
    </div>
  );
}

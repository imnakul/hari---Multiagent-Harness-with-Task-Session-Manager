import { openUrl } from "@tauri-apps/plugin-opener";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { Activity, CircleAlert, ExternalLink } from "../../../shared/ui/icons";
import { SegmentedSwitch } from "../../../shared/ui/SegmentedSwitch";
import { OverlayNav } from "../../../app/shell/TitleBar";
import { WindowControls } from "../../../app/shell/WindowControls";
import { useAiNotesEnabled } from "../model/useActivityRecorder";
import { useLockOverscroll } from "../../../shared/hooks/useLockOverscroll";
import {
  activityTotals,
  agentSpans,
  buildLogItems,
  dailyTotals,
  dayRange,
  periodKey,
  periodPromptLabel,
  shiftDay,
  shiftPeriod,
  summarizeProjects,
  type ActivityLog,
  type ActivityScope,
} from "../model/activity";
import {
  filterAw,
  filterLog,
  loadSources,
  saveSources,
  type ActivitySource,
} from "../model/sources";
import { IS_MAC } from "../../../platform/tauri/platform";
import { ActivityLogFeed, type LogFilter } from "./ActivityLogFeed";
import { ActivityAskPanel, type AskStatus, type AskThread } from "./ActivityAskPanel";
import { AgentStatusPill } from "./AgentStatusPill";
import { AppsBreakdown, PhoneBreakdown, ProjectBreakdown, SitesBreakdown } from "./Breakdown";
import { DailyBars } from "./DailyBars";
import { DayTimeline } from "./DayTimeline";
import { PeriodNav } from "./PeriodNav";
import { PeriodNotes, PeriodSummaryCard } from "./PeriodSummary";
import { StatTiles } from "./StatTiles";
import { useActivityData } from "./useActivityData";

const ACTIVITYWATCH_URL = "https://activitywatch.net/";
const EMPTY_LOG: ActivityLog = { events: [], notes: [] };
/** Remember the viewed period while the app runs, like Notes remembers its note. */
type ActivityMode = "activity" | "ask";
const MODE_OPTIONS = [
  { id: "activity", label: "Activity" },
  { id: "ask", label: "Ask" },
] as const;
let remembered: {
  anchor: Date;
  scope: ActivityScope;
  logFilter: LogFilter;
  mode: ActivityMode;
} | null = null;
/** Keeps a focusable scrolling column (WCAG 2.1.1) without a heavy ring. */
const SCROLL_COLUMN =
  "min-w-0 rounded-md outline-none focus-visible:ring-1 focus-visible:ring-accent/60 lg:min-h-0 lg:overflow-y-auto lg:overscroll-contain lg:pr-1";

type Props = {
  /** Rendered as an inset-layout title tab, which supplies its own header. */
  tabbed?: boolean;
  /** False while a tabbed view sits behind another tab: no Escape handling. */
  active?: boolean;
  besideRail?: boolean;
  compactRail?: boolean;
  onClose: () => void;
  onToggleSidebar?: () => void;
  /** Open the chat a logged prompt came from. */
  onOpenSession?: (sessionId: string) => void;
  /** Open Settings at the Activity rows. */
  onOpenSettings?: () => void;
  /** Fork (L-396): the Ask tab's embedded chat, its state, thread list and actions. */
  askChat?: ReactNode;
  askStatus?: AskStatus;
  askThreads?: readonly AskThread[];
  askActiveId?: string | null;
  onAskOpen?: (id?: string, fresh?: boolean) => void;
  onAskDelete?: (id: string) => void;
};

/**
 * Activity: what you and your agents did on a day, week or month — headline
 * numbers, a timeline (day) or daily bars (week/month), per-project time, top
 * apps and sites, and a log with Antigravity notes or a period summary.
 */
export function ActivityView({
  tabbed = false,
  active = true,
  besideRail = false,
  compactRail = false,
  onClose,
  onToggleSidebar,
  onOpenSession,
  onOpenSettings,
  askChat = null,
  askStatus = "idle",
  askThreads = [],
  askActiveId = null,
  onAskOpen,
  onAskDelete,
}: Props): ReactElement {
  const [anchor, setAnchor] = useState<Date>(
    () => remembered?.anchor ?? shiftDay(new Date(), 0),
  );
  const [scope, setScope] = useState<ActivityScope>(() => remembered?.scope ?? "day");
  const [logFilter, setLogFilter] = useState<LogFilter>(() => remembered?.logFilter ?? "all");
  const [mode, setMode] = useState<ActivityMode>(() => remembered?.mode ?? "activity");
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const scrollLock = useLockOverscroll<HTMLDivElement>();
  const aiNotes = useAiNotesEnabled();
  const [sources, setSources] = useState<ActivitySource[]>(loadSources);
  const phoneOn = sources.includes("phone");
  const data = useActivityData(anchor, scope, phoneOn);
  const { log, aw, phone, agent, isLive } = data;
  const updateSources = (next: ActivitySource[]): void => {
    setSources(next);
    saveSources(next);
  };

  useEffect(() => {
    remembered = { anchor, scope, logFilter, mode };
  }, [anchor, scope, logFilter, mode]);

  const openDay = (start: number): void => {
    setAnchor(new Date(start));
    setScope("day");
    setLogFilter("all");
  };

  /** From "Notes by day": the day opens showing only its notes. */
  const openDayNotes = (start: number): void => {
    openDay(start);
    setLogFilter("notes");
  };

  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onCloseRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active]);

  const current = useMemo(() => filterLog(log.data ?? EMPTY_LOG, sources), [log.data, sources]);
  const totals = useMemo(() => activityTotals(current.events), [current]);
  const projects = useMemo(() => summarizeProjects(current.events), [current]);
  const items = useMemo(() => buildLogItems(current), [current]);
  const turns = useMemo(() => agentSpans(current.events), [current]);
  const awData = useMemo(() => (aw.data ? filterAw(aw.data, sources) : null), [aw.data, sources]);
  const phoneData = phoneOn ? phone.data : null;
  const phoneActiveMs = useMemo(
    () => (phoneData?.activeSpans ?? []).reduce((sum, span) => sum + (span.end - span.start), 0),
    [phoneData],
  );
  const days = useMemo(
    () => (scope === "day" ? [] : dailyTotals(data.range, current.events, awData)),
    [scope, data.range, current.events, awData],
  );
  const summaryKey = periodKey(anchor, scope);
  const awHint = awData && !awData.available ? "ActivityWatch not running" : undefined;
  const firstLoad = log.data == null && log.loading;

  return (
    <div
      role="region"
      aria-label="Activity"
      data-app-activity
      className="flex min-h-0 min-w-0 flex-1 flex-col text-content"
    >
      {tabbed ? (
        <div className="flex h-10 shrink-0 items-center justify-end gap-2 border-b border-stroke px-3">
          <AgentStatusPill
            status={agent}
            aiNotes={aiNotes}
            onRetry={data.retryNotes}
            onOpenSettings={onOpenSettings}
          />
        </div>
      ) : (
        <div
          data-app-view-header
          className="flex h-10 shrink-0 select-none items-center border-b border-stroke"
          data-tauri-drag-region="deep"
        >
          {IS_MAC && compactRail ? <div className="w-4 shrink-0" /> : null}
          {IS_MAC && !besideRail ? <div className="w-[78px] shrink-0" /> : null}
          {besideRail ? null : <OverlayNav onBack={onClose} onToggleSidebar={onToggleSidebar} />}
          <div className="flex min-w-0 flex-1 items-center gap-2 px-3 text-[13px]">
            <Activity className="size-3.5 shrink-0 text-content/45" strokeWidth={1.75} />
            <span className="min-w-0 truncate text-content">Activity</span>
          </div>
          <div className="flex shrink-0 items-center gap-2 pr-2">
            <AgentStatusPill
              status={agent}
              aiNotes={aiNotes}
              onRetry={data.retryNotes}
              onOpenSettings={onOpenSettings}
            />
          </div>
          {IS_MAC ? null : <WindowControls />}
        </div>
      )}

      {onAskOpen && onAskDelete ? (
        <div className="flex h-10 shrink-0 items-center border-b border-stroke px-3">
          <SegmentedSwitch ariaLabel="Activity view" options={MODE_OPTIONS} value={mode} onChange={setMode} />
        </div>
      ) : null}

      {onAskOpen && onAskDelete && mode === "ask" ? (
        <ActivityAskPanel
          chat={askChat}
          status={askStatus}
          threads={askThreads}
          activeId={askActiveId}
          onOpen={onAskOpen}
          onDelete={onAskDelete}
        />
      ) : (
      <div className="flex min-h-0 flex-1 flex-col">
        {/* The fixed top (fork, L-399): the period, headline numbers and timeline stay put. */}
        <div className="mx-auto flex w-full max-w-[1120px] shrink-0 flex-col gap-5 px-4 pt-5 sm:px-6">
          <PeriodNav
            anchor={anchor}
            scope={scope}
            isLive={isLive}
            refreshing={log.loading || aw.loading || phone.loading}
            onScope={setScope}
            onShift={(delta) => setAnchor((a) => shiftPeriod(a, scope, delta))}
            onJump={(date) => setAnchor(shiftDay(date, 0))}
            onRefresh={data.refresh}
            sources={sources}
            onSources={updateSources}
          />
          {!(log.error && !log.data) && !firstLoad ? (
            <>
              <StatTiles
                totals={totals}
                aw={awData?.available ? awData : null}
                phoneMs={phoneOn ? phoneActiveMs : null}
                showAgents={sources.includes("monocode")}
              />
              {awData && !awData.available ? <ActivityWatchHint reason={awData.error} /> : null}
              {scope === "day" ? (
                <DayTimeline
                  day={data.range}
                  active={awData?.activeSpans ?? []}
                  agents={turns}
                  meetings={awData?.meetings ?? []}
                  phone={phoneOn ? (phoneData?.activeSpans ?? []) : null}
                  now={isLive ? Date.now() : null}
                  awHint={awHint}
                />
              ) : (
                <DailyBars
                  days={days}
                  showDesktop={awData?.available === true}
                  today={dayRange(new Date()).start}
                  onOpenDay={openDay}
                />
              )}
            </>
          ) : null}
        </div>

        {/* Below the top: two columns that scroll on their own; one column on a narrow window. */}
        <div
          ref={scrollLock}
          className="relative min-h-0 flex-1 overflow-y-auto overscroll-none lg:overflow-hidden"
        >
          {log.error && !log.data ? (
            <div className="mx-auto w-full max-w-[1120px] px-4 py-5 sm:px-6">
              <ErrorState message={log.error} onRetry={data.refresh} />
            </div>
          ) : firstLoad ? (
            <div className="mx-auto w-full max-w-[1120px] px-4 py-5 sm:px-6">
              <LoadingState />
            </div>
          ) : (
            <div className="mx-auto grid w-full max-w-[1120px] grid-cols-1 gap-6 px-4 py-5 sm:px-6 lg:absolute lg:inset-x-0 lg:inset-y-0 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:py-4">
              <div
                tabIndex={0}
                role="region"
                aria-label="Time breakdown"
                className={`flex flex-col gap-6 ${SCROLL_COLUMN}`}
              >
                {sources.includes("monocode") ? <ProjectBreakdown projects={projects} /> : null}
                {sources.includes("browser") || sources.includes("other") ? (
                  <AppsBreakdown aw={awData} />
                ) : null}
                {sources.includes("browser") ? <SitesBreakdown aw={awData} /> : null}
                {phoneOn ? (
                  <PhoneBreakdown phone={phoneData} loading={phone.loading} failed={phone.error != null} />
                ) : null}
              </div>
              <div
                tabIndex={0}
                role="region"
                aria-label={summaryKey ? "Period summary" : "Activity log"}
                className={`flex flex-col gap-6 ${SCROLL_COLUMN}`}
              >
                {summaryKey ? (
                  <>
                    <PeriodSummaryCard
                      periodKey={summaryKey}
                      label={periodPromptLabel(anchor, scope)}
                      range={data.range}
                      notesEnabled={aiNotes}
                      hasActivity={current.events.length > 0 || current.notes.length > 0}
                    />
                    <PeriodNotes notes={current.notes} onOpenDay={openDayNotes} />
                  </>
                ) : (
                  <ActivityLogFeed
                    items={items}
                    agent={agent}
                    filter={logFilter}
                    onFilter={setLogFilter}
                    onRetry={data.retryNotes}
                    onOpenSession={onOpenSession}
                  />
                )}
              </div>
            </div>
          )}
        </div>
      </div>
      )}
    </div>
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

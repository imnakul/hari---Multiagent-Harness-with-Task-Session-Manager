import {
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactElement,
} from "react";
import type { SessionSummary } from "../../sessions/data/sessionStore";
import { SecondaryButton } from "../../../shared/ui/SecondaryButton";
import { SegmentedSwitch } from "../../../shared/ui/SegmentedSwitch";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import {
  clearTrace,
  getTrace,
  sanitizedReport,
  setCapture,
  subscribeTrace,
} from "../model/trace";
import { turnMeasurements } from "../model/analysis";
import type { LocalEvidence } from "../model/evidence";
import { LocalEvidencePanel } from "./LocalEvidencePanel";
import { QuotaPanel } from "./QuotaPanel";
import { UsageTable } from "./UsageTable";
import { TimelinePanel } from "./TimelinePanel";

type View = "overview" | "timeline" | "local" | "quota";
const VIEWS = [
  { id: "overview", label: "Overview" },
  { id: "timeline", label: "Timeline" },
  { id: "local", label: "Local evidence" },
  { id: "quota", label: "Quota" },
] as const;

export function DebugInspector({
  sessions,
}: {
  sessions: readonly SessionSummary[];
}): ReactElement {
  const snapshot = useSyncExternalStore(subscribeTrace, getTrace, getTrace);
  const [view, setView] = useState<View>("overview");
  const [sessionId, setSessionId] = useState("");
  const [local, setLocal] = useState<LocalEvidence>();
  const [reportState, setReportState] = useState("");
  const sessionOptions = useMemo(() => {
    const options = new Map(
      sessions.map((session) => [
        session.id,
        { value: session.id, label: session.title || session.id },
      ]),
    );
    for (const event of snapshot.events)
      if (event.sessionId && !options.has(event.sessionId))
        options.set(event.sessionId, {
          value: event.sessionId,
          label: event.sessionId,
        });
    return [{ value: "", label: "All sessions" }, ...options.values()];
  }, [sessions, snapshot.events]);
  const events = snapshot.events.filter(
    (event) => !sessionId || event.sessionId === sessionId,
  );
  const counts = [
    ["Submissions", "submission"],
    ["Dispatch attempts", "dispatch"],
    ["Observed responses", "response"],
    ["Tool calls", "tool"],
    ["Process launches", "process-launch"],
    ["Helper operations", "helper"],
  ] as const;
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(sanitizedReport(snapshot, local));
      setReportState(
        "Sanitized report copied. Identifiers are replaced with report-local aliases.",
      );
    } catch {
      setReportState(
        "Copy failed. Use Export report to save the sanitized file.",
      );
    }
  };
  const exportReport = (): void => {
    const url = URL.createObjectURL(
      new Blob([sanitizedReport(snapshot, local)], {
        type: "application/json",
      }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "monocode-debug-inspector.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setReportState("Sanitized report exported. Review before sharing.");
  };
  return (
    <div className="space-y-5 p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <span className="inline-flex items-center gap-2 text-xs font-medium text-content">
            <span
              className={`size-1.5 rounded-full ${snapshot.enabled ? "bg-accent" : "bg-content/35"}`}
            />
            {snapshot.enabled ? "Capturing metadata" : "Capture paused"}
          </span>
          <p className="mt-1 text-xs text-content/40">
            Memory only · this window ·{" "}
            {snapshot.events.length.toLocaleString()} / 2,000 events
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <SecondaryButton onClick={() => setCapture(!snapshot.enabled)}>
            {snapshot.enabled ? "Pause capture" : "Resume capture"}
          </SecondaryButton>
          <SecondaryButton
            onClick={() => {
              clearTrace();
            }}
          >
            Clear buffer
          </SecondaryButton>
          <SecondaryButton
            onClick={() => {
              void copy();
            }}
          >
            Copy report
          </SecondaryButton>
          <SecondaryButton onClick={exportReport}>
            Export report
          </SecondaryButton>
        </div>
      </div>
      {reportState ? (
        <p role="status" className="text-xs text-content/60">
          {reportState}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-content/10 pb-4">
        <div className="max-w-full overflow-x-auto">
          <SegmentedSwitch
            options={VIEWS}
            value={view}
            onChange={setView}
            ariaLabel="Debug Inspector views"
          />
        </div>
        <SearchableSelect
          label="Inspector session"
          value={sessionId}
          onChange={(value) => {
            setSessionId(value);
            setLocal(undefined);
          }}
          options={sessionOptions}
          variant="pill"
        />
      </div>
      {view === "overview" ? (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {counts.map(([label, kind]) => (
              <div
                key={kind}
                className="rounded-lg border border-content/10 bg-content/3 px-4 py-3"
              >
                <p className="text-2xl font-semibold tabular-nums text-content">
                  {events
                    .filter(
                      (event) =>
                        event.kind === kind ||
                        (kind === "tool" && event.kind === "subagent-tool"),
                    )
                    .length.toLocaleString()}
                </p>
                <p className="mt-1 text-xs text-content/45">{label}</p>
                {kind === "submission" ? (
                  <p className="mt-1 text-xs text-content/35">
                    {
                      events.filter(
                        (event) =>
                          event.kind === "submission" &&
                          event.authorship === "user",
                      ).length
                    }{" "}
                    user ·{" "}
                    {
                      events.filter(
                        (event) =>
                          event.kind === "submission" &&
                          event.authorship === "automation",
                      ).length
                    }{" "}
                    automation
                  </p>
                ) : null}
              </div>
            ))}
          </div>
          <div className="space-y-2">
            <h2 className="text-sm font-semibold text-content">
              Reported turn usage
            </h2>
            <p className="text-xs leading-relaxed text-content/50">
              Latest reported aggregate per dispatch: raw Claude SDK result or
              normalized turn usage from other adapters. Message and cumulative
              measurements are separate in Timeline. Helpers without usage stay
              unknown. Streaming chunks are never counted as responses.
            </p>
            <UsageTable measurements={turnMeasurements(events)} aggregate />
          </div>
          <Coverage dropped={snapshot.dropped} />
          {!events.length ? (
            <p className="rounded-lg border border-dashed border-content/15 p-6 text-sm text-content/50">
              No activity captured for this selection. Existing sessions
              continue normally. Use Local evidence to inspect an accessible
              saved native transcript.
            </p>
          ) : null}
        </>
      ) : null}
      {view === "timeline" ? (
        <TimelinePanel key={sessionId} allEvents={events} />
      ) : null}
      {view === "local" ? (
        <LocalEvidencePanel
          sessionId={sessionId}
          sessions={sessions}
          onEvidence={setLocal}
        />
      ) : null}
      {view === "quota" ? (
        <QuotaPanel snapshot={snapshot} local={local} />
      ) : null}
    </div>
  );
}

function Coverage({ dropped }: { dropped: number }): ReactElement {
  return (
    <div className="rounded-lg bg-content/5 p-4 text-xs leading-relaxed text-content/55">
      <h2 className="font-semibold text-content/80">Evidence coverage</h2>
      <p className="mt-1">
        Shared local harness dispatch, tool lifecycle, process launches/exits
        and helper boundaries are observed across providers. Claude exposes
        message/result usage and explicit compaction; Codex exposes completed
        item IDs and cumulative usage. Other providers expose only fields their
        adapters report. Tool labels use safe categories where native names are
        unavailable.
      </p>
      <p className="mt-2">
        Observed responses are not actual network requests. Opaque CLIs may hide
        retries, helpers or cache behavior. Remote-host/cloud execution is
        outside this window’s local trace. RC turns are labeled only where the
        adapter identifies external activity. Pause, restart, unobserved windows
        and retention create gaps; {dropped.toLocaleString()} events were
        evicted. Clearing diagnostics never clears agents, transcripts or quota.
      </p>
    </div>
  );
}

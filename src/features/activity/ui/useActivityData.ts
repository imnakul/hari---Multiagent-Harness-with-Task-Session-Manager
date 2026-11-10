import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ACTIVITY_AGENT_STATUS_EVENT,
  ACTIVITY_CHANGED_EVENT,
  isCurrentPeriod,
  loadActivityLog,
  loadActivityWatch,
  loadAgentStatus,
  periodRange,
  retryAgent,
  type ActivityScope,
  type ActivityLog,
  type AgentStatus,
  type AwSummary,
  type Span,
} from "../model/activity";

/** Async slice that keeps showing the last good data while it reloads. */
export type Loadable<T> = {
  data: T | null;
  loading: boolean;
  error: string | null;
};

const EMPTY: Loadable<never> = { data: null, loading: true, error: null };
/**
 * ActivityWatch has no push channel, so the current period polls it. A week or
 * month re-reads many more events per poll, so it polls far less often.
 */
const AW_POLL_MS: Record<ActivityScope, number> = {
  day: 60_000,
  week: 10 * 60_000,
  month: 10 * 60_000,
};
/** Coalesce bursts of `activity-changed` (prompt + note land together). */
const CHANGE_DEBOUNCE_MS = 250;

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export type ActivityData = {
  range: Span;
  /** The period holds "now", so it can still change. */
  isLive: boolean;
  log: Loadable<ActivityLog>;
  aw: Loadable<AwSummary>;
  agent: AgentStatus | null;
  refresh: () => void;
  retryNotes: () => void;
};

/**
 * Loads a day, week or month of activity: the event/note log from
 * `activity.db`, the ActivityWatch summary, and the notes worker status. The
 * current period stays live via Rust events and a light ActivityWatch poll;
 * responses for a period the user already left are dropped.
 */
export function useActivityData(anchor: Date, scope: ActivityScope): ActivityData {
  // Key on the period's start so a new Date for the same period keeps the range.
  const periodStart = periodRange(anchor, scope).start;
  const range = useMemo(
    () => periodRange(new Date(periodStart), scope),
    [periodStart, scope],
  );
  const isLive = isCurrentPeriod(anchor, scope);

  const [log, setLog] = useState<Loadable<ActivityLog>>(EMPTY);
  const [aw, setAw] = useState<Loadable<AwSummary>>(EMPTY);
  const [agent, setAgent] = useState<AgentStatus | null>(null);
  const generation = useRef(0);

  const loadLog = useCallback(
    (gen: number) => {
      setLog((prev) => ({ ...prev, loading: true }));
      loadActivityLog(range).then(
        (data) => {
          if (gen === generation.current) setLog({ data, loading: false, error: null });
        },
        (err: unknown) => {
          if (gen === generation.current) {
            setLog((prev) => ({ ...prev, loading: false, error: message(err) }));
          }
        },
      );
    },
    [range],
  );

  const loadAw = useCallback(
    (gen: number) => {
      setAw((prev) => ({ ...prev, loading: true }));
      loadActivityWatch(range).then(
        (data) => {
          if (gen === generation.current) setAw({ data, loading: false, error: null });
        },
        (err: unknown) => {
          if (gen === generation.current) {
            setAw((prev) => ({ ...prev, loading: false, error: message(err) }));
          }
        },
      );
    },
    [range],
  );

  // New period: drop the previous one's data so stale numbers never show.
  useEffect(() => {
    const gen = ++generation.current;
    setLog(EMPTY);
    setAw(EMPTY);
    loadLog(gen);
    loadAw(gen);
  }, [loadLog, loadAw]);

  useEffect(() => {
    let cancelled = false;
    loadAgentStatus().then(
      (status) => {
        if (!cancelled) setAgent(status);
      },
      (err: unknown) => console.warn("activity: status failed", err),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  // Live updates for the current period only; a past one cannot change.
  useEffect(() => {
    if (!isLive) return;
    let timer: number | null = null;
    const unlisten: Array<Promise<() => void>> = [
      listen(ACTIVITY_CHANGED_EVENT, () => {
        if (timer != null) window.clearTimeout(timer);
        timer = window.setTimeout(() => loadLog(generation.current), CHANGE_DEBOUNCE_MS);
      }),
      listen<AgentStatus>(ACTIVITY_AGENT_STATUS_EVENT, (event) => setAgent(event.payload)),
    ];
    const poll = window.setInterval(() => loadAw(generation.current), AW_POLL_MS[scope]);
    return () => {
      if (timer != null) window.clearTimeout(timer);
      window.clearInterval(poll);
      for (const pending of unlisten) {
        void pending.then((off) => off());
      }
    };
  }, [isLive, scope, loadLog, loadAw]);

  const refresh = useCallback(() => {
    loadLog(generation.current);
    loadAw(generation.current);
  }, [loadLog, loadAw]);

  const retryNotes = useCallback(() => {
    retryAgent().then(setAgent, (err: unknown) =>
      console.warn("activity: retry failed", err),
    );
  }, []);

  return { range, isLive, log, aw, agent, refresh, retryNotes };
}

import { useEffect, useRef, useSyncExternalStore } from "react";
import {
  collectActivityEvents,
  configureAgent,
  createRecorderState,
  loadAiNotesEnabled,
  loadTrackerEnabled,
  recordActivity,
  subscribeAiNotesEnabled,
  subscribeTrackerEnabled,
  tzOffsetMinutes,
} from "./activity";
import type { Session } from "../../sessions/model/session";

/** Live value of the "AI notes" setting, kept in sync across the app. */
export function useAiNotesEnabled(): boolean {
  return useSyncExternalStore(
    subscribeAiNotesEnabled,
    loadAiNotesEnabled,
    loadAiNotesEnabled,
  );
}

/** Live value of the Activity tracker master switch. */
export function useTrackerEnabled(): boolean {
  return useSyncExternalStore(
    subscribeTrackerEnabled,
    loadTrackerEnabled,
    loadTrackerEnabled,
  );
}

/**
 * Watches live sessions and records each new prompt and finished agent turn
 * to the local activity log. Mount once, at the app root.
 *
 * Also keeps the Rust notes worker's on/off state in sync with the settings.
 * With the tracker switched off it records nothing and stops the worker.
 * Recording is fire-and-forget: a failed write is logged, never surfaced in
 * the chat UI, because the activity log must not get in the way of work.
 */
export function useActivityRecorder(sessions: readonly Session[]): void {
  const stateRef = useRef(createRecorderState());
  const aiNotes = useAiNotesEnabled();
  const enabled = useTrackerEnabled();

  useEffect(() => {
    configureAgent(enabled && aiNotes).catch((err: unknown) => {
      console.warn("activity: could not configure notes agent", err);
    });
  }, [enabled, aiNotes]);

  useEffect(() => {
    // Off means off: forget what was seen so turning it back on starts fresh
    // instead of back-filling everything that happened meanwhile.
    if (!enabled) {
      stateRef.current = createRecorderState();
      return;
    }
    const events = collectActivityEvents(
      stateRef.current,
      sessions,
      Date.now(),
      tzOffsetMinutes(),
    );
    for (const event of events) {
      recordActivity(event).catch((err: unknown) => {
        console.warn("activity: could not record event", err);
      });
    }
  }, [sessions, enabled]);
}

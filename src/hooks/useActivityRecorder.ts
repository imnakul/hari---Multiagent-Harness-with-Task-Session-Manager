import { useEffect, useRef, useSyncExternalStore } from "react";
import {
  collectActivityEvents,
  configureAgent,
  createRecorderState,
  loadAiNotesEnabled,
  recordActivity,
  subscribeAiNotesEnabled,
  tzOffsetMinutes,
} from "../lib/activity";
import type { Session } from "../lib/session";

/** Live value of the "AI notes" setting, kept in sync across the app. */
export function useAiNotesEnabled(): boolean {
  return useSyncExternalStore(
    subscribeAiNotesEnabled,
    loadAiNotesEnabled,
    loadAiNotesEnabled,
  );
}

/**
 * Watches live sessions and records each new prompt and finished agent turn
 * to the local activity log. Mount once, at the app root.
 *
 * Also keeps the Rust notes worker's on/off state in sync with the setting.
 * Recording is fire-and-forget: a failed write is logged, never surfaced in
 * the chat UI, because the activity log must not get in the way of work.
 */
export function useActivityRecorder(sessions: readonly Session[]): void {
  const stateRef = useRef(createRecorderState());
  const aiNotes = useAiNotesEnabled();

  useEffect(() => {
    configureAgent(aiNotes).catch((err: unknown) => {
      console.warn("activity: could not configure notes agent", err);
    });
  }, [aiNotes]);

  useEffect(() => {
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
  }, [sessions]);
}

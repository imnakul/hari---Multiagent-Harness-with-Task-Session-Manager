import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import {
  awayLongerThan,
  recordSessionSeen,
  sessionLastSeen,
} from "../model/sessionLastSeen";
import type { SessionMetadata } from "../model/sessionMetadata";
import { SessionMetadataBody } from "./SessionMetadataHoverCard";

/** How often an uncovered pane checks whether it has gone idle. */
const IDLE_CHECK_MS = 5_000;

export type IdleCoverState = {
  /** The pane is idle and covered. */
  covered: boolean;
  /** Covered, but the pointer moved over the pane: the content shows through. */
  peeking: boolean;
};

/**
 * Idle cover (fork, L-185): after `idleMs` with no activity in the element
 * `root`, the pane is covered. Moving the pointer over a covered pane peeks
 * until it leaves; a click, key, scroll or touch uncovers it and restarts the
 * wait. Pointer movement on an uncovered pane counts as activity. `idleMs`
 * null, or `enabled` false, keeps the pane uncovered; each time the pane
 * becomes eligible again the wait starts over.
 *
 * `seenKey` (L-190) is the chat's id while it is on screen, else null. When a
 * chat comes on screen after being away longer than `idleMs` (or never
 * recorded), it starts covered; when it leaves, the time is recorded.
 */
export function useIdleCover(
  root: RefObject<HTMLElement | null>,
  idleMs: number | null,
  enabled: boolean,
  seenKey: string | null = null,
): IdleCoverState {
  const active = enabled && idleMs != null;
  const [covered, setCovered] = useState(false);
  const [peeking, setPeeking] = useState(false);
  const lastActivity = useRef(Date.now());
  const coveredRef = useRef(false);
  coveredRef.current = covered;
  const idleMsRef = useRef(idleMs);
  idleMsRef.current = idleMs;
  // One-shot: decided when the chat comes on screen, used by the next start.
  const coverOnArrival = useRef(false);

  useEffect(() => {
    if (!seenKey) return;
    const wait = idleMsRef.current;
    coverOnArrival.current = wait != null && awayLongerThan(seenKey, wait);
    return () => {
      // Still covered: you have not looked since the last activity.
      recordSessionSeen(
        seenKey,
        coveredRef.current ? lastActivity.current : Date.now(),
      );
    };
  }, [seenKey]);

  useEffect(() => {
    const arriveCovered = active && coverOnArrival.current;
    coverOnArrival.current = false;
    lastActivity.current = arriveCovered && seenKey
      ? (sessionLastSeen(seenKey) ?? 0)
      : Date.now();
    setCovered(arriveCovered);
    setPeeking(false);
    if (!active) return;
    const element = root.current;
    if (!element) return;
    const uncover = (): void => {
      lastActivity.current = Date.now();
      setCovered(false);
      setPeeking(false);
    };
    const onMove = (): void => {
      if (coveredRef.current) setPeeking(true);
      else lastActivity.current = Date.now();
    };
    const onLeave = (): void => setPeeking(false);
    const timer = window.setInterval(() => {
      if (
        !coveredRef.current &&
        Date.now() - lastActivity.current >= (idleMs ?? Infinity)
      )
        setCovered(true);
    }, Math.min(IDLE_CHECK_MS, idleMs ?? IDLE_CHECK_MS));
    const events = ["pointerdown", "keydown", "wheel", "touchstart"] as const;
    for (const type of events)
      element.addEventListener(type, uncover, { capture: true, passive: true });
    element.addEventListener("pointermove", onMove, { passive: true });
    element.addEventListener("pointerleave", onLeave);
    return () => {
      window.clearInterval(timer);
      for (const type of events)
        element.removeEventListener(type, uncover, { capture: true });
      element.removeEventListener("pointermove", onMove);
      element.removeEventListener("pointerleave", onLeave);
    };
  }, [active, idleMs, root, seenKey]);

  return active ? { covered, peeking: covered && peeking } : { covered: false, peeking: false };
}

/**
 * The blur and centred metadata card over an idle pane (L-185). While
 * `peeking` it fades out and lets the pointer through, so the next click
 * lands on the content (and uncovers the pane).
 */
export function SessionIdleCover({
  state,
  metadata,
  title,
}: {
  state: IdleCoverState;
  metadata: SessionMetadata;
  title: string;
}): ReactNode {
  return (
    <div
      data-session-idle-cover={state.covered ? (state.peeking ? "peek" : "on") : "off"}
      aria-hidden={!state.covered || state.peeking}
      className="session-idle-cover absolute inset-0 z-30 grid place-items-center p-6"
    >
      <div
        role="note"
        aria-label="Session metadata"
        className="session-idle-cover-card max-h-[70%] w-full max-w-md overflow-y-auto rounded-xl border border-stroke bg-background-base px-5 py-4 shadow-lg"
      >
        <SessionMetadataBody metadata={metadata} title={title} />
        <p className="mt-3 text-[11px] text-content/40">
          Hover to peek, click to show the session.
        </p>
      </div>
    </div>
  );
}

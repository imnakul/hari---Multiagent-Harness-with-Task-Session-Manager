import { LOST_AFTER_MS } from "@/features/liveUpdates/liveCards";

/** Fork (Hari, L-367): how the link to the computer has gone this run. */
export type WatchLink =
  /** Not reached yet since Hari opened: the computer may be off. */
  | { phase: "never" }
  | { phase: "up" }
  /** Answered before, not since `since` (ms). */
  | { phase: "lost"; since: number };

/** The link after the connection reports in. */
export function nextWatchLink(link: WatchLink, connected: boolean, now: number): WatchLink {
  if (connected) return link.phase === "up" ? link : { phase: "up" };
  return link.phase === "up" ? { phase: "lost", since: now } : link;
}

/**
 * Fork (Hari, L-367): whether the always-on "Watching your computer" service
 * should run. Only while MonoCode answers: with no computer to hear from it
 * can show nothing, so it only costs battery. A short drop (Wi-Fi switching,
 * the phone waking) is waited out for as long as the session cards wait
 * (`LOST_AFTER_MS`). Once it stops, Android won't let it start again from
 * the background: opening Hari with the computer reachable turns it back on.
 */
export function shouldWatch(options: { wanted: boolean; link: WatchLink; now: number }): boolean {
  const { wanted, link, now } = options;
  if (!wanted) return false;
  if (link.phase === "up") return true;
  if (link.phase === "never") return false;
  return now - link.since < LOST_AFTER_MS;
}

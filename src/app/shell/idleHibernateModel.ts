/** Fork (Hari, L-292): how long nothing works before the notice, and the notice itself. */
export const IDLE_GRACE_MS = 2 * 60_000;
export const IDLE_NOTICE_MS = 30_000;

export type IdlePhase =
  | { kind: "off" }
  | { kind: "waiting" }
  | { kind: "notice"; seconds: number }
  | { kind: "now" };

/** Where the countdown is, given when the chats went quiet (null: armed off or busy). */
export function idlePhase(idleSince: number | null, now: number): IdlePhase {
  if (idleSince == null) return { kind: "off" };
  const quiet = now - idleSince;
  if (quiet < IDLE_GRACE_MS) return { kind: "waiting" };
  const left = IDLE_GRACE_MS + IDLE_NOTICE_MS - quiet;
  if (left <= 0) return { kind: "now" };
  return { kind: "notice", seconds: Math.ceil(left / 1000) };
}

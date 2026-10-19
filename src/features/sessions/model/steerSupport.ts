import { canSteerHarness } from "../../../integrations/harness/core/registry";
import { isClaudeInteractive } from "../../../integrations/harness/providers/claude/claudeInteractiveProtocol";
import type { Session } from "./session";

type SteerTarget = Pick<Session, "harness" | "modelSettings">;

/** Interactive Claude runs the native CLI, one composer turn at a time. */
export function isInteractiveClaudeSession(session: SteerTarget): boolean {
  return session.harness === "claude" && isClaudeInteractive(session.modelSettings);
}

/**
 * True while Interactive Claude works on a turn the app did not send, such as
 * a background continuation. The session is not busy then, but Claude refuses
 * new input until it is idle, so follow-ups must queue (fork, L-121).
 */
export function isInteractiveClaudeWorkingElsewhere(
  session: SteerTarget & Pick<Session, "externalTurnId">,
): boolean {
  return !!session.externalTurnId && isInteractiveClaudeSession(session);
}

/**
 * True when this session's running turn accepts a follow-up mid-turn.
 *
 * Steer support is a harness capability, but Interactive Claude rejects
 * steers, and a rejected steer fails the running turn. Busy follow-ups for
 * those sessions must be queued instead (fork, L-100).
 */
export function canSteerSession(session: SteerTarget): boolean {
  return !isInteractiveClaudeSession(session) && canSteerHarness(session.harness);
}

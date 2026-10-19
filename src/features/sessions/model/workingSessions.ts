import type { Session } from "./session";

type WorkingTarget = Pick<Session, "busy" | "externalTurnId">;

/**
 * True while a session shows as working in the sidebar: a local turn, or a
 * turn the app did not send (phone, Interactive Claude background work).
 * Presentation only; submission, stop and auto-resume use `busy` alone
 * (fork, L-122).
 */
export function isSessionWorking(session: WorkingTarget): boolean {
  return !!session.busy || !!session.externalTurnId;
}

/** Project folders with a working session, for the project shimmer. */
export function workingProjectPaths(
  sessions: readonly (WorkingTarget & Pick<Session, "cwd">)[],
): string[] {
  return sessions.flatMap((session) =>
    isSessionWorking(session) && session.cwd ? [session.cwd] : [],
  );
}

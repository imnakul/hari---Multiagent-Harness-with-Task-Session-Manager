import type { Session } from "../../features/sessions/model/session";
import { sessionNeedsInput } from "../../features/sessions/model/session";

export type OwnedProcess = {
  root: {
    id: string;
    pid: number;
    cwd: string;
    kind: "interactive" | "structured" | "terminal";
    idleMs: number;
  };
  cpu: number | null;
  memory: number | null;
  processes: number;
  status: "live" | "unavailable" | "exited";
};
export function processSessionId(row: OwnedProcess): string {
  return row.root.kind === "interactive"
    ? row.root.id.replace(/^claude-interactive:/, "")
    : row.root.id;
}
export function processIdleCandidate(
  row: OwnedProcess,
  session?: Session,
): boolean {
  // Let recent native output settle; manual row Stop can interrupt any work.
  return (
    row.status === "live" &&
    row.root.idleMs >= 2000 &&
    row.processes === 1 &&
    !!session &&
    !session.busy &&
    !session.backgroundTasks?.length &&
    !session.pendingForm &&
    !sessionNeedsInput(session)
  );
}
export function retainExitedProcesses(
  previous: OwnedProcess[],
  current: OwnedProcess[],
): OwnedProcess[] {
  const keys = new Set(current.map((r) => `${r.root.id}:${r.root.pid}`));
  return [
    ...current,
    ...previous
      .filter(
        (r) => r.status !== "exited" && !keys.has(`${r.root.id}:${r.root.pid}`),
      )
      .map((r): OwnedProcess => ({
        ...r,
        status: "exited",
        cpu: null,
        memory: null,
      })),
  ];
}
export function processMemory(bytes: number | null): string {
  if (bytes == null) return "unavailable";
  return bytes >= 1024 ** 3
    ? `${(bytes / 1024 ** 3).toFixed(1)} GiB`
    : `${Math.round(bytes / 1024 ** 2)} MiB`;
}
export function processIdleAge(ms: number): string {
  return ms < 1000
    ? "active now"
    : ms < 60000
      ? `idle ${Math.floor(ms / 1000)}s`
      : `idle ${Math.floor(ms / 60000)}m`;
}

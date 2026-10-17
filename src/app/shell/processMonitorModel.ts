import type { Session } from "../../features/sessions/model/session";
import { sessionNeedsInput } from "../../features/sessions/model/session";

/** One process inside a row, in tree order (`depth` 0 is the row's root). */
export type ProcessDetail = {
  pid: number;
  parent: number;
  /** Executable or command name; empty when the OS gives none. */
  name: string;
  depth: number;
  cpu: number | null;
  memory: number | null;
};
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
  children: ProcessDetail[];
};
/** MonoCode's own process tree (host and web view), minus the owned rows. */
export type AppProcess = {
  pid: number;
  /** Null until a second sample, or when no app process could be read. */
  cpu: number | null;
  memory: number | null;
  processes: number;
  /** Processes counted but not readable; `cpu`/`memory` sum the rest. */
  unreadable: number;
  children: ProcessDetail[];
};
export type ProcessMonitorStats = { app: AppProcess; owned: OwnedProcess[] };
/** Chip total: app plus live owned rows; null when any part is not known yet. */
export function processTotals(
  app: AppProcess,
  rows: OwnedProcess[],
): { cpu: number | null; memory: number | null } {
  const live = rows.filter((r) => r.status !== "exited");
  const parts = [app, ...live];
  return {
    cpu: parts.every((p) => p.cpu != null)
      ? parts.reduce((n, p) => n + (p.cpu ?? 0), 0)
      : null,
    memory: parts.every((p) => p.memory != null)
      ? parts.reduce((n, p) => n + (p.memory ?? 0), 0)
      : null,
  };
}
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
        children: [],
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
/**
 * Friendly label for a listed process. WebView2 children share one exe name; only
 * the browser process (direct child of the app) is distinguishable without reading
 * each process's command line.
 */
export function processLabel(detail: ProcessDetail, appPid: number): string {
  if (detail.name.toLowerCase() === "msedgewebview2.exe")
    return detail.parent === appPid ? "Web view (main)" : "Web view helper";
  return detail.name || "Unnamed process";
}

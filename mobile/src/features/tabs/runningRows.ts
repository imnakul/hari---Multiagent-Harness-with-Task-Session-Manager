// Fork (Hari, L-412): what the Running tab lists, built from the catalog.
import { isRunning } from "@/features/liveUpdates/liveCards";
import type { Mono, Project, SessionSummary } from "@/features/workspace/types";

export type RunningRow =
  | { kind: "session"; key: string; session: SessionSummary; name: string; needsYou: boolean; at: number }
  | { kind: "mono"; key: string; mono: Mono; name: string; needsYou: boolean; at: number };

/**
 * Every running or waiting project session, and every Mono that isn't idle:
 * those needing the user first, then the most recently active.
 */
export function runningRows(
  sessions: readonly SessionSummary[],
  monos: readonly Mono[],
  projectsById: ReadonlyMap<string, Project>,
): RunningRow[] {
  const rows: RunningRow[] = [];
  for (const session of sessions) {
    if (!isRunning(session)) continue;
    rows.push({
      kind: "session",
      key: `session:${session.id}`,
      session,
      name: projectsById.get(session.projectId)?.name ?? "Project",
      needsYou: !!session.waiting,
      at: session.updatedAt,
    });
  }
  for (const mono of monos) {
    if (mono.status === "idle") continue;
    rows.push({
      kind: "mono",
      key: `mono:${mono.id}`,
      mono,
      name: mono.name,
      needsYou: mono.status === "needs-you",
      at: mono.lastActiveAt,
    });
  }
  return rows.sort((a, b) => Number(b.needsYou) - Number(a.needsYou) || b.at - a.at);
}

export type RunningGroup = {
  /** `project:<id>`, or `monos` for the Monos at work. */
  key: string;
  title: string;
  project?: Project;
  rows: RunningRow[];
  /** How many in the group wait on the user. */
  needsYou: number;
};

/**
 * Fork (Hari, L-412): the Running tab's tree. `rows` (from `runningRows`)
 * under their project, Monos in a group of their own; groups in the order of
 * their first row, so a group with something waiting comes first.
 */
export function runningGroups(rows: readonly RunningRow[], projectsById: ReadonlyMap<string, Project>): RunningGroup[] {
  const groups = new Map<string, RunningGroup>();
  for (const row of rows) {
    const key = row.kind === "mono" ? "monos" : `project:${row.session.projectId}`;
    let group = groups.get(key);
    if (!group) {
      const project = row.kind === "session" ? projectsById.get(row.session.projectId) : undefined;
      group = { key, title: row.kind === "mono" ? "Monos" : row.name, project, rows: [], needsYou: 0 };
      groups.set(key, group);
    }
    group.rows.push(row);
    if (row.needsYou) group.needsYou += 1;
  }
  return [...groups.values()];
}

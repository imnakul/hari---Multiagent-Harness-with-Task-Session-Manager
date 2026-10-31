import type { OrchestrationRun } from "../../orchestration/model/orchestration";
import { summarizeOrchestration } from "../../orchestration/model/orchestrationSummary";
import { fuzzyMatch } from "../../../shared/lib/fuzzy";
import { projectName } from "../../../shared/lib/paths";
import { plainEqual } from "../../../shared/hooks/useStableValue";
import { sameProjectPath } from "../../projects/model/recents";
import {
  isScratchCwd,
  sessionDisplayTitle,
  sessionDraftBlock,
  sessionNeedsInput,
  type Session,
} from "../model/session";
import { shouldPersistSession, type SessionSummary } from "./sessionStore";

function activeTurnModelFor(session: Session) {
  if (!session.busy && !session.externalTurnId) return undefined;
  if (session.externalTurnId) {
    return [...session.blocks]
      .reverse()
      .find(
        (block) =>
          block.externalTurnId === session.externalTurnId && block.turnModel,
      )?.turnModel;
  }
  const activeUserTurn = [...session.blocks]
    .reverse()
    .find((block) => block.role === "user" && !block.draft);
  return activeUserTurn?.turnModel;
}

function activeRunKeyFor(session: Session): string | undefined {
  if (session.externalTurnId) return `external:${session.externalTurnId}`;
  if (!session.busy) return undefined;
  const activeUserTurn = [...session.blocks]
    .reverse()
    .find((block) => block.role === "user" && !block.draft);
  return activeUserTurn ? `local:${activeUserTurn.id}` : undefined;
}

export type SessionGitHint = {
  repo?: string;
  branch?: string;
};

export function compareSessionSummaries(
  a: SessionSummary,
  b: SessionSummary,
): number {
  const pin = Number(!!b.pinned) - Number(!!a.pinned);
  if (pin !== 0) return pin;
  return b.updatedAt - a.updatedAt || a.id.localeCompare(b.id);
}

export function mergeHistorySummary(
  current: SessionSummary[],
  summary: SessionSummary,
): SessionSummary[] {
  const previous = current.find((entry) => entry.id === summary.id);
  const next = {
    ...summary,
    archived: summary.archived ?? previous?.archived,
    pinned: summary.pinned ?? previous?.pinned,
    orchestration: summary.orchestration ?? previous?.orchestration,
    orchestrationLeadId:
      summary.orchestrationLeadId ?? previous?.orchestrationLeadId,
    automationId: summary.automationId ?? previous?.automationId,
  };
  return [next, ...current.filter((entry) => entry.id !== summary.id)].sort(
    compareSessionSummaries,
  );
}

/**
 * Swap in one project's freshly fetched rows while leaving every other
 * project's cached rows alone. `history` is keyed only by the `cwd` on each
 * row, so holding several projects at once costs nothing and lets a revisit
 * paint from cache instead of from an empty list.
 */
export function replaceProjectHistory(
  current: SessionSummary[],
  cwd: string,
  rows: SessionSummary[],
): SessionSummary[] {
  const others = current.filter((entry) => !sameProjectPath(entry.cwd, cwd));
  return [...others, ...rows];
}

/**
 * `mergeHistorySummary`, but scoped so persisting a session cannot drop the
 * other projects the cache is holding. A session that changed project is
 * removed from its old one so the id cannot appear twice.
 */
export function mergeProjectHistorySummary(
  current: SessionSummary[],
  summary: SessionSummary,
): SessionSummary[] {
  const mine: SessionSummary[] = [];
  const others: SessionSummary[] = [];
  for (const entry of current) {
    if (sameProjectPath(entry.cwd, summary.cwd)) mine.push(entry);
    else if (entry.id !== summary.id) others.push(entry);
  }
  return [...others, ...mergeHistorySummary(mine, summary)];
}

export function filterSessionsByArchive(
  rows: SessionSummary[],
  showArchived: boolean,
): SessionSummary[] {
  return rows.filter((row) => !!row.archived === showArchived);
}

export function filterSessionsByQuery(
  rows: SessionSummary[],
  query: string,
): SessionSummary[] {
  const needle = query.trim();
  if (!needle) return rows;
  return rows.filter((row) => sessionSearchHit(row, needle));
}

function sessionSearchHit(row: SessionSummary, query: string): boolean {
  const title = sessionDisplayTitle(row.title, row.harness);
  const git = [row.repo, row.branch].filter(Boolean).join("/");
  const fields = [title, row.title, row.model, row.harness, git];
  return fields.some((field) => field && fuzzyMatch(query, field) != null);
}

export function summaryFromSession(
  session: Session,
  git?: SessionGitHint,
): SessionSummary {
  const activeTurnModel = activeTurnModelFor(session);
  return {
    id: session.id,
    orchestrationLeadId: session.orchestrationLeadId,
    sidebarHidden: session.sidebarHidden,
    cwd: session.cwd,
    harness: session.harness,
    model: session.model,
    ...(activeTurnModel ? { activeTurnModel } : {}),
    ...(activeRunKeyFor(session)
      ? { activeRunKey: activeRunKeyFor(session) }
      : {}),
    runtimeMode: session.runtimeMode,
    title: session.title,
    draft: !!sessionDraftBlock(session),
    providerSessionId: session.providerSessionId,
    worktreeCwd: session.worktreeCwd,
    worktreeRemoved: session.worktreeRemoved,
    ...(session.linkedWorkItem
      ? { linkedWorkItem: session.linkedWorkItem }
      : {}),
    ...(session.automationId ? { automationId: session.automationId } : {}),
    ...(session.providerAccountId
      ? { providerAccountId: session.providerAccountId }
      : {}),
    ...(session.sidechat
      ? {
          sidechat: {
            sourceSessionId: session.sidechat.sourceSessionId,
            sourceTitle: session.sidechat.sourceTitle,
          },
        }
      : {}),
    ...(!session.worktreeRemoved && (session.branch || git?.branch)
      ? { branch: session.branch || git?.branch }
      : {}),
    ...(git?.repo ? { repo: git.repo } : {}),
    createdAt: 0,
    updatedAt: Date.now(),
  };
}

/** Live summaries restamp `updatedAt` on every build; within this window a
 * row counts as unchanged, matching the sidebar's 30s relative-time tick. */
const LIVE_SUMMARY_STALE_MS = 30_000;

/** Same rows in the same order, ignoring a live row's restamped clock. */
export function sameSessionSummaries(
  previous: readonly SessionSummary[],
  next: readonly SessionSummary[],
): boolean {
  if (previous.length !== next.length) return false;
  return previous.every((row, i) => {
    const other = next[i];
    if (row === other) return true;
    if (
      !other ||
      Math.abs(row.updatedAt - other.updatedAt) >= LIVE_SUMMARY_STALE_MS
    )
      return false;
    return plainEqual({ ...row, updatedAt: 0 }, { ...other, updatedAt: 0 });
  });
}

/** Prefer the project's persisted origin name, then the overlay / folder name. */
export function projectGitHint(
  rows: SessionSummary[],
  overlay?: SessionGitHint,
): SessionGitHint {
  const repo = rows.find((row) => row.repo)?.repo ?? overlay?.repo;
  const branch = overlay?.branch ?? rows.find((row) => row.branch)?.branch;
  return {
    ...(repo ? { repo } : {}),
    ...(branch ? { branch } : {}),
  };
}

function gitOverlayForCwd(cwd: string, git?: SessionGitHint): SessionGitHint {
  if (git?.repo) return git;
  if (!cwd || cwd === "~") return git ?? {};
  const name = projectName(cwd);
  if (!name || name === "~") return git ?? {};
  return { ...git, repo: name };
}

export function historyWithLiveSessions(
  history: SessionSummary[],
  sessions: Session[],
  cwd: string,
  git?: SessionGitHint,
  runs: readonly OrchestrationRun[] = [],
): SessionSummary[] {
  const workerIds = new Set([
    ...sessions
      .filter((session) => session.orchestrationLeadId)
      .map((session) => session.id),
    ...history.flatMap(
      (row) => row.orchestration?.tasks.map((task) => task.sessionId) ?? [],
    ),
    ...runs.flatMap((run) => run.tasks.map((task) => task.sessionId)),
  ]);
  const inboxIds = new Set(
    sessions.filter((session) => session.inboxAsk).map((session) => session.id),
  );
  let rows = history.filter(
    (entry) =>
      !inboxIds.has(entry.id) &&
      !entry.orchestrationLeadId &&
      !entry.sidechat &&
      !workerIds.has(entry.id) &&
      sameProjectPath(entry.cwd, cwd),
  );
  const hint = projectGitHint(rows, gitOverlayForCwd(cwd, git));
  for (const session of sessions) {
    // Ephemeral sessions are never chats of the project, even while busy.
    if (
      session.ephemeral ||
      session.sidechat ||
      session.inboxAsk ||
      workerIds.has(session.id)
    )
      continue;
    if (!sameProjectPath(session.cwd, cwd)) continue;
    const live =
      session.busy || !!session.externalTurnId || sessionNeedsInput(session);
    if (!shouldPersistSession(session) && !live) continue;
    const storedIndex = rows.findIndex((row) => row.id === session.id);
    if (storedIndex >= 0) {
      const stored = rows[storedIndex];
      const draft = !!sessionDraftBlock(session);
      const automationId = session.automationId || stored.automationId;
      const activeTurnModel = activeTurnModelFor(session);
      const activeRunKey = activeRunKeyFor(session);
      // Live title and work item land before the next persist, e.g. mid-turn.
      const linkedWorkItem = session.linkedWorkItem ?? stored.linkedWorkItem;
      if (
        !!stored.draft !== draft ||
        stored.automationId !== automationId ||
        stored.model !== session.model ||
        stored.harness !== session.harness ||
        JSON.stringify(stored.activeTurnModel) !==
          JSON.stringify(activeTurnModel) ||
        stored.activeRunKey !== activeRunKey ||
        stored.title !== session.title ||
        !!stored.sidebarHidden !== !!session.sidebarHidden ||
        stored.linkedWorkItem?.url !== linkedWorkItem?.url
      ) {
        rows[storedIndex] = {
          ...stored,
          model: session.model,
          harness: session.harness,
          title: session.title,
          sidebarHidden: session.sidebarHidden,
          draft: draft || undefined,
          ...(activeTurnModel
            ? { activeTurnModel }
            : { activeTurnModel: undefined }),
          ...(activeRunKey ? { activeRunKey } : { activeRunKey: undefined }),
          ...(automationId ? { automationId } : {}),
          ...(linkedWorkItem ? { linkedWorkItem } : {}),
        };
      }
      continue;
    }
    const sessionHint: SessionGitHint = {
      ...hint,
      ...(session.branch ? { branch: session.branch } : {}),
    };
    rows = mergeHistorySummary(rows, summaryFromSession(session, sessionHint));
  }
  const byLead = new Map(runs.map((run) => [run.leadId, run]));
  return rows
    .map((row) => {
      const run = byLead.get(row.id);
      return run
        ? { ...row, orchestration: summarizeOrchestration(run, sessions) }
        : row;
    })
    .sort(compareSessionSummaries);
}

/**
 * Chat-mode list: persisted scratch chats merged with live ones, newest
 * first. Ephemeral sidechats never qualify (project cwd, and excluded
 * explicitly) — the Chat panel only ever shows continuable chats.
 */
export function scratchChatSummaries(
  history: SessionSummary[],
  sessions: Session[],
): SessionSummary[] {
  let rows = history.filter((entry) => isScratchCwd(entry.cwd));
  for (const session of sessions) {
    if (session.ephemeral || !isScratchCwd(session.cwd)) continue;
    const storedIndex = rows.findIndex((row) => row.id === session.id);
    if (storedIndex >= 0) {
      if (
        !shouldPersistSession(session) &&
        !session.busy &&
        !sessionNeedsInput(session)
      ) continue;
      // Title/model events land before storage. Overlay their live values
      // without changing pin/archive state or the saved list ordering.
      rows[storedIndex] = {
        ...rows[storedIndex],
        title: session.title,
        harness: session.harness,
        model: session.model,
        activeTurnModel: activeTurnModelFor(session),
      };
      continue;
    }
    rows = mergeHistorySummary(rows, summaryFromSession(session));
  }
  return [...rows].sort(compareSessionSummaries);
}

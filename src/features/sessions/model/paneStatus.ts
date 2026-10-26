import { sessionNeedsInput, type Session } from "./session";
import { isSessionWorking } from "./workingSessions";

/**
 * What the status pane ring (L-184) shows for a chat:
 * - `working`: a turn is running (accent);
 * - `attention`: it waits on you — a permission, a question, or a paused or
 *   held queue (amber);
 * - `error`: its latest turn failed or was stopped (red);
 * - `done`: its latest turn finished (green);
 * - `idle`: nothing has run yet, or it is a file pane.
 */
export type PaneStatus = "idle" | "working" | "attention" | "error" | "done";

type StatusSession = Pick<
  Session,
  | "busy"
  | "externalTurnId"
  | "blocks"
  | "pendingQuestion"
  | "worktreeRemoved"
  | "queueStatus"
>;

/** A pane's status, most urgent first. */
export function paneStatus(session: StatusSession | undefined): PaneStatus {
  if (!session) return "idle";
  if (sessionNeedsInput(session)) return "attention";
  if (session.queueStatus === "held" || session.queueStatus === "paused")
    return "attention";
  if (isSessionWorking(session)) return "working";
  return latestTurnOutcome(session.blocks);
}

/**
 * How the newest turn ended: an error or interruption notice after the last
 * user message makes it `error`; any other finished turn is `done`; a chat
 * with no sent user message is `idle`.
 */
function latestTurnOutcome(blocks: StatusSession["blocks"]): PaneStatus {
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index];
    // An unsent draft is not a turn.
    if (!block || (block.role === "user" && block.draft)) continue;
    if (block.role === "user") return "done";
    if (block.notice === "error" || block.notice === "interrupt") return "error";
  }
  return "idle";
}

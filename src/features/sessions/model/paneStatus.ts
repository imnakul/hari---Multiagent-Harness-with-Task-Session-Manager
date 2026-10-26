import { sessionNeedsInput, type Session } from "./session";
import { isSessionWorking } from "./workingSessions";

/** What the status pane ring (L-184) shows for a chat. */
export type PaneStatus = "idle" | "working" | "attention" | "error";

type StatusSession = Pick<
  Session,
  | "busy"
  | "externalTurnId"
  | "blocks"
  | "pendingQuestion"
  | "worktreeRemoved"
>;

/**
 * A pane's status, most urgent first: waiting on you (permission or
 * question), then working, then a last turn that ended on an error notice.
 * File panes and empty chats are idle.
 */
export function paneStatus(session: StatusSession | undefined): PaneStatus {
  if (!session) return "idle";
  if (sessionNeedsInput(session)) return "attention";
  if (isSessionWorking(session)) return "working";
  return lastTurnFailed(session.blocks) ? "error" : "idle";
}

/** True when the newest system notice since the last user turn is an error. */
function lastTurnFailed(blocks: StatusSession["blocks"]): boolean {
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index];
    if (!block || block.role === "user") return false;
    if (block.notice === "error") return true;
  }
  return false;
}

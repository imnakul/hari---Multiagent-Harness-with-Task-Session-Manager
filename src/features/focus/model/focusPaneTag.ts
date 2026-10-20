import { hasPendingApproval, type Session } from "../../sessions/model/session";
import { isSessionWorking } from "../../sessions/model/workingSessions";
import {
  boardCardTag,
  type BoardCard,
  type BoardTagTone,
} from "../../session-board/sessionBoard";

type TagSession = Pick<
  Session,
  "busy" | "externalTurnId" | "blocks" | "pendingQuestion" | "worktreeRemoved"
>;

/**
 * A Focus pane's status tag (L-123), in Session Manager wording. The live
 * session wins for what changes fast (asking, working); the board card says
 * how the last run ended. A new chat with no run has no tag.
 */
export function focusPaneTag(
  session: TagSession,
  card: BoardCard | undefined,
): { label: string; tone: BoardTagTone } | null {
  if (!session.worktreeRemoved && hasPendingApproval(session.blocks))
    return { label: "Permission", tone: "attention" };
  if (!session.worktreeRemoved && session.pendingQuestion != null)
    return { label: "Question", tone: "attention" };
  if (isSessionWorking(session)) return { label: "Working…", tone: "working" };
  // A card still marked in progress is about to be updated; say nothing yet.
  if (!card || card.status === "in_progress") return null;
  return boardCardTag(card);
}

/** The newest board card of each chat, by session id. */
export function newestBoardCards(
  cards: readonly BoardCard[],
): Map<string, BoardCard> {
  const newest = new Map<string, BoardCard>();
  for (const card of cards) {
    const seen = newest.get(card.sessionId);
    if (!seen || card.updatedAt > seen.updatedAt)
      newest.set(card.sessionId, card);
  }
  return newest;
}

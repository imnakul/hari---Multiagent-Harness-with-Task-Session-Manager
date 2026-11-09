import type { ApprovalDecision } from "../../../integrations/harness/core/types";
import { pendingApprovalForSession } from "../../notifications/model/approvalToast";
import { hasPendingApproval, type Session } from "../../sessions/model/session";

/**
 * Fork (Hari, L-239): what a session waits on the user for. An approval also
 * names what it asks ("Run: npm test") and its request, so the phone's Live
 * Update can show it and answer it.
 */
export function mobileWaiting(session: Session) {
  if (hasPendingApproval(session.blocks)) {
    const pending = pendingApprovalForSession(session);
    return {
      waiting: "approval" as const,
      ...(pending?.kind === "approval"
        ? { approval: { requestId: pending.requestId, label: pending.label } }
        : {}),
    };
  }
  return session.pendingQuestion ? { waiting: "question" as const } : {};
}

/**
 * Throws the reason the phone can't answer this approval now: the session is
 * gone, or the request was already answered here or on the computer.
 * Returns the request and the decision to pass on, as the desktop's toast does.
 */
export function checkMobileApproval(
  session: Session | undefined,
  params: Record<string, unknown>,
): { requestId: number; decision: ApprovalDecision } {
  if (!session || session.worktreeRemoved)
    throw new Error("Session is no longer available");
  const decision = params.decision;
  if (decision !== "allow" && decision !== "deny")
    throw new Error("Choose Approve or Deny");
  const requestId = params.requestId;
  const waiting =
    typeof requestId === "number" &&
    session.blocks.some(
      (block) =>
        block.approval?.requestId === requestId && !block.approval.decided,
    );
  if (!waiting) throw new Error("This approval was already answered");
  return { requestId: requestId as number, decision };
}

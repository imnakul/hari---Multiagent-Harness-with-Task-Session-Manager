import { buildForkBundle, forkThreadBlocks } from "./fork";
import { harnessForTurn } from "./secondOpinion";
import { HARNESS_TITLE, sessionWorkCwd, type Block, type BranchOrigin, type BranchSummaryReason, type Session } from "./session";

export type BranchPlan =
  | { kind: "legacy"; blocks: Block[]; bundleText: string }
  | { kind: "copied"; blocks: Block[]; bundleText: string; origin: BranchOrigin }
  | { kind: "native"; blocks: Block[]; origin: BranchOrigin };

export function branchReasonText(reason: BranchSummaryReason, providerTitle: string): string {
  switch (reason) {
    case "different-provider": return `this turn came from ${providerTitle}`;
    case "not-started": return `the original chat had no ${providerTitle} conversation yet`;
    case "pending-switch": return "the original chat was switching providers";
    case "orchestration-worker": return "agent workers can't be copied";
    case "no-fork-point": return `${providerTitle} didn't record where this turn ends`;
    case "source-continued": return "the original chat continued before this branch's first message";
    case "branch-changed": return "this branch's provider, account or folder changed";
    case "fork-failed": return `${providerTitle} couldn't reopen the original conversation`;
  }
}

export function branchDividerText(origin: BranchOrigin, providerTitle: string): string {
  const title = [...origin.sourceTitle];
  const prefix = `Branched from “${title.length > 60 ? title.slice(0, 60).join("") + "…" : origin.sourceTitle}” · `;
  if (origin.mode === "native") {
    return prefix + (origin.status === "uncertain"
      ? `${providerTitle} may not have received your first message. Nothing was resent.`
      : `keeps ${providerTitle}'s full history`);
  }
  return prefix + (origin.summaryDelivery === "prefix"
    ? "continued from a copied summary sent with your first message"
    : "starts from a copied summary in the message box")
    + ` (${branchReasonText(origin.reason ?? "fork-failed", providerTitle)})`;
}

export function planBranch(input: { source: Session; turn: Block[]; newSessionId: string }): BranchPlan | null {
  const { source, turn, newSessionId } = input;
  const lastId = turn[turn.length - 1]?.id;
  if (!lastId) return null;
  const blocks = forkThreadBlocks(source.blocks, lastId);
  if (!blocks.length) return null;
  const bundleText = buildForkBundle(blocks).text;
  if (!["claude", "codex", "opencode"].includes(source.harness)) return { kind: "legacy", blocks, bundleText };
  const user = turn.find(block => block.role === "user");
  const turnHarness = harnessForTurn(source.blocks, turn, source.harness);
  let reason: BranchSummaryReason | undefined;
  if (turnHarness !== source.harness) reason = "different-provider";
  else if (source.orchestrationLeadId) reason = "orchestration-worker";
  else if (source.pendingSwitch) reason = "pending-switch";
  else if (!source.providerSessionId) reason = "not-started";
  const laterUsers = source.blocks.slice(source.blocks.findIndex(block => block.id === lastId) + 1)
    .filter(block => block.role === "user" && !block.draft);
  let forkPoint: string | undefined;
  let sourceLastUserBlockId: string | undefined;
  if (!reason) {
    if (source.harness === "claude") forkPoint = user?.providerForkPoint;
    else if (source.harness === "codex" && user?.providerTurnId && !laterUsers.some(block => block.providerTurnId === user.providerTurnId)) forkPoint = user.providerTurnId;
    else if (source.harness === "opencode") forkPoint = laterUsers[0]?.providerTurnId;
    if (!forkPoint) {
      if (!laterUsers.length && !source.busy) sourceLastUserBlockId = user?.id;
      else reason = "no-fork-point";
    }
  }
  const origin: BranchOrigin = {
    sessionId: newSessionId, sourceSessionId: source.id, sourceTitle: source.title,
    harness: reason === "different-provider" ? turnHarness : source.harness,
    mode: reason ? "summary" : "native", status: reason ? "done" : "pending",
    ...(reason ? { reason, summaryDelivery: "composer" } : {
      fork: { sourceProviderSessionId: source.providerSessionId ?? "", forkPoint,
        providerAccountId: source.providerAccountId, workCwd: sessionWorkCwd(source), sourceLastUserBlockId },
    }),
  };
  blocks.push({ id: crypto.randomUUID(), role: "system", branchOrigin: origin,
    text: branchDividerText(origin, HARNESS_TITLE[reason === "different-provider" ? turnHarness : source.harness]) });
  return reason ? { kind: "copied", blocks, bundleText, origin } : { kind: "native", blocks, origin };
}

export function pendingBranchOrigin(session: Session): BranchOrigin | undefined {
  return session.blocks.slice().reverse().find(block => block.branchOrigin?.sessionId === session.id
    && block.branchOrigin.status !== "done")?.branchOrigin;
}

function rewriteOrigin(session: Session, update: (origin: BranchOrigin) => BranchOrigin): Session {
  const pending = pendingBranchOrigin(session);
  if (!pending) return session;
  return { ...session, blocks: session.blocks.map(block => {
    if (block.branchOrigin !== pending) return block;
    const branchOrigin = update(pending);
    return { ...block, branchOrigin, text: branchDividerText(branchOrigin, HARNESS_TITLE[branchOrigin.harness]) };
  }) };
}

export function convertToPrefixSummary(session: Session, reason: BranchSummaryReason): Session {
  return rewriteOrigin(session, origin => {
    const next: BranchOrigin = { ...origin, mode: "summary", summaryDelivery: "prefix", status: "pending", reason };
    delete next.fork;
    return next;
  });
}

export function markBranchUncertain(session: Session): Session {
  return rewriteOrigin(session, origin => origin.mode === "native" ? { ...origin, status: "uncertain" } : origin);
}

/**
 * A Claude fork not sent yet whose parent transcript can be copied to another
 * account (fork, L-200): the fork then starts there with the full history.
 */
export function pendingClaudeFork(session: Session): NonNullable<BranchOrigin["fork"]> | undefined {
  if (session.harness !== "claude" || session.providerSessionId || session.busy) return undefined;
  const origin = pendingBranchOrigin(session);
  if (origin?.mode !== "native" || origin.status !== "pending" || origin.harness !== "claude") return undefined;
  return origin.fork?.sourceProviderSessionId ? origin.fork : undefined;
}

/** Points a pending fork, and the chat, at the account its parent was copied to. */
export function moveBranchForkAccount(session: Session, accountId: string): Session {
  const moved = rewriteOrigin(session, origin => origin.fork
    ? { ...origin, fork: { ...origin.fork, providerAccountId: accountId } }
    : origin);
  return { ...moved, providerAccountId: accountId };
}

import { describe, expect, it } from "vitest";
import { planBranch, pendingBranchOrigin, convertToPrefixSummary, markBranchUncertain, branchDividerText, pendingClaudeFork, moveBranchForkAccount } from "./branchPlan";
import { buildForkBundle, forkThreadBlocks } from "./fork";
import { newSession, HARNESSES, HARNESS_TITLE, type Session, type Block } from "./session";

function source(): Session {
  return { ...newSession("claude", "/repo"), id: "source", title: "Original", providerSessionId: "provider-source",
    blocks: [{ id: "u1", role: "user", text: "one" }, { id: "a1", role: "assistant", text: "reply" }] };
}
function plan(session: Session, turn = session.blocks) {
  return planBranch({ source: session, turn, newSessionId: "branch" });
}
describe("native branch planner", () => {
  it.each(HARNESSES)("chooses provider routing for %s", harness => {
    const session = { ...source(), harness };
    const result = plan(session);
    expect(result?.kind).toBe(["claude", "codex", "opencode"].includes(harness) ? "native" : "legacy");
    if (result?.kind === "legacy") {
      expect(result.bundleText).toBe(buildForkBundle(forkThreadBlocks(session.blocks)).text);
      expect(result.blocks.map(({ id: _id, ...block }) => block)).toEqual(session.blocks.map(({ id: _id, ...block }) => block));
    }
  });
  it.each([
    ["different-provider", { turnModel: { harness: "codex", id: "model", name: "Model" } }],
  ] as const)("prefers %s over other failures", (reason, patch) => {
    const session = source();
    session.blocks[0] = { ...session.blocks[0], ...patch };
    session.orchestrationLeadId = "worker";
    session.providerSessionId = undefined;
    expect(plan(session)).toMatchObject({
      kind: "copied",
      origin: {
        reason,
        harness: reason === "different-provider" ? "codex" : session.harness,
      },
    });
    expect(plan(session)?.blocks[2].text).toContain("this turn came from Codex");
  });
  it.each([
    ["orchestration-worker", { orchestrationLeadId: "lead" }],
    ["pending-switch", { pendingSwitch: { from: "codex", fromModel: "m", fromSettings: {} } }],
    ["not-started", { providerSessionId: undefined }],
    ["no-fork-point", { busy: true }],
  ] satisfies [string, Partial<Session>][])("copies with %s", (reason, patch) => {
    expect(plan({ ...source(), ...patch })).toMatchObject({ kind: "copied", origin: { reason, harness: source().harness, mode: "summary", summaryDelivery: "composer", status: "done" } });
  });
  it("records the account and working copy on a whole-conversation fork", () => {
    expect(plan({ ...source(), providerAccountId: "account", worktreeCwd: "/worktree" })).toMatchObject({
      kind: "native", origin: { fork: { sourceProviderSessionId: "provider-source", sourceLastUserBlockId: "u1", providerAccountId: "account", workCwd: "/worktree" } },
    });
  });
  it.each(["claude", "codex", "opencode"] as const)("uses the earlier %s position", harness => {
    const session = { ...source(), harness };
    session.blocks[0] = { ...session.blocks[0], providerTurnId: "turn-1", providerForkPoint: "uuid-1" };
    session.blocks.push({ id: "u2", role: "user", text: "two", providerTurnId: "turn-2" });
    expect(plan(session, session.blocks.slice(0, 2))).toMatchObject({ kind: "native", origin: { fork: { forkPoint: harness === "claude" ? "uuid-1" : harness === "codex" ? "turn-1" : "turn-2" } } });
  });
  it("rejects a Codex boundary shared by a later user message", () => {
    const session = { ...source(), harness: "codex" as const };
    session.blocks[0].providerTurnId = "shared";
    session.blocks.push({ id: "u2", role: "user", text: "two", providerTurnId: "shared" });
    expect(plan(session, session.blocks.slice(0, 2))).toMatchObject({ kind: "copied", origin: { reason: "no-fork-point" } });
  });
  it("counts internal messages but ignores unsent drafts", () => {
    const session = source();
    session.blocks.push({ id: "draft", role: "user", text: "draft", draft: true });
    expect(plan(session, session.blocks.slice(0, 2))?.kind).toBe("native");
    session.blocks[2] = { ...session.blocks[2], draft: false, internal: true };
    expect(plan(session, session.blocks.slice(0, 2))).toMatchObject({ kind: "copied", origin: { reason: "no-fork-point" } });
  });
  it("returns null for empty turns and empty copies", () => {
    expect(plan(source(), [])).toBeNull();
    const session = source(); session.blocks = [];
    expect(plan(session, [{ id: "missing", role: "user", text: "" }])).toBeNull();
  });
  it("only acts on owned pending dividers", () => {
    const result = plan(source());
    const session = { ...source(), id: "branch", blocks: result?.blocks ?? [] };
    const uncertain = markBranchUncertain(session);
    expect(pendingBranchOrigin(uncertain)?.status).toBe("uncertain");
    expect(pendingBranchOrigin(uncertain)?.fork).toBeDefined();
    const copied = convertToPrefixSummary(uncertain, "fork-failed");
    expect(pendingBranchOrigin(copied)).toMatchObject({ mode: "summary", summaryDelivery: "prefix", status: "pending", reason: "fork-failed" });
    expect(pendingBranchOrigin(copied)?.fork).toBeUndefined();
    expect(markBranchUncertain({ ...session, id: "other" })).toEqual({ ...session, id: "other" });
  });
  it("scrubs copied positions and makes older dividers inert", () => {
    const result = plan(source());
    const blocks: Block[] = [{ id: "u", role: "user", text: "", providerTurnId: "t", providerForkPoint: "p" }, ...(result?.blocks ?? [])];
    const copied = forkThreadBlocks(blocks);
    expect(copied[0].providerTurnId).toBeUndefined(); expect(copied[0].providerForkPoint).toBeUndefined();
    expect(copied[3].branchOrigin?.status).toBe("done"); expect(copied[3].branchOrigin?.fork).toBeUndefined();
  });
  it("uses exact divider copy and truncates the title", () => {
    const result = plan(source());
    if (!result || result.kind === "legacy") throw new Error("missing origin");
    expect(branchDividerText(result.origin, HARNESS_TITLE.claude)).toBe("Branched from “Original” · keeps Claude Code's full history");
    expect(branchDividerText({ ...result.origin, sourceTitle: "x".repeat(61) }, HARNESS_TITLE.claude)).toContain("x".repeat(60) + "…");
  });
});

describe("moving a pending Claude fork to another account (L-200)", () => {
  function fork(): Session {
    const result = plan({ ...source(), providerAccountId: "old" });
    if (result?.kind !== "native") throw new Error("expected a native fork");
    return { ...newSession("claude", "/repo"), id: "branch", providerAccountId: "old", blocks: result.blocks };
  }
  it("finds the parent conversation of an unsent Claude fork", () => {
    expect(pendingClaudeFork(fork())).toMatchObject({ sourceProviderSessionId: "provider-source", providerAccountId: "old" });
  });
  it("ignores sent, busy and non-Claude forks", () => {
    expect(pendingClaudeFork({ ...fork(), providerSessionId: "child" })).toBeUndefined();
    expect(pendingClaudeFork({ ...fork(), busy: true })).toBeUndefined();
    expect(pendingClaudeFork({ ...fork(), harness: "codex" })).toBeUndefined();
  });
  it("moves the chat and its pending fork together", () => {
    const moved = moveBranchForkAccount(fork(), "new");
    expect(moved.providerAccountId).toBe("new");
    expect(pendingBranchOrigin(moved)?.fork?.providerAccountId).toBe("new");
    expect(pendingClaudeFork(moved)?.sourceProviderSessionId).toBe("provider-source");
  });
});

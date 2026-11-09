import { describe, expect, it } from "vitest";
import { newSession, type Block, type Session } from "../../sessions/model/session";
import { checkMobileApproval, mobileWaiting } from "./mobileApproval";

const session = (change: Partial<Session> = {}): Session => ({
  ...newSession("codex", "/fixture"),
  ...change,
});
const tool = (requestId: number, decided?: "allow" | "deny"): Block => ({
  id: `tool-${requestId}`,
  role: "tool",
  text: "npm test",
  tool: { kind: "execute", title: "npm test" },
  approval: { requestId, ...(decided ? { decided } : {}) },
} as Block);

describe("mobileWaiting (L-239)", () => {
  it("is empty when nothing waits on the user", () => {
    expect(mobileWaiting(session())).toEqual({});
  });

  it("names the approval it waits on", () => {
    const waiting = mobileWaiting(session({ blocks: [tool(7)] }));
    expect(waiting.waiting).toBe("approval");
    expect(waiting).toMatchObject({ approval: { requestId: 7 } });
    expect((waiting as { approval: { label: string } }).approval.label).toContain("npm test");
  });

  it("skips answered approvals", () => {
    expect(mobileWaiting(session({ blocks: [tool(7, "allow")] }))).toEqual({});
  });
});

describe("checkMobileApproval (L-239)", () => {
  it("passes an approval still waiting", () => {
    expect(
      checkMobileApproval(session({ blocks: [tool(3), tool(4)] }), { requestId: 3, decision: "deny" }),
    ).toEqual({ requestId: 3, decision: "deny" });
  });

  it("refuses one already answered", () => {
    expect(() =>
      checkMobileApproval(session({ blocks: [tool(3, "allow")] }), { requestId: 3, decision: "allow" }),
    ).toThrow("already answered");
  });

  it("refuses an unknown decision or a missing session", () => {
    expect(() =>
      checkMobileApproval(session({ blocks: [tool(3)] }), { requestId: 3, decision: "maybe" }),
    ).toThrow("Approve or Deny");
    expect(() => checkMobileApproval(undefined, { requestId: 3, decision: "allow" })).toThrow(
      "no longer available",
    );
  });
});

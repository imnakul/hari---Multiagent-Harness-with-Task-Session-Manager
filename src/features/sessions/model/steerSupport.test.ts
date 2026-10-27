import { describe, expect, it, vi } from "vitest";
import {
  canSteerSession,
  hasStaleExternalTurn,
  isInteractiveClaudeSession,
  isInteractiveClaudeWorkingElsewhere,
} from "./steerSupport";

vi.mock("../../../integrations/harness/core/registry", () => ({
  canSteerHarness: (harness: string) => harness !== "fx",
}));

const interactive = { claudeExecution: "interactive" };

describe("canSteerSession", () => {
  it("never steers an Interactive Claude turn, so busy follow-ups queue instead of failing it", () => {
    const session = { harness: "claude" as const, modelSettings: interactive };
    expect(isInteractiveClaudeSession(session)).toBe(true);
    expect(canSteerSession(session)).toBe(false);
  });

  it("treats an Interactive Claude turn the app did not send as working, so sends queue", () => {
    const session = { harness: "claude" as const, modelSettings: interactive };
    expect(isInteractiveClaudeWorkingElsewhere(session)).toBe(false);
    expect(
      isInteractiveClaudeWorkingElsewhere({ ...session, externalTurnId: "interactive:1" }),
    ).toBe(true);
    expect(
      isInteractiveClaudeWorkingElsewhere({ harness: "claude", externalTurnId: "phone:1" }),
    ).toBe(false);
  });

  it("finds a turn the chat waits on that Claude has left (L-186)", () => {
    const session = {
      harness: "claude" as const,
      modelSettings: interactive,
      externalTurnId: "interactive:1",
    };
    expect(hasStaleExternalTurn(session, "interactive:1")).toBe(false);
    expect(hasStaleExternalTurn(session, undefined)).toBe(true);
    expect(hasStaleExternalTurn(session, "interactive:2")).toBe(true);
    expect(
      hasStaleExternalTurn({ ...session, externalTurnId: undefined }, undefined),
    ).toBe(false);
    expect(
      hasStaleExternalTurn({ harness: "claude", externalTurnId: "phone:1" }, undefined),
    ).toBe(false);
  });

  it("keeps harness steer support for headless Claude and other providers", () => {
    expect(canSteerSession({ harness: "claude", modelSettings: {} })).toBe(true);
    expect(canSteerSession({ harness: "claude" })).toBe(true);
    expect(canSteerSession({ harness: "codex", modelSettings: interactive })).toBe(true);
    expect(canSteerSession({ harness: "fx" })).toBe(false);
  });
});

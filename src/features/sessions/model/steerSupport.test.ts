import { describe, expect, it, vi } from "vitest";
import { canSteerSession, isInteractiveClaudeSession } from "./steerSupport";

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

  it("keeps harness steer support for headless Claude and other providers", () => {
    expect(canSteerSession({ harness: "claude", modelSettings: {} })).toBe(true);
    expect(canSteerSession({ harness: "claude" })).toBe(true);
    expect(canSteerSession({ harness: "codex", modelSettings: interactive })).toBe(true);
    expect(canSteerSession({ harness: "fx" })).toBe(false);
  });
});

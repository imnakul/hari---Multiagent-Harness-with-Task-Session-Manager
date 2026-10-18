// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  canContinueOnAccount,
  continueAccountTargets,
  continueBlockedReason,
  continueCostNote,
  continuedMarker,
  copyClaudeSession,
} from "./continueOnAccount";
import { saveProviderAccount } from "./providerAccounts";
import type { Block } from "../../sessions/model/session";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const ID = "11111111-2222-4333-8444-555555555555";
const block: Block = { id: "b", role: "user", text: "hi" };
const chat = {
  harness: "claude" as const,
  providerSessionId: ID,
  cwd: "/repo",
  blocks: [block],
};

beforeEach(() => {
  vi.mocked(invoke).mockReset().mockResolvedValue(undefined);
  localStorage.clear();
});

describe("continue a Claude chat on another account", () => {
  it("is offered only for local Claude chats with history and a native id", () => {
    expect(canContinueOnAccount(chat)).toBe(true);
    expect(canContinueOnAccount({ ...chat, harness: "codex" })).toBe(false);
    expect(canContinueOnAccount({ ...chat, blocks: [] })).toBe(false);
    expect(
      canContinueOnAccount({ ...chat, providerSessionId: undefined }),
    ).toBe(false);
    expect(canContinueOnAccount({ ...chat, providerSessionId: "../x" })).toBe(
      false,
    );
    expect(canContinueOnAccount({ ...chat, ephemeral: true })).toBe(false);
    expect(canContinueOnAccount({ ...chat, cwd: "remote://host-1/repo" })).toBe(
      false,
    );
  });

  it("refuses busy chats, background tasks and live Interactive processes", () => {
    expect(continueBlockedReason({}, false)).toBeNull();
    expect(continueBlockedReason({ busy: true }, false)).toMatch(
      /stop it or wait/i,
    );
    expect(
      continueBlockedReason({ backgroundTasks: ["build"] }, false),
    ).toMatch(/background tasks/i);
    expect(continueBlockedReason({}, true)).toMatch(/Interactive/);
  });

  it("states the one-time uncached cost", () => {
    expect(continueCostNote("imnakul")).toBe(
      "The first reply on imnakul is not cached, so it uses more of that account's limit once. Later replies are cached as usual.",
    );
  });

  it("copies through the backend and rejects non-UUID ids before calling it", async () => {
    const input = {
      fromAccount: "default",
      toAccount: "account-1",
      sessionId: ID,
      cwd: "/repo",
    };
    await copyClaudeSession(input);
    expect(invoke).toHaveBeenCalledWith("claude_copy_session", input);
    await expect(
      copyClaudeSession({ ...input, sessionId: "../escape" }),
    ).rejects.toThrow(/Invalid/);
    expect(invoke).toHaveBeenCalledTimes(1);
    vi.mocked(invoke).mockRejectedValueOnce("different version");
    await expect(copyClaudeSession(input)).rejects.toThrow("different version");
  });

  it("records the switch and lists only the other accounts", () => {
    expect(continuedMarker("imnakul")).toMatchObject({
      role: "system",
      text: "Continued on imnakul",
    });
    expect(continueAccountTargets("default")).toEqual([]);
    saveProviderAccount({
      id: "account-1",
      provider: "claude",
      label: "imnakul",
    });
    expect(continueAccountTargets("default")).toEqual([
      { id: "account-1", label: "imnakul" },
    ]);
    expect(continueAccountTargets("account-1")).toEqual([
      { id: "default", label: "Default account" },
    ]);
  });
});

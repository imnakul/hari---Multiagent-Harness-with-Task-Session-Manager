import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SendTurnInput } from "../../core/types";

const { mockInvoke, mockSend, mockForget } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
  mockSend: vi.fn(),
  mockForget: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mockInvoke }));
vi.mock("./commandCode", () => ({
  sendCommandCodeTurn: mockSend,
  forgetCommandCodeSession: mockForget,
}));

import { runCommandCodeHelperPrompt } from "./commandCodeHelper";
import {
  HelperToolAttemptError,
  HelperUnavailableError,
} from "../../core/helperIsolation";

const input = { cwd: "/repo", prompt: "Name this chat", timeoutMs: 5_000 };

beforeEach(() => {
  mockInvoke.mockReset().mockResolvedValue("/helper");
  mockSend.mockReset();
  mockForget.mockReset().mockResolvedValue(undefined);
});

describe("runCommandCodeHelperPrompt", () => {
  it("runs one plan turn in the empty helper folder and forgets it", async () => {
    mockSend.mockImplementation(async (turn: SendTurnInput) => {
      turn.onEvent({ type: "message.delta", text: " Fix " });
      turn.onEvent({ type: "message.delta", text: "login " });
    });
    await expect(
      runCommandCodeHelperPrompt({
        ...input,
        model: "command-code:claude-haiku-5-5",
        modelSettings: { effort: "low" },
      }),
    ).resolves.toBe("Fix login");
    const turn = mockSend.mock.calls[0]![0] as SendTurnInput;
    expect(mockInvoke).toHaveBeenCalledWith("command_code_helper_directory");
    expect(turn.cwd).toBe("/helper");
    expect(turn.intent).toBe("plan");
    expect(turn.runtimeMode).toBe("supervised");
    expect(turn.ephemeral).toBe(true);
    expect(turn.model).toBe("command-code:claude-haiku-5-5");
    expect(turn.modelSettings).toEqual({ effort: "low" });
    expect(turn.sessionId).toMatch(/^command-code-helper:/);
    expect(mockForget).toHaveBeenCalledWith(turn.sessionId);
  });

  it("fails and stops the process when Command Code starts a tool", async () => {
    mockSend.mockImplementation(
      (turn: SendTurnInput) =>
        new Promise<void>(() => {
          turn.onEvent({ type: "tool.started", callId: "t1", tool: "read" });
        }),
    );
    await expect(runCommandCodeHelperPrompt(input)).rejects.toBeInstanceOf(
      HelperToolAttemptError,
    );
    expect(mockForget).toHaveBeenCalledTimes(1);
  });

  it("fails instead of waiting on an approval prompt", async () => {
    mockSend.mockImplementation(
      (turn: SendTurnInput) =>
        new Promise<void>(() => {
          turn.onEvent({
            type: "approval.requested",
            requestId: 1,
            title: "Run tests",
            kind: "execute",
          });
        }),
    );
    await expect(runCommandCodeHelperPrompt(input)).rejects.toBeInstanceOf(
      HelperToolAttemptError,
    );
    expect(mockForget).toHaveBeenCalledTimes(1);
  });

  it("times out a hung turn", async () => {
    vi.useFakeTimers();
    try {
      mockSend.mockReturnValue(new Promise<void>(() => undefined));
      const run = runCommandCodeHelperPrompt({ ...input, timeoutMs: 100 });
      const check = expect(run).rejects.toThrow(/timed out/);
      await vi.advanceTimersByTimeAsync(150);
      await check;
      expect(mockForget).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects an empty reply", async () => {
    mockSend.mockResolvedValue(undefined);
    await expect(runCommandCodeHelperPrompt(input)).rejects.toThrow(/empty/);
  });

  it("reports unavailable when the helper folder can't be made", async () => {
    mockInvoke.mockRejectedValue(new Error("no app data"));
    await expect(runCommandCodeHelperPrompt(input)).rejects.toBeInstanceOf(
      HelperUnavailableError,
    );
    expect(mockSend).not.toHaveBeenCalled();
  });
});

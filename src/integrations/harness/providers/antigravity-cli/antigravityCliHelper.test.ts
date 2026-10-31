import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SendTurnInput } from "../../core/types";

const { mockInvoke, mockSend, mockForget } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
  mockSend: vi.fn(),
  mockForget: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mockInvoke }));
vi.mock("./antigravityCli", () => ({
  sendCliTurn: mockSend,
  forgetCliSession: mockForget,
}));

import { runAntigravityCliHelperPrompt } from "./antigravityCliHelper";
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

describe("runAntigravityCliHelperPrompt", () => {
  it("returns the streamed reply and always stops the process", async () => {
    mockSend.mockImplementation(async (turn: SendTurnInput) => {
      turn.onEvent({ type: "message.delta", text: " Fix " } as never);
      turn.onEvent({ type: "message.delta", text: "login " } as never);
    });
    await expect(runAntigravityCliHelperPrompt(input)).resolves.toBe("Fix login");
    const turn = mockSend.mock.calls[0]![0] as SendTurnInput;
    expect(turn.cwd).toBe("/helper");
    expect(turn.runtimeMode).toBe("supervised");
    expect(turn.sessionId).toMatch(/^antigravity-cli-helper:/);
    expect(mockForget).toHaveBeenCalledWith(turn.sessionId);
  });

  it("fails and stops the process when agy tries a tool", async () => {
    mockSend.mockImplementation(
      (turn: SendTurnInput) =>
        new Promise<void>(() => {
          turn.onEvent({ type: "tool.started" } as never);
        }),
    );
    await expect(runAntigravityCliHelperPrompt(input)).rejects.toBeInstanceOf(
      HelperToolAttemptError,
    );
    expect(mockForget).toHaveBeenCalledTimes(1);
  });

  it("times out a hung turn", async () => {
    vi.useFakeTimers();
    try {
      mockSend.mockReturnValue(new Promise<void>(() => undefined));
      const run = runAntigravityCliHelperPrompt({ ...input, timeoutMs: 100 });
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
    await expect(runAntigravityCliHelperPrompt(input)).rejects.toThrow(/empty/);
  });

  it("reports unavailable when the helper folder can't be made", async () => {
    mockInvoke.mockRejectedValue(new Error("no home"));
    await expect(runAntigravityCliHelperPrompt(input)).rejects.toBeInstanceOf(
      HelperUnavailableError,
    );
    expect(mockSend).not.toHaveBeenCalled();
  });
});

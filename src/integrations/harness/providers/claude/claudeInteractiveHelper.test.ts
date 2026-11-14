import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HarnessEvent } from "../../core/types";

const calls = vi.hoisted(() => ({
  send: vi.fn(),
  stop: vi.fn(async (_id: string) => undefined),
  forget: vi.fn(async (_id: string) => undefined),
  allowReads: vi.fn((_id: string, _allow: boolean) => undefined),
}));

vi.mock("./claudeInteractive", () => ({
  sendInteractiveClaude: calls.send,
  stopInteractiveClaude: calls.stop,
  forgetInteractiveClaude: calls.forget,
  allowInteractiveAttachmentReads: calls.allowReads,
}));
vi.mock("../../../../features/sessions/model/models", () => ({
  preferredModelId: () => "claude-default",
}));

import { runInteractiveClaudeHelper } from "./claudeInteractiveHelper";

type Input = {
  sessionId: string;
  model: string;
  modelSettings: Record<string, string>;
  runtimeMode: string;
  onEvent: (event: HarnessEvent) => void;
};

beforeEach(() => {
  calls.send.mockReset();
  calls.stop.mockClear();
  calls.forget.mockClear();
  calls.allowReads.mockClear();
});

describe("Interactive Claude helper (L-204)", () => {
  it("collects the reply from a fresh hidden session, then forgets it", async () => {
    calls.send.mockImplementation(async (input: Input) => {
      input.onEvent({ type: "message.delta", text: "Hello " });
      input.onEvent({ type: "message.delta", text: "board" });
    });
    const reply = await runInteractiveClaudeHelper({
      cwd: "C:/p",
      prompt: "hi",
      timeoutMs: 5000,
      modelSettings: { effort: "high" },
      purpose: "whiteboard",
    });
    expect(reply).toBe("Hello board");
    const sent = calls.send.mock.calls[0]![0] as Input;
    expect(sent.sessionId).toMatch(/^whiteboard-helper-/);
    expect(sent.model).toBe("claude-default");
    expect(sent.runtimeMode).toBe("supervised");
    expect(sent.modelSettings).toEqual({ effort: "high", claudeExecution: "interactive" });
    expect(calls.forget).toHaveBeenCalledWith(sent.sessionId);
  });

  it("sends attachments and lets Claude Read only them, for this call only (L-271)", async () => {
    calls.send.mockImplementation(async (input: Input) => {
      input.onEvent({ type: "message.delta", text: "A login form" });
    });
    const image = { id: "1", name: "shot.png", mimeType: "image/png", kind: "image" as const, size: 3, data: "AAAA" };
    await runInteractiveClaudeHelper({ cwd: "C:/p", prompt: "hi", timeoutMs: 5000, purpose: "whiteboard", attachments: [image] });
    const sent = calls.send.mock.calls[0]![0] as Input & { attachments?: unknown[] };
    expect(sent.attachments).toEqual([image]);
    expect(calls.allowReads.mock.calls).toEqual([
      [sent.sessionId, true],
      [sent.sessionId, false],
    ]);
  });

  it("stops Claude when it asks to use a tool", async () => {
    calls.send.mockImplementation(
      (input: Input) =>
        new Promise<void>(() => {
          input.onEvent({ type: "approval.requested" } as HarnessEvent);
        }),
    );
    await expect(
      runInteractiveClaudeHelper({ cwd: "C:/p", prompt: "hi", timeoutMs: 5000, purpose: "whiteboard" }),
    ).rejects.toThrow(/^AI helper tried to use a tool/);
    expect(calls.stop).toHaveBeenCalled();
    expect(calls.forget).toHaveBeenCalled();
  });

  it("stops Claude when the caller cancels", async () => {
    const controller = new AbortController();
    calls.send.mockImplementation(() => {
      queueMicrotask(() => controller.abort());
      return new Promise<void>(() => undefined);
    });
    await expect(
      runInteractiveClaudeHelper({
        cwd: "C:/p",
        prompt: "hi",
        timeoutMs: 5000,
        purpose: "whiteboard",
        signal: controller.signal,
      }),
    ).rejects.toThrow(/cancelled/);
    expect(calls.stop).toHaveBeenCalled();
  });

  it("refuses an empty reply", async () => {
    calls.send.mockResolvedValue(undefined);
    await expect(
      runInteractiveClaudeHelper({ cwd: "C:/p", prompt: "hi", timeoutMs: 5000, purpose: "whiteboard" }),
    ).rejects.toThrow(/empty output/);
  });
});

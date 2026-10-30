import { describe, expect, it } from "vitest";
import { askWhiteboardAgent, whiteboardAgentTargets } from "./whiteboardHelper";

const FENCE = "```";

describe("whiteboard agent helper", () => {
  it("returns the reply text and drawing changes", async () => {
    const prompts: string[] = [];
    const outcome = await askWhiteboardAgent({
      target: { provider: "claude" },
      cwd: "C:/tmp",
      prompt: "draw a box",
      isAvailable: () => true,
      run: async (_target, prompt) => {
        prompts.push(prompt);
        return `Done.\n${FENCE}whiteboard\n{"add":[{"type":"rectangle","x":0,"y":0}]}\n${FENCE}`;
      },
    });
    expect(prompts[0]).toContain("draw a box");
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.reply.text).toBe("Done.");
      expect(outcome.reply.ops?.add).toHaveLength(1);
    }
  });

  it("says plainly when the helper is not available", async () => {
    const outcome = await askWhiteboardAgent({
      target: { provider: "codex" },
      cwd: "C:/tmp",
      prompt: "x",
      isAvailable: () => false,
      run: async () => "never",
    });
    expect(outcome).toEqual({
      ok: false,
      cancelled: false,
      message: "Codex is not available as an AI helper.",
    });
  });

  it("reports a cancelled request as cancelled", async () => {
    const controller = new AbortController();
    const outcome = await askWhiteboardAgent({
      target: { provider: "claude" },
      cwd: "C:/tmp",
      prompt: "x",
      signal: controller.signal,
      isAvailable: () => true,
      run: async () => {
        controller.abort();
        return "late";
      },
    });
    expect(outcome).toMatchObject({ ok: false, cancelled: true });
  });

  it("lists the AI helper settings first, without repeats or unavailable providers", () => {
    const targets = whiteboardAgentTargets(
      {
        mode: "custom",
        primary: { provider: "codex", model: "gpt-6" },
        fallback: { provider: "claude" },
      } as Parameters<typeof whiteboardAgentTargets>[0],
      (target) => target.provider !== "opencode",
    );
    expect(targets[0]).toEqual({ provider: "codex", model: "gpt-6" });
    expect(targets[1]).toEqual({ provider: "claude" });
    expect(targets.filter((target) => target.provider === "claude")).toHaveLength(1);
    expect(targets.some((target) => target.provider === "opencode")).toBe(false);
  });
});

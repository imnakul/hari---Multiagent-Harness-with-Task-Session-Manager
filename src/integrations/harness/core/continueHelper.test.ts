import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runHarnessHelperPrompt: vi.fn(),
  isHarnessAvailable: vi.fn((_id: string) => true),
}));
vi.mock("./registry", () => ({ runHarnessHelperPrompt: mocks.runHarnessHelperPrompt }));
vi.mock("./availability", () => ({ isHarnessAvailable: mocks.isHarnessAvailable }));

import type { ContinueChoice } from "../../../features/sessions/model/continueCard";
import type { Block } from "../../../features/sessions/model/session";
import type { AiHelperTarget } from "../../../features/settings/model/settings";
import { HelperToolAttemptError } from "./helperIsolation";
import {
  continueHelperAvailable,
  continueHelperTargets,
  prepareContinueCard,
} from "./continueHelper";

const blocks: Block[] = [
  { id: "u1", role: "user", text: "Fix the login bug. Never touch the schema." },
  { id: "a1", role: "assistant", text: "Fixed in auth.ts." },
];
const choice = (over: Partial<ContinueChoice> = {}): ContinueChoice => ({
  target: { harness: "codex", model: "gpt", modelSettings: {} },
  preset: "balanced",
  ...over,
});
const CARD = "## Goal\nFix the login bug for every user.\n\n## Next step\nRun the tests.";
const all = () => true;

describe("continueHelperTargets (L-189)", () => {
  it("puts the chosen helper first, then Settings, source, target and the rest", () => {
    const targets = continueHelperTargets({
      choice: choice({ helper: { provider: "antigravity", model: "g" } }),
      sourceHarness: "claude",
      settings: { mode: "custom", primary: { provider: "opencode" }, fallback: null },
    });
    expect(targets.map((target) => target.provider)).toEqual([
      "antigravity",
      "opencode",
      "claude",
      "codex",
    ]);
  });

  it("skips providers that cannot be helpers", () => {
    const targets = continueHelperTargets({
      choice: choice({ target: { harness: "cursor", model: "m", modelSettings: {} } }),
      sourceHarness: "pi",
      settings: { mode: "automatic" },
    });
    expect(targets.map((target) => target.provider)).toEqual([
      "claude",
      "codex",
      "opencode",
      "antigravity",
    ]);
  });

  it("allows Antigravity when it is installed", () => {
    expect(continueHelperAvailable({ provider: "antigravity" })).toBe(true);
    mocks.isHarnessAvailable.mockReturnValueOnce(false);
    expect(continueHelperAvailable({ provider: "antigravity" })).toBe(false);
  });
});

describe("prepareContinueCard (L-189)", () => {
  it("returns the Quick card without calling a helper", async () => {
    const run = vi.fn();
    const result = await prepareContinueCard({
      blocks,
      cwd: "/repo",
      choice: choice({ preset: "quick" }),
      sourceHarness: "claude",
      run,
    });
    expect(run).not.toHaveBeenCalled();
    expect(result.note).toBe("Quick card");
    expect(result.card).toContain("## How the chat started");
  });

  it("falls back to the next helper when one tries a tool", async () => {
    const targets: AiHelperTarget[] = [{ provider: "antigravity" }, { provider: "claude" }];
    const run = vi.fn(async (target: AiHelperTarget, _prompt: string) => {
      if (target.provider === "antigravity") throw new HelperToolAttemptError("antigravity", "read");
      return CARD;
    });
    const result = await prepareContinueCard({
      blocks,
      cwd: "/repo",
      choice: choice(),
      sourceHarness: "claude",
      targets,
      isAvailable: all,
      run,
    });
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[0]![1]).toContain("Do not use any tools.");
    expect(result.helper).toEqual({ provider: "claude" });
    expect(result.note).toBe("Written by Claude Code · Antigravity ACP tried a tool");
    expect(result.card.startsWith(CARD)).toBe(true);
    expect(result.card).toContain("## User rules (verbatim)");
  });

  it("runs the check pass for two passes and keeps the draft when it fails", async () => {
    const run = vi
      .fn<(target: AiHelperTarget, prompt: string) => Promise<string>>()
      .mockResolvedValueOnce(CARD)
      .mockResolvedValueOnce(`${CARD}\n\n## Open questions\nNone so far.`);
    const checked = await prepareContinueCard({
      blocks,
      cwd: "/repo",
      choice: choice({ preset: "thorough" }),
      sourceHarness: "claude",
      targets: [{ provider: "codex" }],
      isAvailable: all,
      run,
    });
    expect(run.mock.calls[1]![1]).toContain("<card>\n## Goal");
    expect(checked.note).toBe("Written and checked by Codex");
    expect(checked.card).toContain("## Open questions\nNone so far.");

    const failing = vi
      .fn<(target: AiHelperTarget, prompt: string) => Promise<string>>()
      .mockResolvedValueOnce(CARD)
      .mockRejectedValue(new Error("request timed out"));
    const draft = await prepareContinueCard({
      blocks,
      cwd: "/repo",
      choice: choice({ passes: 2 }),
      sourceHarness: "claude",
      targets: [{ provider: "codex" }],
      isAvailable: all,
      run: failing,
    });
    expect(draft.note).toBe("Written by Codex (check took too long)");
    expect(draft.card.startsWith(CARD)).toBe(true);
  });

  it("uses the Quick card and says why when every helper fails", async () => {
    const result = await prepareContinueCard({
      blocks,
      cwd: "/repo",
      choice: choice(),
      sourceHarness: "claude",
      targets: [{ provider: "claude" }],
      isAvailable: all,
      run: async () => "no headings in this reply at all",
    });
    expect(result.note).toBe("Quick card used: Claude Code gave an unusable reply");
    expect(result.card).toContain("## How the chat started");
    const none = await prepareContinueCard({
      blocks,
      cwd: "/repo",
      choice: choice(),
      sourceHarness: "claude",
      targets: [{ provider: "claude" }],
      isAvailable: () => false,
      run: async () => CARD,
    });
    expect(none.note).toBe("Quick card used: no AI helper is available");
  });
});

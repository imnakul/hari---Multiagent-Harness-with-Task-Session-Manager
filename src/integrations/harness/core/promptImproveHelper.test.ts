import { describe, expect, it, vi } from "vitest";

vi.mock("./registry", () => ({ runHarnessHelperPrompt: vi.fn() }));
vi.mock("./availability", () => ({ isHarnessAvailable: () => true }));

import {
  DEFAULT_PROMPT_IMPROVE,
  EMPTY_PROMPT_MEMORY,
  memoryProjectKey,
  type PromptMemory,
} from "../../../features/prompt-improve/model/promptImproveStore";
import { HARNESS_TITLE } from "../../../features/sessions/model/session";
import type { AiHelperTarget } from "../../../features/settings/model/settings";
import { improvePrompt } from "./promptImproveHelper";

const claude: AiHelperTarget = { provider: "claude" };
const codex: AiHelperTarget = { provider: "codex", model: "m" };
const CWD = "/home/me/shop";
const memory: PromptMemory = {
  ...EMPTY_PROMPT_MEMORY,
  profile: "- terse",
  samples: [{ rewrite: "Fix it.", sent: "Fix the header.", at: 1 }],
  projects: {
    [memoryProjectKey(CWD)]: {
      name: "shop",
      glossary: "PDP = product page",
      rules: [{ text: "Use pnpm", count: 1 }],
    },
  },
};
const base = {
  text: "/plan fix the bug in src/a.ts quickly",
  cwd: CWD,
  harness: "claude" as const,
  settings: DEFAULT_PROMPT_IMPROVE,
  memory,
  targets: [claude, codex],
  isAvailable: () => true,
};

describe("improvePrompt (L-252)", () => {
  it("rewrites the draft, keeps the leading command and returns what to learn", async () => {
    const run = vi.fn(
      async () =>
        "<prompt>Fix the bug in src/a.ts.</prompt><learned>rule: Use pnpm</learned>",
    );
    const outcome = await improvePrompt({ ...base, run });
    expect(outcome).toEqual({
      ok: true,
      prompt: "/plan Fix the bug in src/a.ts.",
      learned: { styles: [], terms: [], rules: ["Use pnpm"] },
      usedSamples: 1,
      helper: claude,
    });
    const sent = run.mock.calls[0]![1] as string;
    expect(sent).toContain(
      "<draft>\nfix the bug in src/a.ts quickly\n</draft>",
    );
    expect(sent).not.toContain("/plan");
    expect(sent).toContain("Project: shop");
    expect(sent).toContain("PDP = product page");
    expect(sent).toContain("<owner_edits>");
  });

  it("sends no edits and learns nothing when learning is off", async () => {
    const run = vi.fn(
      async () =>
        "<prompt>Fix the bug in src/a.ts.</prompt><learned>rule: Use pnpm</learned>",
    );
    const outcome = await improvePrompt({
      ...base,
      settings: { ...DEFAULT_PROMPT_IMPROVE, learn: false },
      run,
    });
    expect(outcome).toMatchObject({
      ok: true,
      learned: { styles: [], terms: [], rules: [] },
      usedSamples: 0,
    });
    expect(run.mock.calls[0]![1]).not.toContain("<owner_edits>");
  });

  it("falls back to the next helper when the first needs sign-in", async () => {
    const run = vi.fn(async (target: AiHelperTarget) => {
      if (target.provider === "claude") throw new Error("401 unauthorized");
      return "<prompt>Fix src/a.ts.</prompt>";
    });
    const outcome = await improvePrompt({ ...base, run });
    expect(outcome).toMatchObject({
      ok: true,
      prompt: "/plan Fix src/a.ts.",
      helper: codex,
    });
  });

  it("explains every failure and leaves the text unchanged", async () => {
    const run = vi.fn(async (target: AiHelperTarget) => {
      if (target.provider === "claude") throw new Error("401 unauthorized");
      return "<prompt>Fix the bug in the file.</prompt>";
    });
    const outcome = await improvePrompt({ ...base, run });
    expect(outcome).toEqual({
      ok: false,
      cancelled: false,
      message: `Couldn't improve the prompt: ${HARNESS_TITLE.claude} needs sign-in, ${HARNESS_TITLE.codex} dropped part of your text. Your text is unchanged.`,
    });
  });

  it("skips helpers that are not installed", async () => {
    const run = vi.fn(async () => "<prompt>Fix src/a.ts.</prompt>");
    const outcome = await improvePrompt({
      ...base,
      isAvailable: () => false,
      run,
    });
    expect(outcome).toEqual({
      ok: false,
      cancelled: false,
      message:
        "Couldn't improve the prompt: no AI helper is available. Your text is unchanged.",
    });
    expect(run).not.toHaveBeenCalled();
  });

  it("stops quietly when cancelled", async () => {
    const controller = new AbortController();
    const run = vi.fn(async () => {
      controller.abort();
      return "<prompt>Fix src/a.ts.</prompt>";
    });
    const outcome = await improvePrompt({
      ...base,
      signal: controller.signal,
      run,
    });
    expect(outcome).toEqual({ ok: false, cancelled: true, message: "" });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("does not call a helper for an empty draft", async () => {
    const run = vi.fn(async () => "");
    const outcome = await improvePrompt({ ...base, text: "/plan   ", run });
    expect(outcome).toEqual({
      ok: false,
      cancelled: false,
      message: "There is nothing to improve yet.",
    });
    expect(run).not.toHaveBeenCalled();
  });
});

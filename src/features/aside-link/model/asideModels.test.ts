import { describe, expect, it } from "vitest";
import type { AgentModel } from "../../sessions/model/models";
import type { HarnessId } from "../../sessions/model/session";
import {
  asideEffort,
  asideModelId,
  asideProviders,
  asideSlug,
  parseAsideModelId,
} from "./asideModels";

const effort = (values: string[]) => ({
  id: "effort",
  label: "Effort",
  kind: "select" as const,
  value: values[0],
  options: values.map((value) => ({ value, label: value })),
});
const CATALOG: Partial<Record<HarnessId, AgentModel[]>> = {
  claude: [
    {
      id: "claude:opus-5-5",
      harness: "claude",
      name: "Claude Opus 5.5",
      contextWindow: 1_000_000,
      settings: [effort(["low", "medium", "high", "xhigh", "max", "ultracode"])],
    },
    { id: "claude:locked", harness: "claude", name: "Locked", locked: { reason: "plan" } },
  ],
  "command-code": [{ id: "cc:plain", harness: "command-code", name: "Plain" }],
};
const modelsFor = (harness: HarnessId) => CATALOG[harness] ?? [];

describe("asideProviders", () => {
  it("lists unlocked models with the Reasoning levels each one offers", () => {
    const providers = asideProviders(["claude", "command-code", "antigravity-cli"], modelsFor);
    expect(Object.keys(providers)).toEqual(["hari-claude-interactive", "hari-command-code"]);
    const [opus] = providers["hari-claude-interactive"].models;
    expect(providers["hari-claude-interactive"].models).toHaveLength(1);
    expect(opus).toMatchObject({
      id: "claude/claude:opus-5-5",
      reasoning: true,
      contextWindow: 1_000_000,
      thinkingLevelMap: { off: null, minimal: null, low: "low", xhigh: "xhigh", max: "max" },
      compat: { supportsReasoningEffort: true, sendSessionAffinityHeaders: true },
    });
    const [plain] = providers["hari-command-code"].models;
    expect(plain.reasoning).toBe(false);
    expect(plain.thinkingLevelMap).toBeUndefined();
  });

  it("skips harnesses that are not offered", () => {
    expect(asideProviders(["command-code"], modelsFor)).not.toHaveProperty(
      "hari-claude-interactive",
    );
  });

  it("offers each Claude account as its own provider when there are several", () => {
    const accounts = [
      { id: "default", label: "Default account" },
      { id: "account-1", label: "Work (Knoarc)" },
      { id: "account-2", label: "Work knoarc" },
      { id: "bad id!", label: "Broken" },
    ];
    const providers = asideProviders(["claude"], modelsFor, (harness) =>
      harness === "claude" ? accounts : [],
    );
    expect(Object.keys(providers)).toEqual([
      "hari-claude-interactive-default-account",
      "hari-claude-interactive-work-knoarc",
      "hari-claude-interactive-work-knoarc-2",
    ]);
    const work = providers["hari-claude-interactive-work-knoarc"];
    expect(work.name).toBe("Hari · Claude (Interactive) · Work (Knoarc)");
    expect(work.models[0].id).toBe("claude@account-1/claude:opus-5-5");
    for (const key of Object.keys(providers)) expect(key.length).toBeLessThanOrEqual(64);
  });

  it("keeps one provider when there is only one account", () => {
    const providers = asideProviders(["claude"], modelsFor, () => [
      { id: "default", label: "Default account" },
    ]);
    expect(Object.keys(providers)).toEqual(["hari-claude-interactive"]);
    expect(providers["hari-claude-interactive"].models[0].id).toBe("claude/claude:opus-5-5");
  });
});

describe("model IDs", () => {
  it("round-trip through Aside and refuse other harnesses", () => {
    expect(parseAsideModelId(asideModelId("claude", "claude:opus-5-5"))).toEqual({
      harness: "claude",
      modelId: "claude:opus-5-5",
    });
    expect(parseAsideModelId(asideModelId("claude", "claude:opus-5-5", "account-1"))).toEqual({
      harness: "claude",
      modelId: "claude:opus-5-5",
      accountId: "account-1",
    });
    expect(parseAsideModelId("claude@bad id/opus")).toBeUndefined();
    expect(parseAsideModelId("claude@a@b/opus")).toBeUndefined();
    expect(parseAsideModelId("codex/gpt")).toBeUndefined();
    expect(parseAsideModelId("claude/")).toBeUndefined();
    expect(parseAsideModelId("opus")).toBeUndefined();
  });
});

describe("asideSlug", () => {
  it("keeps letters and digits joined by single dashes", () => {
    expect(asideSlug("  Nakul's Work — 2 ")).toBe("nakul-s-work-2");
    expect(asideSlug("कार्य")).toBe("");
  });
});

describe("asideEffort", () => {
  it("keeps only an effort the model offers", () => {
    const [opus] = CATALOG.claude!;
    expect(asideEffort(opus, "xhigh")).toBe("xhigh");
    expect(asideEffort(opus, "minimal")).toBeUndefined();
    expect(asideEffort(opus, undefined)).toBeUndefined();
    expect(asideEffort(CATALOG["command-code"]![0], "high")).toBeUndefined();
  });
});

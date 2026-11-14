/**
 * Fork (L-274): MonoCode's models as Aside's custom providers, and Aside's
 * model and Reasoning choice back to a MonoCode model and effort.
 */
import { modelEffortSetting, type AgentModel } from "../../sessions/model/models";
import type { HarnessId } from "../../sessions/model/session";

export const ASIDE_HARNESSES = [
  { harness: "claude", provider: "monocode-claude", name: "Hari · Claude" },
  { harness: "command-code", provider: "monocode-command-code", name: "Hari · Command Code" },
  { harness: "antigravity-cli", provider: "monocode-antigravity-cli", name: "Hari · Antigravity" },
] as const satisfies readonly { harness: HarnessId; provider: string; name: string }[];

export type AsideHarness = (typeof ASIDE_HARNESSES)[number]["harness"];

/** Aside's Reasoning levels; `off` and `minimal` have no CLI equivalent. */
const ASIDE_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
const DEFAULT_CONTEXT_WINDOW = 200_000;
const MAX_OUTPUT_TOKENS = 32_000;

export type AsideModelEntry = {
  id: string;
  name: string;
  reasoning: boolean;
  thinkingLevelMap?: Record<string, string | null>;
  input: ["text"];
  cost: { input: 0; output: 0; cacheRead: 0; cacheWrite: 0 };
  contextWindow: number;
  maxTokens: number;
  compat: { supportsReasoningEffort: boolean; supportsDeveloperRole: boolean };
};

export type AsideProvider = { name: string; models: AsideModelEntry[] };

/** Aside's model ID for a MonoCode model; the harness rides along so it cannot be confused. */
export function asideModelId(harness: AsideHarness, modelId: string): string {
  return `${harness}/${modelId}`;
}

export function parseAsideModelId(
  id: string,
): { harness: AsideHarness; modelId: string } | undefined {
  const slash = id.indexOf("/");
  if (slash <= 0) return undefined;
  const harness = ASIDE_HARNESSES.find((entry) => entry.harness === id.slice(0, slash))?.harness;
  const modelId = id.slice(slash + 1);
  return harness && modelId ? { harness, modelId } : undefined;
}

function levelMap(model: AgentModel): Record<string, string | null> | undefined {
  const values = new Set(modelEffortSetting(model)?.options.map((option) => option.value));
  const map = Object.fromEntries(
    ASIDE_LEVELS.map((level) => [level, values.has(level) ? level : null]),
  );
  return Object.values(map).some((value) => value !== null) ? map : undefined;
}

function entry(harness: AsideHarness, model: AgentModel): AsideModelEntry {
  const thinkingLevelMap = levelMap(model);
  return {
    id: asideModelId(harness, model.id),
    name: model.name,
    reasoning: !!thinkingLevelMap,
    ...(thinkingLevelMap ? { thinkingLevelMap } : {}),
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: model.contextWindow ?? DEFAULT_CONTEXT_WINDOW,
    maxTokens: MAX_OUTPUT_TOKENS,
    compat: { supportsReasoningEffort: !!thinkingLevelMap, supportsDeveloperRole: false },
  };
}

/** Aside providers for the harnesses offered, skipping models the plan locks. */
export function asideProviders(
  harnesses: readonly AsideHarness[],
  modelsFor: (harness: HarnessId) => readonly AgentModel[],
): Record<string, AsideProvider> {
  return Object.fromEntries(
    ASIDE_HARNESSES.filter((entry) => harnesses.includes(entry.harness)).flatMap((provider) => {
      const models = modelsFor(provider.harness)
        .filter((model) => model.harness === provider.harness && !model.locked)
        .map((model) => entry(provider.harness, model));
      return models.length ? [[provider.provider, { name: provider.name, models }]] : [];
    }),
  );
}

/** The model's effort value for Aside's choice, when the model offers it. */
export function asideEffort(model: AgentModel, effort: string | undefined): string | undefined {
  const setting = modelEffortSetting(model);
  if (!setting || !effort) return undefined;
  return setting.options.some((option) => option.value === effort) ? effort : undefined;
}

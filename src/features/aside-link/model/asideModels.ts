/**
 * Fork (L-274, L-283): MonoCode's models as Aside's custom providers, and
 * Aside's model and Reasoning choice back to a MonoCode model, account and
 * effort. Aside's model picker shows the provider key, so the keys carry the
 * name the user reads: `hari-claude-interactive`, one per Claude account when
 * there are several.
 */
import { modelEffortSetting, type AgentModel } from "../../sessions/model/models";
import type { HarnessId } from "../../sessions/model/session";

export const ASIDE_HARNESSES = [
  { harness: "claude", provider: "hari-claude-interactive", name: "Hari · Claude (Interactive)" },
  { harness: "command-code", provider: "hari-command-code", name: "Hari · Command Code" },
  { harness: "antigravity-cli", provider: "hari-antigravity", name: "Hari · Antigravity" },
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
  compat: {
    supportsReasoningEffort: boolean;
    supportsDeveloperRole: boolean;
    /** Aside then names its chat in `x-session-affinity`, which keys the session. */
    sendSessionAffinityHeaders: true;
  };
};

export type AsideProvider = { name: string; models: AsideModelEntry[] };

/** A MonoCode account of a harness, offered as its own Aside provider. */
export type AsideAccount = { id: string; label: string };

const ACCOUNT_ID = /^[A-Za-z0-9_-]{1,80}$/;
const MAX_PROVIDER_KEY = 64;

/**
 * Aside's model ID for a MonoCode model. The harness, and the account when
 * the user has several, ride along so a choice can't be confused.
 */
export function asideModelId(harness: AsideHarness, modelId: string, accountId?: string): string {
  return `${harness}${accountId ? `@${accountId}` : ""}/${modelId}`;
}

export function parseAsideModelId(
  id: string,
): { harness: AsideHarness; modelId: string; accountId?: string } | undefined {
  const slash = id.indexOf("/");
  if (slash <= 0) return undefined;
  const [harnessPart, accountId, ...rest] = id.slice(0, slash).split("@");
  if (rest.length || (accountId !== undefined && !ACCOUNT_ID.test(accountId))) return undefined;
  const harness = ASIDE_HARNESSES.find((entry) => entry.harness === harnessPart)?.harness;
  const modelId = id.slice(slash + 1);
  if (!harness || !modelId) return undefined;
  return accountId === undefined ? { harness, modelId } : { harness, modelId, accountId };
}

/** Lowercase letters, digits and single dashes: the shape a provider key allows. */
export function asideSlug(text: string): string {
  return text
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** One provider key per account, from its label, unique among the harness's keys. */
function accountKeys(base: string, accounts: readonly AsideAccount[]): string[] {
  const used = new Set<string>();
  return accounts.map((account, index) => {
    const room = MAX_PROVIDER_KEY - base.length - 4;
    const slug = asideSlug(account.label).slice(0, room).replace(/-+$/, "") || String(index + 1);
    let key = `${base}-${slug}`;
    for (let suffix = 2; used.has(key); suffix += 1) key = `${base}-${slug}-${suffix}`;
    used.add(key);
    return key;
  });
}

function levelMap(model: AgentModel): Record<string, string | null> | undefined {
  const values = new Set(modelEffortSetting(model)?.options.map((option) => option.value));
  const map = Object.fromEntries(
    ASIDE_LEVELS.map((level) => [level, values.has(level) ? level : null]),
  );
  return Object.values(map).some((value) => value !== null) ? map : undefined;
}

function entry(harness: AsideHarness, model: AgentModel, accountId?: string): AsideModelEntry {
  const thinkingLevelMap = levelMap(model);
  return {
    id: asideModelId(harness, model.id, accountId),
    name: model.name,
    reasoning: !!thinkingLevelMap,
    ...(thinkingLevelMap ? { thinkingLevelMap } : {}),
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: model.contextWindow ?? DEFAULT_CONTEXT_WINDOW,
    maxTokens: MAX_OUTPUT_TOKENS,
    compat: {
      supportsReasoningEffort: !!thinkingLevelMap,
      supportsDeveloperRole: false,
      sendSessionAffinityHeaders: true,
    },
  };
}

/**
 * Aside providers for the harnesses offered, skipping models the plan locks.
 * A harness with more than one account gets a provider per account
 * (`hari-claude-interactive-work`), whose models start on that account.
 */
export function asideProviders(
  harnesses: readonly AsideHarness[],
  modelsFor: (harness: HarnessId) => readonly AgentModel[],
  accountsFor: (harness: AsideHarness) => readonly AsideAccount[] = () => [],
): Record<string, AsideProvider> {
  return Object.fromEntries(
    ASIDE_HARNESSES.filter((entry) => harnesses.includes(entry.harness)).flatMap((provider) => {
      const models = modelsFor(provider.harness).filter(
        (model) => model.harness === provider.harness && !model.locked,
      );
      if (!models.length) return [];
      const accounts = accountsFor(provider.harness).filter((account) => ACCOUNT_ID.test(account.id));
      if (accounts.length < 2)
        return [
          [
            provider.provider,
            { name: provider.name, models: models.map((model) => entry(provider.harness, model)) },
          ],
        ];
      const keys = accountKeys(provider.provider, accounts);
      return accounts.map((account, index) => [
        keys[index],
        {
          name: `${provider.name} · ${account.label}`,
          models: models.map((model) => entry(provider.harness, model, account.id)),
        },
      ]);
    }),
  );
}

/** The model's effort value for Aside's choice, when the model offers it. */
export function asideEffort(model: AgentModel, effort: string | undefined): string | undefined {
  const setting = modelEffortSetting(model);
  if (!setting || !effort) return undefined;
  return setting.options.some((option) => option.value === effort) ? effort : undefined;
}

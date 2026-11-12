import { invoke } from "@tauri-apps/api/core";
import {
  setHarnessModels,
  type AgentModel,
  type ModelSetting,
} from "../../../../features/sessions/model/models";
import { asRecord } from "./commandCodeProtocol";

/**
 * Plan whose models the user can run. Command Code's catalog does not say
 * which plan the signed-in account has, so it is fixed here.
 */
// TODO(nakul): read the account's plan once Command Code exposes it without the auth file.
export const COMMAND_CODE_ACCOUNT_PLAN = "individual-go";

/** Models on this plan bill per token instead of from a subscription. */
const PAY_PER_USE_PLAN = "individual-provider";

const EFFORT_LABELS: Record<string, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
  max: "Max",
};

type CatalogModel = {
  id: string;
  name?: string;
  contextLength?: number;
  efforts: string[];
  minimumPlan?: string;
  hidden: boolean;
  badge?: string;
  group?: string;
  label?: string;
  order: number;
};

let inflight: Promise<void> | null = null;

/**
 * Fork (L-259): load the model list Command Code caches for the signed-in
 * account. The cache appears after the CLI has run once; until then the
 * picker keeps "Account default".
 */
export function refreshCommandCodeCatalog(): Promise<void> {
  if (inflight) return inflight;
  inflight = invoke<string | null>("command_code_model_catalog")
    .then((raw) => {
      if (!raw) return;
      const models = commandCodeModelsFromCatalog(raw);
      if (models.length > 0) setHarnessModels("command-code", models);
    })
    .catch((error: unknown) => {
      console.debug("[monocode] command-code catalog", error);
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/**
 * Turns the cached catalog JSON into picker models: "Account default" first,
 * then each visible model with its group, efforts, Free badge and plan lock.
 * Malformed entries are skipped; a malformed file gives an empty list.
 */
export function commandCodeModelsFromCatalog(raw: string): AgentModel[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const body = asRecord(asRecord(parsed)?.body);
  if (!body || !Array.isArray(body.data)) return [];
  const entries = body.data.flatMap((item: unknown) => {
    const model = catalogModel(item);
    return model && !model.hidden ? [model] : [];
  });
  // Models the plan can run come first, so locked ones sink to each
  // provider group's end.
  const lockRank = (model: CatalogModel) =>
    commandCodePlanLock(model.minimumPlan) ? 1 : 0;
  entries.sort((a, b) => lockRank(a) - lockRank(b) || a.order - b.order);
  // The picker groups by provider and arrow keys follow list order, so each
  // group stays contiguous; groups with a usable model come first.
  const byGroup = new Map<string, CatalogModel[]>();
  for (const model of entries) {
    const key = model.group ?? "";
    byGroup.set(key, [...(byGroup.get(key) ?? []), model]);
  }
  const ordered = [...byGroup.values()].flat();
  const defaultId = optionalText(asRecord(body.roles)?.default);
  const defaultName = ordered.find((model) => model.id === defaultId);
  return [
    {
      id: "command-code:default",
      harness: "command-code",
      name: defaultName
        ? `Account default (${modelName(defaultName)})`
        : "Account default",
      nativeId: "",
    },
    ...ordered.map(toAgentModel),
  ];
}

function toAgentModel(model: CatalogModel): AgentModel {
  const group = model.group;
  const settings = effortSetting(model.efforts);
  const locked = commandCodePlanLock(model.minimumPlan);
  return {
    id: `command-code:${model.id}`,
    harness: "command-code",
    name: modelName(model),
    nativeId: model.id,
    ...(group
      ? { provider: { id: group.toLowerCase().replace(/\s+/g, "-"), name: group } }
      : {}),
    ...(settings ? { settings: [settings] } : {}),
    ...(model.contextLength ? { contextWindow: model.contextLength } : {}),
    ...(locked ? { locked } : {}),
    ...(model.badge === "free" ? { badge: "free" as const } : {}),
  };
}

/** Why a model on `minimumPlan` can't run on the account's plan, if so. */
export function commandCodePlanLock(
  minimumPlan: string | undefined,
): { reason: string } | undefined {
  if (!minimumPlan || minimumPlan === COMMAND_CODE_ACCOUNT_PLAN) return undefined;
  if (minimumPlan === PAY_PER_USE_PLAN) return { reason: "Pay per use" };
  const plan = minimumPlan.replace(/^individual-/, "");
  return { reason: `Needs ${plan.charAt(0).toUpperCase()}${plan.slice(1)} plan` };
}

function modelName(model: CatalogModel): string {
  return model.label ?? model.name ?? model.id;
}

function catalogModel(value: unknown): CatalogModel | undefined {
  const rec = asRecord(value);
  const id = optionalText(rec?.id);
  if (!rec || !id) return undefined;
  const display = asRecord(rec.display);
  const contextLength = rec.context_length;
  const order = display?.order;
  return {
    id,
    name: optionalText(rec.name),
    contextLength:
      typeof contextLength === "number" && contextLength > 0
        ? contextLength
        : undefined,
    efforts: Array.isArray(rec.reasoningEfforts)
      ? rec.reasoningEfforts.filter(
          (effort): effort is string => typeof effort === "string",
        )
      : [],
    minimumPlan: optionalText(rec.minimumPlan),
    hidden: rec.hidden === true,
    badge: optionalText(display?.badge),
    group: optionalText(display?.group),
    label: optionalText(display?.label),
    order:
      typeof order === "number" && Number.isFinite(order)
        ? order
        : Number.MAX_SAFE_INTEGER,
  };
}

function optionalText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function effortSetting(efforts: string[]): ModelSetting | undefined {
  const values = efforts.filter((value) => /^[a-z]+$/.test(value));
  if (values.length === 0) return undefined;
  return {
    id: "effort",
    label: "Reasoning",
    kind: "select",
    value: values.includes("medium") ? "medium" : values[0],
    options: values.map((value) => ({
      value,
      label: EFFORT_LABELS[value] ?? value.charAt(0).toUpperCase() + value.slice(1),
    })),
  };
}

import { pathKey } from "../../../shared/lib/paths";
import { AI_HELPER_PROVIDERS, type AiHelperTarget } from "../../settings/model/settings";
import type { ContinueChoice } from "./continueCard";
import { HARNESSES } from "./session";

/** Last Continue choice per project folder (L-189). */
const KEY = "monocode.continueChoice";
const MAX_PROJECTS = 50;

type Saved = Record<string, ContinueChoice>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseHelper(value: unknown): AiHelperTarget | null {
  if (!isRecord(value)) return null;
  const provider = AI_HELPER_PROVIDERS.find((id) => id === value.provider);
  if (!provider) return null;
  return {
    provider,
    ...(typeof value.accountId === "string" ? { accountId: value.accountId } : {}),
    ...(typeof value.model === "string" && value.model ? { model: value.model } : {}),
  };
}

export function parseContinueChoice(value: unknown): ContinueChoice | null {
  if (!isRecord(value) || !isRecord(value.target)) return null;
  const target = value.target;
  const harness = HARNESSES.find((id) => id === target.harness);
  const model = target.model;
  if (!harness || typeof model !== "string" || !model) return null;
  const settings = isRecord(target.modelSettings) ? target.modelSettings : {};
  const modelSettings: Record<string, string> = {};
  for (const [key, setting] of Object.entries(settings)) {
    if (typeof setting === "string") modelSettings[key] = setting;
  }
  const preset =
    value.preset === "quick" || value.preset === "thorough" ? value.preset : "balanced";
  const helper = parseHelper(value.helper);
  return {
    target: { harness, model, modelSettings },
    preset,
    ...(helper ? { helper } : {}),
    ...(value.passes === 1 || value.passes === 2 ? { passes: value.passes } : {}),
    ...(value.context === "short" || value.context === "long" ? { context: value.context } : {}),
  };
}

function readAll(): Saved {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return isRecord(raw) ? (raw as Saved) : {};
  } catch {
    return {};
  }
}

export function loadContinueChoice(projectCwd: string): ContinueChoice | null {
  return parseContinueChoice(readAll()[pathKey(projectCwd)]);
}

export function saveContinueChoice(projectCwd: string, choice: ContinueChoice): void {
  const key = pathKey(projectCwd);
  const rest = Object.entries(readAll()).filter(([entry]) => entry !== key);
  const next = Object.fromEntries([...rest.slice(-(MAX_PROJECTS - 1)), [key, choice]]);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage full or blocked: the panel falls back to its defaults next time.
  }
}

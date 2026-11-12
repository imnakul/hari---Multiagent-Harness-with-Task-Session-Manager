import { promptBlocks, type PromptContentBlock } from "../../../../features/sessions/model/attachments";
import type { AgentModel, ModelSetting } from "../../../../features/sessions/model/models";
import type { Attachment, RuntimeMode } from "../../../../features/sessions/model/session";
import { upstreamProviderName } from "../../core/providerNames";

/** Fork (L-255). The Windows launcher is `cmdc`; `cmd` is the system shell. */
export const COMMAND_CODE_AUTH_HELP =
  "Sign in with `cmdc login` in a terminal, then try again.";

export type CommandCodeModeId =
  | "default"
  | "auto-accept"
  | "plan"
  | "dont-ask"
  | "bypass";

/** One `select` config option the session advertised, such as `effort`. */
export type CommandCodeConfigOption = {
  id: string;
  currentValue: string;
  choices: string[];
};

/**
 * Map MonoCode access levels to Command Code's ACP modes. Plan always wins so
 * a plan turn can never edit, whatever the access level.
 */
export function commandCodeModeId(
  runtimeMode: RuntimeMode,
  planning = false,
): CommandCodeModeId {
  if (planning) return "plan";
  if (runtimeMode === "supervised") return "default";
  if (runtimeMode === "auto-accept-edits") return "auto-accept";
  if (runtimeMode === "auto") return "dont-ask";
  return "bypass";
}

/** Command Code accepts the standard ACP text, image, and resource blocks. */
export function commandCodePromptBlocks(
  text: string,
  attachments: Attachment[] = [],
): PromptContentBlock[] {
  return promptBlocks(text, attachments);
}

export function commandCodeSessionId(result: unknown): string | undefined {
  const rec = asRecord(result);
  const id = rec?.sessionId ?? rec?.session_id;
  return typeof id === "string" && id.trim() ? id.trim() : undefined;
}

export function commandCodeCurrentModelId(result: unknown): string | undefined {
  const models = asRecord(asRecord(result)?.models);
  const value = models?.currentModelId ?? models?.current_model_id;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function commandCodeCurrentModeId(result: unknown): string | undefined {
  const modes = asRecord(asRecord(result)?.modes);
  const value = modes?.currentModeId ?? modes?.current_mode_id;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** Read the `select` config options (model, effort) from session setup. */
export function commandCodeConfigOptions(
  value: unknown,
): CommandCodeConfigOption[] {
  const raw = Array.isArray(value) ? value : asRecord(value)?.configOptions;
  if (!Array.isArray(raw)) return [];
  const options: CommandCodeConfigOption[] = [];
  for (const item of raw) {
    const rec = asRecord(item);
    const id = typeof rec?.id === "string" ? rec.id.trim() : "";
    if (!rec || !id || rec.type !== "select") continue;
    const choices = Array.isArray(rec.options)
      ? rec.options
          .map((choice) => asRecord(choice)?.value)
          .filter((choice): choice is string => typeof choice === "string")
      : [];
    options.push({
      id,
      currentValue: String(rec.currentValue ?? rec.current_value ?? ""),
      choices,
    });
  }
  return options;
}

/**
 * The reasoning effort select, offered on every model. Command Code reports
 * it per session for the current model; a saved value the next model lacks is
 * skipped at send time instead of failing the turn.
 */
export function commandCodeEffortSetting(
  configOptions: unknown,
): ModelSetting | undefined {
  const raw = Array.isArray(configOptions)
    ? configOptions
    : asRecord(configOptions)?.configOptions;
  if (!Array.isArray(raw)) return undefined;
  for (const item of raw) {
    const rec = asRecord(item);
    if (!rec || rec.id !== "effort" || rec.type !== "select") continue;
    if (!Array.isArray(rec.options)) return undefined;
    const options = rec.options.flatMap((choice) => {
      const option = asRecord(choice);
      const value = option?.value;
      if (typeof value !== "string" || !value) return [];
      const name = typeof option?.name === "string" ? option.name : value;
      return [{ value, label: effortLabel(value, name) }];
    });
    if (options.length === 0) return undefined;
    const current = String(rec.currentValue ?? "");
    return {
      id: "effort",
      label: "Effort",
      kind: "select",
      value: options.some((option) => option.value === current)
        ? current
        : (options[0]?.value ?? ""),
      options,
    };
  }
  return undefined;
}

/** Read the standard ACP model list from `session/new`, current model first. */
export function modelsFromCommandCodeSession(result: unknown): AgentModel[] {
  const state = asRecord(asRecord(result)?.models);
  const raw = state?.availableModels ?? state?.available_models;
  if (!Array.isArray(raw)) return [];

  const effort = commandCodeEffortSetting(asRecord(result)?.configOptions);
  const seen = new Set<string>();
  const models: AgentModel[] = [];
  for (const item of raw) {
    const model = asRecord(item);
    if (!model) continue;
    const nativeId = String(model.modelId ?? model.model_id ?? "").trim();
    if (!nativeId || seen.has(nativeId)) continue;
    seen.add(nativeId);
    const name = String(model.name ?? nativeId).trim() || nativeId;
    models.push({
      id: `command-code:${nativeId}`,
      harness: "command-code",
      name,
      nativeId,
      provider: commandCodeModelProvider(nativeId),
      ...(effort ? { settings: [effort] } : {}),
    });
  }

  // The account's current model is the right default for a new chat;
  // setHarnessModels picks the first model of a generic catalog.
  const current = commandCodeCurrentModelId(result);
  if (current) {
    const index = models.findIndex((model) => model.nativeId === current);
    if (index > 0) models.unshift(...models.splice(index, 1));
  }
  return models;
}

/**
 * Hosted models are `vendor/model`; first-party Anthropic and OpenAI models
 * carry no vendor prefix, so group them by their family name instead.
 */
function commandCodeModelProvider(
  nativeId: string,
): NonNullable<AgentModel["provider"]> {
  const slash = nativeId.indexOf("/");
  const id =
    slash > 0
      ? nativeId.slice(0, slash).toLowerCase()
      : nativeId.startsWith("claude-")
        ? "anthropic"
        : nativeId.startsWith("gpt-")
          ? "openai"
          : "command-code";
  return {
    id,
    name: id === "command-code" ? "Command Code" : upstreamProviderName(id),
  };
}

function effortLabel(value: string, name: string): string {
  if (value === "xhigh") return "Extra high";
  return name || value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * Turn a startup failure into an actionable message. Command Code reports a
 * missing login as an ACP auth error; the CLI's own hint names `cmd login`,
 * which on Windows opens the system shell instead.
 */
export function commandCodeStartupError(error: unknown): Error {
  const detail = error instanceof Error ? error.message : String(error);
  if (isAuthFailure(detail)) {
    return new Error(`${detail.trim()}\n\n${COMMAND_CODE_AUTH_HELP}`);
  }
  if (/timed out/i.test(detail)) {
    return new Error(`Command Code did not start. ${COMMAND_CODE_AUTH_HELP}`);
  }
  return new Error(`Command Code did not start. ${detail}`);
}

/** Add the sign-in hint to a turn error only when it is about the login. */
export function commandCodeTurnError(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  return isAuthFailure(detail)
    ? `${detail.trim()}\n\n${COMMAND_CODE_AUTH_HELP}`
    : detail;
}

function isAuthFailure(detail: string): boolean {
  return /auth(?:entication|orization)? (?:required|failed)|not (?:signed|logged) in|unauthori[sz]ed|sign in|log ?in|(?:invalid|expired|missing) (?:api key|token|credential)/i.test(
    detail,
  );
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

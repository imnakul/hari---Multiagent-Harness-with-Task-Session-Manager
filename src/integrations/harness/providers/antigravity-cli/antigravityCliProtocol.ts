import type {
  AgentModel,
  ModelSetting,
} from "../../../../features/sessions/model/models";
import { modelsFor } from "../../../../features/sessions/model/models";
import type { ProcessedUsage } from "../../../../features/sessions/model/tokenAccounting";
import type { HarnessSessionInput } from "../../core/types";

export const CLI_HELP =
  "Install the official agy CLI, sign in once by running agy in a terminal, then Recheck Antigravity CLI in Providers.";
export const CLI_POLICY =
  "Antigravity CLI headless mode follows its saved permissions. Requests requiring confirmation are denied; use ACP for interactive approvals, or select Full access explicitly.";

export function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function nativeConversationId(value: unknown): string | undefined {
  return typeof value === "string" &&
    /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(value)
    ? value
    : undefined;
}

export function cliAgentName(settings?: Record<string, string>): string {
  const agent = settings?.antigravityAgent ?? "default";
  if (!/^[a-z\d][a-z\d_.-]{0,127}$/i.test(agent))
    throw new Error("Invalid Antigravity CLI agent name. Choose an available agent or Default agent.");
  return agent;
}

export function cliSpawnArgs(
  input: HarnessSessionInput,
  nativeId?: string,
): string[] {
  const args = [
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--print-timeout",
    "30m",
  ];
  const agent = cliAgentName(input.modelSettings);
  if (agent !== "default") args.push("--agent", agent);
  const model = input.model.startsWith("antigravity-cli:")
    ? input.model.slice("antigravity-cli:".length)
    : input.model;
  const effort = input.modelSettings?.effort;
  if (model && model !== "default")
    args.push(
      "--model",
      cliModelSlug(model, effort, modelsFor("antigravity-cli")),
    );
  // agy 1.4.11+ rejects --effort beside any named model; only its configured default takes it.
  else if (effort && EFFORTS.includes(effort)) args.push("--effort", effort);
  if (nativeId) {
    if (!nativeConversationId(nativeId))
      throw new Error(
        "Invalid Antigravity CLI conversation ID; ACP IDs cannot be resumed by the CLI.",
      );
    args.push("--conversation", nativeId);
  }
  if (input.runtimeMode === "full-access")
    args.push("--dangerously-skip-permissions");
  return args;
}

export function userMessage(text: string): string {
  return JSON.stringify({ event: "user", message: { content: text } });
}

const EFFORTS = ["low", "medium", "high"];
const VARIANT = /^(.+)-(low|medium|high)$/;

function effortSetting(values: string[]): ModelSetting {
  return {
    id: "effort",
    label: "Reasoning",
    kind: "select",
    value: values.includes("high") ? "high" : values[values.length - 1],
    options: values.map((value) => ({
      value,
      label: value[0].toUpperCase() + value.slice(1),
    })),
  };
}

/**
 * agy names its reasoning level in the slug (`gemini-3.8-flash-high`), so the
 * Reasoning choice picks the matching listed variant. A saved level the model
 * does not list keeps the saved slug instead of inventing one.
 */
export function cliModelSlug(
  slug: string,
  effort: string | undefined,
  models: AgentModel[],
): string {
  const variant = slug.match(VARIANT);
  if (!variant || !effort || effort === variant[2]) return slug;
  const group = models.find(
    (model) => model.nativeId?.match(VARIANT)?.[1] === variant[1],
  );
  const listed = group?.settings?.find((setting) => setting.id === "effort");
  return listed?.options.some((option) => option.value === effort)
    ? `${variant[1]}-${effort}`
    : slug;
}

/**
 * The official `agy models` output is a slug followed by its display name.
 * Variants that differ only by reasoning level become one model whose
 * Reasoning setting picks the variant.
 */
export function cliModels(output: string): AgentModel[] {
  const seen = new Set<string>();
  const rows = output
    .replace(/\x1b\[[0-9;]*m/g, "")
    .split(/\r?\n/)
    .flatMap((line) => {
      const match = line
        .trim()
        .match(/^([a-z\d][a-z\d._/-]*)(?:\t+| {2,})(.+)$/i);
      if (
        !match ||
        ["model", "slug", "name"].includes(match[1].toLowerCase()) ||
        seen.has(match[1])
      )
        return [];
      seen.add(match[1]);
      return [{ slug: match[1], name: match[2].trim() }];
    });
  const levels = new Map<string, string[]>();
  for (const row of rows) {
    const variant = row.slug.match(VARIANT);
    if (variant)
      levels.set(variant[1], [...(levels.get(variant[1]) ?? []), variant[2]]);
  }
  const grouped = new Set<string>();
  return rows.flatMap((row): AgentModel[] => {
    const base = row.slug.match(VARIANT)?.[1];
    const values = base ? (levels.get(base) ?? []) : [];
    if (!base || values.length < 2)
      return [
        {
          id: `antigravity-cli:${row.slug}`,
          harness: "antigravity-cli",
          nativeId: row.slug,
          name: row.name,
        },
      ];
    if (grouped.has(base)) return [];
    grouped.add(base);
    const setting = effortSetting(
      EFFORTS.filter((value) => values.includes(value)),
    );
    const slug = `${base}-${setting.value}`;
    const name = rows.find((item) => item.slug === slug)?.name ?? row.name;
    return [
      {
        id: `antigravity-cli:${slug}`,
        harness: "antigravity-cli",
        nativeId: slug,
        name: name.replace(/\s*\((?:low|medium|high)\)\s*$/i, ""),
        settings: [setting],
      },
    ];
  });
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : 0;
}

export function cliUsage(value: unknown): ProcessedUsage | undefined {
  const usage = record(value);
  if (
    !usage ||
    !["input_tokens", "output_tokens", "total_tokens"].some(
      (key) => typeof usage[key] === "number",
    )
  )
    return undefined;
  const input = count(usage.input_tokens),
    output = count(usage.output_tokens);
  return {
    input,
    output,
    total:
      typeof usage.total_tokens === "number"
        ? count(usage.total_tokens)
        : input + output,
    cachedInput: count(usage.cache_read_tokens),
    reasoning: count(usage.thinking_tokens),
  };
}

/** Cumulative process counters become per-turn counters, never context occupancy. */
export function usageDelta(
  current: ProcessedUsage,
  previous?: ProcessedUsage,
): ProcessedUsage {
  const subtract = (key: keyof ProcessedUsage): number =>
    Math.max(0, (current[key] ?? 0) - (previous?.[key] ?? 0));
  return {
    total: subtract("total"),
    input: subtract("input"),
    output: subtract("output"),
    cachedInput: subtract("cachedInput"),
    reasoning: subtract("reasoning"),
  };
}

/** Read-only CLI commands must not be sent into the user-message stream. */
export function reportArgs(text: string): string[] | undefined {
  const command = text.trim().toLowerCase();
  if (["/usage", "/quota", "/credits"].includes(command))
    return ["--print", command, "--print-timeout", "30s"];
  if (["/models", "/model"].includes(command)) return ["models"];
  return undefined;
}

export function validateCliPrompt(text: string): void {
  if (text.trimStart().startsWith("/"))
    throw new Error(
      "Antigravity CLI interactive slash commands are unavailable in a streaming chat. Use /usage or /models for reports; use the agy terminal for interactive controls and compaction.",
    );
}

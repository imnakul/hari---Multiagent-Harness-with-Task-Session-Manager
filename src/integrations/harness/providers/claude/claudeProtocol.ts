import type { NativeContextBreakdown } from "../../../../features/sessions/model/contextBreakdown";
import type {
  Attachment,
  RuntimeMode,
  TaskListItem,
  ToolPreview,
  TurnMetrics,
} from "../../../../features/sessions/model/session";
import {
  attachmentPathText,
  promptText,
} from "../../../../features/sessions/model/attachments";
import { parseResetTimestamp } from "../../../../features/providers/model/rateLimits";
import {
  isTaskListToolName,
  normalizeTaskListStatus,
  taskListFromToolInput,
} from "../../../../features/sessions/model/taskList";
import {
  questionPromptTitle,
  questionsFromUnknown,
  selectedAnswerLabels,
  type UserQuestionReply,
} from "../../../../features/sessions/model/userQuestion";
import {
  extractToolPreview,
  isAgentToolName,
  titleFromToolInput,
} from "../../core/preview";
import { streamTextDelta } from "../../core/streamText";
import { nativeModelId } from "../../../../features/sessions/model/models";
import type {
  ApprovalDecision,
  HarnessEvent,
  HarnessSessionInput,
} from "../../core/types";

/** Claude Code versions that first ship Opus 5.5 / Opus 5 / Sonnet 5 / Fable 5 / Opus 4.8 / 4.7. */
export const MINIMUM_CLAUDE_OPUS_5_5_VERSION = "2.1.280";
export const MINIMUM_CLAUDE_OPUS_5_VERSION = "2.1.219";
export const MINIMUM_CLAUDE_SONNET_5_VERSION = "2.1.197";
export const MINIMUM_CLAUDE_FABLE_5_VERSION = "2.1.169";
export const MINIMUM_CLAUDE_OPUS_4_8_VERSION = "2.1.154";
export const MINIMUM_CLAUDE_OPUS_4_7_VERSION = "2.1.111";

export const CLAUDE_SETTING_SOURCES = "user,project,local";

export const SUPPORTED_CLAUDE_IMAGE_MIME_TYPES = new Set([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export type ClaudePermissionMode =
  "default" | "plan" | "acceptEdits" | "auto" | "bypassPermissions";

export type ClaudeLiveKey = {
  account: string;
  model: string;
  cliEffort?: string;
  ultracode: boolean;
  fast?: string;
  thinking?: string;
  context?: string;
  runtimeMode: RuntimeMode;
  planning: boolean;
  hooks: boolean;
};

export type ClaudeSwitchStep =
  | { type: "set_model"; model: string }
  | { type: "set_permission_mode"; mode: ClaudePermissionMode };

export type ClaudeLiveSwitchPlan =
  | { kind: "reuse" }
  | { kind: "switch"; steps: ClaudeSwitchStep[] }
  | { kind: "restart"; reason: string };

export type ClaudeControlRequest = {
  requestId: string;
  subtype: string;
  toolName?: string;
  input?: Record<string, unknown>;
  toolUseId?: string;
  permissionSuggestions?: unknown;
};

export type ClaudeSessionRule = {
  toolName: string;
  ruleContent?: string;
};

export type ClaudeSessionPermissionUpdate =
  | {
      type: "addRules";
      rules: ClaudeSessionRule[];
      behavior: "allow";
      destination: "session";
    }
  | {
      type: "addDirectories";
      directories: string[];
      destination: "session";
    };

export type ClaudeSessionGrant = {
  updates: ClaudeSessionPermissionUpdate[];
  rules: ClaudeSessionRule[];
};

/**
 * Build Claude's server wildcard only when the configured names identify one
 * server unambiguously. Claude encodes MCP tool names as
 * `mcp__<server>__<tool>`; a wildcard for a shorter overlapping server would
 * also cover the longer server.
 */
export function claudeMcpServerGrant(
  toolName: string,
  configuredServerNames: string[],
  enabledServerNames: string[] = configuredServerNames,
): { serverName: string; grant: ClaudeSessionGrant } | null {
  if (!toolName.startsWith("mcp__") || /[*?\[\]{}]/.test(toolName)) return null;
  if (
    configuredServerNames.some((name) => !/^[A-Za-z0-9_-]+$/.test(name))
  ) {
    return null;
  }
  const names = [...new Set(configuredServerNames)];
  const candidates = names.filter(
    (name) =>
      toolName.startsWith(`mcp__${name}__`) &&
      toolName.length > `mcp__${name}__`.length,
  );
  if (candidates.length !== 1) return null;
  const serverName = candidates[0];
  if (!enabledServerNames.includes(serverName)) return null;
  if (
    names.some(
      (name) =>
        name !== serverName &&
        (name.startsWith(`${serverName}__`) ||
          serverName.startsWith(`${name}__`)),
    )
  ) {
    return null;
  }
  const rule = { toolName: `mcp__${serverName}__*` };
  return {
    serverName,
    grant: {
      updates: [
        {
          type: "addRules",
          rules: [rule],
          behavior: "allow",
          destination: "session",
        },
      ],
      rules: [rule],
    },
  };
}

export type ClaudeMappedLine = {
  events: HarnessEvent[];
  sessionId?: string;
  control?: ClaudeControlRequest;
  cancelRequestId?: string;
  turnCompleted?: {
    status: "completed" | "failed" | "interrupted" | "cancelled";
    error?: string;
  };
};

export type ClaudeCliSettings = {
  alwaysThinkingEnabled?: boolean;
  fastMode?: boolean;
  ultracode?: boolean;
  disableAllHooks?: boolean;
};

export function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

export function stringField(
  rec: Record<string, unknown> | null | undefined,
  key: string,
): string | undefined {
  if (!rec) return undefined;
  const value = rec[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

export function parseClaudeVersion(output: string): string | null {
  const match = output.match(/\d+\.\d+\.\d+/);
  return match?.[0] ?? null;
}

export function compareSemver(left: string, right: string): number {
  const a = left.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const b = right.split(".").map((part) => Number.parseInt(part, 10) || 0);
  for (let i = 0; i < 3; i += 1) {
    const delta = (a[i] ?? 0) - (b[i] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

/**
 * Supervised maps onto a flag like every other mode. Sending nothing left the
 * CLI free to fall back to `permissions.defaultMode` from the user's settings,
 * so a session the picker called Supervised could silently run as `auto`.
 * `default` is the value that asks; `manual` is its alias but needs CLI 2.1.200.
 */
export function runtimeModeToPermission(
  mode: RuntimeMode,
): ClaudePermissionMode {
  switch (mode) {
    case "auto-accept-edits":
      return "acceptEdits";
    case "auto":
      return "auto";
    case "full-access":
      return "bypassPermissions";
    default:
      return "default";
  }
}

/** Older model ids that reject `xhigh` and want `max` instead. */
const LEGACY_XHIGH_AS_MAX = new Set([
  "claude-opus-4-6",
  "claude-sonnet-4-6",
  "claude-opus-4-5",
  "claude-haiku-4-5",
  "claude-opus-4-1",
  "claude-opus-4-0",
  "claude-sonnet-4-0",
  "claude-sonnet-4-5",
]);

/**
 * Normalize a resolved Claude effort for `--effort`.
 * `ultracode` pairs with `xhigh`; `ultrathink` is a prompt prefix, not a CLI effort.
 */
export function normalizeClaudeCliEffort(
  effort: string | null | undefined,
  model: string | null | undefined,
): string | undefined {
  if (!effort || effort === "ultrathink") return undefined;
  if (effort === "ultracode") return "xhigh";
  if (effort === "xhigh" && model && LEGACY_XHIGH_AS_MAX.has(model)) {
    return "max";
  }
  if (effort === "max" && model === "claude-sonnet-4-6") return "high";
  return effort;
}

export function isClaudeUltracodeEffort(
  effort: string | null | undefined,
): boolean {
  return effort === "ultracode";
}

export function claudeLiveKey(
  input: Pick<
    HarnessSessionInput,
    "providerAccountId" | "model" | "modelSettings" | "runtimeMode" | "intent"
  >,
  hooks: boolean,
): ClaudeLiveKey {
  const model = nativeModelId(input.model);
  const effort = input.modelSettings?.effort;
  return {
    account: input.providerAccountId ?? "default",
    model,
    cliEffort: normalizeClaudeCliEffort(effort, model),
    ultracode: isClaudeUltracodeEffort(effort),
    fast: input.modelSettings?.fast,
    thinking: input.modelSettings?.thinking,
    context: input.modelSettings?.context ?? undefined,
    runtimeMode: input.runtimeMode,
    planning: input.intent === "plan",
    hooks,
  };
}

function permissionModeForLiveKey(key: ClaudeLiveKey): ClaudePermissionMode {
  return key.planning ? "plan" : runtimeModeToPermission(key.runtimeMode);
}

export function planClaudeLiveSwitch(
  previous: ClaudeLiveKey,
  next: ClaudeLiveKey,
): ClaudeLiveSwitchPlan {
  if (
    previous.account === next.account &&
    previous.model === next.model &&
    previous.cliEffort === next.cliEffort &&
    previous.ultracode === next.ultracode &&
    previous.fast === next.fast &&
    previous.thinking === next.thinking &&
    previous.context === next.context &&
    previous.runtimeMode === next.runtimeMode &&
    previous.planning === next.planning &&
    previous.hooks === next.hooks
  ) {
    return { kind: "reuse" };
  }
  if (previous.account !== next.account) {
    return { kind: "restart", reason: "provider account changed" };
  }
  if (previous.hooks !== next.hooks) {
    return { kind: "restart", reason: "Claude hooks setting changed" };
  }
  if (previous.context !== next.context) {
    return { kind: "restart", reason: "Claude context setting changed" };
  }
  if (previous.thinking !== next.thinking) {
    return { kind: "restart", reason: "Claude thinking setting changed" };
  }
  if (previous.fast !== next.fast) {
    return { kind: "restart", reason: "Claude fast setting changed" };
  }
  if (
    previous.cliEffort !== next.cliEffort ||
    previous.ultracode !== next.ultracode
  ) {
    return { kind: "restart", reason: "Claude CLI effort changed" };
  }
  const previousPermission = permissionModeForLiveKey(previous);
  const nextPermission = permissionModeForLiveKey(next);
  if (
    previousPermission !== nextPermission &&
    (previousPermission === "bypassPermissions" ||
      nextPermission === "bypassPermissions")
  ) {
    return { kind: "restart", reason: "full access requires a spawn flag" };
  }
  if (
    previous.runtimeMode !== next.runtimeMode &&
    (previous.runtimeMode === "full-access" ||
      next.runtimeMode === "full-access")
  ) {
    return { kind: "restart", reason: "full access requires a spawn flag" };
  }

  const steps: ClaudeSwitchStep[] = [];
  if (previousPermission !== nextPermission) {
    steps.push({
      type: "set_permission_mode",
      mode: nextPermission,
    });
  }
  if (previous.model !== next.model) {
    steps.push({
      type: "set_model",
      model: resolveClaudeApiModelId(next.model, next.context),
    });
  }
  return { kind: "switch", steps };
}

export function applyClaudePromptEffortPrefix(
  text: string,
  effort: string | null | undefined,
): string {
  if (effort !== "ultrathink") return text;
  if (!text) return "Ultrathink:";
  return `Ultrathink:\n${text}`;
}

export function resolveClaudeApiModelId(
  model: string,
  context?: string | null,
): string {
  if (context === "1m") return `${model}[1m]`;
  return model;
}

export function buildSetModelRequest(model: string): Record<string, unknown> {
  return { subtype: "set_model", model };
}

export function buildSetPermissionModeRequest(
  mode: ClaudePermissionMode,
): Record<string, unknown> {
  return { subtype: "set_permission_mode", mode };
}

export function parseJsonLine(line: string): Record<string, unknown> | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    return asRecord(JSON.parse(trimmed));
  } catch {
    return null;
  }
}

/**
 * `humanAuthored` marks a message the user typed. Claude Code reads the
 * top-level `origin: { kind: "human" }` on stdin messages and reports the turn
 * as `cc_turn_origin=human` instead of `sdk` in its billing attribution.
 * Leave it off for app-generated turns so the label stays truthful.
 */
export function buildClaudeUserMessage(input: {
  text: string;
  attachments?: Attachment[];
  effort?: string | null;
  humanAuthored?: boolean;
}): Record<string, unknown> {
  const text = applyClaudePromptEffortPrefix(
    promptText(input.text, input.attachments ?? []),
    input.effort,
  );
  const content: Array<Record<string, unknown>> = [];
  if (text) content.push({ type: "text", text });
  for (const attachment of input.attachments ?? []) {
    content.push(
      imageContentBlock(attachment) ?? {
        type: "text",
        text: attachmentPathText(attachment),
      },
    );
  }
  return {
    type: "user",
    session_id: "",
    parent_tool_use_id: null,
    message: {
      role: "user",
      content,
    },
    ...(input.humanAuthored ? { origin: { kind: "human" } } : {}),
  };
}

function imageContentBlock(
  attachment: Attachment,
): Record<string, unknown> | null {
  if (attachment.kind !== "image" || !attachment.data) return null;
  const mime = normalizeImageMime(attachment.mimeType);
  if (!SUPPORTED_CLAUDE_IMAGE_MIME_TYPES.has(mime)) return null;
  return {
    type: "image",
    source: {
      type: "base64",
      media_type: mime,
      data: attachment.data,
    },
  };
}

function normalizeImageMime(mime: string): string {
  if (mime === "image/jpg") return "image/jpeg";
  return mime;
}

export function buildClaudeSpawnArgs(input: {
  model?: string;
  effort?: string;
  permissionMode?: ClaudePermissionMode;
  resume?: string;
  sessionId?: string;
  forkSession?: boolean;
  resumeSessionAt?: string;
  settings?: ClaudeCliSettings;
  includePartialMessages?: boolean;
  maxTurns?: number;
  isolated?: boolean;
  allowedTools?: string[];
  noTools?: boolean;
}): string[] {
  const args = [
    "--output-format",
    "stream-json",
    "--verbose",
    "--input-format",
    "stream-json",
  ];
  if (!input.isolated) {
    args.push("--permission-prompt-tool", "stdio");
  }
  if (input.allowedTools?.length) {
    args.push("--allowedTools", ...input.allowedTools);
  }
  if (input.includePartialMessages !== false) {
    args.push("--include-partial-messages");
  }
  // Isolated spawns are MonoCode's own helper calls (titles, summaries); the
  // user's hooks have no business firing there. Interactive sessions inherit
  // whatever the caller decided so `~/.claude` hooks keep working.
  const settings: ClaudeCliSettings = {
    ...input.settings,
    ...(input.isolated ? { disableAllHooks: true } : {}),
  };
  if (input.isolated) {
    args.push("--no-session-persistence");
    args.push("--strict-mcp-config");
    args.push("--mcp-config", JSON.stringify({ mcpServers: {} }));
    args.push("--settings", JSON.stringify(settings));
  } else {
    args.push(`--setting-sources=${CLAUDE_SETTING_SOURCES}`);
    args.push("--settings", JSON.stringify(settings));
  }
  if (input.noTools) {
    args.push("--tools", "", "--disable-slash-commands");
  }
  if (input.model) args.push("--model", input.model);
  if (input.effort) args.push("--effort", input.effort);
  if (input.permissionMode) {
    args.push("--permission-mode", input.permissionMode);
  }
  if (input.permissionMode === "bypassPermissions") {
    args.push("--allow-dangerously-skip-permissions");
  }
  if (input.resume) args.push("--resume", input.resume);
  if (input.sessionId && (!input.resume || input.forkSession))
    args.push("--session-id", input.sessionId);
  if (input.forkSession) args.push("--fork-session");
  if (input.resumeSessionAt)
    args.push("--resume-session-at", input.resumeSessionAt);
  if (input.maxTurns) args.push("--max-turns", String(input.maxTurns));
  return args;
}

/** Claude's SDK-hosted Remote Control request (undocumented stream-json API). */
export function buildRemoteControlRequest(
  enabled: boolean,
  name?: string,
): Record<string, unknown> {
  const request: Record<string, unknown> = {
    subtype: "remote_control",
    enabled,
  };
  const trimmedName = name?.trim();
  if (trimmedName) {
    request.name = [...trimmedName].slice(0, 80).join("");
  }
  return request;
}

export type ClaudeRemoteControlResponse = {
  sessionUrl: string;
  bridgeSessionId?: string;
};

/** Only HTTPS session links are safe to expose to the UI. */
export function parseRemoteControlResponse(
  payload: Record<string, unknown>,
): ClaudeRemoteControlResponse | null {
  const rawUrl = stringField(payload, "session_url")?.trim();
  if (!rawUrl) return null;
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:" || !url.hostname) return null;
  } catch {
    return null;
  }
  const bridgeSessionId = stringField(payload, "bridge_session_id")?.trim();
  return {
    sessionUrl: rawUrl,
    ...(bridgeSessionId ? { bridgeSessionId } : {}),
  };
}

export function isRemoteControlConsentError(message: string): boolean {
  return message.toLowerCase().includes("one-time confirmation");
}

export function buildControlRequest(
  requestId: string,
  request: Record<string, unknown>,
): Record<string, unknown> {
  return {
    type: "control_request",
    request_id: requestId,
    request,
  };
}

export function buildControlResponse(
  requestId: string,
  response: Record<string, unknown>,
): Record<string, unknown> {
  return {
    type: "control_response",
    response: {
      subtype: "success",
      request_id: requestId,
      response,
    },
  };
}

export type ClaudeControlResponse = {
  requestId: string;
  ok: boolean;
  payload: Record<string, unknown> | null;
  error?: string;
};

export function parseControlResponse(
  rec: Record<string, unknown>,
): ClaudeControlResponse | null {
  if (stringField(rec, "type") !== "control_response") return null;
  const nested = asRecord(rec.response);
  const requestId =
    stringField(nested, "request_id") ?? stringField(rec, "request_id") ?? "";
  if (!requestId) return null;
  const subtype = stringField(nested, "subtype") ?? "";
  if (subtype === "error") {
    return {
      requestId,
      ok: false,
      payload: null,
      error: stringField(nested, "error") ?? "control request failed",
    };
  }
  if (subtype && subtype !== "success") return null;
  return {
    requestId,
    ok: true,
    payload: asRecord(nested?.response) ?? {},
  };
}

/** Rows from a `list_models` control response, or null if this line is something else. */
export function listModelsFromControlResponse(
  rec: Record<string, unknown>,
  requestId: string,
): unknown[] | null {
  const parsed = parseControlResponse(rec);
  if (!parsed || parsed.requestId !== requestId) return null;
  if (!parsed.ok) return [];
  return Array.isArray(parsed.payload?.models) ? parsed.payload.models : [];
}

export function isClaudeInitMessage(rec: Record<string, unknown>): boolean {
  const type = stringField(rec, "type");
  const subtype = stringField(rec, "subtype");
  return type === "system" && (subtype === "init" || subtype === "initialized");
}

export function toClaudePermissionResult(
  decision: ApprovalDecision,
  input: Record<string, unknown>,
  updatedPermissions?: ClaudeSessionPermissionUpdate[],
): Record<string, unknown> {
  if (decision === "allow") {
    return {
      behavior: "allow",
      updatedInput: input,
      ...(updatedPermissions?.length ? { updatedPermissions } : {}),
    };
  }
  return {
    behavior: "deny",
    message: "User declined tool execution.",
  };
}

export function parseControlRequest(
  rec: Record<string, unknown>,
): ClaudeControlRequest | null {
  const type = stringField(rec, "type");
  if (type !== "control_request" && type !== "sdk_control_request") {
    return null;
  }
  const nested = asRecord(rec.request);
  const requestId =
    stringField(rec, "request_id") ?? stringField(nested, "request_id") ?? "";
  const subtype =
    stringField(nested, "subtype") ?? stringField(rec, "subtype") ?? "";
  if (!requestId || !subtype) return null;
  const input =
    asRecord(nested?.input) ??
    asRecord(nested?.tool_input) ??
    asRecord(rec.input) ??
    {};
  return {
    requestId,
    subtype,
    toolName: stringField(nested, "tool_name") ?? stringField(rec, "tool_name"),
    input,
    permissionSuggestions:
      nested?.permission_suggestions ?? rec.permission_suggestions,
    toolUseId:
      stringField(nested, "tool_use_id") ??
      stringField(nested, "toolUseID") ??
      stringField(rec, "tool_use_id"),
  };
}

/** Keep only Claude-suggested allow rules and directories, scoped to this process session. */
export function claudeSessionRules(
  toolName: string,
  suggestions: unknown,
): ClaudeSessionGrant | null {
  const updates: ClaudeSessionPermissionUpdate[] = [];
  const rules: ClaudeSessionRule[] = [];

  if (Array.isArray(suggestions)) {
    for (const candidate of suggestions) {
      const suggestion = asRecord(candidate);
      if (suggestion?.type === "addRules" && suggestion.behavior === "allow") {
        const suggestedRules = suggestion.rules;
        if (!Array.isArray(suggestedRules) || suggestedRules.length === 0) {
          continue;
        }
        const parsedRules: ClaudeSessionRule[] = [];
        for (const candidateRule of suggestedRules) {
          const rule = asRecord(candidateRule);
          if (
            typeof rule?.toolName !== "string" ||
            rule.toolName.length === 0 ||
            (rule.ruleContent !== undefined &&
              typeof rule.ruleContent !== "string")
          ) {
            parsedRules.length = 0;
            break;
          }
          parsedRules.push({
            toolName: rule.toolName,
            ...(typeof rule.ruleContent === "string"
              ? { ruleContent: rule.ruleContent }
              : {}),
          });
        }
        if (parsedRules.length === 0) continue;
        updates.push({
          type: "addRules",
          rules: parsedRules,
          behavior: "allow",
          destination: "session",
        });
        rules.push(...parsedRules);
      } else if (suggestion?.type === "addDirectories") {
        const directories = suggestion.directories;
        if (
          !Array.isArray(directories) ||
          directories.length === 0 ||
          !directories.every(
            (directory): directory is string =>
              typeof directory === "string" && directory.length > 0,
          )
        ) {
          continue;
        }
        updates.push({
          type: "addDirectories",
          directories,
          destination: "session",
        });
      }
    }
  }

  if (updates.length === 0 && toolName.startsWith("mcp__")) {
    const fallbackRule = { toolName };
    return {
      updates: [
        {
          type: "addRules",
          rules: [fallbackRule],
          behavior: "allow",
          destination: "session",
        },
      ],
      rules: [fallbackRule],
    };
  }

  return updates.length > 0 ? { updates, rules } : null;
}

export function parseControlCancelId(
  rec: Record<string, unknown>,
): string | undefined {
  if (stringField(rec, "type") !== "control_cancel_request") return undefined;
  return (
    stringField(rec, "request_id") ??
    stringField(asRecord(rec.request), "request_id")
  );
}

export function sessionIdFromMessage(
  rec: Record<string, unknown>,
): string | undefined {
  const type = stringField(rec, "type");
  const subtype = stringField(rec, "subtype");
  if (type === "system" && subtype?.startsWith("hook_")) return undefined;
  // Subagents can carry their own session id. Rebinding the parent to it
  // would drop resume for the conversation the user is actually in.
  const parent = rec.parent_tool_use_id;
  if (typeof parent === "string" && parent.length > 0) return undefined;
  return stringField(rec, "session_id");
}

/**
 * Claude Code pings `system/status` for every request lifecycle step
 * ("requesting", "responding", …). Codex and opencode only emit status text for
 * notable events — retries, warnings, compaction — so drop the lifecycle chatter
 * here and keep the transcript comparable across harnesses.
 */
const LIFECYCLE_STATUSES = new Set([
  "requesting",
  "request",
  "responding",
  "response",
  "streaming",
  "thinking",
  "working",
  "running",
  "pending",
  "queued",
  "waiting",
  "in_progress",
  "tool_use",
  "idle",
  "done",
  "completed",
  "status",
  "compact",
]);

export function statusTextFromSystem(
  rec: Record<string, unknown>,
): string | undefined {
  if (stringField(rec, "type") !== "system") return undefined;
  const subtype = stringField(rec, "subtype") ?? "";
  const compact = subtype.startsWith("compact");
  if (subtype !== "status" && !compact) return undefined;
  // Prose lives in `message`; `status` carries the bare lifecycle token.
  const text = (stringField(rec, "message") ?? "").trim();
  const notable =
    text && !LIFECYCLE_STATUSES.has(text.toLowerCase().replace(/[\s.…]+$/, ""));
  if (notable) return text;
  // Compaction is worth one row even when the CLI sends no prose with it.
  return compact ? "Compacted context" : undefined;
}

export function turnStatusFromResult(rec: Record<string, unknown>): {
  status: "completed" | "failed" | "interrupted" | "cancelled";
  error?: string;
} {
  const subtype = stringField(rec, "subtype") ?? "";
  if (subtype === "success") return { status: "completed" };
  const errors = Array.isArray(rec.errors)
    ? rec.errors.filter((item): item is string => typeof item === "string")
    : [];
  const joined = errors.join(" ").toLowerCase();
  const terminal = stringField(rec, "terminal_reason") ?? "";
  if (
    terminal === "aborted_tools" ||
    terminal === "aborted_streaming" ||
    joined.includes("interrupt")
  ) {
    return { status: "interrupted" };
  }
  if (joined.includes("cancel")) return { status: "cancelled" };
  const error = errors.find((item) => !item.startsWith("[ede_diagnostic]"));
  return { status: "failed", error: error ?? "Claude turn failed." };
}

/**
 * A `rate_limit_event` that refuses requests, with when its window resets.
 * `null` once requests are allowed again, while extra usage is paying for
 * them and the turn goes on, or when only the extra-usage pool is refused:
 * fast mode bills to it, and Claude Code drops to standard speed and goes on
 * under the plan.
 */
export function usageLimitFromRateLimitEvent(
  rec: Record<string, unknown>,
): { resetsAt?: number } | null {
  const info = asRecord(rec.rate_limit_info);
  if (stringField(info, "status") !== "rejected") return null;
  if (info?.isUsingOverage === true) return null;
  if (stringField(info, "rateLimitType") === "overage") return null;
  const resetsAt = parseResetTimestamp(info?.resetsAt);
  return resetsAt != null ? { resetsAt } : {};
}

const USAGE_LIMIT_TEXT = /hit your (?:usage )?limit|usage limit reached/i;

/** Claude also ends a limited turn with the limit as its error text. */
export function isUsageLimitResult(rec: Record<string, unknown>): boolean {
  if (rec.is_error !== true) return false;
  const errors = Array.isArray(rec.errors)
    ? rec.errors.filter((item): item is string => typeof item === "string")
    : [];
  return [stringField(rec, "result") ?? "", ...errors].some((text) =>
    USAGE_LIMIT_TEXT.test(text),
  );
}

export function streamDeltaFromEvent(
  rec: Record<string, unknown>,
): { kind: "assistant" | "reasoning"; text: string } | null {
  const event = asRecord(rec.event);
  if (!event || stringField(event, "type") !== "content_block_delta") {
    return null;
  }
  const delta = asRecord(event.delta);
  const deltaType = stringField(delta, "type") ?? "";
  if (deltaType === "text_delta") {
    const text = streamTextDelta(delta?.text);
    return text ? { kind: "assistant", text } : null;
  }
  if (deltaType === "thinking_delta") {
    const text = streamTextDelta(delta?.thinking);
    return text ? { kind: "reasoning", text } : null;
  }
  return null;
}

export function toolStartFromEvent(rec: Record<string, unknown>): {
  index: number;
  id: string;
  name: string;
  input: Record<string, unknown>;
} | null {
  const event = asRecord(rec.event);
  if (!event || stringField(event, "type") !== "content_block_start") {
    return null;
  }
  const block = asRecord(event.content_block);
  if (!block) return null;
  const blockType = stringField(block, "type") ?? "";
  if (
    blockType !== "tool_use" &&
    blockType !== "server_tool_use" &&
    blockType !== "mcp_tool_use"
  ) {
    return null;
  }
  const id = stringField(block, "id");
  const name = stringField(block, "name");
  if (!id || !name) return null;
  const index = typeof event.index === "number" ? event.index : -1;
  return {
    index,
    id,
    name,
    input: asRecord(block.input) ?? {},
  };
}

export function inputJsonDeltaFromEvent(
  rec: Record<string, unknown>,
): { index: number; partial: string } | null {
  const event = asRecord(rec.event);
  if (!event || stringField(event, "type") !== "content_block_delta") {
    return null;
  }
  const delta = asRecord(event.delta);
  if (stringField(delta, "type") !== "input_json_delta") return null;
  const partial =
    typeof delta?.partial_json === "string" ? delta.partial_json : "";
  if (!partial) return null;
  const index = typeof event.index === "number" ? event.index : -1;
  return { index, partial };
}

export function isSubagentMessage(rec: Record<string, unknown>): boolean {
  const parent = rec.parent_tool_use_id;
  return typeof parent === "string" && parent.length > 0;
}

/**
 * On resume, the CLI re-reports every background task the session started
 * that it considers unfinished — even ones already stopped and reported —
 * and answers each with an empty, zero-turn result. That result belongs to
 * no turn, so it must not end the one MonoCode is waiting on.
 */
export function isReplayedTaskNotificationResult(
  rec: Record<string, unknown>,
): boolean {
  return (
    stringField(asRecord(rec.origin), "kind") === "task-notification" &&
    rec.num_turns === 0
  );
}

export function isAgentTaskType(taskType: string | undefined): boolean {
  const key = (taskType ?? "").toLowerCase();
  return key === "local_agent" || key === "remote_agent";
}

export type ClaudeAgentTaskStarted = {
  taskId: string;
  toolUseId?: string;
  description: string;
  taskType: string;
  backgrounded: boolean;
  ambient: boolean;
};

export function parseTaskStarted(
  rec: Record<string, unknown>,
): ClaudeAgentTaskStarted | null {
  if (
    stringField(rec, "type") !== "system" ||
    stringField(rec, "subtype") !== "task_started"
  ) {
    return null;
  }
  const taskId = stringField(rec, "task_id");
  if (!taskId) return null;
  return {
    taskId,
    toolUseId: stringField(rec, "tool_use_id"),
    description: stringField(rec, "description") ?? "Subagent",
    taskType: stringField(rec, "task_type") ?? "",
    backgrounded: rec.is_backgrounded === true,
    ambient: rec.ambient === true,
  };
}

export type ClaudeAgentTaskProgress = {
  taskId: string;
  toolUseId?: string;
  description: string;
  subagentType?: string;
  lastToolName?: string;
  summary?: string;
};

export function parseTaskProgress(
  rec: Record<string, unknown>,
): ClaudeAgentTaskProgress | null {
  if (
    stringField(rec, "type") !== "system" ||
    stringField(rec, "subtype") !== "task_progress"
  ) {
    return null;
  }
  const taskId = stringField(rec, "task_id");
  if (!taskId) return null;
  return {
    taskId,
    toolUseId: stringField(rec, "tool_use_id"),
    description: stringField(rec, "description") ?? "Subagent",
    subagentType: stringField(rec, "subagent_type"),
    lastToolName: stringField(rec, "last_tool_name"),
    summary: stringField(rec, "summary"),
  };
}

export type ClaudeAgentTaskUpdated = {
  taskId: string;
  status?: string;
  description?: string;
  error?: string;
  backgrounded?: boolean;
};

export function parseTaskUpdated(
  rec: Record<string, unknown>,
): ClaudeAgentTaskUpdated | null {
  if (
    stringField(rec, "type") !== "system" ||
    stringField(rec, "subtype") !== "task_updated"
  ) {
    return null;
  }
  const taskId = stringField(rec, "task_id");
  const patch = asRecord(rec.patch) ?? {};
  if (!taskId) return null;
  const backgrounded =
    patch.is_backgrounded === true
      ? true
      : patch.is_backgrounded === false
        ? false
        : undefined;
  return {
    taskId,
    status: stringField(patch, "status"),
    description: stringField(patch, "description"),
    error: stringField(patch, "error"),
    ...(backgrounded !== undefined ? { backgrounded } : {}),
  };
}

export type ClaudeAgentTaskNotification = {
  taskId: string;
  toolUseId?: string;
  status: string;
  summary: string;
  ambient: boolean;
};

export function parseTaskNotification(
  rec: Record<string, unknown>,
): ClaudeAgentTaskNotification | null {
  if (
    stringField(rec, "type") !== "system" ||
    stringField(rec, "subtype") !== "task_notification"
  ) {
    return null;
  }
  const taskId = stringField(rec, "task_id");
  if (!taskId) return null;
  return {
    taskId,
    toolUseId: stringField(rec, "tool_use_id"),
    status: stringField(rec, "status") ?? "completed",
    summary: stringField(rec, "summary") ?? "",
    ambient: rec.ambient === true,
  };
}

export type ClaudeBackgroundTask = {
  taskId: string;
  taskType: string;
  description: string;
};

/** Every task Claude is running for the session: subagents, shells, monitors. */
export function parseBackgroundTasks(
  rec: Record<string, unknown>,
): ClaudeBackgroundTask[] | null {
  if (
    stringField(rec, "type") !== "system" ||
    stringField(rec, "subtype") !== "background_tasks_changed"
  ) {
    return null;
  }
  const tasks = Array.isArray(rec.tasks) ? rec.tasks : [];
  return tasks.flatMap((item) => {
    const row = asRecord(item);
    if (!row || row.ambient === true) return [];
    const taskId = stringField(row, "task_id");
    const taskType = stringField(row, "task_type") ?? "";
    if (!taskId) return [];
    return [
      {
        taskId,
        taskType,
        description: stringField(row, "description") ?? "Subagent",
      },
    ];
  });
}

export type ClaudeToolProgress = {
  toolUseId: string;
  parentToolUseId?: string;
  toolName?: string;
  subagentType?: string;
};

export function parseToolProgress(
  rec: Record<string, unknown>,
): ClaudeToolProgress | null {
  if (stringField(rec, "type") !== "tool_progress") return null;
  const toolUseId = stringField(rec, "tool_use_id");
  if (!toolUseId) return null;
  const parent = stringField(rec, "parent_tool_use_id");
  return {
    toolUseId,
    ...(parent ? { parentToolUseId: parent } : {}),
    toolName: stringField(rec, "tool_name"),
    subagentType: stringField(rec, "subagent_type"),
  };
}

export function isTerminalAgentTaskStatus(status: string | undefined): boolean {
  const key = (status ?? "").toLowerCase();
  return (
    key === "completed" ||
    key === "failed" ||
    key === "killed" ||
    key === "stopped"
  );
}

export function assistantTextBlocks(rec: Record<string, unknown>): string[] {
  const message = asRecord(rec.message);
  const content = message?.content;
  if (!Array.isArray(content)) return [];
  return content.flatMap((block) => {
    const row = asRecord(block);
    if (stringField(row, "type") !== "text") return [];
    const text = typeof row?.text === "string" ? row.text : "";
    return text ? [text] : [];
  });
}

/** Reasoning a message carries, used to mirror a subagent's thinking. */
export function assistantThinkingBlocks(
  rec: Record<string, unknown>,
): string[] {
  const message = asRecord(rec.message);
  const content = message?.content;
  if (!Array.isArray(content)) return [];
  return content.flatMap((block) => {
    const row = asRecord(block);
    if (stringField(row, "type") !== "thinking") return [];
    const text = typeof row?.thinking === "string" ? row.thinking : "";
    return text ? [text] : [];
  });
}

/** Provider id of an assistant message, for keying steps mirrored from it. */
export function assistantMessageId(
  rec: Record<string, unknown>,
): string | undefined {
  return stringField(asRecord(rec.message), "id");
}

export function assistantToolUses(rec: Record<string, unknown>): Array<{
  id: string;
  name: string;
  input: Record<string, unknown>;
}> {
  const message = asRecord(rec.message);
  const content = message?.content;
  if (!Array.isArray(content)) return [];
  return content.flatMap((block) => {
    const row = asRecord(block);
    if (!row || stringField(row, "type") !== "tool_use") return [];
    const id = stringField(row, "id");
    const name = stringField(row, "name");
    if (!id || !name) return [];
    return [{ id, name, input: asRecord(row.input) ?? {} }];
  });
}

export function toolResultsFromUserMessage(
  rec: Record<string, unknown>,
): Array<{
  toolUseId: string;
  isError: boolean;
  text: string;
}> {
  const message = asRecord(rec.message);
  const content = message?.content;
  if (!Array.isArray(content)) return [];
  return content.flatMap((block) => {
    const row = asRecord(block);
    if (!row || stringField(row, "type") !== "tool_result") return [];
    const toolUseId = stringField(row, "tool_use_id");
    if (!toolUseId) return [];
    const text = toolResultText(row.content);
    return [
      {
        toolUseId,
        isError: row.is_error === true,
        text,
      },
    ];
  });
}

function toolResultText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value
    .flatMap((block) => {
      if (typeof block === "string") return [block];
      const row = asRecord(block);
      if (
        stringField(row, "type") === "text" &&
        typeof row?.text === "string"
      ) {
        return [row.text];
      }
      return [];
    })
    .join("");
}

export function extractExitPlanModePlan(value: unknown): string | undefined {
  const rec = asRecord(value);
  const plan = stringField(rec, "plan");
  return plan;
}

export function extractAskUserQuestionTitle(
  input: Record<string, unknown>,
): string {
  return questionPromptTitle(questionsFromUnknown(input)) || "Claude question";
}

export function askUserQuestionAllowInput(
  input: Record<string, unknown>,
  reply?: UserQuestionReply,
): Record<string, unknown> {
  const questions = questionsFromUnknown(input);
  const answers: Record<string, string> = {};
  if (reply?.kind === "answered") {
    for (const question of questions) {
      const labels = selectedAnswerLabels(question, reply);
      if (labels.length === 0) continue;
      answers[question.prompt] = question.multiSelect
        ? labels.join(", ")
        : (labels[0] ?? "");
    }
  }
  return { questions: input.questions, answers };
}

export function tryParseJsonRecord(
  value: string,
): Record<string, unknown> | undefined {
  try {
    return asRecord(JSON.parse(value)) ?? undefined;
  } catch {
    return undefined;
  }
}

export function taskListFromTodos(
  input: Record<string, unknown>,
): TaskListItem[] | null {
  return taskListFromToolInput("TodoWrite", input);
}

export function isTodoTool(toolName: string): boolean {
  return isTaskListToolName(toolName);
}

/**
 * Newer Claude Code builds replace TodoWrite with incremental task tools:
 * TaskCreate adds one item and TaskUpdate changes one item by id.
 */
export function isClaudeTaskTool(toolName: string): boolean {
  return ["TaskCreate", "TaskUpdate", "TaskList", "TaskGet"].includes(
    toolName.trim(),
  );
}

/**
 * Fold one successful TaskCreate/TaskUpdate call into the session's task map.
 * Returns true when the visible list changed. TaskCreate only learns its id
 * from the result text ("Task #3 created successfully: ...").
 */
export function applyClaudeTaskTool(
  tasks: Map<string, TaskListItem>,
  toolName: string,
  input: Record<string, unknown>,
  resultText: string,
): boolean {
  const name = toolName.trim();
  if (name === "TaskCreate") {
    const text = [input.subject, input.activeForm, input.description]
      .find(
        (value): value is string => typeof value === "string" && !!value.trim(),
      )
      ?.trim();
    const id = resultText.match(/Task #([^\s:]+)/)?.[1];
    if (!text || !id) return false;
    tasks.set(id, { id, text, status: "pending" });
    return true;
  }
  if (name === "TaskUpdate") {
    const rawId = input.taskId;
    const id =
      typeof rawId === "number" && Number.isFinite(rawId)
        ? String(rawId)
        : typeof rawId === "string"
          ? rawId.trim().replace(/^#/, "")
          : "";
    const current = id ? tasks.get(id) : undefined;
    if (!current) return false;
    const status = stringField(input, "status")?.trim().toLowerCase();
    if (status === "deleted") {
      tasks.delete(id);
      return true;
    }
    const subject = stringField(input, "subject")?.trim();
    tasks.set(id, {
      ...current,
      ...(subject ? { text: subject } : {}),
      ...(status ? { status: normalizeTaskListStatus(status) } : {}),
    });
    return true;
  }
  return false;
}

export function toolKindFromName(toolName: string): string {
  const normalized = toolName.toLowerCase();
  if (isTodoTool(toolName) || isClaudeTaskTool(toolName)) return "tasks";
  if (
    normalized.includes("bash") ||
    normalized.includes("command") ||
    normalized.includes("shell") ||
    normalized.includes("terminal")
  ) {
    return "execute";
  }
  if (
    normalized.includes("edit") ||
    normalized.includes("write") ||
    normalized.includes("patch") ||
    normalized.includes("replace") ||
    normalized.includes("multiedit")
  ) {
    return "edit";
  }
  if (normalized === "read" || normalized.includes("read")) return "read";
  if (
    normalized.includes("grep") ||
    normalized.includes("glob") ||
    normalized.includes("search") ||
    normalized.includes("websearch")
  ) {
    return "search";
  }
  if (normalized === "skill" || normalized === "skills") return "skill";
  if (isAgentToolName(toolName)) return "agent";
  return toolName;
}

export function toolTitle(
  name: string,
  input: Record<string, unknown>,
): string {
  return titleFromToolInput(name, toolKindFromName(name), input);
}

export function previewFromTool(
  name: string,
  input: Record<string, unknown>,
  output?: string,
): ToolPreview | undefined {
  const kind = toolKindFromName(name);
  return extractToolPreview(
    {
      title: name,
      name,
      kind,
      input,
      rawInput: input,
      content: output,
    },
    {
      title: name,
      name,
      kind,
      rawInput: input,
    },
  );
}

export function summarizeToolRequest(
  toolName: string,
  input: Record<string, unknown>,
): string {
  const command = stringField(input, "command") ?? stringField(input, "cmd");
  if (command) return `${toolName}: ${command.slice(0, 400)}`;
  const description = stringField(input, "description");
  if (description) return description;
  try {
    const serialized = JSON.stringify(input);
    if (serialized.length <= 400) return `${toolName}: ${serialized}`;
    return `${toolName}: ${serialized.slice(0, 397)}...`;
  } catch {
    return toolName;
  }
}

export function claudeSettingsKey(input: {
  model: string;
  effort?: string;
  fast?: string;
  thinking?: string;
  context?: string;
  runtimeMode: RuntimeMode;
  hooks?: boolean;
}): string {
  return [
    input.model,
    input.effort ?? "",
    input.fast ?? "",
    input.thinking ?? "",
    input.context ?? "",
    input.runtimeMode,
    input.hooks === false ? "nohooks" : "hooks",
  ].join("|");
}

function numberField(
  rec: Record<string, unknown> | null | undefined,
  key: string,
): number {
  const value = rec?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * Tokens occupying the window for one request.
 *
 * Cached reads still take up window space, so they count the same as fresh
 * input; output counts because it carries into the next request.
 */
function contextUsedFromUsage(usage: Record<string, unknown> | null): number {
  if (!usage) return 0;
  return (
    numberField(usage, "input_tokens") +
    numberField(usage, "cache_creation_input_tokens") +
    numberField(usage, "cache_read_input_tokens") +
    numberField(usage, "output_tokens")
  );
}

/** Aggregate token accounting for the completed Claude turn. */
export function turnMetricsFromResult(
  rec: Record<string, unknown>,
): TurnMetrics | undefined {
  const usage = asRecord(rec.usage);
  if (!usage) return undefined;
  const inputTokens = numberField(usage, "input_tokens");
  const outputTokens = numberField(usage, "output_tokens");
  const cacheReadTokens = numberField(usage, "cache_read_input_tokens");
  const cacheWriteTokens = numberField(usage, "cache_creation_input_tokens");
  const cacheReported =
    "cache_read_input_tokens" in usage ||
    "cache_creation_input_tokens" in usage;
  const cacheableInput = inputTokens + cacheReadTokens + cacheWriteTokens;
  if (!inputTokens && !outputTokens && !cacheableInput) return undefined;
  return {
    ...(inputTokens ? { inputTokens } : {}),
    ...(outputTokens ? { outputTokens } : {}),
    ...(cacheReadTokens ? { cacheReadTokens } : {}),
    ...(cacheWriteTokens ? { cacheWriteTokens } : {}),
    ...(cacheReported && cacheableInput
      ? { cacheHitPercent: (cacheReadTokens / cacheableInput) * 100 }
      : {}),
  };
}

/**
 * Context level from an `assistant` message. Callers must skip subagent
 * messages — subagents run their own window and would make the reading jump.
 */
export function contextUsedFromAssistant(
  rec: Record<string, unknown>,
): number | undefined {
  const usage = asRecord(asRecord(rec.message)?.usage);
  if (!usage) return undefined;
  const used = contextUsedFromUsage(usage);
  return used > 0 ? used : undefined;
}

/**
 * Context level and window from a turn `result`.
 *
 * `usage` at the top level sums every iteration of the turn, so the last entry
 * of `usage.iterations` is what actually sits in the window. `modelUsage`
 * carries the window itself, which is why we let the CLI tell us rather than
 * keeping a model table in sync.
 */
export function contextFromResult(
  rec: Record<string, unknown>,
): { used?: number; window?: number } | undefined {
  const usage = asRecord(rec.usage);
  const iterations = Array.isArray(usage?.iterations) ? usage.iterations : [];
  const last = asRecord(iterations[iterations.length - 1]);
  const used = contextUsedFromUsage(last ?? usage);

  let window: number | undefined;
  const modelUsage = asRecord(rec.modelUsage);
  for (const entry of Object.values(modelUsage ?? {})) {
    const contextWindow = numberField(asRecord(entry), "contextWindow");
    if (contextWindow > 0) {
      window = Math.max(window ?? 0, contextWindow);
    }
  }

  if (!used && !window) return undefined;
  return { used: used > 0 ? used : undefined, window };
}

/** Summary numbers are reported by Claude Code and may include its local estimates. */
export function parseClaudeContextUsage(
  payload: unknown,
): NativeContextBreakdown | null {
  const record = (value: unknown): Record<string, unknown> | null =>
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null; // Unknown protocol objects are narrowed before field access.
  const number = (value: unknown): value is number =>
    typeof value === "number" && Number.isFinite(value) && value >= 0;
  const root = record(payload);
  if (!root || !number(root.totalTokens) || !number(root.maxTokens))
    return null;
  const result: NativeContextBreakdown = {
    source: "claude",
    totalTokens: root.totalTokens,
    windowTokens: root.maxTokens,
    categories: [],
    mcpServers: [],
    memoryFiles: [],
  };
  if (typeof root.model === "string") result.model = root.model;
  if (number(root.autoCompactThreshold))
    result.autoCompactThreshold = root.autoCompactThreshold;
  for (const key of ["categories", "memoryFiles", "mcpTools"]) {
    if (root[key] !== undefined && !Array.isArray(root[key])) return null;
  }
  for (const value of Array.isArray(root.categories) ? root.categories : []) {
    const item = record(value);
    if (!item || typeof item.name !== "string" || !number(item.tokens))
      return null;
    const kind = item.kind ?? "used";
    if (
      kind !== "used" &&
      kind !== "free" &&
      kind !== "buffer" &&
      kind !== "deferred"
    )
      return null;
    result.categories.push({ name: item.name, tokens: item.tokens, kind });
  }
  for (const value of Array.isArray(root.memoryFiles) ? root.memoryFiles : []) {
    const item = record(value);
    if (!item || typeof item.path !== "string" || !number(item.tokens))
      return null;
    result.memoryFiles.push({ path: item.path, tokens: item.tokens });
  }
  for (const value of Array.isArray(root.mcpTools) ? root.mcpTools : []) {
    const item = record(value);
    if (!item || typeof item.serverName !== "string" || !number(item.tokens))
      return null;
    let server = result.mcpServers.find(
      (entry) => entry.serverName === item.serverName,
    );
    if (!server) {
      server = {
        serverName: item.serverName,
        tokens: 0,
        toolCount: 0,
        deferredTools: 0,
      };
      result.mcpServers.push(server);
    }
    server.tokens += item.tokens;
    server.toolCount += 1;
    if (item.isLoaded === false) server.deferredTools += 1;
  }
  if (root.skills !== undefined) {
    const skills = record(root.skills);
    if (!skills || !number(skills.includedSkills) || !number(skills.tokens))
      return null;
    result.skills = { count: skills.includedSkills, tokens: skills.tokens };
  }
  if (root.messageBreakdown !== undefined) {
    const messages = record(root.messageBreakdown);
    if (!messages) return null;
    const keys = [
      "toolCallTokens",
      "toolResultTokens",
      "attachmentTokens",
      "assistantMessageTokens",
      "userMessageTokens",
      "unattributedTokens",
    ];
    if (keys.some((key) => !number(messages[key]))) return null;
    result.messages = {
      toolCalls: Number(messages.toolCallTokens),
      toolResults: Number(messages.toolResultTokens),
      attachments: Number(messages.attachmentTokens),
      assistant: Number(messages.assistantMessageTokens),
      user: Number(messages.userMessageTokens),
      unattributed: Number(messages.unattributedTokens),
    };
  }
  return result;
}

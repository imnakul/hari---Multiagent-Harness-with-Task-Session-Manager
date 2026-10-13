import type {
  HarnessEvent,
  HarnessSessionInput,
} from "../../../integrations/harness/core/types";
import type { HarnessId } from "../../sessions/model/session";
import type { ProcessedUsage } from "../../sessions/model/tokenAccounting";
import type { ProviderRateLimits } from "../../providers/model/rateLimits";

export type UsageScope =
  "message" | "turn" | "session-cumulative" | "sdk-result" | "last-response";
export type UsageMeasurement = {
  identity: string;
  timestamp?: string;
  scope: UsageScope;
  model?: string;
  uncachedInput?: number;
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  cacheWrite5m?: number;
  cacheWrite1h?: number;
  reasoning?: number;
  costUsd?: number;
};
export type TraceContext = {
  provider: HarnessId;
  sessionId?: string;
  nativeId?: string;
  accountId?: string;
  submissionId?: string;
  attemptId?: string;
  turnId?: string;
  processId?: string;
  model?: string;
  effort?: string;
  settings?: Record<string, string>;
  runtimeMode?: string;
  purpose: string;
  activity: "local" | "remote-control" | "unknown";
  authorship?: "user" | "automation";
};
export type TraceEvent = TraceContext & {
  id: string;
  at: number;
  updatedAt: number;
  source: string;
  kind: string;
  identity: string;
  state?: string;
  durationMs?: number;
  toolName?: string;
  requestId?: string;
  responseId?: string;
  providerTurnId?: string;
  code?: number | null;
  contextUsed?: number;
  contextWindow?: number;
  usage?: UsageMeasurement;
};
export type QuotaObservation = {
  provider: string;
  accountId: string;
  at: number;
  windows: {
    name: string;
    usedPercent: number;
    resetsAt: number | null;
    windowMinutes: number;
  }[];
};
export type TraceSnapshot = {
  enabled: boolean;
  events: readonly TraceEvent[];
  quotas: readonly QuotaObservation[];
  dropped: number;
  startedAt: number;
};

export const TRACE_LIMIT = 2000;
const IDENTITY_LIMIT = 6000;
const listeners = new Set<() => void>();
let snapshot: TraceSnapshot = {
  enabled: true,
  events: [],
  quotas: [],
  dropped: 0,
  startedAt: Date.now(),
};
const identities = new Map<string, string>();
const contexts = new Map<string, TraceContext>();
const externalContexts = new Map<string, TraceContext>();
const helperContexts = new Map<string, TraceContext>();
let notification: ReturnType<typeof setTimeout> | undefined;
let sequence = 0;
/** Independent of App's turn generation, which can reset when a chat reopens. */
export function nextSubmissionIdentity(): string {
  return `submission-${++sequence}`;
}

/** Diagnostics are disposable. No observer failure may escape into execution. */
export function diagnosticOnly(action: () => void): void {
  try {
    action();
  } catch {
    /* Deliberately isolated from provider execution. */
  }
}

function publish(): void {
  if (notification || !listeners.size) return;
  notification = setTimeout(() => {
    notification = undefined;
    for (const listener of listeners) diagnosticOnly(listener);
  }, 250);
}

export function subscribeTrace(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function getTrace(): TraceSnapshot {
  return snapshot;
}
export function setCapture(enabled: boolean): void {
  if (!enabled) {
    contexts.clear();
    externalContexts.clear();
    helperContexts.clear();
  }
  snapshot = { ...snapshot, enabled };
  publish();
}
export function clearTrace(): void {
  identities.clear();
  contexts.clear();
  externalContexts.clear();
  helperContexts.clear();
  snapshot = {
    enabled: snapshot.enabled,
    events: [],
    quotas: [],
    dropped: 0,
    startedAt: Date.now(),
  };
  publish();
}

/** Only categorical metadata accepts strings. Never pass prompt-derived labels. */
export function metadataLabel(value: unknown): string | undefined {
  return typeof value === "string" && /^[a-zA-Z0-9_.:/+-]{1,128}$/.test(value)
    ? value
    : undefined;
}
export function finiteCount(value: unknown): number | undefined {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= Number.MAX_SAFE_INTEGER
    ? value
    : undefined;
}
export function knownSettings(
  values: Record<string, string> | undefined,
): Record<string, string> | undefined {
  const result: Record<string, string> = {};
  for (const key of [
    "effort",
    "reasoningEffort",
    "thinking",
    "fast",
    "context",
  ]) {
    const value = values?.[key];
    if (
      value &&
      value.length <= 32 &&
      /^(true|false|low|medium|high|xhigh|max|minimal|ultracode|ultrathink|auto|none|default|[0-9]+[km]?)$/.test(
        value,
      )
    )
      result[key] = value;
  }
  return Object.keys(result).length ? result : undefined;
}
export function recordTrace(
  context: TraceContext,
  kind: string,
  identity: string,
  fields: Pick<
    TraceEvent,
    | "source"
    | "state"
    | "durationMs"
    | "toolName"
    | "requestId"
    | "responseId"
    | "providerTurnId"
    | "code"
    | "contextUsed"
    | "contextWindow"
    | "usage"
  >,
): void {
  diagnosticOnly(() => {
    if (!snapshot.enabled) return;
    if (
      identity.length > 256 ||
      [
        context.sessionId,
        context.nativeId,
        context.submissionId,
        context.turnId,
        context.accountId,
        fields.requestId,
      ].some((id) => id !== undefined && id.length > 256)
    )
      return;
    const scopeIdentity =
      kind === "submission"
        ? "submission"
        : fields.usage?.scope === "message"
          ? "provider-message"
          : fields.usage?.scope === "session-cumulative"
            ? "provider-session"
            : fields.usage
              ? (context.attemptId ?? context.turnId)
              : context.turnId;
    const key = [
      context.provider,
      context.accountId,
      context.sessionId,
      scopeIdentity,
      kind,
      identity,
    ].join("\0");
    const priorId = identities.get(key);
    const prior = priorId
      ? snapshot.events.find((event) => event.id === priorId)
      : undefined;
    // An evicted identity stays remembered for a bounded replay horizon.
    if (priorId && !prior) return;
    const toolName =
      fields.source === "harness event" && prior?.toolName
        ? prior.toolName
        : (fields.toolName ?? prior?.toolName);
    const state = fields.state ?? prior?.state;
    if (
      kind === "tool" &&
      prior &&
      state === prior.state &&
      toolName === prior.toolName
    )
      return;
    const now = Date.now();
    const event: TraceEvent = {
      ...context,
      ...fields,
      toolName,
      state,
      durationMs:
        fields.durationMs ??
        ((kind === "tool" ||
          kind === "subagent-tool" ||
          kind === "external-turn") &&
        (fields.state === "completed" || fields.state === "failed") &&
        prior
          ? now - prior.at
          : prior?.durationMs),
      kind,
      identity,
      id: priorId ?? `trace-${++sequence}`,
      at: prior?.at ?? now,
      updatedAt: now,
    };
    const events = prior
      ? snapshot.events.map((item) => (item.id === prior.id ? event : item))
      : [...snapshot.events, event];
    if (!priorId) identities.set(key, event.id);
    if (identities.size > IDENTITY_LIMIT)
      identities.delete(identities.keys().next().value ?? "");
    const excess = Math.max(0, events.length - TRACE_LIMIT);
    snapshot = {
      ...snapshot,
      events: excess ? events.slice(excess) : events,
      dropped: snapshot.dropped + excess,
    };
    publish();
  });
}

export function sessionContext(
  input: Pick<
    HarnessSessionInput,
    | "sessionId"
    | "providerAccountId"
    | "model"
    | "modelSettings"
    | "runtimeMode"
    | "nativeResume"
  >,
  provider: HarnessId,
  purpose: string,
  correlation?: { submissionId?: string; turnId?: string },
): TraceContext {
  const previous = contexts.get(input.sessionId);
  const sameOwner =
    previous?.provider === provider &&
    previous.accountId === (input.providerAccountId ?? "default");
  return {
    provider,
    sessionId: input.sessionId,
    nativeId:
      input.nativeResume?.providerSessionId ??
      (sameOwner ? previous.nativeId : undefined),
    processId: sameOwner ? previous.processId : undefined,
    accountId: input.providerAccountId ?? "default",
    model: metadataLabel(input.model),
    effort: metadataLabel(input.modelSettings?.effort),
    settings: knownSettings(input.modelSettings),
    runtimeMode: metadataLabel(input.runtimeMode),
    purpose,
    activity: "local",
    ...correlation,
  };
}
export function rememberTraceContext(context: TraceContext): void {
  diagnosticOnly(() => {
    if (!snapshot.enabled || !context.sessionId) return;
    contexts.set(context.sessionId, context);
    if (contexts.size > 256)
      contexts.delete(contexts.keys().next().value ?? "");
  });
}
export function traceContextFor(sessionId: string): TraceContext | undefined {
  return contexts.get(sessionId);
}
function externalContext(context: TraceContext, turnId: string): TraceContext {
  const key = `${context.sessionId}:${turnId}`;
  const existing = externalContexts.get(key);
  if (existing) return existing;
  const external: TraceContext = {
    ...context,
    submissionId: undefined,
    attemptId: undefined,
    authorship: undefined,
    turnId,
    model: undefined,
    effort: undefined,
    settings: undefined,
    purpose: "external-turn",
    activity: "remote-control",
  };
  externalContexts.set(key, external);
  if (externalContexts.size > 256)
    externalContexts.delete(externalContexts.keys().next().value ?? "");
  return external;
}
/** Correlate a shared helper child only when ownership is unambiguous. */
export function helperTraceContext(
  provider: HarnessId,
): TraceContext | undefined {
  const matches = [...helperContexts.values()].filter(
    (context) => context.provider === provider,
  );
  return matches.length === 1 ? matches[0] : undefined;
}

/** Observes one existing operation; invokes it exactly once and preserves its outcome. */
export async function traceOperation<T>(
  context: TraceContext,
  operation: string,
  run: (context: TraceContext) => Promise<T>,
): Promise<T> {
  const active = { ...context, attemptId: `attempt-${++sequence}` };
  if (operation !== "helper") rememberTraceContext(active);
  const started = Date.now();
  if (operation === "helper" && snapshot.enabled && helperContexts.size < 32)
    helperContexts.set(active.attemptId, active);
  recordTrace(active, operation, active.attemptId, {
    source: "harness boundary",
    state: "running",
  });
  try {
    const result = await run(active);
    recordTrace(active, operation, active.attemptId, {
      source: "harness boundary",
      state: "completed",
      durationMs: Date.now() - started,
    });
    return result;
  } catch (error: unknown) {
    recordTrace(active, operation, active.attemptId, {
      source: "harness boundary",
      state:
        error instanceof Error && error.name === "AbortError"
          ? "cancelled"
          : "failed",
      durationMs: Date.now() - started,
    });
    throw error;
  } finally {
    helperContexts.delete(active.attemptId);
  }
}

function normalizedUsage(
  provider: HarnessId,
  value: ProcessedUsage,
  scope: UsageScope,
  identity: string,
): UsageMeasurement {
  // Normalizers can default unsupported counters to zero. Only positive
  // normalized counters are conclusive without the underlying raw metadata.
  const reported = (counter: unknown): number | undefined => {
    const count = finiteCount(counter);
    return count !== undefined && count > 0 ? count : undefined;
  };
  const cacheRead = reported(value.cachedInput);
  const cacheWrite = reported(value.cacheWrite);
  const input = reported(value.input);
  return {
    identity,
    scope,
    input,
    output: reported(value.output),
    cacheRead,
    cacheWrite,
    reasoning: reported(value.reasoning),
    ...(provider === "codex" &&
    input !== undefined &&
    cacheRead !== undefined &&
    cacheRead <= input
      ? { uncachedInput: input - cacheRead }
      : {}),
  };
}

/** Streaming text/tool arguments are ignored. Stable lifecycle rows replace replays. */
export function observeHarnessEvent(
  context: TraceContext,
  event: HarnessEvent,
): void {
  diagnosticOnly(() => {
    if (!snapshot.enabled) return;
    if (event.type === "externalTurn.event") {
      observeHarnessEvent(externalContext(context, event.turnId), event.event);
      return;
    }
    const fields = { source: "harness event" };
    switch (event.type) {
      case "externalTurn.started":
      case "externalTurn.finished":
        recordTrace(
          externalContext(context, event.turnId),
          "external-turn",
          event.turnId,
          {
            ...fields,
            state: event.type.endsWith("started") ? "running" : "completed",
          },
        );
        break;
      case "session.providerBound":
        context.nativeId = event.providerSessionId;
        rememberTraceContext(context);
        recordTrace(context, "native-binding", event.providerSessionId, fields);
        break;
      case "turn.started":
        recordTrace(context, "provider-turn", event.providerTurnId, {
          ...fields,
          providerTurnId: event.providerTurnId,
        });
        break;
      case "turn.model":
        context.model = metadataLabel(event.turnModel.id);
        context.effort = metadataLabel(event.turnModel.settings?.effort);
        context.settings = knownSettings(event.turnModel.settings);
        recordTrace(context, "model", "model", fields);
        break;
      case "tool.started":
      case "tool.updated":
        recordTrace(context, "tool", event.callId, {
          ...fields,
          state: metadataLabel(event.status),
          toolName: metadataLabel(event.kind),
        });
        break;
      case "remoteControl.changed":
        recordTrace(context, "remote-control", event.status, {
          ...fields,
          state: event.status,
        });
        break;
      case "session.error":
        recordTrace(context, "error", context.attemptId ?? "session", {
          ...fields,
          state: "failed",
        });
        break;
      case "session.started":
      case "session.ended":
        recordTrace(context, event.type, context.attemptId ?? "session", {
          ...fields,
          ...(event.type === "session.ended" ? { code: event.code } : {}),
        });
        break;
      case "usage":
        // Claude's normal display accounting fills absent raw fields with zero.
        // The inspector keeps its message and SDK-result metadata instead.
        if (context.provider === "claude") break;
        if (event.turn)
          recordTrace(context, "usage", "turn", {
            source:
              "normalized harness usage (missing fields may be unavailable)",
            usage: normalizedUsage(
              context.provider,
              event.turn,
              "turn",
              context.turnId ?? context.attemptId ?? "turn",
            ),
          });
        if (event.session)
          recordTrace(context, "usage", "session", {
            source: "normalized harness usage",
            usage: normalizedUsage(
              context.provider,
              event.session,
              "session-cumulative",
              context.nativeId ?? context.sessionId ?? "session",
            ),
          });
        break;
      case "diagnostic.measurement":
        recordTrace(
          { ...context, purpose: event.purpose ?? context.purpose },
          event.measurement.scope === "message" ? "response" : "usage",
          event.measurement.identity,
          {
            source: "provider-reported metadata",
            ...(event.measurement.scope === "message"
              ? { responseId: event.measurement.identity }
              : {}),
            usage: event.measurement,
          },
        );
        break;
      case "diagnostic.tool":
        recordTrace(context, "tool", event.callId, {
          source: "provider tool identity",
          toolName: metadataLabel(event.name),
        });
        break;
      case "diagnostic.lifecycle":
        recordTrace(context, event.operation, event.identity, {
          source: "provider lifecycle",
          state: event.state,
          ...(event.operation === "response"
            ? { responseId: event.identity }
            : {}),
        });
        break;
      case "agent.step":
        if (event.kind === "tool")
          recordTrace(
            { ...context, purpose: "subagent" },
            "subagent-tool",
            `${event.callId}:${event.stepId}`,
            {
              source: "harness subagent step (parent correlation only)",
              toolName: metadataLabel(event.toolKind),
              state: metadataLabel(event.status),
            },
          );
        break;
      case "context":
        recordTrace(context, "context", context.attemptId ?? "context", {
          source: "reported harness context",
          contextUsed: finiteCount(event.used),
          contextWindow: finiteCount(event.window),
        });
        break;
      default:
        break;
    }
  });
}

/** Diagnostic-only records never enter transcript/approval/queue reducers. */
export function isDiagnosticEvent(event: HarnessEvent): boolean {
  return (
    event.type.startsWith("diagnostic.") ||
    (event.type === "externalTurn.event" && isDiagnosticEvent(event.event))
  );
}

export function observeQuota(
  provider: string,
  accountId: string,
  value: ProviderRateLimits,
): void {
  diagnosticOnly(() => {
    if (!snapshot.enabled || value.status !== "ok" || !value.updatedAt) return;
    if (
      snapshot.quotas.some(
        (row) =>
          row.provider === provider &&
          row.accountId === accountId &&
          row.at === value.updatedAt,
      )
    )
      return;
    const windows: QuotaObservation["windows"] = [];
    for (const [name, window] of [
      ["session", value.session],
      ["weekly", value.weekly],
      ["monthly", value.monthly],
    ] as const) {
      if (window) windows.push({ name, ...window });
    }
    for (const group of value.modelGroups ?? []) {
      for (const [name, window] of [
        ["session", group.session],
        ["weekly", group.weekly],
      ] as const) {
        if (window) windows.push({ name: `${group.name} ${name}`, ...window });
      }
    }
    snapshot = {
      ...snapshot,
      quotas: [
        ...snapshot.quotas,
        { provider, accountId, at: value.updatedAt, windows },
      ].slice(-200),
    };
    publish();
  });
}

/** Raw numeric fields stay unknown when absent; no default zero or overlapping sums. */
export function claudeMeasurement(
  raw: Record<string, unknown> | null | undefined,
  identity: string,
  scope: UsageScope,
  model?: unknown,
): UsageMeasurement {
  const ttl = raw?.cache_creation;
  const cache =
    ttl && typeof ttl === "object" && !Array.isArray(ttl) ? ttl : undefined;
  return {
    identity,
    scope,
    model: metadataLabel(model),
    uncachedInput: finiteCount(raw?.input_tokens),
    output: finiteCount(raw?.output_tokens),
    cacheRead: finiteCount(raw?.cache_read_input_tokens),
    cacheWrite: finiteCount(raw?.cache_creation_input_tokens),
    cacheWrite5m:
      cache && "ephemeral_5m_input_tokens" in cache
        ? finiteCount(cache.ephemeral_5m_input_tokens)
        : undefined,
    cacheWrite1h:
      cache && "ephemeral_1h_input_tokens" in cache
        ? finiteCount(cache.ephemeral_1h_input_tokens)
        : undefined,
  };
}

/** Report uses an allowlist and report-local pseudonyms, including arbitrary native IDs. */
export function sanitizedReport(
  value: TraceSnapshot,
  local?: {
    measurements: readonly UsageMeasurement[];
    source: string;
    observedAt: number;
  },
): string {
  const aliases = new Map<string, string>();
  const alias = (id: string | undefined): string | undefined => {
    if (id === undefined) return undefined;
    if (!aliases.has(id)) aliases.set(id, `id-${aliases.size + 1}`);
    return aliases.get(id);
  };
  const usage = (row: UsageMeasurement): UsageMeasurement => ({
    identity: alias(row.identity) ?? "unknown",
    scope: row.scope,
    timestamp:
      row.timestamp && Number.isFinite(Date.parse(row.timestamp))
        ? new Date(row.timestamp).toISOString()
        : undefined,
    model: alias(row.model),
    uncachedInput: finiteCount(row.uncachedInput),
    input: finiteCount(row.input),
    output: finiteCount(row.output),
    cacheRead: finiteCount(row.cacheRead),
    cacheWrite: finiteCount(row.cacheWrite),
    cacheWrite5m: finiteCount(row.cacheWrite5m),
    cacheWrite1h: finiteCount(row.cacheWrite1h),
    reasoning: finiteCount(row.reasoning),
    costUsd: finiteCount(row.costUsd),
  });
  return JSON.stringify(
    {
      format: "monocode-debug-inspector-v1",
      generatedAt: Date.now(),
      startedAt: value.startedAt,
      enabled: value.enabled,
      dropped: value.dropped,
      limitations: [
        "Observed responses are not network request counts. CLI retries may be hidden.",
        "Usage scopes overlap and must not be added together.",
        "Quota is account-wide; other applications/devices and provider weighting are unknown.",
        "Capture is window-local, memory-only, and may have gaps.",
      ],
      events: value.events.map((event) => ({
        id: alias(event.id),
        at: event.at,
        updatedAt: event.updatedAt,
        provider: metadataLabel(event.provider),
        source: [
          "harness boundary",
          "harness event",
          "provider-reported metadata",
          "provider lifecycle",
          "child backend PID",
          "child backend exit",
          "accepted MonoCode submission",
          "restored provider identity",
          "provider tool identity",
        ].includes(event.source)
          ? event.source
          : "diagnostic observation",
        session: alias(event.sessionId),
        nativeSession: alias(event.nativeId),
        account: alias(event.accountId),
        submission: alias(event.submissionId),
        attempt: alias(event.attemptId),
        turn: alias(event.turnId),
        process: alias(event.processId),
        model: alias(event.model),
        effort: [
          "minimal",
          "low",
          "medium",
          "high",
          "xhigh",
          "max",
          "ultracode",
          "ultrathink",
        ].includes(event.effort ?? "")
          ? event.effort
          : undefined,
        runtimeMode: [
          "supervised",
          "auto-accept-edits",
          "auto",
          "full-access",
        ].includes(event.runtimeMode ?? "")
          ? event.runtimeMode
          : undefined,
        settings: knownSettings(event.settings),
        contextUsed: finiteCount(event.contextUsed),
        contextWindow: finiteCount(event.contextWindow),
        tool: alias(event.toolName),
        request: alias(event.requestId),
        response: alias(event.responseId),
        providerTurn: alias(event.providerTurnId),
        authorship: event.authorship,
        identity: alias(event.identity),
        kind: metadataLabel(event.kind),
        purpose: metadataLabel(event.purpose),
        activity: event.activity,
        state: [
          "running",
          "completed",
          "failed",
          "cancelled",
          "requested",
          "started",
          "observed",
          "pending",
          "in_progress",
          "queued",
          "dispatching",
          "steering",
          "on",
          "off",
          "connecting",
          "needs-consent",
        ].includes(event.state ?? "")
          ? event.state
          : undefined,
        durationMs: finiteCount(event.durationMs),
        code: event.code,
        ...(event.usage ? { usage: usage(event.usage) } : {}),
      })),
      quotas: value.quotas.map((row) => ({
        provider: metadataLabel(row.provider),
        account: alias(row.accountId),
        at: row.at,
        windows: row.windows.map((window) => ({
          name: [
            "session",
            "weekly",
            "monthly",
            "Gemini session",
            "Gemini weekly",
            "Claude session",
            "Claude weekly",
            "GPT session",
            "GPT weekly",
            "Claude & GPT session",
            "Claude & GPT weekly",
          ].includes(window.name)
            ? window.name
            : "account window",
          usedPercent: finiteCount(window.usedPercent),
          resetsAt: window.resetsAt,
          windowMinutes: finiteCount(window.windowMinutes),
        })),
      })),
      local: local
        ? {
            source: "native transcript metadata",
            observedAt: local.observedAt,
            measurements: local.measurements.map(usage),
          }
        : undefined,
    },
    null,
    2,
  );
}

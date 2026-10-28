import type { NativeContextBreakdown } from "../../../features/sessions/model/contextBreakdown";
import type {
  Block,
  HarnessId,
  TaskListMeta,
  TurnIntent,
} from "../../../features/sessions/model/session";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { transferProviderSession } from "./child";
import type { GeneratedSessionTitle } from "../../../features/sessions/model/sessionTitle";
import type { PrContent } from "../../../features/source-control/model/gitText";
import { hasLiveCatalog } from "../../../features/sessions/model/models";
import type { UserQuestionReply } from "../../../features/sessions/model/userQuestion";
import type { McpFormReply } from "../../../features/sessions/model/mcpForm";
import type { NativeCommandProvider } from "./nativeCommands";
import { HarnessRemoteControlError } from "./types";
import { isDiagnosticEvent, knownSettings, metadataLabel, observeHarnessEvent, recordTrace, rememberTraceContext, sessionContext, traceContextFor, traceOperation } from "../../../features/debug-inspector/model/trace";
import type {
  ApprovalDecision,
  ApprovalScope,
  CompactContextInput,
  HarnessEvent,
  RewindLastTurnInput,
  RewindLastTurnResult,
  SendTurnInput,
  SteerTurnInput,
  HarnessSessionInput,
} from "./types";

export type HarnessRemoteControlInput = HarnessSessionInput & {
  enabled: boolean;
  name?: string;
};

export type TitleInput = {
  sessionId: string;
  cwd: string;
  message: string;
  providerAccountId?: string;
};

export type HelperPromptInput = {
  cwd: string;
  prompt: string;
  timeoutMs: number;
  providerAccountId?: string;
  model?: string;
  /** e.g. `{ effort }` (L-192); providers ignore keys they do not use. */
  modelSettings?: Record<string, string>;
  outputSchema?: Record<string, unknown>;
};

/** One-shot, isolated text generation shared by titles and side questions. */
export type TextPromptInput = {
  cwd: string;
  providerAccountId?: string;
  model?: string;
  modelSettings?: Record<string, string>;
  /** Codex defaults to unsaved threads; false allows resumable side questions. */
  ephemeral?: boolean;
  codexStore?: "mono";
  threadId?: string;
  onThreadId?: (threadId: string) => void;
  intent?: TurnIntent;
  prompt: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  onEvent?: (event: HarnessEvent) => void;
};

/**
 * Lifecycle contract for a live harness adapter.
 * App.tsx dispatches through the registry instead of harness-specific branches.
 */
export type HarnessAdapter = {
  id: HarnessId;
  /** True when this adapter can run live turns. */
  live: boolean;
  /** False when the harness cannot accept a follow-up while a turn is running. Default: same as live. */
  canSteer?: boolean;
  commands?: NativeCommandProvider;
  /** Read-only inspection; must not spawn or wake a process. */
  inspectContext?(sessionId: string, signal?: AbortSignal): Promise<NativeContextBreakdown | null>;
  sendTurn(input: SendTurnInput): Promise<void>;
  /** Trigger provider-owned compaction outside MonoCode's normal user-turn path. */
  compactContext?(input: CompactContextInput): Promise<void>;
  /** Rewind provider state so the last user turn can be replaced. */
  rewindLastTurn?(input: RewindLastTurnInput): Promise<RewindLastTurnResult>;
  steerTurn(input: SteerTurnInput): Promise<void>;
  cancelTurn(sessionId: string): Promise<void>;
  respondApproval(
    sessionId: string,
    requestId: number,
    decision: ApprovalDecision,
    scope?: ApprovalScope,
  ): void;
  respondQuestion?(
    sessionId: string,
    requestId: number,
    reply: UserQuestionReply,
  ): void;
  respondForm?(
    sessionId: string,
    requestId: number,
    reply: McpFormReply,
  ): void;
  /** Keep a timed question open once the user starts answering it. */
  keepQuestionOpen?(sessionId: string, requestId: number): void;
  /** Kill the child but keep resume state for later rebind. */
  stopSession(sessionId: string): Promise<void>;
  /** False while a native session owns interactions beyond a MonoCode turn. Read-only. */
  canIdlePark?(sessionId: string): boolean;
  /** Drop resume state and kill the child (delete, harness switch, idle detach). */
  forgetSession(sessionId: string): Promise<void>;
  /** Seed resume state from a restored MonoCode session. */
  bindSession(
    threadId: string,
    providerSessionId: string,
    cwd: string,
    providerAccountId?: string,
  ): void;
  /** Seed provider task state from a restored session's persisted panels. */
  restoreTaskLists?(threadId: string, lists: TaskListMeta[]): void;
  /** Refresh the model catalog overlay when supported. */
  refreshCatalog?(): Promise<void>;
  /** Optional LLM tab title for the first turn. */
  generateTitle?(input: TitleInput): Promise<GeneratedSessionTitle | null>;
  /** Optional LLM commit message from staged changes. */
  generateCommitMessage?(
    cwd: string,
    signal?: AbortSignal,
    paths?: readonly string[],
  ): Promise<string>;
  /** Optional LLM pull request title/body from branch diff context. */
  generatePrContent?(
    cwd: string,
  ): Promise<(PrContent & { base: string; head: string }) | null>;
  /** Optional LLM branch name from a user message. */
  generateBranchName?(cwd: string, message: string): Promise<string | null>;
  /** Optional warmup for text-generation backends. */
  warmupText?(cwd: string): Promise<void>;
  /** Isolated text generation used by user-selected AI helpers. */
  runHelperPrompt?(input: HelperPromptInput): Promise<string>;
  /** Run an isolated, read-only prompt without mutating the main session. */
  runTextPrompt?(input: TextPromptInput): Promise<string>;
  /** Stop an isolated text-generation backend. */
  stopTextPrompt?(): Promise<void>;
  /** Toggle this provider's local Remote Control feature without queueing a turn. */
  setRemoteControl?(input: HarnessRemoteControlInput): Promise<void>;
  /** Seed persisted desired state without starting a process. */
  setRemoteControlDesired?(
    sessionId: string,
    enabled: boolean,
    name?: string,
  ): void;
  /** Current persisted-or-live desired state, used by idle parking. */
  isRemoteControlDesired?(sessionId: string): boolean;
};

const adapters = new Map<HarnessId, HarnessAdapter>();

/**
 * After a turn settles, keep the child warm for follow-ups, then park it.
 * Resume state stays, so the next prompt respawns instead of starting over.
 */
export const HARNESS_IDLE_PARK_MS = 3 * 60_000;

/**
 * Each warm child is a CLI process of a few hundred MB, plus its MCP servers.
 * Past `limit` idle ones, the least recently settled is parked early, never
 * one `keep` claims (the conversation on screen) unless the limit is zero.
 * Running turns are not idle, so they never count.
 */
export type HarnessIdleParkPolicy = {
  limit: () => number;
  keep: (sessionId: string) => boolean;
};

let idleParkPolicy: HarnessIdleParkPolicy = {
  limit: () => Number.POSITIVE_INFINITY,
  keep: () => false,
};
let idleLimitCheck: ReturnType<typeof setTimeout> | undefined;

/** Map order is settle order: the first entry has been idle longest. */
const idleParkTimers = new Map<
  string,
  { harness: HarnessId; timer: ReturnType<typeof setTimeout> }
>();
const sessionOperationTails = new Map<string, Promise<void>>();
const sessionSteerTails = new Map<string, Promise<void>>();
const activeTurnSessions = new Set<string>();
const idleParkExempt = new Set<string>();

function queueSessionOperation<T>(
  sessionId: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = sessionOperationTails.get(sessionId) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(operation);
  const settled = current.then(
    () => undefined,
    () => undefined,
  );
  sessionOperationTails.set(sessionId, settled);
  void settled.then(() => {
    if (sessionOperationTails.get(sessionId) === settled) {
      sessionOperationTails.delete(sessionId);
    }
  });
  return current;
}

function queueSteerOperation<T>(
  sessionId: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previousSteer = sessionSteerTails.get(sessionId) ?? Promise.resolve();
  // A live turn must remain steerable while its long-running send is pending.
  // Other provider-state operations still form a barrier for the steer.
  const barrier = activeTurnSessions.has(sessionId)
    ? Promise.resolve()
    : (sessionOperationTails.get(sessionId) ?? Promise.resolve());
  const current = Promise.all([
    previousSteer.catch(() => undefined),
    barrier.catch(() => undefined),
  ]).then(operation);
  const settled = current.then(
    () => undefined,
    () => undefined,
  );
  sessionSteerTails.set(sessionId, settled);
  void settled.then(() => {
    if (sessionSteerTails.get(sessionId) === settled) {
      sessionSteerTails.delete(sessionId);
    }
  });
  return current;
}

function cancelIdlePark(sessionId: string): void {
  const idle = idleParkTimers.get(sessionId);
  if (idle) clearTimeout(idle.timer);
  idleParkTimers.delete(sessionId);
}

/** A native owner can become protected after settling, so every eviction rechecks. */
function canGenericIdlePark(harness: HarnessId, sessionId: string): boolean {
  const adapter = adapters.get(harness);
  return adapter?.canIdlePark?.(sessionId) !== false &&
    !(adapter?.isRemoteControlDesired?.(sessionId) ?? idleParkExempt.has(sessionId));
}

function scheduleIdlePark(harness: HarnessId, sessionId: string): void {
  cancelIdlePark(sessionId);
  if (!canGenericIdlePark(harness, sessionId)) return;
  idleParkTimers.set(sessionId, {
    harness,
    timer: setTimeout(() => {
      idleParkTimers.delete(sessionId);
      if (!canGenericIdlePark(harness, sessionId)) return;
      void stopHarnessSession(harness, sessionId);
    }, HARNESS_IDLE_PARK_MS),
  });
  if (idleLimitCheck === undefined) idleLimitCheck = setTimeout(enforceHarnessIdleLimit, 0);
}

export function configureHarnessIdlePark(policy: HarnessIdleParkPolicy) {
  idleParkPolicy = policy;
}

/** Park the longest-idle children past the limit; also run when it drops. */
export function enforceHarnessIdleLimit(): void {
  clearTimeout(idleLimitCheck);
  idleLimitCheck = undefined;
  const limit = Math.max(0, idleParkPolicy.limit());
  const eligible = [...idleParkTimers].filter(([sessionId, { harness }]) => {
    if (canGenericIdlePark(harness, sessionId)) return true;
    cancelIdlePark(sessionId);
    return false;
  });
  let excess = eligible.length - limit;
  for (const [sessionId, { harness }] of eligible) {
    if (excess <= 0) return;
    if (sessionOperationTails.has(sessionId) || activeTurnSessions.has(sessionId)) continue;
    if (limit > 0 && idleParkPolicy.keep(sessionId)) continue;
    excess -= 1;
    void stopHarnessSession(harness, sessionId);
  }
}

/** Test seam. */
export function resetHarnessIdlePark(): void {
  for (const { timer } of idleParkTimers.values()) clearTimeout(timer);
  idleParkTimers.clear();
  idleParkExempt.clear();
  clearTimeout(idleLimitCheck);
  idleLimitCheck = undefined;
  idleParkPolicy = {
    limit: () => Number.POSITIVE_INFINITY,
    keep: () => false,
  };
}

export function registerHarness(adapter: HarnessAdapter): void {
  adapters.set(adapter.id, adapter);
}

export function getHarness(id: HarnessId): HarnessAdapter | undefined {
  return adapters.get(id);
}

export function requireHarness(id: HarnessId): HarnessAdapter {
  const adapter = adapters.get(id);
  if (!adapter) {
    throw new Error(`No harness adapter registered for "${id}"`);
  }
  return adapter;
}

export function isLiveHarness(id: HarnessId): boolean {
  return adapters.get(id)?.live === true;
}

export function listHarnesses(): HarnessAdapter[] {
  return [...adapters.values()];
}

export function sendHarnessTurn(input: SendTurnInput & { harness: HarnessId }) {
  return queueSessionOperation(input.sessionId, async () => {
    const adapter = requireHarness(input.harness);
    if (!adapter.live) {
      throw new Error(`${input.harness} is not connected yet`);
    }
    cancelIdlePark(input.sessionId);
    const controlled = typeof isTauri === "function" && isTauri();
    if (controlled)
      await invoke("control_authorize_turn", {
        sessionId: input.sessionId,
        cwd: input.cwd,
        appAccess: input.appAccess === true,
      });
    activeTurnSessions.add(input.sessionId);
    try {
      const context = sessionContext(input, input.harness, input.diagnostic?.purpose ?? (input.humanAuthored ? "chat" : "automation"), input.diagnostic);
      context.authorship = input.humanAuthored === undefined ? undefined : input.humanAuthored ? "user" : "automation";
      await traceOperation(context, "dispatch", async (active) => {
        if (input.nativeResume) recordTrace(active, "native-resume-request", active.attemptId ?? "resume", { source: "validated dispatch input", state: "requested" });
        return adapter.sendTurn({
          ...input,
          onEvent: (event) => { observeHarnessEvent(active, event); if (!isDiagnosticEvent(event)) input.onEvent(event); },
          onAccepted: () => {
            recordTrace(active, "accepted", active.attemptId ?? "accepted", { source: "provider acceptance" });
            input.onEvent({ type: "turn.ready" });
            input.onAccepted?.();
          },
        });
      });
    } finally {
      activeTurnSessions.delete(input.sessionId);
      if (controlled)
        await invoke("control_turn_finished", { sessionId: input.sessionId });
      scheduleIdlePark(input.harness, input.sessionId);
    }
  });
}

export function canCompactHarnessContext(id: HarnessId): boolean {
  const adapter = adapters.get(id);
  return adapter?.live === true && adapter.compactContext != null;
}

export function compactHarnessContext(
  input: CompactContextInput & { harness: HarnessId },
): Promise<void> {
  return queueSessionOperation(input.sessionId, async () => {
    const adapter = requireHarness(input.harness);
    if (!adapter.live) {
      throw new Error(`${input.harness} is not connected yet`);
    }
    if (!adapter.compactContext) {
      throw new Error(`${input.harness} does not support manual compaction`);
    }
    cancelIdlePark(input.sessionId);
    try {
      await traceOperation(sessionContext(input, input.harness, "compaction"), "compaction", async (active) => adapter.compactContext?.({
        ...input, onEvent: (event) => { observeHarnessEvent(active, event); if (!isDiagnosticEvent(event)) input.onEvent(event); },
      }));
    } finally {
      scheduleIdlePark(input.harness, input.sessionId);
    }
  });
}

export function canSteerHarness(id: HarnessId): boolean {
  const adapter = adapters.get(id);
  if (!adapter?.live) return false;
  return adapter.canSteer !== false;
}

export function canHarnessRemoteControl(id: HarnessId): boolean {
  return adapters.get(id)?.setRemoteControl != null;
}

/**
 * Synchronize persisted RC preference into the adapter without waking a
 * provider process. Call this for saved session ids during model startup.
 */
export function syncHarnessRemoteControlDesired(input: {
  harness: HarnessId;
  sessionId: string;
  enabled: boolean;
  name?: string;
}): void {
  const adapter = getHarness(input.harness);
  if (!adapter?.setRemoteControlDesired) {
    if (input.enabled) {
      throw new Error(`${input.harness} does not support Remote Control`);
    }
    idleParkExempt.delete(input.sessionId);
    return;
  }
  adapter.setRemoteControlDesired(
    input.sessionId,
    input.enabled,
    input.name,
  );
  if (input.enabled) {
    idleParkExempt.add(input.sessionId);
    cancelIdlePark(input.sessionId);
  } else {
    idleParkExempt.delete(input.sessionId);
  }
}

/**
 * Toggle RC independently from a running provider turn. Its control request
 * must remain responsive while the normal per-session queue is occupied.
 */
export async function setHarnessRemoteControl(
  input: HarnessRemoteControlInput & { harness: HarnessId },
): Promise<void> {
  const adapter = requireHarness(input.harness);
  if (!adapter.setRemoteControl) {
    throw new Error(`${input.harness} does not support Remote Control`);
  }
  if (input.enabled) {
    idleParkExempt.add(input.sessionId);
    cancelIdlePark(input.sessionId);
  } else {
    idleParkExempt.delete(input.sessionId);
  }
  try {
    const observationContext = traceContextFor(input.sessionId) ?? sessionContext(input, input.harness, "remote-control");
    await traceOperation(sessionContext(input, input.harness, "remote-control"), "remote-control-operation", () => adapter.setRemoteControl!({
      ...input, onEvent: (event) => { observeHarnessEvent(observationContext, event); if (!isDiagnosticEvent(event)) input.onEvent(event); },
    }));
  } catch (error) {
    if (
      input.enabled &&
      error instanceof HarnessRemoteControlError &&
      error.status === "failed"
    ) {
      idleParkExempt.delete(input.sessionId);
    }
    if (
      (!input.enabled ||
        (error instanceof HarnessRemoteControlError &&
          error.status === "failed")) &&
      !activeTurnSessions.has(input.sessionId)
    ) {
      scheduleIdlePark(input.harness, input.sessionId);
    }
    throw error;
  }
  if (!input.enabled && !activeTurnSessions.has(input.sessionId)) {
    scheduleIdlePark(input.harness, input.sessionId);
  }
}

export function canRewindHarnessLastTurn(id: HarnessId): boolean {
  const adapter = adapters.get(id);
  return adapter?.live === true && adapter.rewindLastTurn != null;
}

export function rewindHarnessLastTurn(
  input: RewindLastTurnInput & { harness: HarnessId },
): Promise<RewindLastTurnResult> {
  return queueSessionOperation(input.sessionId, async () => {
    const adapter = requireHarness(input.harness);
    if (!adapter.rewindLastTurn) {
      throw new Error(
        `${input.harness} does not support editing the last message`,
      );
    }
    cancelIdlePark(input.sessionId);
    try {
      return await adapter.rewindLastTurn(input);
    } finally {
      scheduleIdlePark(input.harness, input.sessionId);
    }
  });
}

export function steerHarnessTurn(
  input: SteerTurnInput & { harness: HarnessId },
): Promise<void> {
  return queueSteerOperation(input.sessionId, async () => {
    const adapter = requireHarness(input.harness);
    if (!adapter.live) {
      throw new Error(`${input.harness} is not connected yet`);
    }
    cancelIdlePark(input.sessionId);
    const context = traceContextFor(input.sessionId) ?? { provider: input.harness, sessionId: input.sessionId,
      purpose: "steering", activity: "local" };
    await traceOperation({ ...context, submissionId: input.diagnostic?.submissionId, purpose: input.diagnostic?.purpose ?? "steering" }, "steer-dispatch", () => adapter.steerTurn(input));
  });
}

export async function cancelHarnessTurn(
  harness: HarnessId,
  sessionId: string,
): Promise<void> {
  const adapter = getHarness(harness);
  if (!adapter?.live) return;
  cancelIdlePark(sessionId);
  const context = traceContextFor(sessionId);
  if (context) recordTrace(context, "cancellation", context.attemptId ?? "session", { source: "harness boundary", state: "requested" });
  await adapter.cancelTurn(sessionId);
  scheduleIdlePark(harness, sessionId);
}

export function respondHarnessApproval(
  harness: HarnessId,
  sessionId: string,
  requestId: number,
  decision: ApprovalDecision,
  scope?: ApprovalScope,
): void {
  getHarness(harness)?.respondApproval(sessionId, requestId, decision, scope);
}

export function respondHarnessQuestion(
  harness: HarnessId,
  sessionId: string,
  requestId: number,
  reply: UserQuestionReply,
): void {
  getHarness(harness)?.respondQuestion?.(sessionId, requestId, reply);
}

export function respondHarnessForm(
  harness: HarnessId,
  sessionId: string,
  requestId: number,
  reply: McpFormReply,
): void {
  getHarness(harness)?.respondForm?.(sessionId, requestId, reply);
}

export function keepHarnessQuestionOpen(
  harness: HarnessId,
  sessionId: string,
  requestId: number,
): void {
  getHarness(harness)?.keepQuestionOpen?.(sessionId, requestId);
}

export async function stopHarnessSession(
  harness: HarnessId,
  sessionId: string,
): Promise<void> {
  cancelIdlePark(sessionId);
  const adapter = getHarness(harness);
  if (!adapter?.live) return;
  await adapter.stopSession(sessionId);
}

export async function forgetHarnessSession(
  harness: HarnessId,
  sessionId: string,
): Promise<void> {
  cancelIdlePark(sessionId);
  idleParkExempt.delete(sessionId);
  const adapter = getHarness(harness);
  if (!adapter) return;
  adapter.setRemoteControlDesired?.(sessionId, false);
  await adapter.forgetSession(sessionId);
}

export function bindHarnessSession(
  harness: HarnessId,
  threadId: string,
  providerSessionId: string,
  cwd: string,
  providerAccountId?: string,
  /** Restored transcript, so the adapter can reseed its task state. */
  blocks?: Block[],
): void {
  const adapter = getHarness(harness);
  adapter?.bindSession(threadId, providerSessionId, cwd, providerAccountId);
  if (adapter) {
    const context = { provider: harness, sessionId: threadId, nativeId: providerSessionId, accountId: providerAccountId ?? "default", purpose: "native-binding", activity: "local" } as const;
    rememberTraceContext(context);
    recordTrace(context, "native-binding", providerSessionId, { source: "restored provider identity" });
  }
  if (!blocks || !adapter?.restoreTaskLists) return;
  const lists = blocks.flatMap((block) =>
    block.role === "tasks" && block.taskList ? [block.taskList] : [],
  );
  if (lists.length > 0) adapter.restoreTaskLists(threadId, lists);
}

/**
 * Continue a provider conversation under another account of the same provider.
 * The old process stops first so its transcript is complete, then the native
 * transcript is copied to the new account and the thread resumes from it.
 * Throws when the transcript cannot be carried, retaining the original resume binding.
 */
export async function transferHarnessSessionAccount(input: {
  harness: "claude" | "codex";
  threadId: string;
  providerSessionId: string;
  cwd: string;
  fromAccountId?: string;
  toAccountId: string;
  blocks?: Block[];
}): Promise<void> {
  // Stop drains native output but retains the original resume binding if copy fails.
  await stopHarnessSession(input.harness, input.threadId);
  await transferProviderSession(
    input.harness,
    input.fromAccountId,
    input.toAccountId,
    input.providerSessionId,
  );
  bindHarnessSession(
    input.harness,
    input.threadId,
    input.providerSessionId,
    input.cwd,
    input.toAccountId,
    input.blocks,
  );
}

/**
 * Probe model lists only for the harnesses the caller actually needs.
 * Boot used to refresh every adapter; that spawned unused CLIs (Pi with
 * extensions can sit at ~1GB) even when the workspace never touched them.
 */
/** `force` re-reads a catalog that already loaded, e.g. after a CLI update. */
export async function refreshHarnessCatalogs(
  ids: Iterable<HarnessId>,
  options?: { force?: boolean },
): Promise<void> {
  const wanted = new Set(ids);
  if (wanted.size === 0) return;
  await Promise.all(
    [...adapters.values()]
      .filter((adapter) => wanted.has(adapter.id))
      .map(async (adapter) => {
        if (!adapter.refreshCatalog) return;
        // Explicit dropdown opens and manual Recheck can replace stale or
        // fallback catalogs; routine refreshes skip once a live list lands.
        if (!options?.force && hasLiveCatalog(adapter.id)) return;
        await adapter.refreshCatalog().catch((error: unknown) => {
          console.debug(`[monocode] ${adapter.id} catalog`, error);
        });
      }),
  );
}

export async function generateHarnessTitle(
  harness: HarnessId,
  input: TitleInput,
): Promise<GeneratedSessionTitle | null> {
  const adapter = getHarness(harness);
  if (!adapter?.generateTitle) return null;
  return traceOperation({ provider: harness, sessionId: input.sessionId, accountId: input.providerAccountId ?? "default",
    purpose: "title-generation", activity: "local" }, "helper", () => adapter.generateTitle!(input));
}

export async function runHarnessHelperPrompt(
  harness: HarnessId,
  input: HelperPromptInput,
): Promise<string> {
  const adapter = getHarness(harness);
  if (!adapter?.runHelperPrompt) {
    throw new Error(`${harness} does not support AI helper prompts`);
  }
  return traceOperation({ provider: harness, accountId: input.providerAccountId ?? "default", model: metadataLabel(input.model), purpose: "AI-helper", activity: "local" },
    "helper", () => adapter.runHelperPrompt!(input));
}

export async function generateHarnessCommitMessage(
  harness: HarnessId,
  cwd: string,
  signal?: AbortSignal,
  paths?: readonly string[],
): Promise<string> {
  const adapter = requireHarness(harness);
  if (!adapter.generateCommitMessage) {
    throw new Error(`${harness} does not support commit message generation`);
  }
  signal?.throwIfAborted();
  return traceOperation({ provider: harness, purpose: "commit-message", activity: "local" }, "helper", () => paths === undefined
    ? adapter.generateCommitMessage!(cwd, signal)
    : adapter.generateCommitMessage!(cwd, signal, paths));
}

export async function generateHarnessPrContent(
  harness: HarnessId,
  cwd: string,
): Promise<(PrContent & { base: string; head: string }) | null> {
  const adapter = getHarness(harness);
  if (!adapter?.generatePrContent) return null;
  return traceOperation({ provider: harness, purpose: "PR-generation", activity: "local" }, "helper", () => adapter.generatePrContent!(cwd));
}

export async function generateHarnessBranchName(
  harness: HarnessId,
  cwd: string,
  message: string,
): Promise<string | null> {
  const adapter = getHarness(harness);
  if (!adapter?.generateBranchName) return null;
  return traceOperation({ provider: harness, purpose: "branch-name", activity: "local" }, "helper", () => adapter.generateBranchName!(cwd, message));
}

export async function warmupHarnessText(
  harness: HarnessId,
  cwd: string,
): Promise<void> {
  await getHarness(harness)?.warmupText?.(cwd);
}

export async function inspectHarnessContext(
  harness: HarnessId,
  sessionId: string,
  signal?: AbortSignal,
): Promise<NativeContextBreakdown | null> {
  return getHarness(harness)?.inspectContext?.(sessionId, signal) ?? null;
}

export function canRunHarnessTextPrompt(harness: HarnessId): boolean {
  const adapter = getHarness(harness);
  return adapter?.live === true && adapter.runTextPrompt != null;
}

function stopTextPrompt(adapter: HarnessAdapter): Promise<void> {
  return adapter.stopTextPrompt
    ? adapter.stopTextPrompt().catch(() => undefined)
    : Promise.resolve();
}

const activeTextPromptOwners = new Map<HarnessAdapter, Set<symbol>>();

function beginTextPrompt(adapter: HarnessAdapter): symbol {
  const owner = Symbol("text-prompt");
  const owners = activeTextPromptOwners.get(adapter) ?? new Set<symbol>();
  owners.add(owner);
  activeTextPromptOwners.set(adapter, owners);
  return owner;
}

function finishTextPrompt(
  adapter: HarnessAdapter,
  owner: symbol,
  stopIfLast: boolean,
): void {
  const owners = activeTextPromptOwners.get(adapter);
  if (!owners?.delete(owner)) return;
  if (owners.size > 0) return;
  activeTextPromptOwners.delete(adapter);
  if (stopIfLast) void stopTextPrompt(adapter);
}

function cancelledTextPrompt(): Error {
  return new Error("By-the-way request cancelled");
}

export async function runHarnessTextPrompt(
  input: TextPromptInput & { harness: HarnessId },
): Promise<string> {
  const adapter = requireHarness(input.harness);
  if (!adapter.live) {
    throw new Error(`${input.harness} is not connected yet`);
  }
  if (!adapter.runTextPrompt) {
    throw new Error(`${input.harness} does not support isolated text prompts`);
  }

  const signal = input.signal;
  if (signal?.aborted) {
    throw cancelledTextPrompt();
  }

  const owner = beginTextPrompt(adapter);
  let run: Promise<string>;
  try {
    run = traceOperation({ provider: input.harness, nativeId: input.threadId, accountId: input.providerAccountId ?? "default",
      model: metadataLabel(input.model), effort: metadataLabel(input.modelSettings?.effort), settings: knownSettings(input.modelSettings), purpose: "isolated-text", activity: "local" }, "helper", (active) => adapter.runTextPrompt!({
        ...input, onEvent: (event) => { observeHarnessEvent(active, event); if (!isDiagnosticEvent(event)) input.onEvent?.(event); },
      }));
  } catch (error) {
    finishTextPrompt(adapter, owner, false);
    throw error;
  }
  if (!signal) {
    try {
      return await run;
    } finally {
      finishTextPrompt(adapter, owner, false);
    }
  }

  let abortHandler: (() => void) | undefined;
  const abortPromise = new Promise<never>((_, reject) => {
    abortHandler = () => {
      finishTextPrompt(adapter, owner, false);
      reject(cancelledTextPrompt());
    };
    signal.addEventListener("abort", abortHandler, { once: true });
    if (signal.aborted) abortHandler();
  });
  try {
    return await Promise.race([run, abortPromise]);
  } finally {
    if (abortHandler) signal.removeEventListener("abort", abortHandler);
    finishTextPrompt(adapter, owner, false);
  }
}

export async function stopHarnessTextPrompts(): Promise<void> {
  await Promise.all([...adapters.values()].map(stopTextPrompt));
}

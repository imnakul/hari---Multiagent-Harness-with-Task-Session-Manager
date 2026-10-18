import { invoke } from "@tauri-apps/api/core";
import { claudeMeasurement, finiteCount } from "../../../../features/debug-inspector/model/trace";
import { parseClaudeContextUsage } from "./claudeProtocol";
import type { NativeContextBreakdown } from "../../../../features/sessions/model/contextBreakdown";
import { TurnNotReadyError } from "../../core/types";
import {
  nativeModelId,
  resolveModel,
} from "../../../../features/sessions/model/models";
import { sameProviderAccountId } from "../../../../features/providers/model/providerAccounts";
import type {
  RuntimeMode,
  TaskListItem,
  TaskListMeta,
  TurnModel,
} from "../../../../features/sessions/model/session";
import { loadClaudeHooks } from "../../../../features/settings/model/settings";
import {
  addProcessedUsage,
  parseClaudeUsage,
  sumProcessedUsage,
  type ProcessedUsage,
} from "../../../../features/sessions/model/tokenAccounting";
import {
  killChild,
  resolveClaudeBinary,
  spawnChild,
  unwatchChild,
  watchChild,
  writeChild,
} from "../../core/child";
import {
  asRecord,
  askUserQuestionAllowInput,
  assistantMessageId,
  assistantTextBlocks,
  assistantThinkingBlocks,
  assistantToolUses,
  contextFromResult,
  contextUsedFromAssistant,
  turnMetricsFromResult,
  buildClaudeSpawnArgs,
  buildClaudeUserMessage,
  buildControlRequest,
  buildControlResponse,
  buildRemoteControlRequest,
  buildSetModelRequest,
  buildSetPermissionModeRequest,
  claudeLiveKey,
  claudeSessionRules,
  claudeMcpServerGrant,
  claudeSettingsKey,
  extractAskUserQuestionTitle,
  extractExitPlanModePlan,
  inputJsonDeltaFromEvent,
  isAgentTaskType,
  isClaudeUltracodeEffort,
  isRemoteControlConsentError,
  isReplayedTaskNotificationResult,
  isSubagentMessage,
  isTerminalAgentTaskStatus,
  isTodoTool,
  applyClaudeTaskTool,
  isUsageLimitResult,
  normalizeClaudeCliEffort,
  parseBackgroundTasks,
  parseControlCancelId,
  parseControlResponse,
  parseControlRequest,
  parseRemoteControlResponse,
  parseJsonLine,
  parseTaskNotification,
  parseTaskProgress,
  parseTaskStarted,
  parseTaskUpdated,
  parseToolProgress,
  taskListFromTodos,
  previewFromTool,
  resolveClaudeApiModelId,
  runtimeModeToPermission,
  planClaudeLiveSwitch,
  sessionIdFromMessage,
  statusTextFromSystem,
  streamDeltaFromEvent,
  stringField,
  summarizeToolRequest,
  toClaudePermissionResult,
  toolKindFromName,
  toolResultsFromUserMessage,
  toolStartFromEvent,
  toolTitle,
  tryParseJsonRecord,
  turnStatusFromResult,
  usageLimitFromRateLimitEvent,
  type ClaudeAgentTaskNotification,
  type ClaudeCliSettings,
  type ClaudeLiveKey,
  type ClaudeControlRequest,
  type ClaudeSessionGrant,
  type ClaudeSessionRule,
} from "./claudeProtocol";
import { isAgentToolName } from "../../core/preview";
import { joinStreamText, snapshotRemainder } from "../../core/streamText";
import {
  questionPromptTitle,
  questionsFromUnknown,
  type UserQuestionReply,
} from "../../../../features/sessions/model/userQuestion";
import {
  HarnessRemoteControlError,
  NativeForkError,
  NativeResumeError,
} from "../../core/types";
import type {
  ApprovalDecision,
  ApprovalScope,
  CompactContextInput,
  HarnessEvent,
  HarnessSessionInput,
  RemoteControlStatus,
  SendTurnInput,
  SteerTurnInput,
} from "../../core/types";

/**
 * A PermissionRequest hook can decide before the user touches the prompt; Claude
 * then cancels the control request out from under us. That is not a rejection,
 * so it gets its own outcome instead of being folded into "deny".
 */
type ApprovalOutcome =
  { decision: ApprovalDecision; scope?: ApprovalScope } | "cancelled";

type PendingApproval = {
  requestId: string;
  input: Record<string, unknown>;
  grant?: ClaudeSessionGrant;
  serverGrant?: ClaudeSessionGrant;
  resolve: (decision: ApprovalOutcome) => void;
};

type ClaudeMcpDiscoveryRow = {
  provider?: unknown;
  name?: unknown;
  enabled?: unknown;
};

type PendingControl = {
  resolve: (payload: Record<string, unknown>) => void;
  reject: (error: ClaudeControlError) => void;
  timer: ReturnType<typeof setTimeout>;
  cleanup: () => void;
};

type PendingQuestion = {
  requestId: string;
  event: Extract<HarnessEvent, { type: "question.asked" }>;
  resolve: (reply: UserQuestionReply | "cancelled") => void;
};

type InFlightTool = {
  id: string;
  name: string;
  input: Record<string, unknown>;
  partialJson: string;
  title: string;
};

type LiveAgentTask = {
  taskId: string;
  toolUseId?: string;
  description: string;
  backgrounded: boolean;
};

type BackgroundTask = {
  description: string;
  toolUseId?: string;
};

type Live = {
  lastAssistantUuid?: string;
  forkPending: boolean;
  forkSourceSessionId?: string;
  exited: boolean;
  sessionId: string;
  cwd: string;
  claudeSessionId: string;
  nativeResumeSessionId?: string;
  nativeResumeError?: NativeResumeError;
  initializeRequestId?: string;
  providerAccountId?: string;
  runtimeMode: RuntimeMode;
  planning: boolean;
  settingsKey: string;
  liveKey: ClaudeLiveKey;
  pendingControls: Map<string, PendingControl>;
  generation: number;
  expectModel?: string;
  onEvent: (event: HarnessEvent) => void;
  approvals: Map<number, PendingApproval>;
  questions: Map<number, PendingQuestion>;
  visibleQuestionId: number | null;
  nextApprovalUiId: number;
  toolsByIndex: Map<number, InFlightTool>;
  toolsById: Map<string, InFlightTool>;
  agentTasks: Map<string, LiveAgentTask>;
  /**
   * Every task Claude still runs for this session, by id: subagents, shells it
   * backgrounded, monitors. Each one ends in a notification that wakes Claude
   * for another turn, so the MonoCode turn stays open until they are done.
   */
  backgroundTasks: Map<string, BackgroundTask>;
  /** Rows shown for tasks still running when Claude yielded, by task id. */
  backgroundRows: Map<string, string>;
  /** A task finished after Claude yielded; its follow-up turn is on the way. */
  awaitingResume: ReturnType<typeof setTimeout> | null;
  /** Last background list sent to the UI, to skip repeats. */
  backgroundKey: string;
  /** Finished-subagent notes held until Claude picks the thread back up. */
  taskNotes: string[];
  /** TaskCreate/TaskUpdate items, keyed by Claude's task id. */
  claudeTasks: Map<string, TaskListItem>;
  turnResultSeen: boolean;
  /** Latest `rate_limit_event` refused requests; reported when the turn ends. */
  usageLimit: { resetsAt?: number } | null;
  cancelled: boolean;
  muteUpdates: boolean;
  turns: Promise<void>;
  turnDone: (() => void) | null;
  turnFailed: ((error: Error) => void) | null;
  turnEndPending: boolean;
  activeTurn: boolean;
  stopped: boolean;
  externalTurn: boolean;
  externalLive?: Live;
  externalTurnId?: string;
  externalTurnModel?: TurnModel;
  externalSeen?: Set<string>;
  externalTurnWait: Promise<void> | null;
  externalTurnDone: (() => void) | null;
  pendingExternalWaitCancel: (() => void) | null;
  remoteControl: {
    status: RemoteControlStatus;
    url?: string;
    message?: string;
    generation: number;
  };
  remoteControlAttempt?: { generation: number; promise: Promise<void> };
  initDone: (() => void) | null;
  initialized: boolean;
  emittedAssistant: string;
  emittedReasoning: string;
  requestsById: Map<string, ProcessedUsage>;
  priorTurnsUsage?: ProcessedUsage;
  turnUsage?: ProcessedUsage;
  pendingAssistantBoundary: boolean;
  manualCompaction: boolean;
  compactionConfirmed: boolean;
};

type Resume = {
  sessionId: string;
  cwd: string;
  providerAccountId?: string;
};

const INIT_TIMEOUT_MS = 8_000;
const CONTROL_TIMEOUT_MS = 5_000;
const REMOTE_CONTROL_TIMEOUT_MS = 10_000;

export type ClaudeControlFailure =
  | "error"
  | "timeout"
  | "cancelled"
  | "stopped"
  | "write-failed"
  | "unavailable";

export class ClaudeControlError extends Error {
  constructor(
    readonly reason: ClaudeControlFailure,
    message: string,
  ) {
    super(message);
    this.name = "ClaudeControlError";
  }
}

const liveByThread = new Map<string, Live>();
const liveStartsByThread = new Map<string, Promise<Live>>();
const resumeByThread = new Map<string, Resume>();
const remoteControlDesired = new Map<string, { name?: string }>();
const remoteControlGenerations = new Map<string, number>();
const sessionGrantsByThread = new Map<
  string,
  {
    cwd: string;
    providerAccountId?: string;
    rules: ClaudeSessionRule[];
  }
>();
/**
 * How long a finished background task may take to wake Claude before the turn
 * is let go anyway. The follow-up turn normally starts within a second or two.
 */
const RESUME_GRACE_MS = 15_000;

/**
 * Claude task lists outlive a Live: a restart that resumes the conversation
 * keeps its task ids, so later TaskUpdate calls must find earlier tasks. Task
 * ids belong to one Claude conversation, so each map records which one.
 */
const tasksByThread = new Map<
  string,
  { providerSessionId: string; tasks: Map<string, TaskListItem> }
>();
/** Task-list block key for TaskCreate/TaskUpdate items. */
const CLAUDE_TASKS_KEY = "claude-tasks";
const cancelledThreads = new Set<string>();
let nextClaudeGeneration = 0;
// Keep control IDs unique across child generations so late lines cannot match
// a request issued after Claude has respawned.
let nextClaudeControlId = 0;

let resolveClaudeBinaryImpl: () => Promise<{ path: string }> =
  resolveClaudeBinary;
async function discoverClaudeMcpServers(
  cwd: string,
): Promise<{ configured: string[]; enabled: string[] }> {
  const rows = await invoke<ClaudeMcpDiscoveryRow[]>("mcp_discover", { cwd });
  if (!Array.isArray(rows)) return { configured: [], enabled: [] };
  const enabled = new Map<string, boolean>();
  for (const row of rows) {
    if (row.provider !== "claude" || typeof row.name !== "string") continue;
    enabled.set(
      row.name,
      (enabled.get(row.name) ?? true) && row.enabled !== false,
    );
  }
  return {
    configured: [...enabled.keys()],
    enabled: [...enabled]
      .filter(([, isEnabled]) => isEnabled)
      .map(([name]) => name),
  };
}
let resolveClaudeMcpServersImpl = discoverClaudeMcpServers;

/** Test seam. */
export function setClaudeBinaryResolver(
  fn: () => Promise<{ path: string }>,
): void {
  resolveClaudeBinaryImpl = fn;
}

/** Test seam for the native MCP configuration discovery used to qualify grants. */
export function setClaudeMcpServerResolver(
  fn: (
    cwd: string,
  ) => Promise<{ configured: string[]; enabled: string[] }>,
): void {
  resolveClaudeMcpServersImpl = fn;
}

/** Seed saved intent without starting Claude. */
export function setClaudeRemoteControlDesired(
  sessionId: string,
  enabled: boolean,
  name?: string,
): void {
  if (!sessionId) return;
  const current = remoteControlDesired.get(sessionId);
  const trimmedName = name?.trim();
  if (enabled) {
    if (remoteControlDesired.has(sessionId) && current?.name === trimmedName) {
      return;
    }
    nextRemoteControlGeneration(sessionId);
    remoteControlDesired.set(sessionId, {
      ...(trimmedName ? { name: trimmedName } : {}),
    });
  } else {
    if (!remoteControlDesired.has(sessionId)) return;
    nextRemoteControlGeneration(sessionId);
    remoteControlDesired.delete(sessionId);
  }
}

export function isClaudeRemoteControlDesired(sessionId: string): boolean {
  return remoteControlDesired.has(sessionId);
}

/** Toggle Claude Remote Control outside the normal per-session turn queue. */
export async function setClaudeRemoteControl(
  input: HarnessSessionInput & { enabled: boolean; name?: string },
): Promise<void> {
  const name = input.name?.trim();
  const generation = nextRemoteControlGeneration(input.sessionId);
  if (input.enabled) {
    remoteControlDesired.set(input.sessionId, {
      ...(name ? { name } : {}),
    });
  } else {
    remoteControlDesired.delete(input.sessionId);
  }

  let live = liveByThread.get(input.sessionId);
  if (!input.enabled) {
    if (!live || live.exited || !live.initialized) {
      if (live) emitRemoteControl(live, "off");
      else {
        input.onEvent({ type: "remoteControl.changed", status: "off" });
      }
      return;
    }
    await requestClaudeRemoteControl(live, false, generation, name, {
      throwOnFailure: true,
      waitForResponse: true,
    });
    return;
  }

  if (live?.remoteControl.status === "on") return;
  if (live) emitRemoteControl(live, "connecting");
  else input.onEvent({ type: "remoteControl.changed", status: "connecting" });

  try {
    live = await ensureLive(input, true);
  } catch (error) {
    if (remoteControlGenerations.get(input.sessionId) !== generation) return;
    const message = error instanceof Error ? error.message : String(error);
    const status = isRemoteControlConsentError(message)
      ? "needs-consent"
      : "failed";
    if (status === "failed") remoteControlDesired.delete(input.sessionId);
    input.onEvent({ type: "remoteControl.changed", status, message });
    throw new HarnessRemoteControlError(status, message);
  }

  live.onEvent = input.onEvent;
  if (remoteControlGenerations.get(input.sessionId) !== generation) return;
  if (live.remoteControl.status === "on") return;
  if (
    live.remoteControl.status === "connecting" &&
    live.remoteControl.generation === generation &&
    live.remoteControlAttempt?.generation === generation
  ) {
    await live.remoteControlAttempt.promise;
    if (remoteControlGenerations.get(input.sessionId) !== generation) return;
    const statusAfterAttempt = live.remoteControl.status as RemoteControlStatus;
    if (statusAfterAttempt === "on") return;
  }
  if (live.remoteControl.generation !== generation) {
    await requestClaudeRemoteControl(live, true, generation, name, {
      throwOnFailure: true,
      waitForResponse: true,
    });
    return;
  }
  const status =
    live.remoteControl.status === "needs-consent" ? "needs-consent" : "failed";
  throw new HarnessRemoteControlError(
    status,
    live.remoteControl.message ?? "Claude Remote Control could not be enabled.",
  );
}

export async function sendClaudeTurn(input: SendTurnInput): Promise<void> {
  let live: Live;
  try {
    live = await ensureLive(input);
  } catch (error) {
    cancelledThreads.delete(input.sessionId);
    throw error;
  }
  if (cancelledThreads.delete(input.sessionId)) return;

  live.onEvent = input.onEvent;
  live.runtimeMode = input.runtimeMode;
  live.turns = live.turns
    .catch(() => undefined)
    .then(async () => {
      live.cancelled = false;
      live.muteUpdates = false;
      try {
        await runTurn(live, input);
      } catch (error) {
        if (live.cancelled) return;
        throw error;
      }
    });
  await live.turns;
}

export async function compactClaudeContext(
  input: CompactContextInput,
): Promise<void> {
  const settingsKey = settingsKeyFor(input);
  let live = liveByThread.get(input.sessionId);
  if (!live || live.cwd !== input.cwd || live.settingsKey !== settingsKey) {
    live = await ensureLive(input);
  }
  if (cancelledThreads.delete(input.sessionId)) return;

  live.onEvent = input.onEvent;
  live.runtimeMode = input.runtimeMode;
  live.turns = live.turns
    .catch(() => undefined)
    .then(async () => {
      live.cancelled = false;
      live.muteUpdates = false;
      live.manualCompaction = true;
      live.compactionConfirmed = false;
      try {
        await runTurn(live, {
          ...input,
          modelSettings: undefined,
          text: "/compact",
          attachments: [],
        });
        if (!live.compactionConfirmed) {
          throw new Error("Claude Code did not confirm context compaction");
        }
      } catch (error) {
        if (live.cancelled) return;
        throw error;
      } finally {
        live.manualCompaction = false;
      }
    });
  await live.turns;
}

export async function steerClaudeTurn(input: SteerTurnInput): Promise<void> {
  const live = liveByThread.get(input.sessionId);
  if (!live?.activeTurn) throw new TurnNotReadyError("No active turn to steer");

  const message = buildClaudeUserMessage({
    text: input.text,
    attachments: input.attachments,
    effort: input.modelSettings?.effort,
  });
  const content = (message.message as { content: unknown[] }).content;
  if (content.length === 0) return;

  await writeJson(input.sessionId, message);
}

export function respondClaudeApproval(
  sessionId: string,
  requestId: number,
  decision: ApprovalDecision,
  scope?: ApprovalScope,
): void {
  const live = liveByThread.get(sessionId);
  const pending = live?.approvals.get(requestId);
  if (!pending) return;
  const safeScope =
    decision === "allow" &&
    !live?.planning &&
    scope === "session" &&
    pending.grant
      ? scope
      : decision === "allow" &&
          !live?.planning &&
          scope === "server" &&
          pending.serverGrant
        ? scope
        : undefined;
  pending.resolve({ decision, scope: safeScope });
}

export function respondClaudeQuestion(
  sessionId: string,
  requestId: number,
  reply: UserQuestionReply,
): void {
  const live = liveByThread.get(sessionId);
  const pending = live?.questions.get(requestId);
  if (!pending) return;
  pending.resolve(reply);
}

export async function cancelClaudeTurn(sessionId: string): Promise<void> {
  const live = liveByThread.get(sessionId);
  if (!live) {
    cancelledThreads.add(sessionId);
    return;
  }
  const cancelWaitingSend = live.pendingExternalWaitCancel;
  const hadActiveTurn = live.activeTurn || live.turnDone !== null;
  live.cancelled = true;
  live.muteUpdates = true;
  cancelWaitingSend?.();
  for (const [, pending] of live.approvals)
    pending.resolve({ decision: "deny" });
  live.approvals.clear();
  for (const [, pending] of live.questions)
    pending.resolve({ kind: "skipped" });
  live.questions.clear();
  // Stop means the whole run, including what Claude left going in the
  // background. Otherwise it finishes later and wakes Claude up again.
  for (const taskId of live.backgroundTasks.keys()) {
    await writeJson(
      sessionId,
      buildControlRequest(nextControlId(), {
        subtype: "stop_task",
        task_id: taskId,
      }),
    ).catch(() => undefined);
  }
  await writeJson(
    sessionId,
    buildControlRequest(nextControlId(), { subtype: "interrupt" }),
  ).catch(() => undefined);
  if (hadActiveTurn) {
    finishActiveTurn(live, [
      { type: "message.completed" },
      { type: "reasoning.completed" },
    ]);
  }
}

export async function stopClaudeSession(sessionId: string): Promise<void> {
  cancelledThreads.delete(sessionId);
  const live = liveByThread.get(sessionId);
  liveByThread.delete(sessionId);
  if (live) {
    live.stopped = true;
    resolveExternalClaudeTurn(live);
    resetRemoteControlForExit(live);
    live.muteUpdates = true;
    rejectPendingControls(
      live,
      new ClaudeControlError("stopped", "Claude Code stopped"),
    );
    for (const [, pending] of live.approvals)
      pending.resolve({ decision: "deny" });
    live.approvals.clear();
    for (const [, pending] of live.questions)
      pending.resolve({ kind: "skipped" });
    live.questions.clear();
    live.activeTurn = false;
    live.turnDone?.();
    live.turnDone = null;
    live.turnFailed = null;
    live.initDone?.();
    live.initDone = null;
  }
  unwatchChild(sessionId);
  await killChild(sessionId).catch(() => undefined);
}

export async function forgetClaudeSession(sessionId: string): Promise<void> {
  setClaudeRemoteControlDesired(sessionId, false);
  resumeByThread.delete(sessionId);
  sessionGrantsByThread.delete(sessionId);
  tasksByThread.delete(sessionId);
  await stopClaudeSession(sessionId);
}

export function bindClaudeSession(
  threadId: string,
  providerSessionId: string,
  cwd: string,
  providerAccountId?: string,
): void {
  const sessionId = providerSessionId.trim();
  if (!threadId || !sessionId || !cwd.trim()) return;
  const grant = sessionGrantsByThread.get(threadId);
  const existingResume = resumeByThread.get(threadId);
  if (
    grant &&
    (existingResume?.sessionId !== sessionId ||
      grant.cwd !== cwd ||
      !sameProviderAccountId(grant.providerAccountId, providerAccountId))
  ) {
    sessionGrantsByThread.delete(threadId);
  }
  resumeByThread.set(threadId, { sessionId, cwd, providerAccountId });
  // Task ids from another conversation mean nothing in this one.
  if (tasksByThread.get(threadId)?.providerSessionId !== sessionId) {
    tasksByThread.delete(threadId);
  }
}

/**
 * Seed the task map from a restored session's persisted panel. After an app
 * restart only the transcript survives, and a resumed conversation still
 * refers to its earlier task ids.
 */
export function restoreClaudeTaskLists(
  threadId: string,
  lists: TaskListMeta[],
): void {
  if (!threadId || tasksByThread.has(threadId)) return;
  // Only a list produced by the conversation bound to this thread applies.
  const providerSessionId = resumeByThread.get(threadId)?.sessionId;
  if (!providerSessionId) return;
  let items: TaskListItem[] = [];
  for (const entry of lists) {
    if (entry.key !== CLAUDE_TASKS_KEY) continue;
    if (entry.providerSessionId !== providerSessionId) continue;
    items = entry.items.filter((item) => item.id);
  }
  if (items.length === 0) return;
  tasksByThread.set(threadId, {
    providerSessionId,
    tasks: new Map(items.map((item) => [item.id!, { ...item }])),
  });
}

function validateNativeResumeInput(
  input: HarnessSessionInput,
): string | undefined {
  const nativeResumeSessionId = input.nativeResume?.providerSessionId.trim();
  if (input.nativeResume && !nativeResumeSessionId) {
    throw new NativeResumeError("The original Claude conversation id is empty.");
  }
  if (nativeResumeSessionId && input.fork) {
    throw new NativeResumeError(
      "A native Claude resume cannot be combined with a fork request.",
    );
  }
  return nativeResumeSessionId || undefined;
}

async function ensureLive(
  input: HarnessSessionInput,
  remoteControlConnectingEmitted = false,
): Promise<Live> {
  validateNativeResumeInput(input);
  const pending = liveStartsByThread.get(input.sessionId);
  if (pending) {
    const live = await pending;
    const nativeResumeSessionId = input.nativeResume?.providerSessionId.trim();
    const requestedLiveKey = claudeLiveKey(input, loadClaudeHooks());
    if (
      live.cwd !== input.cwd ||
      !sameProviderAccountId(live.providerAccountId, input.providerAccountId) ||
      planClaudeLiveSwitch(live.liveKey, requestedLiveKey).kind !== "reuse" ||
      (nativeResumeSessionId &&
        live.nativeResumeSessionId !== nativeResumeSessionId)
    ) {
      return ensureLive(input, remoteControlConnectingEmitted);
    }
    live.onEvent = input.onEvent;
    live.runtimeMode = input.runtimeMode;
    return live;
  }
  const starting = ensureLiveUncoalesced(input, remoteControlConnectingEmitted);
  let tracked: Promise<Live>;
  tracked = starting.finally(() => {
    if (liveStartsByThread.get(input.sessionId) === tracked) {
      liveStartsByThread.delete(input.sessionId);
    }
  });
  liveStartsByThread.set(input.sessionId, tracked);
  return tracked;
}

async function ensureLiveUncoalesced(
  input: HarnessSessionInput,
  remoteControlConnectingEmitted: boolean,
): Promise<Live> {
  const nativeResumeSessionId = validateNativeResumeInput(input);
  const sessionGrant = sessionGrantsByThread.get(input.sessionId);
  if (
    sessionGrant &&
    (sessionGrant.cwd !== input.cwd ||
      !sameProviderAccountId(
        sessionGrant.providerAccountId,
        input.providerAccountId,
      ))
  ) {
    if (nativeResumeSessionId) {
      throw new NativeResumeError(
        "This Claude conversation is bound to a different folder or account.",
      );
    }
    sessionGrantsByThread.delete(input.sessionId);
  }
  const savedResume = resumeByThread.get(input.sessionId);
  if (
    nativeResumeSessionId &&
    savedResume &&
    (savedResume.sessionId !== nativeResumeSessionId ||
      savedResume.cwd !== input.cwd ||
      !sameProviderAccountId(
        savedResume.providerAccountId,
        input.providerAccountId,
      ))
  ) {
    throw new NativeResumeError(
      "The requested Claude conversation does not match this session's saved provider binding.",
    );
  }
  if (nativeResumeSessionId && !savedResume) {
    resumeByThread.set(input.sessionId, {
      sessionId: nativeResumeSessionId,
      cwd: input.cwd,
      providerAccountId: input.providerAccountId,
    });
  }
  const settingsKey = settingsKeyFor(input);
  const liveKey = claudeLiveKey(input, loadClaudeHooks());
  const planning = input.intent === "plan";
  const existing = liveByThread.get(input.sessionId);
  const switchPlan = existing
    ? existing.settingsKey === "stale"
      ? { kind: "restart" as const, reason: "Claude model did not match" }
      : planClaudeLiveSwitch(existing.liveKey, liveKey)
    : null;
  const existingMatchesNativeResume =
    !nativeResumeSessionId ||
    existing?.nativeResumeSessionId === nativeResumeSessionId;
  if (
    existing &&
    existing.cwd === input.cwd &&
    existingMatchesNativeResume &&
    switchPlan?.kind === "reuse"
  ) {
    existing.settingsKey = settingsKey;
    existing.liveKey = liveKey;
    existing.planning = planning;
    existing.onEvent = input.onEvent;
    existing.runtimeMode = input.runtimeMode;
    return existing;
  }
  let liveSwitchFallback = false;
  if (
    existing &&
    existing.cwd === input.cwd &&
    existingMatchesNativeResume &&
    switchPlan?.kind === "switch" &&
    existing.initialized &&
    !existing.activeTurn &&
    !existing.turnEndPending &&
    existing.approvals.size === 0 &&
    existing.questions.size === 0 &&
    !existing.manualCompaction
  ) {
    try {
      for (const step of switchPlan.steps) {
        if (step.type === "set_permission_mode") {
          await sendControl(existing, buildSetPermissionModeRequest(step.mode));
        } else {
          await sendControl(existing, buildSetModelRequest(step.model));
          existing.expectModel = step.model;
        }
      }
      existing.settingsKey = settingsKey;
      existing.liveKey = liveKey;
      existing.planning = planning;
      existing.onEvent = input.onEvent;
      existing.runtimeMode = input.runtimeMode;
      return existing;
    } catch {
      liveSwitchFallback = true;
    }
  }
  if (existing) {
    // Model and launch-setting changes require a fresh Claude process, but
    // they must resume the same provider conversation. Only a cwd change
    // invalidates the stored session because Claude sessions are cwd-bound.
    if (existing.cwd !== input.cwd) {
      resumeByThread.delete(input.sessionId);
      sessionGrantsByThread.delete(input.sessionId);
    }
    await stopClaudeSession(input.sessionId);
  }

  const resume = resumeByThread.get(input.sessionId);
  const canResume = nativeResumeSessionId
    ? true
    : resume != null &&
      resume.cwd === input.cwd &&
      sameProviderAccountId(resume.providerAccountId, input.providerAccountId);
  if (
    resume &&
    (resume.cwd !== input.cwd ||
      !sameProviderAccountId(resume.providerAccountId, input.providerAccountId))
  ) {
    resumeByThread.delete(input.sessionId);
    sessionGrantsByThread.delete(input.sessionId);
  }
  const { path } = await resolveClaudeBinaryImpl();
  const liveRef: { current: Live | null } = { current: null };
  const claudeSessionId = nativeResumeSessionId
    ? nativeResumeSessionId
    : canResume && resume
      ? resume.sessionId
      : crypto.randomUUID();
  const retained = tasksByThread.get(input.sessionId);
  const claudeTasks =
    retained?.providerSessionId === claudeSessionId
      ? retained.tasks
      : new Map<string, TaskListItem>();
  tasksByThread.set(input.sessionId, {
    providerSessionId: claudeSessionId,
    tasks: claudeTasks,
  });
  const launch = launchOptions(
    input,
    canResume ? resume?.sessionId : undefined,
    claudeSessionId,
  );
  const fork = !canResume && input.fork ? input.fork : undefined;
  const spawnArgs = buildClaudeSpawnArgs(
    fork
      ? {
          ...launch,
          resume: fork.sourceProviderSessionId,
          forkSession: true,
          sessionId: claudeSessionId,
          resumeSessionAt: fork.forkPoint,
        }
      : launch,
  );

  const live: Live = {
    forkPending: !!fork,
    forkSourceSessionId: fork?.sourceProviderSessionId,
    exited: false,
    sessionId: input.sessionId,
    cwd: input.cwd,
    claudeSessionId,
    ...(nativeResumeSessionId ? { nativeResumeSessionId } : {}),
    providerAccountId: input.providerAccountId,
    runtimeMode: input.runtimeMode,
    planning,
    settingsKey,
    liveKey,
    pendingControls: new Map(),
    generation: ++nextClaudeGeneration,
    onEvent: input.onEvent,
    approvals: new Map(),
    questions: new Map(),
    visibleQuestionId: null,
    nextApprovalUiId: 1,
    toolsByIndex: new Map(),
    toolsById: new Map(),
    agentTasks: new Map(),
    backgroundTasks: new Map(),
    backgroundRows: new Map(),
    awaitingResume: null,
    backgroundKey: "",
    taskNotes: [],
    claudeTasks,
    turnResultSeen: false,
    usageLimit: null,
    cancelled: false,
    muteUpdates: false,
    turns: Promise.resolve(),
    turnDone: null,
    turnFailed: null,
    turnEndPending: false,
    activeTurn: false,
    stopped: false,
    externalTurn: false,
    externalTurnWait: null,
    externalTurnDone: null,
    pendingExternalWaitCancel: null,
    remoteControl: {
      status: remoteControlDesired.has(input.sessionId) ? "connecting" : "off",
      generation: 0,
    },
    initDone: null,
    initialized: false,
    emittedAssistant: "",
    emittedReasoning: "",
    requestsById: new Map(),
    priorTurnsUsage: undefined,
    turnUsage: undefined,
    pendingAssistantBoundary: false,
    manualCompaction: false,
    compactionConfirmed: false,
  };
  liveRef.current = live;
  if (
    remoteControlDesired.has(input.sessionId) &&
    !remoteControlConnectingEmitted
  ) {
    emitClaudeEvent(live, { type: "remoteControl.changed", status: "connecting" });
  }

  watchChild(
    input.sessionId,
    (line) => {
      const current = liveRef.current;
      if (!current) return;
      handleLine(input.sessionId, current, line);
    },
    (code) => {
      const current = liveRef.current;
      if (current) {
        current.exited = true;
        resolveExternalClaudeTurn(current);
        resetRemoteControlForExit(current);
        if (
          current.forkPending &&
          resumeByThread.get(input.sessionId)?.sessionId ===
            current.claudeSessionId
        ) {
          resumeByThread.delete(input.sessionId);
        }
      }
      if (current && liveByThread.get(input.sessionId) === current) {
        liveByThread.delete(input.sessionId);
      }
      if (current) {
        rejectPendingControls(
          current,
          new ClaudeControlError("stopped", "Claude Code stopped"),
        );
      }
      if (!current?.muteUpdates) {
        (current?.onEvent ?? input.onEvent)({ type: "session.ended", code });
      }
      current?.turnFailed?.(new Error("Claude Code exited"));
      current?.initDone?.();
      if (current) {
        current.turnDone = null;
        current.turnFailed = null;
        current.initDone = null;
      }
    },
  );

  await spawnChild(
    input.sessionId,
    path,
    spawnArgs,
    input.cwd,
    { provider: "claude", id: input.providerAccountId ?? "default" },
    "claude",
  );

  liveByThread.set(input.sessionId, live);
  resumeByThread.set(input.sessionId, {
    sessionId: claudeSessionId,
    cwd: input.cwd,
    providerAccountId: input.providerAccountId,
  });

  try {
    const initializeRequestId = nextControlId();
    live.initializeRequestId = initializeRequestId;
    await writeJson(
      input.sessionId,
      buildControlRequest(initializeRequestId, { subtype: "initialize" }),
    );
    await waitForInit(live, INIT_TIMEOUT_MS);
    if (live.nativeResumeError) throw live.nativeResumeError;
    if (
      nativeResumeSessionId &&
      (live.exited ||
        !live.initialized ||
        live.claudeSessionId !== nativeResumeSessionId)
    ) {
      throw new NativeResumeError(
        "Claude Code could not resume the original conversation. No new conversation was started.",
      );
    }
    if (live.forkPending && live.exited) {
      resumeByThread.delete(input.sessionId);
      throw new NativeForkError(
        "Claude Code could not open the original conversation.",
      );
    }
    const desiredRemoteControl = remoteControlDesired.get(input.sessionId);
    if (desiredRemoteControl) {
      const remoteGeneration =
        remoteControlGenerations.get(input.sessionId) ??
        nextRemoteControlGeneration(input.sessionId);
      await requestClaudeRemoteControl(
        live,
        true,
        remoteGeneration,
        desiredRemoteControl.name,
        { throwOnFailure: false, waitForResponse: false },
      );
    }
    if (!live.forkPending)
      emitClaudeEvent(live, {
        type: "session.providerBound",
        providerSessionId: live.claudeSessionId,
      });
    emitClaudeEvent(live, { type: "session.started" });
    if (liveSwitchFallback) {
      emitClaudeEvent(live, {
        type: "status",
        text: "Claude couldn't switch live, so it restarted with the new settings.",
      });
    }
    return live;
  } catch (error) {
    await stopClaudeSession(input.sessionId);
    throw error;
  }
}

async function runTurn(live: Live, input: SendTurnInput): Promise<void> {
  if (live.forkPending && live.exited) {
    resumeByThread.delete(input.sessionId);
    await stopClaudeSession(input.sessionId);
    throw new NativeForkError(
      "Claude Code could not open the original conversation.",
    );
  }
  if (!(await waitForExternalClaudeTurn(live))) return;
  if (live.stopped || live.cancelled) return;
  if (live.nativeResumeError) throw live.nativeResumeError;
  if (live.exited) throw new Error("Claude Code exited");
  const effort = input.modelSettings?.effort;
  const message = buildClaudeUserMessage({
    text: input.text,
    attachments: input.attachments,
    effort,
    humanAuthored: input.humanAuthored,
  });
  const content = (message.message as { content: unknown[] }).content;
  if (content.length === 0) return;

  live.emittedAssistant = "";
  live.lastAssistantUuid = undefined;
  live.emittedReasoning = "";
  live.pendingAssistantBoundary = false;
  live.toolsByIndex.clear();
  live.toolsById.clear();
  live.agentTasks.clear();
  live.backgroundTasks.clear();
  live.backgroundRows.clear();
  clearAwaitingResume(live);
  live.backgroundKey = "";
  live.taskNotes = [];
  live.turnResultSeen = false;
  live.requestsById.clear();
  live.turnUsage = undefined;

  const turnPromise = new Promise<void>((resolve, reject) => {
    live.turnDone = resolve;
    live.turnFailed = reject;
  });
  live.activeTurn = true;
  settlePendingTurn(live);

  try {
    await writeJson(input.sessionId, message);
    input.onAccepted?.();
    settlePendingTurn(live);
    await turnPromise;
  } catch (error) {
    if (live.cancelled) return;
    emitClaudeEvent(live, {
      type: "session.error",
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  } finally {
    live.turnDone = null;
    live.turnFailed = null;
  }
}

async function waitForExternalClaudeTurn(live: Live): Promise<boolean> {
  while (live.externalTurn && live.externalTurnWait) {
    const externalWait = live.externalTurnWait;
    let cancelWait!: () => void;
    const cancelled = new Promise<void>((resolve) => {
      cancelWait = resolve;
      live.pendingExternalWaitCancel = resolve;
    });
    const outcome = await Promise.race([
      externalWait.then(() => "external" as const),
      cancelled.then(() => "cancelled" as const),
    ]);
    if (live.pendingExternalWaitCancel === cancelWait) {
      live.pendingExternalWaitCancel = null;
    }
    if (outcome === "cancelled" || live.cancelled || live.stopped) return false;
  }
  return !live.cancelled && !live.stopped;
}

function handleLine(sessionId: string, live: Live, line: string): void {
  const rec = parseJsonLine(line);
  if (!rec) return;

  const type = stringField(rec, "type");
  if (type === "keep_alive") return;

  const cancelId = parseControlCancelId(rec);
  if (cancelId) {
    for (const [uiId, pending] of live.approvals) {
      if (pending.requestId === cancelId) {
        pending.resolve("cancelled");
        live.approvals.delete(uiId);
      }
    }
    for (const [uiId, pending] of live.questions) {
      if (pending.requestId === cancelId) {
        pending.resolve("cancelled");
        live.questions.delete(uiId);
      }
    }
    return;
  }

  const control = parseControlRequest(rec);
  if (control) {
    const turn = live.turnDone;
    void handleControlRequest(sessionId, live, control).catch(
      (error: unknown) => {
        if (live.muteUpdates || live.turnDone !== turn) return;
        const failure =
          error instanceof Error ? error : new Error(String(error));
        if (live.turnFailed) {
          live.turnFailed(failure);
        } else {
          emitClaudeEvent(live, { type: "session.error", message: failure.message });
        }
      },
    );
    return;
  }

  if (live.muteUpdates) return;

  const sessionIdFromLine = sessionIdFromMessage(rec);
  if (
    live.nativeResumeSessionId &&
    sessionIdFromLine &&
    sessionIdFromLine !== live.nativeResumeSessionId
  ) {
    const error = new NativeResumeError(
      "Claude Code opened a different conversation than the one requested. No new conversation was started.",
    );
    live.nativeResumeError = error;
    if (live.activeTurn) live.turnFailed?.(error);
    markInitialized(live);
    return;
  }
  if (
    sessionIdFromLine &&
    sessionIdFromLine !== live.claudeSessionId &&
    (!live.forkPending || sessionIdFromLine !== live.forkSourceSessionId)
  ) {
    live.claudeSessionId = sessionIdFromLine;
    // A different conversation starts with its own task ids.
    live.claudeTasks = new Map();
    tasksByThread.set(sessionId, {
      providerSessionId: sessionIdFromLine,
      tasks: live.claudeTasks,
    });
    resumeByThread.set(sessionId, {
      sessionId: sessionIdFromLine,
      cwd: live.cwd,
      providerAccountId: live.providerAccountId,
    });
    if (!live.forkPending) {
      emitClaudeEvent(live, {
        type: "session.providerBound",
        providerSessionId: sessionIdFromLine,
      });
    }
  }

  if (
    type === "system" &&
    (stringField(rec, "subtype") === "init" ||
      stringField(rec, "subtype") === "initialized")
  ) {
    markInitialized(live);
    if (stringField(rec, "subtype") === "init") noteClaudeTurnStarted(live);
  }

  if (type === "control_response") {
    const response = parseControlResponse(rec);
    if (
      response &&
      response.requestId === live.initializeRequestId &&
      !response.ok &&
      live.nativeResumeSessionId
    ) {
      live.nativeResumeError = new NativeResumeError(
        response.error ?? "Claude Code could not open the original conversation.",
      );
    }
    if (response?.ok) {
      resolvePendingControl(live, response.requestId, response.payload ?? {});
    } else if (response) {
      rejectPendingControl(
        live,
        response.requestId,
        new ClaudeControlError(
          "error",
          response.error ?? "control request failed",
        ),
      );
    }
    markInitialized(live);
    return;
  }

  if (live.externalTurn) {
    handleExternalClaudeLine(live, rec);
    return;
  }
  if (
    !live.activeTurn &&
    live.remoteControl.status === "on" &&
    isExternalClaudeTurnActivity(type) && !isSubagentMessage(rec) &&
    (type !== "user" || externalUserText(rec) !== undefined)
  ) {
    beginExternalClaudeTurn(live, rec);
    handleExternalClaudeLine(live, rec);
    return;
  }

  if (live.manualCompaction && type !== "system" && type !== "result") {
    return;
  }

  if (handleAgentLifecycle(live, rec)) return;
  if (type === "tool_progress") {
    handleToolProgress(live, rec);
    return;
  }
  if (type === "stream_event") {
    if (!isSubagentMessage(rec)) noteClaudeTurnStarted(live);
    handleStreamEvent(live, rec);
    return;
  }
  if (type === "assistant") {
    if (!isSubagentMessage(rec)) noteClaudeTurnStarted(live);
    handleAssistant(live, rec);
    return;
  }
  if (type === "user") {
    handleUser(live, rec);
    return;
  }
  if (type === "result") {
    handleResult(live, rec);
    return;
  }
  if (type === "rate_limit_event") {
    live.usageLimit = usageLimitFromRateLimitEvent(rec);
    return;
  }
  if (type === "system") {
    const text = statusTextFromSystem(rec);
    if (text) {
      if ((stringField(rec, "subtype") ?? "").startsWith("compact")) {
        live.compactionConfirmed = true;
        emitClaudeEvent(live, { type: "diagnostic.lifecycle", operation: "provider-compaction", identity: stringField(rec, "uuid") ?? "compaction", state: "observed" });
        emitClaudeEvent(live, { type: "context.stale" });
      }
      emitClaudeEvent(live, { type: "status", text });
    }
  }
}

function isExternalClaudeTurnActivity(type: string | undefined): boolean {
  // A delayed result/progress/quota event cannot start a new phone conversation.
  return type === "assistant" || type === "stream_event" || type === "user";
}

function externalUserText(rec: Record<string, unknown>): string | undefined {
  if (rec.type !== "user" || isSubagentMessage(rec) || rec.tool_use_id) return undefined;
  const message = asRecord(rec.message);
  const content = message?.content;
  if (typeof content === "string") return content || undefined;
  if (!Array.isArray(content)) return undefined;
  const text = content.flatMap((part: unknown) => {
    const item = asRecord(part);
    return item?.type === "text" && typeof item.text === "string" ? [item.text] : [];
  }).join("\n");
  return text || undefined;
}

function beginExternalClaudeTurn(live: Live, rec: Record<string, unknown>): void {
  if (live.externalTurn) return;
  live.externalTurn = true;
  const turnId = stringField(rec, "uuid") ?? crypto.randomUUID();
  live.externalTurnId = turnId;
  live.externalTurnWait = new Promise<void>((resolve) => { live.externalTurnDone = resolve; });
  live.externalSeen = new Set();
  const state: Live = {
    ...live, externalTurn: false, externalLive: undefined, externalTurnWait: null,
    externalTurnDone: null, externalTurnId: undefined, externalSeen: undefined,
    externalTurnModel: undefined,
    activeTurn: true, cancelled: false, muteUpdates: false, manualCompaction: false,
    forkPending: false, expectModel: undefined, emittedAssistant: "", emittedReasoning: "",
    lastAssistantUuid: undefined, pendingAssistantBoundary: false,
    toolsByIndex: new Map(), toolsById: new Map(), agentTasks: new Map(),
    backgroundTasks: new Map(), backgroundRows: new Map(), awaitingResume: null,
    backgroundKey: "", taskNotes: [], claudeTasks: new Map(live.claudeTasks),
    requestsById: new Map(), turnUsage: undefined, usageLimit: null,
    turnResultSeen: false, turnEndPending: false,
    turnDone: () => finishExternalClaudeTurn(live),
    turnFailed: () => resolveExternalClaudeTurn(live),
    onEvent: (event) => live.onEvent({ type: "externalTurn.event", turnId, event }),
  };
  live.externalLive = state;
  live.onEvent({ type: "externalTurn.started", turnId, text: externalUserText(rec), nativeId: stringField(rec, "uuid") });
}

function handleExternalClaudeLine(live: Live, rec: Record<string, unknown>): void {
  const state = live.externalLive;
  const turnId = live.externalTurnId;
  if (!state || !turnId) return;
  const uuid = stringField(rec, "uuid");
  if (uuid && live.externalSeen?.has(uuid)) return;
  if (uuid) live.externalSeen?.add(uuid);
  const turnModel = externalClaudeTurnModel(rec);
  if (turnModel) {
    const previous = state.externalTurnModel;
    // message_start can carry the explicit effort before the assistant record.
    // Keep it when that same model is repeated without settings, but never let
    // a newly selected model inherit the previous model's effort.
    const next =
      previous?.id === turnModel.id && !turnModel.settings?.effort &&
      previous.settings?.effort
        ? { ...turnModel, settings: previous.settings }
        : turnModel;
    if (JSON.stringify(next) !== JSON.stringify(previous)) {
      state.externalTurnModel = next;
      state.onEvent({ type: "turn.model", turnModel: next });
    }
  }
  const text = externalUserText(rec);
  if (text) live.onEvent({ type: "externalTurn.user", turnId, text, nativeId: uuid });
  if (handleAgentLifecycle(state, rec)) return;
  switch (rec.type) {
    case "stream_event": handleStreamEvent(state, rec); break;
    case "assistant": handleAssistant(state, rec); break;
    case "user": handleUser(state, rec); break;
    case "tool_progress": handleToolProgress(state, rec); break;
    case "rate_limit_event": state.usageLimit = usageLimitFromRateLimitEvent(rec); break;
    case "result": handleResult(state, rec); break;
  }
}

/** Model metadata belongs to the phone turn only when it came from Claude's
 * root assistant message. Tool inputs and subagent messages are excluded. */
function externalClaudeTurnModel(
  rec: Record<string, unknown>,
): TurnModel | undefined {
  if (isSubagentMessage(rec)) return undefined;
  let message: Record<string, unknown> | null = null;
  if (rec.type === "assistant") {
    message = asRecord(rec.message);
    if (message?.role && message.role !== "assistant") return undefined;
  } else if (rec.type === "stream_event") {
    const event = asRecord(rec.event);
    if (event?.type !== "message_start") return undefined;
    message = asRecord(event.message);
    if (message?.role && message.role !== "assistant") return undefined;
  } else {
    return undefined;
  }
  const id = stringField(message, "model")?.trim();
  if (!id) return undefined;
  const modelSettings = asRecord(message?.modelSettings);
  const rawEffort =
    stringField(message, "effort")?.trim() ??
    stringField(modelSettings, "effort")?.trim();
  const effort = rawEffort && CLAUDE_TURN_EFFORTS.has(rawEffort)
    ? rawEffort
    : undefined;
  return {
    harness: "claude",
    id,
    name: resolveModel("claude", id).name,
    ...(effort ? { settings: { effort } } : {}),
  };
}

const CLAUDE_TURN_EFFORTS = new Set([
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultracode",
  "ultrathink",
]);

/** Control requests use the real connection; their UI belongs to the phone turn. */
function emitClaudeEvent(live: Live, event: HarnessEvent): void {
  if (live.externalTurnId && !event.type.startsWith("externalTurn.") &&
      event.type !== "remoteControl.changed" && event.type !== "session.providerBound") {
    live.onEvent({ type: "externalTurn.event", turnId: live.externalTurnId, event });
  } else live.onEvent(event);
}

function finishExternalClaudeTurn(live: Live): void {
  if (!live.externalTurn) return;
  if (live.externalLive) {
    live.priorTurnsUsage = live.externalLive.priorTurnsUsage;
    live.claudeTasks = live.externalLive.claudeTasks;
  }
  resolveExternalClaudeTurn(live, true);
}

function resolveExternalClaudeTurn(live: Live, completed = false): void {
  if (!live.externalTurn) return;
  if (live.externalLive) clearAwaitingResume(live.externalLive);
  const turnId = live.externalTurnId;
  if (turnId) {
    if (!completed) live.onEvent({ type: "externalTurn.event", turnId,
      event: { type: "session.error", message: "The other device's turn was interrupted when the connection closed." } });
    live.onEvent({ type: "externalTurn.finished", turnId });
  }
  live.externalTurn = false;
  live.externalLive = undefined;
  live.externalTurnId = undefined;
  live.externalSeen = undefined;
  const done = live.externalTurnDone;
  live.externalTurnDone = null;
  live.externalTurnWait = null;
  done?.();
}

function resetRemoteControlForExit(live: Live): void {
  if (
    live.remoteControl.status !== "off" ||
    live.remoteControl.url ||
    live.remoteControl.message
  ) {
    emitRemoteControl(live, "off");
  }
}

function handleStreamEvent(live: Live, rec: Record<string, unknown>): void {
  const subagent = isSubagentMessage(rec);
  const delta = streamDeltaFromEvent(rec);
  if (delta) {
    if (subagent) return;
    if (delta.kind === "assistant") {
      closePendingAssistantMessage(live);
      live.emittedAssistant = joinStreamText(live.emittedAssistant, delta.text);
      emitClaudeEvent(live, { type: "message.delta", text: delta.text });
    } else {
      live.emittedReasoning = joinStreamText(live.emittedReasoning, delta.text);
      emitClaudeEvent(live, { type: "reasoning.delta", text: delta.text });
    }
    return;
  }

  const started = toolStartFromEvent(rec);
  if (started) {
    if (subagent) {
      noteSubagentTool(live, rec, started.id, started.name, started.input);
      return;
    }
    const tool: InFlightTool = {
      id: started.id,
      name: started.name,
      input: started.input,
      partialJson: "",
      title: toolTitle(started.name, started.input),
    };
    if (started.index >= 0) live.toolsByIndex.set(started.index, tool);
    live.toolsById.set(started.id, tool);
    emitClaudeEvent(live, {
      type: "tool.started",
      callId: tool.id,
      title: tool.title,
      kind: toolKindFromName(tool.name),
      ...(isAgentToolName(tool.name) && stringField(tool.input, "model")
        ? { agentModel: stringField(tool.input, "model") }
        : {}),
      status: isAgentToolName(tool.name) ? "in_progress" : "pending",
      preview: previewFromTool(tool.name, tool.input),
    });
    emitTaskListIfNeeded(live, tool.name, tool.input);
    return;
  }

  const jsonDelta = inputJsonDeltaFromEvent(rec);
  if (jsonDelta) {
    if (subagent) return;
    const tool = live.toolsByIndex.get(jsonDelta.index);
    if (!tool) return;
    tool.partialJson += jsonDelta.partial;
    const parsed = tryParseJsonRecord(tool.partialJson);
    if (!parsed) return;
    tool.input = parsed;
    tool.title = toolTitle(tool.name, parsed);
    emitClaudeEvent(live, {
      type: "tool.updated",
      callId: tool.id,
      title: tool.title,
      kind: toolKindFromName(tool.name),
      ...(isAgentToolName(tool.name) && stringField(tool.input, "model")
        ? { agentModel: stringField(tool.input, "model") }
        : {}),
      status: "pending",
      detail: summarizeToolRequest(tool.name, parsed),
      preview: previewFromTool(tool.name, parsed),
    });
    emitTaskListIfNeeded(live, tool.name, parsed);
    return;
  }
}

function handleAssistant(live: Live, rec: Record<string, unknown>): void {
  const diagnosticMessage = asRecord(rec.message);
  const diagnosticId = stringField(diagnosticMessage, "id");
  if (diagnosticId) emitClaudeEvent(live, { type: "diagnostic.measurement", purpose: isSubagentMessage(rec) ? "subagent" : undefined, measurement:
    claudeMeasurement(asRecord(diagnosticMessage?.usage), diagnosticId, "message", diagnosticMessage?.model) });
  if (isSubagentMessage(rec)) {
    noteSubagentNarration(live, rec);
    for (const use of assistantToolUses(rec)) {
      noteSubagentTool(live, rec, use.id, use.name, use.input);
    }
    return;
  }

  const uuid = stringField(rec, "uuid");
  if (uuid) live.lastAssistantUuid = uuid;
  const msg = asRecord(rec.message);
  const expectedModel = live.expectModel;
  if (expectedModel) {
    live.expectModel = undefined;
    const actualModel = stringField(msg, "model");
    const requestedModel = expectedModel.replace(/\[1m\]$/, "");
    if (actualModel && actualModel !== requestedModel) {
      emitClaudeEvent(live, {
        type: "status",
        text: `Claude answered with ${actualModel} instead of ${expectedModel}. The next message restarts Claude with the selected model.`,
      });
      live.settingsKey = "stale";
    }
  }
  const messageId = stringField(msg, "id");
  const usageRec = asRecord(msg?.usage);
  const reqUsage = parseClaudeUsage(usageRec);
  if (reqUsage && messageId) {
    live.requestsById.set(messageId, reqUsage);
    const turnUsage = sumProcessedUsage(Array.from(live.requestsById.values()));
    live.turnUsage = turnUsage;
    const sessionUsage = addProcessedUsage(live.priorTurnsUsage, turnUsage);
    emitClaudeEvent(live, {
      type: "usage",
      turn: turnUsage,
      session: sessionUsage,
    });
  }

  const used = contextUsedFromAssistant(rec);
  if (used !== undefined) emitClaudeEvent(live, { type: "context", used });

  const snapshot = assistantTextBlocks(rec).join("");
  if (snapshot) closePendingAssistantMessage(live);
  const extra = snapshotRemainder(live.emittedAssistant, snapshot);
  if (extra) {
    live.emittedAssistant = joinStreamText(live.emittedAssistant, extra);
    emitClaudeEvent(live, { type: "message.delta", text: extra });
  }

  for (const use of assistantToolUses(rec)) {
    emitClaudeEvent(live, { type: "diagnostic.tool", callId: use.id, name: use.name });
    const streamed = live.toolsById.get(use.id);
    if (streamed) {
      // content_block_start often has an empty input. The input JSON delta may
      // never form a parseable object before the complete assistant snapshot.
      // Reconcile that snapshot instead of leaving the tool labelled "Shell".
      if (JSON.stringify(streamed.input) !== JSON.stringify(use.input)) {
        streamed.input = use.input;
        streamed.title = toolTitle(use.name, use.input);
        emitClaudeEvent(live, {
          type: "tool.updated",
          callId: streamed.id,
          title: streamed.title,
          kind: toolKindFromName(streamed.name),
          ...(isAgentToolName(streamed.name) && stringField(use.input, "model")
            ? { agentModel: stringField(use.input, "model") }
            : {}),
          status: isAgentToolName(streamed.name) ? "in_progress" : "pending",
          preview: previewFromTool(streamed.name, use.input),
        });
        emitTaskListIfNeeded(live, streamed.name, use.input);
      }
      if (use.name === "ExitPlanMode") {
        const plan = extractExitPlanModePlan(use.input);
        if (plan) emitClaudeEvent(live, { type: "plan", text: plan });
      }
      continue;
    }
    const tool: InFlightTool = {
      id: use.id,
      name: use.name,
      input: use.input,
      partialJson: "",
      title: toolTitle(use.name, use.input),
    };
    live.toolsById.set(use.id, tool);
    emitClaudeEvent(live, {
      type: "tool.started",
      callId: tool.id,
      title: tool.title,
      kind: toolKindFromName(tool.name),
      ...(isAgentToolName(tool.name) && stringField(tool.input, "model")
        ? { agentModel: stringField(tool.input, "model") }
        : {}),
      status: isAgentToolName(tool.name) ? "in_progress" : "pending",
      preview: previewFromTool(tool.name, tool.input),
    });
    if (use.name === "ExitPlanMode") {
      const plan = extractExitPlanModePlan(use.input);
      if (plan) emitClaudeEvent(live, { type: "plan", text: plan });
    }
    emitTaskListIfNeeded(live, tool.name, tool.input);
  }

  // Each assistant record is one Claude message. Wait until the next message
  // begins to close its UI block, so a backgrounded turn stays visibly live.
  live.pendingAssistantBoundary = !!(snapshot || live.emittedAssistant);
  live.emittedAssistant = "";
  live.emittedReasoning = "";
}

function closePendingAssistantMessage(live: Live): void {
  if (!live.pendingAssistantBoundary) return;
  live.pendingAssistantBoundary = false;
  emitClaudeEvent(live, { type: "message.completed" });
}

function handleUser(live: Live, rec: Record<string, unknown>): void {
  if (isSubagentMessage(rec)) {
    noteSubagentResults(live, rec);
    return;
  }
  for (const result of toolResultsFromUserMessage(rec)) {
    const tool = live.toolsById.get(result.toolUseId);
    if (!tool) continue;
    if (isAgentToolName(tool.name) && isBackgroundedAgentTool(live, tool.id)) {
      continue;
    }
    emitClaudeEvent(live, {
      type: "tool.updated",
      callId: tool.id,
      title: tool.title,
      kind: toolKindFromName(tool.name),
      status: result.isError ? "failed" : "completed",
      detail: result.text || undefined,
      preview: previewFromTool(tool.name, tool.input, result.text),
    });
    if (
      !result.isError &&
      applyClaudeTaskTool(live.claudeTasks, tool.name, tool.input, result.text)
    ) {
      emitClaudeEvent(live, {
        type: "tasks.updated",
        key: CLAUDE_TASKS_KEY,
        // The map is the source of truth, so a TaskUpdate subject is a rename.
        authoritative: true,
        providerSessionId: live.claudeSessionId,
        items: [...live.claudeTasks.values()],
      });
    }
    // What a subagent hands back is the last thing it said, so it closes out
    // that agent's own trail rather than sitting on the parent row as detail.
    if (isAgentToolName(tool.name) && result.text.trim() && !result.isError) {
      emitClaudeEvent(live, {
        type: "agent.step",
        callId: tool.id,
        stepId: `${tool.id}:report`,
        kind: "message",
        text: result.text,
      });
    }
    if (isAgentToolName(tool.name)) settleInlineAgentTask(live, tool.id);
  }
}

/**
 * A subagent that was never backgrounded reports back on the parent's own tool
 * result, and Claude sends no task record for one that ended inline. Without
 * this its task would keep the turn open for good: the reply reads as finished
 * while the composer and the plan's Build button stay disabled until a restart.
 */
function settleInlineAgentTask(live: Live, toolUseId: string): void {
  let settled = false;
  for (const [taskId, task] of [...live.agentTasks]) {
    if (task.toolUseId !== toolUseId || task.backgrounded) continue;
    live.agentTasks.delete(taskId);
    live.backgroundTasks.delete(taskId);
    settled = true;
  }
  if (!settled) return;
  maybeFinishTurn(live);
  syncBackgroundWait(live);
}

function handleResult(live: Live, rec: Record<string, unknown>): void {
  if (isSubagentMessage(rec)) return;
  if (isReplayedTaskNotificationResult(rec)) {
    // A limit reported for the replay must not carry over to the real turn.
    live.usageLimit = null;
    return;
  }
  emitClaudeEvent(live, { type: "diagnostic.measurement", measurement:
    { ...claudeMeasurement(asRecord(rec.usage), stringField(rec, "uuid") ?? "sdk-result", "sdk-result"), costUsd: finiteCount(rec.total_cost_usd) } });
  if (live.forkPending) {
    live.forkPending = false;
    emitClaudeEvent(live, {
      type: "session.providerBound",
      providerSessionId: live.claudeSessionId,
    });
  }
  if (!live.manualCompaction && live.lastAssistantUuid) {
    emitClaudeEvent(live, {
      type: "turn.forkPoint",
      providerForkPoint: live.lastAssistantUuid,
    });
  }
  // A /compact result reports the summarizer call's usage, not the rebuilt
  // conversation level. The next real turn will provide the fresh reading.
  if (!live.manualCompaction) {
    const context = contextFromResult(rec);
    if (context) emitClaudeEvent(live, { type: "context", ...context });

    const usageRec = asRecord(rec.usage);
    const resultUsage = parseClaudeUsage(usageRec);
    const finalTurnUsage = resultUsage ?? live.turnUsage;
    if (finalTurnUsage) {
      live.turnUsage = finalTurnUsage;
      live.priorTurnsUsage = addProcessedUsage(
        live.priorTurnsUsage,
        finalTurnUsage,
      );
      live.requestsById.clear();
      emitClaudeEvent(live, {
        type: "usage",
        turn: finalTurnUsage,
        session: live.priorTurnsUsage,
      });
    }
  }
  const metrics = turnMetricsFromResult(rec);
  if (metrics) emitClaudeEvent(live, { type: "turn.metrics", ...metrics });

  const result = turnStatusFromResult(rec);
  if (result.status === "failed" && result.error && !live.cancelled) {
    emitClaudeEvent(live, { type: "session.error", message: result.error });
  }
  // A refused window can still fall back to another model, so only a turn
  // that ended in error was stopped by it.
  const turnErrored = rec.is_error === true || result.status === "failed";
  const usageLimit = live.usageLimit ?? (isUsageLimitResult(rec) ? {} : null);
  live.usageLimit = null;
  if (usageLimit && turnErrored && !live.cancelled) {
    emitClaudeEvent(live, { type: "usage.limited", ...usageLimit });
  }
  live.turnResultSeen = true;
  maybeFinishTurn(live);
  showBackgroundRows(live);
  syncBackgroundWait(live);
}

async function handleControlRequest(
  sessionId: string,
  live: Live,
  control: ClaudeControlRequest,
): Promise<void> {
  if (control.subtype !== "can_use_tool" && control.subtype !== "permission") {
    await writeJson(sessionId, buildControlResponse(control.requestId, {}));
    return;
  }

  const toolName = control.toolName ?? "tool";
  const input = control.input ?? {};

  if (live.cancelled || live.muteUpdates) {
    await writeJson(
      sessionId,
      buildControlResponse(
        control.requestId,
        toClaudePermissionResult("deny", input),
      ),
    ).catch(() => undefined);
    return;
  }

  if (toolName === "AskUserQuestion") {
    const questions = questionsFromUnknown(input);
    const uiId = live.nextApprovalUiId++;
    const pending = waitQuestion(live, uiId, control.requestId, {
      type: "question.asked",
      requestId: uiId,
      title:
        questionPromptTitle(questions) || extractAskUserQuestionTitle(input),
      questions,
      callId: control.toolUseId,
    });
    showNextQuestion(live);
    const outcome = await pending;
    const decision =
      outcome === "cancelled"
        ? "cancelled"
        : outcome.kind === "answered"
          ? "answered"
          : "skipped";
    emitClaudeEvent(live, { type: "question.resolved", requestId: uiId, decision });
    showNextQuestion(live);
    if (outcome === "cancelled") return;
    const response =
      outcome.kind === "answered"
        ? {
            behavior: "allow",
            updatedInput: askUserQuestionAllowInput(input, outcome),
          }
        : {
            behavior: "deny",
            message: "User cancelled tool execution.",
          };
    await writeJson(
      sessionId,
      buildControlResponse(control.requestId, response),
    );
    return;
  }

  if (toolName === "ExitPlanMode") {
    const plan = extractExitPlanModePlan(input);
    if (plan) emitClaudeEvent(live, { type: "plan", text: plan });
    await writeJson(
      sessionId,
      buildControlResponse(control.requestId, {
        behavior: "deny",
        message:
          "The client captured your proposed plan. Stop here and wait for the user's feedback or implementation request in a later turn.",
      }),
    );
    return;
  }

  applyKnownToolInput(live, toolName, input, control.toolUseId);

  if (live.planning) {
    const kind = toolKindFromName(toolName);
    const decision = kind === "read" || kind === "search" ? "allow" : "deny";
    await writeJson(
      sessionId,
      buildControlResponse(
        control.requestId,
        toClaudePermissionResult(decision, input),
      ),
    );
    return;
  }

  if (live.runtimeMode === "full-access") {
    await writeJson(
      sessionId,
      buildControlResponse(
        control.requestId,
        toClaudePermissionResult("allow", input),
      ),
    );
    return;
  }

  let qualifiedServer:
    | { serverName: string; grant: ClaudeSessionGrant }
    | null = null;
  if (toolName.startsWith("mcp__")) {
    try {
      const servers = await resolveClaudeMcpServersImpl(live.cwd);
      qualifiedServer = claudeMcpServerGrant(
        toolName,
        servers.configured,
        servers.enabled,
      );
    } catch {
      // A discovery failure removes the server-wide option; the exact
      // provider permission request remains available to the user.
    }
    if (
      live.cancelled ||
      live.muteUpdates ||
      liveByThread.get(sessionId) !== live
    ) {
      await writeJson(
        sessionId,
        buildControlResponse(
          control.requestId,
          toClaudePermissionResult("deny", input),
        ),
      ).catch(() => undefined);
      return;
    }
  }

  const uiId = live.nextApprovalUiId++;
  const grant = claudeSessionRules(toolName, control.permissionSuggestions);
  const pending = waitApproval(
    live,
    uiId,
    control.requestId,
    input,
    grant ?? undefined,
    qualifiedServer?.grant,
  );
  emitClaudeEvent(live, {
    type: "approval.requested",
    requestId: uiId,
    title: toolTitle(toolName, input),
    kind: toolKindFromName(toolName),
    callId: control.toolUseId,
    preview: previewFromTool(toolName, input),
    ...(grant
      ? { sessionScope: { hint: "Stop asking for this in this chat." } }
      : {}),
    ...(qualifiedServer
      ? {
          serverScope: {
            serverName: qualifiedServer.serverName,
            hint: `Allow all tools from ${qualifiedServer.serverName} for this chat.`,
          },
        }
      : {}),
  });
  const outcome = await pending;
  const decision = outcome === "cancelled" ? "cancelled" : outcome.decision;
  const requestedScope = outcome === "cancelled" ? undefined : outcome.scope;
  const scope =
    decision === "allow" && requestedScope === "session" && grant
      ? "session"
      : decision === "allow" &&
          requestedScope === "server" &&
          qualifiedServer
        ? "server"
        : undefined;
  emitClaudeEvent(live, {
    type: "approval.resolved",
    requestId: uiId,
    decision,
    ...(scope ? { scope } : {}),
  });
  if (outcome === "cancelled") return;
  const approvalDecision = outcome.decision;
  await writeJson(
    sessionId,
    buildControlResponse(
      control.requestId,
      toClaudePermissionResult(
        approvalDecision,
        input,
        approvalDecision === "allow" && scope === "session"
          ? grant?.updates
          : approvalDecision === "allow" && scope === "server"
            ? qualifiedServer?.grant.updates
            : undefined,
      ),
    ),
  );
  if (approvalDecision === "allow" && scope === "session" && grant) {
    addClaudeSessionRules(sessionId, live, grant.rules);
  } else if (
    approvalDecision === "allow" &&
    scope === "server" &&
    qualifiedServer
  ) {
    addClaudeSessionRules(sessionId, live, qualifiedServer.grant.rules);
  }
}

function applyKnownToolInput(
  live: Live,
  toolName: string,
  input: Record<string, unknown>,
  callId?: string,
): void {
  if (!callId || Object.keys(input).length === 0) return;
  const existing = live.toolsById.get(callId);
  if (existing) {
    existing.input = input;
    existing.title = toolTitle(toolName, input);
  }
  emitClaudeEvent(live, {
    type: "tool.updated",
    callId,
    title: toolTitle(toolName, input),
    kind: toolKindFromName(toolName),
    status: "pending",
    preview: previewFromTool(toolName, input),
  });
}

function waitApproval(
  live: Live,
  uiId: number,
  requestId: string,
  input: Record<string, unknown>,
  grant?: ClaudeSessionGrant,
  serverGrant?: ClaudeSessionGrant,
): Promise<ApprovalOutcome> {
  return new Promise<ApprovalOutcome>((resolve) => {
    live.approvals.set(uiId, {
      requestId,
      input,
      grant,
      serverGrant,
      resolve,
    });
  }).finally(() => {
    live.approvals.delete(uiId);
  });
}

function waitQuestion(
  live: Live,
  uiId: number,
  requestId: string,
  event: Extract<HarnessEvent, { type: "question.asked" }>,
): Promise<UserQuestionReply | "cancelled"> {
  return new Promise<UserQuestionReply | "cancelled">((resolve) => {
    live.questions.set(uiId, { requestId, event, resolve });
  }).finally(() => {
    live.questions.delete(uiId);
  });
}

function showNextQuestion(live: Live): void {
  if (live.muteUpdates || live.cancelled) return;
  if (
    live.visibleQuestionId !== null &&
    live.questions.has(live.visibleQuestionId)
  )
    return;
  const next = live.questions.entries().next().value;
  live.visibleQuestionId = next?.[0] ?? null;
  if (next) emitClaudeEvent(live, next[1].event);
}

function emitTaskListIfNeeded(
  live: Live,
  toolName: string,
  input: Record<string, unknown>,
): void {
  if (!isTodoTool(toolName)) return;
  const items = taskListFromTodos(input);
  if (items) emitClaudeEvent(live, { type: "tasks.updated", items });
}

function handleAgentLifecycle(
  live: Live,
  rec: Record<string, unknown>,
): boolean {
  const started = parseTaskStarted(rec);
  if (started) {
    if (started.ambient) return true;
    live.backgroundTasks.set(started.taskId, {
      description: started.description,
      toolUseId: started.toolUseId,
    });
    syncBackgroundWait(live);
    if (!isAgentTaskType(started.taskType)) return true;
    live.agentTasks.set(started.taskId, {
      taskId: started.taskId,
      toolUseId: started.toolUseId,
      description: started.description,
      backgrounded: started.backgrounded,
    });
    upsertAgentTool(
      live,
      started.toolUseId,
      started.description,
      "in_progress",
    );
    return true;
  }

  const progress = parseTaskProgress(rec);
  if (progress) {
    const task = live.agentTasks.get(progress.taskId);
    const title = progress.description || task?.description || "Subagent";
    const detail =
      progress.summary ||
      progress.lastToolName ||
      (progress.subagentType
        ? `${progress.subagentType.replace(/[_-]+/g, " ")} subagent`
        : undefined);
    upsertAgentTool(
      live,
      progress.toolUseId ?? task?.toolUseId,
      title,
      "in_progress",
      detail,
    );
    return true;
  }

  const updated = parseTaskUpdated(rec);
  if (updated) {
    const task = live.agentTasks.get(updated.taskId);
    if (task && updated.backgrounded !== undefined) {
      task.backgrounded = updated.backgrounded;
    }
    if (task && updated.description) task.description = updated.description;
    const background = live.backgroundTasks.get(updated.taskId);
    if (background && updated.description) {
      background.description = updated.description;
    }
    if (isTerminalAgentTaskStatus(updated.status)) {
      settleBackgroundRow(
        live,
        updated.taskId,
        updated.status ?? "completed",
        updated.error,
      );
      finishBackgroundTask(live, updated.taskId);
      completeAgentTask(
        live,
        updated.taskId,
        updated.status === "completed" ? "completed" : "failed",
        updated.error,
      );
    }
    return true;
  }

  const notice = parseTaskNotification(rec);
  if (notice) {
    if (!notice.ambient) {
      noteTaskNotification(live, notice);
      finishBackgroundTask(live, notice.taskId);
      completeAgentTask(
        live,
        notice.taskId,
        notice.status === "completed" ? "completed" : "failed",
        notice.summary || undefined,
      );
    }
    return true;
  }

  const allTasks = parseBackgroundTasks(rec);
  if (!allTasks) return false;
  const next = new Set(allTasks.map((task) => task.taskId));
  for (const id of [...live.backgroundTasks.keys()]) {
    if (next.has(id)) continue;
    settleBackgroundRow(live, id, "completed");
    finishBackgroundTask(live, id);
  }
  for (const row of allTasks) {
    if (!live.backgroundTasks.has(row.taskId)) {
      live.backgroundTasks.set(row.taskId, { description: row.description });
    }
  }
  const liveTasks = allTasks.filter((task) => isAgentTaskType(task.taskType));
  for (const id of [...live.agentTasks.keys()]) {
    if (!next.has(id)) completeAgentTask(live, id, "completed");
  }
  for (const row of liveTasks) {
    if (live.agentTasks.has(row.taskId)) continue;
    // The list carries no tool_use_id and often lands before task_started, so
    // find the Agent call that spawned it rather than opening a second row.
    const toolUseId = unclaimedAgentCall(live, row.description);
    live.agentTasks.set(row.taskId, {
      taskId: row.taskId,
      toolUseId,
      description: row.description,
      backgrounded: true,
    });
    upsertAgentTool(live, toolUseId, row.description, "in_progress");
  }
  maybeFinishTurn(live);
  syncBackgroundWait(live);
  return true;
}

function handleToolProgress(live: Live, rec: Record<string, unknown>): void {
  const progress = parseToolProgress(rec);
  if (!progress) return;
  const tool =
    live.toolsById.get(progress.toolUseId) ??
    (progress.parentToolUseId
      ? live.toolsById.get(progress.parentToolUseId)
      : undefined);
  if (!tool || !isAgentToolName(tool.name)) return;
  emitClaudeEvent(live, {
    type: "tool.updated",
    callId: tool.id,
    title: tool.title,
    kind: "agent",
    status: "in_progress",
  });
  // Progress names the call in flight. That is a step in the run, not the
  // result of it, so it goes to the panel rather than onto the Agent row.
  if (progress.toolName) {
    emitClaudeEvent(live, {
      type: "agent.step",
      callId: tool.id,
      stepId: progress.toolUseId,
      kind: "tool",
      text: progress.toolName,
      status: "in_progress",
      ...(progress.subagentType ? { agentType: progress.subagentType } : {}),
    });
  }
}

/**
 * The Agent call a subagent message belongs to, or nothing when the message
 * came from somewhere the parent transcript has no row for.
 */
function subagentParent(
  live: Live,
  rec: Record<string, unknown>,
): InFlightTool | undefined {
  const parentId = stringField(rec, "parent_tool_use_id");
  if (!parentId) return undefined;
  const parent = live.toolsById.get(parentId);
  if (!parent || !isAgentToolName(parent.name)) return undefined;
  return parent;
}

/**
 * A call a subagent made, mirrored onto the Agent row that spawned it. The
 * parent keeps its own "still running" status; the step is what the panel
 * under that row reads back.
 */
function noteSubagentTool(
  live: Live,
  rec: Record<string, unknown>,
  id: string,
  name: string,
  input: Record<string, unknown>,
): void {
  const parent = subagentParent(live, rec);
  if (!parent) return;
  const title = toolTitle(name, input);
  // No detail: the Agent row's detail is the report the run hands back, and
  // writing the call of the moment there would leave whatever the subagent
  // happened to do last standing in as its result.
  emitClaudeEvent(live, {
    type: "tool.updated",
    callId: parent.id,
    title: parent.title,
    kind: "agent",
    status: "in_progress",
  });
  if (!id) return;
  const preview = previewFromTool(name, input);
  emitClaudeEvent(live, {
    type: "agent.step",
    callId: parent.id,
    stepId: id,
    kind: "tool",
    text: title,
    toolKind: toolKindFromName(name),
    status: "in_progress",
    ...(preview ? { preview } : {}),
  });
}

/**
 * What a subagent said and thought on its way through the work. Its prose
 * never joins the parent transcript — that would read as the main agent
 * talking — but it is the most legible thing in the panel for its own row.
 */
function noteSubagentNarration(live: Live, rec: Record<string, unknown>): void {
  const parent = subagentParent(live, rec);
  if (!parent) return;
  const model = stringField(asRecord(rec.message), "model");
  if (model)
    emitClaudeEvent(live, {
      type: "tool.updated",
      callId: parent.id,
      kind: "agent",
      agentModel: model,
    });
  const messageId = assistantMessageId(rec) ?? crypto.randomUUID();
  const thinking = assistantThinkingBlocks(rec).join("").trim();
  if (thinking) {
    emitClaudeEvent(live, {
      type: "agent.step",
      callId: parent.id,
      stepId: `${messageId}:thinking`,
      kind: "reasoning",
      text: thinking,
    });
  }
  const text = assistantTextBlocks(rec).join("").trim();
  if (text) {
    emitClaudeEvent(live, {
      type: "agent.step",
      callId: parent.id,
      stepId: `${messageId}:text`,
      kind: "message",
      text,
    });
  }
}

/** Settles the subagent's own tool rows once their results come back. */
function noteSubagentResults(live: Live, rec: Record<string, unknown>): void {
  const parent = subagentParent(live, rec);
  if (!parent) return;
  for (const result of toolResultsFromUserMessage(rec)) {
    emitClaudeEvent(live, {
      type: "agent.step",
      callId: parent.id,
      stepId: result.toolUseId,
      kind: "tool",
      text: "",
      status: result.isError ? "failed" : "completed",
      ...(result.isError && result.text ? { detail: result.text } : {}),
    });
  }
}

function isBackgroundedAgentTool(live: Live, toolUseId: string): boolean {
  for (const task of live.agentTasks.values()) {
    if (task.toolUseId === toolUseId && task.backgrounded) return true;
  }
  return false;
}

/** The latest Agent call with this description that no task has claimed yet. */
function unclaimedAgentCall(
  live: Live,
  description: string,
): string | undefined {
  const claimed = new Set(
    [...live.agentTasks.values()].map((task) => task.toolUseId),
  );
  let match: string | undefined;
  for (const tool of live.toolsById.values()) {
    if (!isAgentToolName(tool.name) || claimed.has(tool.id)) continue;
    if (stringField(tool.input, "description") === description) match = tool.id;
  }
  return match;
}

function upsertAgentTool(
  live: Live,
  callId: string | undefined,
  title: string,
  status: string,
  detail?: string,
): void {
  const id = callId ?? `agent:${title}`;
  const existing = live.toolsById.get(id);
  if (!existing) {
    live.toolsById.set(id, {
      id,
      name: "Agent",
      input: {},
      partialJson: "",
      title,
    });
    emitClaudeEvent(live, {
      type: "tool.started",
      callId: id,
      title,
      kind: "agent",
      status,
    });
    if (
      status !== "in_progress" &&
      status !== "pending" &&
      status !== "running"
    ) {
      emitClaudeEvent(live, {
        type: "tool.updated",
        callId: id,
        title,
        kind: "agent",
        status,
        ...(detail ? { detail } : {}),
      });
    }
    return;
  }
  if (title) existing.title = title;
  emitClaudeEvent(live, {
    type: "tool.updated",
    callId: id,
    title: existing.title,
    kind: "agent",
    status,
    ...(detail ? { detail } : {}),
  });
}

function completeAgentTask(
  live: Live,
  taskId: string,
  status: string,
  detail?: string,
): void {
  const task = live.agentTasks.get(taskId);
  live.agentTasks.delete(taskId);
  if (task) {
    upsertAgentTool(
      live,
      task.toolUseId,
      task.description,
      status,
      detail ?? (status === "failed" ? "Subagent failed." : undefined),
    );
  }
  maybeFinishTurn(live);
}

/**
 * A task is done. If Claude had already yielded, the notification about it
 * starts a follow-up turn, so hold the MonoCode turn open for that too rather
 * than settling in the gap between the two.
 */
function finishBackgroundTask(live: Live, taskId: string): void {
  if (!live.backgroundTasks.delete(taskId)) return;
  if (live.turnResultSeen && live.activeTurn && !live.awaitingResume) {
    live.awaitingResume = setTimeout(() => {
      live.awaitingResume = null;
      maybeFinishTurn(live);
      syncBackgroundWait(live);
    }, RESUME_GRACE_MS);
  }
  maybeFinishTurn(live);
  syncBackgroundWait(live);
}

/**
 * Claude began another turn inside this MonoCode turn: woken by a finished
 * task, or by a follow-up written in while it waited. Its own result, not the
 * earlier one, decides when the MonoCode turn ends.
 */
function noteClaudeTurnStarted(live: Live): void {
  if (!live.activeTurn || !live.turnResultSeen) return;
  live.turnResultSeen = false;
  // A new message, not more of the last one: its snapshot must not be
  // compared against what the earlier turn streamed.
  live.emittedAssistant = "";
  live.emittedReasoning = "";
  live.pendingAssistantBoundary = false;
  // Close the message Claude left off with, so the reply starts its own and
  // the fold puts the earlier one away, the same as prose between tool calls.
  // A background command's row already sits between the two; a subagent's
  // report is noted in the trail to do the same.
  emitClaudeEvent(live, { type: "message.completed" });
  emitClaudeEvent(live, { type: "reasoning.completed" });
  for (const text of live.taskNotes) emitClaudeEvent(live, { type: "status", text });
  live.taskNotes = [];
  clearAwaitingResume(live);
  syncBackgroundWait(live);
}

/**
 * Claude yielded with commands still running. Each gets a live row under the
 * message it left off with, like any call in flight, until it finishes.
 * Subagents already have a row of their own.
 */
function showBackgroundRows(live: Live): void {
  if (!live.activeTurn || live.cancelled) return;
  for (const [taskId, task] of live.backgroundTasks) {
    if (live.backgroundRows.has(taskId) || live.agentTasks.has(taskId))
      continue;
    const source = task.toolUseId
      ? live.toolsById.get(task.toolUseId)
      : undefined;
    if (source && isAgentToolName(source.name)) continue;
    const callId = `background:${taskId}`;
    live.backgroundRows.set(taskId, callId);
    emitClaudeEvent(live, {
      type: "tool.started",
      callId,
      title: source ? toolTitle(source.name, source.input) : task.description,
      kind: source ? toolKindFromName(source.name) : "execute",
      status: "in_progress",
      background: true,
      ...(source
        ? { preview: previewFromTool(source.name, source.input) }
        : {}),
    });
  }
}

function settleBackgroundRow(
  live: Live,
  taskId: string,
  status: string,
  detail?: string,
): void {
  const callId = live.backgroundRows.get(taskId);
  if (!callId || live.muteUpdates) return;
  emitClaudeEvent(live, {
    type: "tool.updated",
    callId,
    status: status === "completed" ? "completed" : "failed",
    ...(detail ? { detail } : {}),
  });
}

/**
 * What Claude was told when a task finished. A command's row takes the
 * summary; a subagent's is kept for the trail until Claude picks back up.
 */
function noteTaskNotification(
  live: Live,
  notice: ClaudeAgentTaskNotification,
): void {
  if (!live.activeTurn) return;
  if (live.backgroundRows.has(notice.taskId)) {
    settleBackgroundRow(
      live,
      notice.taskId,
      notice.status,
      notice.summary || undefined,
    );
    return;
  }
  const tool = notice.toolUseId ? live.toolsById.get(notice.toolUseId) : null;
  const agent =
    (tool && isAgentToolName(tool.name)) || live.agentTasks.has(notice.taskId);
  if (!agent || !live.turnResultSeen) return;
  live.taskNotes.push(notice.summary || "Subagent finished.");
}

function clearAwaitingResume(live: Live): void {
  if (!live.awaitingResume) return;
  clearTimeout(live.awaitingResume);
  live.awaitingResume = null;
}

/**
 * Tells the UI what the turn is waiting on once Claude has yielded with work
 * still running, and clears it when Claude picks the thread back up.
 */
function syncBackgroundWait(live: Live): void {
  const waiting =
    live.activeTurn && live.turnResultSeen && !live.cancelled
      ? [...live.backgroundTasks.values()].map((task) => task.description)
      : [];
  const key = waiting.join("\n");
  if (key === live.backgroundKey) return;
  live.backgroundKey = key;
  if (live.muteUpdates) return;
  emitClaudeEvent(live, { type: "background.updated", tasks: waiting });
}

function maybeFinishTurn(live: Live): void {
  if (!live.turnResultSeen) return;
  if (live.agentTasks.size > 0 || live.backgroundTasks.size > 0) return;
  if (live.awaitingResume) return;
  if (!live.activeTurn && !live.turnDone) return;
  finishActiveTurn(live, [
    { type: "message.completed" },
    { type: "reasoning.completed" },
  ]);
}

function finishActiveTurn(live: Live, extraEvents: HarnessEvent[] = []): void {
  clearAwaitingResume(live);
  live.turnEndPending = false;
  live.activeTurn = false;
  if (live.turnUsage && live.requestsById.size > 0) {
    live.priorTurnsUsage = addProcessedUsage(
      live.priorTurnsUsage,
      live.turnUsage,
    );
    live.turnUsage = undefined;
    live.requestsById.clear();
  }
  for (const event of extraEvents) emitClaudeEvent(live, event);
  const done = live.turnDone;
  const failed = live.turnFailed;
  live.turnDone = null;
  live.turnFailed = null;
  if (done) {
    done();
    return;
  }
  if (!failed) live.turnEndPending = true;
}

function settlePendingTurn(live: Live): void {
  if (!live.turnEndPending || !live.turnDone) return;
  finishActiveTurn(live);
}

function markInitialized(live: Live): void {
  if (live.initialized) return;
  live.initialized = true;
  live.initDone?.();
  live.initDone = null;
}

function waitForInit(live: Live, timeoutMs: number): Promise<void> {
  if (live.initialized || live.exited) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      live.initDone = null;
      resolve();
    }, timeoutMs);
    live.initDone = () => {
      clearTimeout(timer);
      resolve();
    };
  });
}

function nextControlId(): string {
  nextClaudeControlId += 1;
  return `monocode_${nextClaudeControlId}`;
}

function writeJson(
  sessionId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  return writeChild(sessionId, JSON.stringify(payload));
}

function takePendingControl(
  live: Live,
  requestId: string,
): PendingControl | undefined {
  const pending = live.pendingControls.get(requestId);
  if (!pending) return undefined;
  live.pendingControls.delete(requestId);
  clearTimeout(pending.timer);
  pending.cleanup();
  return pending;
}

function resolvePendingControl(
  live: Live,
  requestId: string,
  payload: Record<string, unknown>,
): void {
  takePendingControl(live, requestId)?.resolve(payload);
}

function rejectPendingControl(
  live: Live,
  requestId: string,
  error: ClaudeControlError,
): void {
  takePendingControl(live, requestId)?.reject(error);
}

function rejectPendingControls(live: Live, error: ClaudeControlError): void {
  for (const requestId of live.pendingControls.keys()) {
    rejectPendingControl(live, requestId, error);
  }
}

function sendControl(
  live: Live,
  request: Record<string, unknown>,
  opts?: {
    timeoutMs?: number;
    signal?: AbortSignal;
    onWriteComplete?: () => void;
  },
): Promise<Record<string, unknown>> {
  const signal = opts?.signal;
  if (signal?.aborted) {
    return Promise.reject(
      new ClaudeControlError("cancelled", "Claude control request cancelled"),
    );
  }

  const requestId = nextControlId();
  return new Promise((resolve, reject) => {
    let abortHandler: (() => void) | undefined;
    let writeCompletionNotified = false;
    const notifyWriteComplete = (): void => {
      if (writeCompletionNotified) return;
      writeCompletionNotified = true;
      opts?.onWriteComplete?.();
    };
    const pending: PendingControl = {
      resolve,
      reject,
      timer: setTimeout(
        () =>
          rejectPendingControl(
            live,
            requestId,
            new ClaudeControlError(
              "timeout",
              "Claude Code control request timed out",
            ),
          ),
        opts?.timeoutMs ?? CONTROL_TIMEOUT_MS,
      ),
      cleanup: () => {
        if (signal && abortHandler) {
          signal.removeEventListener("abort", abortHandler);
        }
      },
    };
    live.pendingControls.set(requestId, pending);

    if (signal) {
      abortHandler = () =>
        rejectPendingControl(
          live,
          requestId,
          new ClaudeControlError(
            "cancelled",
            "Claude control request cancelled",
          ),
        );
      signal.addEventListener("abort", abortHandler, { once: true });
      if (signal.aborted) {
        abortHandler();
        return;
      }
    }

    try {
      void writeJson(live.sessionId, buildControlRequest(requestId, request))
        .then(notifyWriteComplete)
        .catch((error: unknown) => {
          notifyWriteComplete();
          rejectPendingControl(
            live,
            requestId,
            new ClaudeControlError(
              "write-failed",
              error instanceof Error ? error.message : String(error),
            ),
          );
        });
    } catch (error) {
      notifyWriteComplete();
      rejectPendingControl(
        live,
        requestId,
        new ClaudeControlError(
          "write-failed",
          error instanceof Error ? error.message : String(error),
        ),
      );
    }
  });
}

function nextRemoteControlGeneration(sessionId: string): number {
  const generation = (remoteControlGenerations.get(sessionId) ?? 0) + 1;
  remoteControlGenerations.set(sessionId, generation);
  return generation;
}

function emitRemoteControl(
  live: Live,
  status: RemoteControlStatus,
  details: { url?: string; message?: string } = {},
): void {
  live.remoteControl = {
    status,
    generation: live.remoteControl.generation,
    ...(details.url ? { url: details.url } : {}),
    ...(details.message ? { message: details.message } : {}),
  };
  emitClaudeEvent(live, {
    type: "remoteControl.changed",
    status,
    ...(details.url ? { url: details.url } : {}),
    ...(details.message ? { message: details.message } : {}),
  });
}

function isCurrentRemoteControlAction(live: Live, generation: number): boolean {
  return (
    !live.exited &&
    liveByThread.get(live.sessionId) === live &&
    remoteControlGenerations.get(live.sessionId) === generation
  );
}

async function requestClaudeRemoteControl(
  live: Live,
  enabled: boolean,
  generation: number,
  name: string | undefined,
  options: { throwOnFailure: boolean; waitForResponse: boolean },
): Promise<void> {
  live.remoteControl.generation = generation;
  emitRemoteControl(live, "connecting");
  let completeWrite!: () => void;
  const writeComplete = new Promise<void>((resolve) => {
    completeWrite = resolve;
  });
  const response = sendControl(
    live,
    buildRemoteControlRequest(enabled, name),
    {
      timeoutMs: REMOTE_CONTROL_TIMEOUT_MS,
      onWriteComplete: completeWrite,
    },
  )
    .then((payload) => {
      if (!isCurrentRemoteControlAction(live, generation)) return;
      if (!enabled) {
        emitRemoteControl(live, "off");
        return;
      }
      const parsed = parseRemoteControlResponse(payload);
      if (!parsed) {
        throw new Error(
          "Claude Code did not return a valid HTTPS Remote Control session URL.",
        );
      }
      emitRemoteControl(live, "on", { url: parsed.sessionUrl });
    })
    .catch((error: unknown) => {
      if (!isCurrentRemoteControlAction(live, generation)) return;
      const message = error instanceof Error ? error.message : String(error);
      const status = isRemoteControlConsentError(message)
        ? "needs-consent"
        : "failed";
      if (enabled && status === "failed") {
        remoteControlDesired.delete(live.sessionId);
      }
      emitRemoteControl(live, status, { message });
      if (options.throwOnFailure) {
        throw new HarnessRemoteControlError(status, message);
      }
    });
  void response.then(completeWrite, completeWrite);
  live.remoteControlAttempt = { generation, promise: response };
  if (options.waitForResponse) {
    await response;
    return;
  }
  await writeComplete;
}

const READ_ONLY_CLAUDE_CONTROL_SUBTYPES = new Set([
  "get_context_usage",
  "get_settings",
]);

export function requestClaudeControl(
  sessionId: string,
  request: Record<string, unknown>,
  opts?: {
    timeoutMs?: number;
    signal?: AbortSignal;
    requireIdle?: boolean;
  },
): Promise<{ payload: Record<string, unknown>; generation: number }> {
  const live = liveByThread.get(sessionId);
  if (!live || !live.initialized) {
    return Promise.reject(
      new ClaudeControlError("unavailable", "Claude Code is not initialized"),
    );
  }
  const subtype = stringField(request, "subtype");
  if (!subtype || !READ_ONLY_CLAUDE_CONTROL_SUBTYPES.has(subtype)) {
    return Promise.reject(
      new ClaudeControlError(
        "unavailable",
        "Unsupported Claude control request",
      ),
    );
  }
  if (
    opts?.requireIdle &&
    (live.activeTurn ||
      live.turnEndPending ||
      live.manualCompaction ||
      live.approvals.size > 0 ||
      live.questions.size > 0)
  ) {
    return Promise.reject(
      new ClaudeControlError("unavailable", "Claude Code is busy"),
    );
  }
  const generation = live.generation;
  return sendControl(live, request, opts).then((payload) => ({
    payload,
    generation,
  }));
}

function settingsKeyFor(input: HarnessSessionInput): string {
  return `${input.providerAccountId ?? "default"}:${claudeSettingsKey({
    model: nativeModelId(input.model),
    effort: input.modelSettings?.effort,
    fast: input.modelSettings?.fast,
    thinking: input.modelSettings?.thinking,
    context: input.modelSettings?.context,
    runtimeMode: input.runtimeMode,
    hooks: loadClaudeHooks(),
  })}`;
}

function launchOptions(
  input: HarnessSessionInput,
  resume: string | undefined,
  sessionId: string,
): {
  model?: string;
  effort?: string;
  permissionMode?: ReturnType<typeof runtimeModeToPermission>;
  resume?: string;
  sessionId?: string;
  settings?: ClaudeCliSettings;
  allowedTools?: string[];
} {
  const native = nativeModelId(input.model);
  const effortRaw = input.modelSettings?.effort;
  const context = input.modelSettings?.context;
  const settings: ClaudeCliSettings = {};
  if (input.modelSettings?.thinking === "true") {
    settings.alwaysThinkingEnabled = true;
  }
  if (input.modelSettings?.fast === "true") {
    settings.fastMode = true;
  }
  if (isClaudeUltracodeEffort(effortRaw)) {
    settings.ultracode = true;
  }
  if (!loadClaudeHooks()) {
    settings.disableAllHooks = true;
  }
  return {
    model: resolveClaudeApiModelId(native, context),
    effort: normalizeClaudeCliEffort(effortRaw, native),
    permissionMode:
      input.intent === "plan"
        ? "plan"
        : runtimeModeToPermission(input.runtimeMode),
    resume,
    sessionId: resume ? undefined : sessionId,
    settings: Object.keys(settings).length > 0 ? settings : undefined,
    allowedTools: claudeAllowedTools(input),
  };
}

function claudeAllowedTools(input: HarnessSessionInput): string[] | undefined {
  if (input.intent === "plan") return undefined;
  const grant = sessionGrantsByThread.get(input.sessionId);
  if (
    !grant ||
    grant.cwd !== input.cwd ||
    !sameProviderAccountId(grant.providerAccountId, input.providerAccountId)
  ) {
    return undefined;
  }
  return grant.rules.map((rule) =>
    rule.ruleContent === undefined
      ? rule.toolName
      : `${rule.toolName}(${rule.ruleContent})`,
  );
}

function addClaudeSessionRules(
  sessionId: string,
  live: Live,
  rules: ClaudeSessionRule[],
): void {
  if (liveByThread.get(sessionId) !== live || live.cancelled || live.planning)
    return;
  const entry = sessionGrantsByThread.get(sessionId) ?? {
    cwd: live.cwd,
    providerAccountId: live.providerAccountId,
    rules: [],
  };
  const seen = new Set(
    entry.rules.map(
      (rule) => `${rule.toolName}\u0000${rule.ruleContent ?? ""}`,
    ),
  );
  for (const rule of rules) {
    const key = `${rule.toolName}\u0000${rule.ruleContent ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    entry.rules.push(rule);
  }
  sessionGrantsByThread.set(sessionId, entry);
}

/** Exported for tests. */
export function __claudeTestReset(): void {
  liveByThread.clear();
  liveStartsByThread.clear();
  resumeByThread.clear();
  remoteControlDesired.clear();
  remoteControlGenerations.clear();
  sessionGrantsByThread.clear();
  resolveClaudeMcpServersImpl = discoverClaudeMcpServers;
  tasksByThread.clear();
  cancelledThreads.clear();
  nextClaudeGeneration = 0;
  nextClaudeControlId = 0;
}

/** Inspects only an existing idle process; transport owns cancellation and timeout. */
export async function inspectClaudeContext(
  sessionId: string,
  signal?: AbortSignal,
): Promise<NativeContextBreakdown | null> {
  try {
    const { payload, generation } = await requestClaudeControl(
      sessionId,
      { subtype: "get_context_usage", detail: "summary" },
      { timeoutMs: 5000, requireIdle: true, signal },
    );
    if (liveByThread.get(sessionId)?.generation !== generation) return null;
    return parseClaudeContextUsage(payload);
  } catch (error: unknown) {
    if (error instanceof ClaudeControlError) return null;
    throw error;
  }
}

import { isProviderFailureText } from "./plan";
import { isPreparingHandoff } from "./handoff";
import {
  promoteLastAssistantToPlan,
  stopStreaming,
} from "../../../integrations/harness/core/apply";
import {
  QUEUE_HOLD_REASON_STEER_CANCEL,
  QUEUE_HOLD_REASON_USAGE_LIMIT,
  type PlanStatus,
  type QueuedMessage,
  type Session,
  type TurnIntent,
} from "./session";

const QUEUED_STEER_CANCEL_GRACE_MS = 15_000;

export function queuedHead(session: Session): QueuedMessage | undefined {
  return session.queuedMessages?.[0];
}

/** Preserve queue barriers when a follow-up is added during an active turn. */
export function appendQueuedMessage(
  session: Session,
  message: QueuedMessage,
): Session {
  const preserveStatus =
    session.queueStatus === "paused" ||
    session.queueStatus === "held" ||
    session.queueStatus === "steering" ||
    session.queueStatus === "resuming";
  const usageLimitHold =
    Boolean(session.usageLimit) &&
    session.queueStatus !== "paused" &&
    session.queueStatus !== "steering" &&
    session.queueStatus !== "resuming";
  return {
    ...session,
    queuedMessages: [...(session.queuedMessages ?? []), message],
    queueStatus: usageLimitHold
      ? "held"
      : preserveStatus
        ? session.queueStatus
        : "active",
    ...(usageLimitHold
      ? {
          queueHoldReason:
            session.queueHoldReason ?? QUEUE_HOLD_REASON_USAGE_LIMIT,
        }
      : {}),
  };
}

/** Keep a usage-limit dismissal from releasing queued work automatically. */
export function dismissUsageLimitNotice(session: Session): Session {
  if (!session.usageLimit) return session;
  const cleared = { ...session, usageLimit: undefined };
  if (!session.queuedMessages?.length) {
    return session.busy
      ? {
          ...cleared,
          queueStatus: "held",
          queueHoldReason:
            session.queueHoldReason ?? QUEUE_HOLD_REASON_USAGE_LIMIT,
        }
      : cleared;
  }
  if (
    session.queueStatus === "paused" ||
    session.queueStatus === "steering" ||
    session.queueStatus === "resuming"
  ) {
    return cleared;
  }
  return {
    ...cleared,
    queueStatus: "held",
    queueHoldReason: session.queueHoldReason ?? QUEUE_HOLD_REASON_USAGE_LIMIT,
  };
}

/** Release a held queue only after the user activates its Resume control. */
export function releaseHeldQueue(session: Session): Session {
  if (session.queueStatus !== "held") return session;
  return {
    ...session,
    queueStatus: "active",
    queueHoldReason: undefined,
    usageLimit: undefined,
  };
}

/** Explicit or opted-in quota resume sends Continue before queued follow-ups. */
export function prepareUsageLimitContinue(session: Session): Session {
  if (!session.usageLimit) return session;
  return {
    ...session,
    usageLimit: undefined,
    ...(session.queuedMessages?.length
      ? { queueStatus: "resuming", queueHoldReason: undefined }
      : { queueStatus: undefined, queueHoldReason: undefined }),
  };
}

/** Hold auto-dispatch only while the item about to send is being edited. */
export function isEditingQueuedHead(session: Session): boolean {
  const head = queuedHead(session);
  return Boolean(head && session.editingQueuedMessageId === head.id);
}

export function dequeueQueuedMessage(
  session: Session,
  messageId: string,
): Session {
  const queuedMessages = (session.queuedMessages ?? []).filter(
    (message) => message.id !== messageId,
  );
  return {
    ...session,
    queuedMessages: queuedMessages.length > 0 ? queuedMessages : undefined,
    queueStatus: queuedMessages.length > 0 ? session.queueStatus : undefined,
    ...(queuedMessages.length > 0 ? {} : { queueHoldReason: undefined }),
    editingQueuedMessageId:
      session.editingQueuedMessageId === messageId
        ? undefined
        : session.editingQueuedMessageId,
  };
}

/**
 * True when the idle session can send its queued head as a new turn.
 * Busy / paused / resuming / usage-limited / steering / held / preparing-handoff / editing-the-head all wait.
 */
export function canDispatchQueuedHead(session: Session): boolean {
  if (session.busy) return false;
  if (session.worktreePreparing || session.worktreeRemoved) return false;
  if (session.usageLimit) return false;
  if (
    session.queueStatus === "paused" ||
    session.queueStatus === "resuming" ||
    session.queueStatus === "steering" ||
    // A failed turn holds the queue: auto-dispatch waits for the user.
    session.queueStatus === "held"
  ) {
    return false;
  }
  const head = queuedHead(session);
  if (!head) return false;
  if (isEditingQueuedHead(session)) return false;
  if (isPreparingHandoff(session)) return false;
  return true;
}

/** Monos deliver one waiting follow-up at a time after the provider is ready. */
export function canSteerQueuedHead(session: Session): boolean {
  const head = queuedHead(session);
  return (
    !!head &&
    !head.monoSessionCompletion &&
    !!session.busy &&
    !!session.turnReady &&
    !session.worktreePreparing &&
    !session.worktreeRemoved &&
    !session.pendingSwitch &&
    !session.usageLimit &&
    !(
      session.pendingQuestion && session.pendingQuestion.autoResolveAt == null
    ) &&
    session.queueStatus !== "paused" &&
    session.queueStatus !== "held" &&
    session.queueStatus !== "steering" &&
    session.queueStatus !== "resuming" &&
    !isEditingQueuedHead(session) &&
    !isPreparingHandoff(session) &&
    head.intent !== "plan" &&
    head.intent !== "orchestrate"
  );
}

/** Resolve a queued row for auto-dispatch (head, idle) or an explicit Steer. */
export function queuedMessageForSubmit(
  session: Session,
  messageId: string,
  mode: "dispatch" | "steer",
): QueuedMessage | undefined {
  const message = session.queuedMessages?.find(
    (entry) => entry.id === messageId,
  );
  if (!message) return undefined;
  if (mode === "steer") return message.monoSessionCompletion ? undefined : message;
  if (queuedHead(session)?.id !== messageId) return undefined;
  if (!canDispatchQueuedHead(session)) return undefined;
  return message;
}

/**
 * Stop visible progress and hold dispatch while a non-native Steer waits for
 * the provider's cancellation acknowledgement.
 */
export function beginQueuedSteerCancellation(
  session: Session,
  messageId: string,
): Session {
  const selected = session.queuedMessages?.find(
    (message) => message.id === messageId,
  );
  if (!selected) return session;
  const stopped = stopStreaming(session);
  return {
    ...stopped,
    // Keep the composer in its in-flight state until cancellation settles.
    busy: true,
    queuedMessages: [
      selected,
      ...(stopped.queuedMessages ?? []).filter(
        (message) => message.id !== messageId,
      ),
    ],
    queueStatus: "steering",
    queueHoldReason: undefined,
    editingQueuedMessageId: undefined,
  };
}

/** Release a cancelled Steer, or hold it for manual recovery on failure. */
export function finishQueuedSteerCancellation(
  session: Session,
  succeeded: boolean,
): Session {
  if (session.queueStatus !== "steering") return session;
  return {
    ...session,
    busy: false,
    queueStatus: succeeded ? "active" : "held",
    queueHoldReason: succeeded ? undefined : QUEUE_HOLD_REASON_STEER_CANCEL,
  };
}

/** Wait for every provider cancellation and report whether all acknowledged. */
export async function settleQueuedSteerCancellations(
  cancellations: readonly Promise<void>[],
): Promise<boolean> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const settled = Promise.allSettled(cancellations).then((results) =>
    results.every((result) => result.status === "fulfilled"),
  );
  const timedOut = new Promise<false>((resolve) => {
    timeoutId = setTimeout(() => resolve(false), QUEUED_STEER_CANCEL_GRACE_MS);
  });

  try {
    return await Promise.race([settled, timedOut]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

export function withPlanStatus(
  session: Session,
  blockId: string,
  status: PlanStatus,
): Session {
  return {
    ...session,
    blocks: session.blocks.map((block) =>
      block.id === blockId && block.role === "plan"
        ? {
            ...block,
            plan: { ...(block.plan ?? { status: "ready" }), status },
          }
        : block,
    ),
  };
}

export function lastAssistantTextInTurn(session: Session): string {
  for (let index = session.blocks.length - 1; index >= 0; index -= 1) {
    const block = session.blocks[index];
    if (block.role === "user") return "";
    if (block.role === "assistant" && block.text.trim()) return block.text;
  }
  return "";
}

function failedTurnReason(session: Session): string {
  for (let index = session.blocks.length - 1; index >= 0; index -= 1) {
    const block = session.blocks[index];
    if (block.role === "user") break;
    if (
      block.role === "system" &&
      block.notice === "error" &&
      block.text.trim()
    ) {
      return block.text.trim();
    }
    if (
      block.role === "assistant" &&
      block.text.trim() &&
      isProviderFailureText(block.text)
    ) {
      return block.text.trim();
    }
  }
  return "The last turn failed. Review the error before resuming the queue.";
}

/**
 * Pure turn finalizer. Stops streaming, updates plan/build state, and
 * transitions non-empty queues to "held" synchronously on provider failure.
 */
export function finalizeTurnSession(
  session: Session,
  params: {
    providerFailed: boolean;
    intent?: TurnIntent;
    approvedPlanId?: string;
    buildSucceeded?: boolean;
    nativePlanSeen?: boolean;
    planEventKey?: string;
  },
): Session {
  const stopped = stopStreaming(session);
  const finalized =
    params.intent === "plan" && !params.nativePlanSeen && !params.providerFailed
      ? promoteLastAssistantToPlan(stopped, params.planEventKey)
      : stopped;
  const built =
    params.approvedPlanId && params.intent === "build"
      ? withPlanStatus(
          finalized,
          params.approvedPlanId,
          params.buildSucceeded && !params.providerFailed ? "built" : "ready",
        )
      : finalized;
  if (params.providerFailed && built.queuedMessages?.length) {
    return {
      ...built,
      queueStatus: "held",
      queueHoldReason: failedTurnReason(built),
    };
  }
  if (!built.queuedMessages?.length && built.queueStatus === "held") {
    return { ...built, queueStatus: undefined, queueHoldReason: undefined };
  }
  return built;
}

export interface TurnCompletionParams {
  sessionId: string;
  getSessions: () => Session[];
  setSessions: (sessions: Session[]) => void;
  syncDockBadge?: (sessions: Session[]) => void;
  flushCheckpoint: (sessionId: string) => Promise<void>;
  beforeFailureCheckpoint?: () => Promise<void>;
  providerFailureSeen: boolean;
  intent?: TurnIntent;
  approvedPlanId?: string;
  buildSucceeded: boolean;
  nativePlanSeen: boolean;
  planEventKey: string;
  /**
   * The caller's last changes to the finished turn, applied in the same update
   * that releases `busy`. Once released, the queue may start the next turn, so
   * a later update from the finished turn would end that one instead.
   */
  finalizeSession?: (session: Session, providerFailed: boolean) => Session;
}

/**
 * Orchestrates turn completion with atomic queue status transitions.
 * If provider failed, synchronously transitions non-empty queue to "held"
 * before awaiting checkpoint flush, preventing auto-dispatch race conditions.
 * On success, preserves busy: true until checkpoint flush completes.
 * After this resolves the session belongs to the queue: callers must not
 * finalize the turn again.
 */
export async function orchestrateTurnCompletion(
  params: TurnCompletionParams,
): Promise<void> {
  const current = params.getSessions().find((s) => s.id === params.sessionId);
  if (!current) return;

  const providerFailed =
    params.providerFailureSeen ||
    isProviderFailureText(lastAssistantTextInTurn(current));

  const finalizeSession = params.finalizeSession ?? ((session) => session);
  if (providerFailed) {
    const finalized = finalizeSession(
      finalizeTurnSession(current, {
        providerFailed: true,
        intent: params.intent,
        approvedPlanId: params.approvedPlanId,
        buildSucceeded: false,
        nativePlanSeen: params.nativePlanSeen,
        planEventKey: params.planEventKey,
      }),
      true,
    );
    const nextSessions = params
      .getSessions()
      .map((s) => (s.id === params.sessionId ? finalized : s));
    params.setSessions(nextSessions);
    params.syncDockBadge?.(nextSessions);

    if (params.beforeFailureCheckpoint) {
      await params.beforeFailureCheckpoint();
    }
    await params.flushCheckpoint(params.sessionId);
  } else {
    await params.flushCheckpoint(params.sessionId);

    const latest =
      params.getSessions().find((s) => s.id === params.sessionId) ?? current;
    const finalized = finalizeSession(
      finalizeTurnSession(latest, {
        providerFailed: false,
        intent: params.intent,
        approvedPlanId: params.approvedPlanId,
        buildSucceeded: params.buildSucceeded,
        nativePlanSeen: params.nativePlanSeen,
        planEventKey: params.planEventKey,
      }),
      false,
    );
    const nextSessions = params
      .getSessions()
      .map((s) => (s.id === params.sessionId ? finalized : s));
    params.setSessions(nextSessions);
    params.syncDockBadge?.(nextSessions);
  }
}

import { visibleMonoCompletionMessages } from "../../monos/model/monoMessaging";
import type {
  MessageQueueStatus,
  QueuedMessage,
  Session,
} from "../../sessions/model/session";
import { isInteractiveClaudeSession } from "../../sessions/model/steerSupport";

// Fork (Hari, L-238): the desktop's message queue as the phone shows it, above
// its composer, and the checks before the phone changes it.

export type MobileQueue = {
  status: MessageQueueStatus;
  holdReason?: string;
  sendingId?: string;
  /** What "send now" does here; null where the phone offers no send now. */
  steer: "steer" | "send-now" | null;
  messages: {
    id: string;
    /** As the desktop's queue row reads. */
    label: string;
    text: string;
    attachments: number;
    error?: string;
    canEdit: boolean;
  }[];
};

export type MobileQueueAction = "delete" | "edit" | "steer" | "resume";

/** The label the desktop's queue row shows for a message. */
export function queuedMessageLabel(message: QueuedMessage) {
  const completion = message.monoSessionCompletion;
  const count = message.attachments.length;
  return (
    (completion
      ? completion.sessionCount
        ? `${completion.sessionCount} sessions finished`
        : `Session ${completion.status}: ${completion.title}`
      : message.text.trim()) ||
    message.noteCard?.title ||
    message.handoffCard?.brief ||
    `${count} attachment${count === 1 ? "" : "s"}`
  );
}

/**
 * The queue a conversation shows, null when empty. A Mono's pane lists only
 * its session-finished notices; its own messages are bubbles in the chat.
 */
export function mobileQueue(
  session: Session,
  mono = false,
): MobileQueue | null {
  const messages = mono
    ? visibleMonoCompletionMessages(session)
    : (session.queuedMessages ?? []);
  if (!messages.length) return null;
  return {
    status: session.queueStatus ?? "active",
    ...(session.queueHoldReason ? { holdReason: session.queueHoldReason } : {}),
    ...(session.sendingQueuedMessageId
      ? { sendingId: session.sendingQueuedMessageId }
      : {}),
    steer: mono
      ? null
      : isInteractiveClaudeSession(session)
        ? "send-now"
        : "steer",
    messages: messages.map((message) => ({
      id: message.id,
      label: queuedMessageLabel(message),
      text: message.text,
      attachments: message.attachments.length,
      ...(message.error ? { error: message.error } : {}),
      canEdit: !mono && !message.monoSessionCompletion,
    })),
  };
}

/**
 * Throws the reason the phone can't make this change now, as the desktop's
 * own buttons would be disabled. Returns the edited text for an edit.
 */
export function checkMobileQueueAction(
  session: Session | undefined,
  action: MobileQueueAction,
  params: Record<string, unknown>,
  mono = false,
): string | undefined {
  if (!session || session.worktreeRemoved)
    throw new Error("Session is no longer available");
  const queue = mobileQueue(session, mono);
  if (session.queueStatus === "steering")
    throw new Error("The queue is sending a message. Try again in a moment.");
  if (action === "resume") {
    if (!queue) throw new Error("The queue is already empty");
    if (session.queueStatus !== "paused" && session.queueStatus !== "held")
      throw new Error("The queue is already running");
    return undefined;
  }
  const message = queue?.messages.find(
    (entry) => entry.id === params.messageId,
  );
  if (!message) throw new Error("This message was already sent or removed");
  if (session.sendingQueuedMessageId === message.id)
    throw new Error("This message is sending now");
  if (action === "steer" && !queue?.steer)
    throw new Error("This message can't be sent now from the phone");
  if (action !== "edit") return undefined;
  if (!message.canEdit) throw new Error("This message can't be edited");
  const text = typeof params.text === "string" ? params.text : "";
  if ((!text.trim() && message.attachments === 0) || text.length > 100_000)
    throw new Error("Enter a message under 100,000 characters");
  return text;
}

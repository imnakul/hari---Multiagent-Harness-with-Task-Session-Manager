import { useEffect, useRef, useState } from "react";
import {
  Check,
  CornerDownRight,
  ListEnd,
  Pause,
  Pencil,
  Play,
  Trash2,
  X,
} from "../../../shared/ui/icons";
import { isImeComposition } from "../../../shared/lib/keyboard";
import type { MessageQueueStatus, QueuedMessage } from "../model/session";

export function MessageQueue({
  messages,
  status,
  holdReason,
  onDelete,
  onEdit,
  onEditingChange,
  onSteer,
  steerLabel = "steer",
  onResume,
  variant = "queue",
  sendingId,
}: {
  messages: QueuedMessage[];
  status?: MessageQueueStatus;
  holdReason?: string;
  onDelete?: (messageId: string) => void;
  onEdit?: (messageId: string, text: string) => void;
  onEditingChange?: (messageId?: string) => void;
  onSteer?: (messageId: string) => void;
  /** Interactive Claude can't steer: its button stops the turn, then sends (L-193). */
  steerLabel?: "steer" | "send-now";
  onResume?: () => void;
  variant?: "queue" | "messages";
  sendingId?: string;
}) {
  const [editingId, setEditingId] = useState<string>();
  const [editDraft, setEditDraft] = useState("");
  const onEditingChangeRef = useRef(onEditingChange);
  onEditingChangeRef.current = onEditingChange;
  const editingIdRef = useRef(editingId);
  editingIdRef.current = editingId;
  useEffect(() => {
    return () => {
      if (editingIdRef.current) onEditingChangeRef.current?.(undefined);
    };
  }, []);
  useEffect(() => {
    if (status === "steering" && editingIdRef.current) {
      setEditingId(undefined);
      setEditDraft("");
      onEditingChangeRef.current?.(undefined);
    }
  }, [status]);
  if (messages.length === 0) return null;
  const paused = status === "paused";
  const held = status === "held";
  const steering = status === "steering";
  const failed = messages.some((message) => message.error);

  const startEdit = (message: QueuedMessage) => {
    if (steering || sendingId === message.id || message.monoSessionCompletion)
      return;
    setEditingId(message.id);
    setEditDraft(message.text);
    onEditingChange?.(message.id);
  };
  const cancelEdit = () => {
    if (steering) return;
    setEditingId(undefined);
    setEditDraft("");
    onEditingChange?.(undefined);
  };
  const saveEdit = (message: QueuedMessage) => {
    if (steering) return;
    if (!editDraft.trim() && message.attachments.length === 0) return;
    onEdit?.(message.id, editDraft);
    setEditingId(undefined);
    setEditDraft("");
    onEditingChange?.(undefined);
  };

  return (
    <div className="px-2 text-content/55" data-message-queue>
      <div
        className="relative z-0 rounded-t-[10px] border border-b-0 border-content/10 bg-content/3 px-2.5 py-0.5"
        data-message-queue-card
      >
        {steering ? (
          <div
            role="status"
            aria-live="polite"
            className="flex h-7 items-center gap-2 border-b border-content/10 text-[12px]"
          >
            <Pause className="size-3.5" />
            <span>Stopping the current turn before steering</span>
          </div>
        ) : null}
        {held ? (
          <div
            role="status"
            aria-live="polite"
            className="flex h-7 items-center gap-2 border-b border-content/10 text-[12px]"
          >
            <Pause className="size-3.5" />
            <span
              title={holdReason || "Queue held because the last turn failed"}
              className="min-w-0 flex-1 truncate"
            >
              {holdReason || "Queue held because the last turn failed"}
            </span>
            <button
              type="button"
              onClick={onResume}
              aria-label="Resume held message queue"
              className="flex h-6 shrink-0 items-center gap-1.5 rounded-md px-1.5 hover:bg-content/10 hover:text-content"
            >
              <Play className="size-3.5" />
              Resume
            </button>
          </div>
        ) : null}
        {paused ? (
          <div className="flex h-7 items-center gap-2 border-b border-stroke text-[12px]">
            <Pause className="size-3.5" />
            <span className="min-w-0 flex-1 truncate">
              {failed
                ? "A message couldn't be sent"
                : variant === "messages"
                  ? "Messages paused"
                  : "Queue paused because you interrupted"}
            </span>
            <button
              type="button"
              onClick={onResume}
              aria-label="Resume paused message queue"
              className="flex h-6 shrink-0 items-center gap-1.5 rounded-md px-1.5 hover:bg-content/10 hover:text-content"
            >
              <Play className="size-3.5" />
              {failed ? "Retry" : "Resume"}
            </button>
          </div>
        ) : null}
        {variant === "messages" && !paused && !held && !steering ? (
          <div role="status" className="py-1 text-[11px] text-content/50">
            {sendingId ? "Sending…" : "Waiting to send"}
          </div>
        ) : null}
        {messages.map((message, index) => {
          const sending = steering || sendingId === message.id;
          const editing = !steering && editingId === message.id;
          const label =
            (message.monoSessionCompletion
              ? message.monoSessionCompletion.sessionCount
                ? `${message.monoSessionCompletion.sessionCount} sessions finished`
                : `Session ${message.monoSessionCompletion.status}: ${message.monoSessionCompletion.title}`
              : message.text.trim()) ||
            message.noteCard?.title ||
            message.handoffCard?.brief ||
            `${message.attachments.length} attachment${message.attachments.length === 1 ? "" : "s"}`;
          return (
            <div
              key={message.id}
              className={`flex min-h-8 items-center gap-2.5 text-[12px] ${
                index > 0 ? "border-t border-content/5" : ""
              }`}
            >
              <ListEnd className="size-3.5 shrink-0 text-content/35" />
              {editing ? (
                <>
                  <textarea
                    autoFocus
                    aria-label="Edit queued message"
                    value={editDraft}
                    rows={1}
                    onChange={(event) => setEditDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (isImeComposition(event.nativeEvent)) return;
                      if (event.key === "Escape") {
                        event.preventDefault();
                        cancelEdit();
                      } else if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        saveEdit(message);
                      }
                    }}
                    className="min-h-6 min-w-0 flex-1 resize-none rounded-md border border-content/15 bg-content/5 px-1.5 py-0.5 text-[12px] text-content outline-none focus:border-content/30"
                  />
                  <button
                    type="button"
                    title="Save queued message"
                    aria-label="Save queued message"
                    disabled={
                      steering ||
                      (!editDraft.trim() && message.attachments.length === 0)
                    }
                    onClick={() => saveEdit(message)}
                    className="grid size-6 shrink-0 place-items-center rounded-md hover:bg-content/10 hover:text-content disabled:opacity-30"
                  >
                    <Check className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    title="Cancel queued message edit"
                    aria-label="Cancel queued message edit"
                    onClick={cancelEdit}
                    disabled={steering}
                    className="grid size-6 shrink-0 place-items-center rounded-md hover:bg-content/10 hover:text-content"
                  >
                    <X className="size-3.5" />
                  </button>
                </>
              ) : (
                <>
                  <div className="min-w-0 flex-1 py-1">
                    <div className="truncate text-content/75" title={label}>
                      {label}
                    </div>
                    {message.error ? (
                      <p role="alert" className="text-red-400">
                        {message.error}
                      </p>
                    ) : null}
                  </div>
                  {onSteer && !message.monoSessionCompletion ? (
                    <button
                      type="button"
                      disabled={sending}
                      aria-label={
                        steerLabel === "send-now"
                          ? `Send now, stopping the current turn: ${label}`
                          : `Steer with queued message: ${label}`
                      }
                      title={
                        steerLabel === "send-now"
                          ? "Stops Claude's current turn, then sends this message"
                          : undefined
                      }
                      onClick={() => onSteer?.(message.id)}
                      className="flex h-6 shrink-0 items-center gap-1.5 rounded-md px-2 text-content/50 transition-colors hover:bg-content/8 hover:text-content/90 disabled:opacity-40"
                    >
                      <CornerDownRight className="size-3.5" />
                      {steerLabel === "send-now" ? "Send now" : "Steer"}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    title="Edit queued message"
                    aria-label="Edit queued message"
                    disabled={sending || !!message.monoSessionCompletion}
                    onClick={() => startEdit(message)}
                    className="grid size-6 shrink-0 place-items-center rounded-md text-content/40 transition-colors hover:bg-content/8 hover:text-content/90 disabled:opacity-40"
                  >
                    <Pencil className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    title="Remove queued message"
                    aria-label="Remove queued message"
                    disabled={sending}
                    onClick={() => onDelete?.(message.id)}
                    className="grid size-6 shrink-0 place-items-center rounded-md text-content/40 transition-colors hover:bg-content/8 hover:text-content/90 disabled:opacity-40"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

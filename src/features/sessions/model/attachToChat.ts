import type { Attachment } from "./session";

/**
 * Fork (L-207): other surfaces (the Browser) hand attachments to the focused
 * chat's composer, which shows them as chips. Nothing is sent until the user
 * sends the message.
 */
export const ATTACH_TO_CHAT_EVENT = "monocode:attach-to-chat";

export type AttachToChatDetail = {
  attachments: Attachment[];
  /** Set by the composer that took them. */
  handled: boolean;
};

/** Mime for inline context notes; harnesses get the text, not a file. */
export const CONTEXT_NOTE_MIME = "application/x-monocode-context";

/** Adds attachments to the focused chat; false when no chat took them. */
export function attachToChat(attachments: Attachment[]): boolean {
  if (attachments.length === 0) return false;
  const detail: AttachToChatDetail = { attachments, handled: false };
  window.dispatchEvent(new CustomEvent(ATTACH_TO_CHAT_EVENT, { detail }));
  return detail.handled;
}

let noteSeq = 0;

/** A short text note shown as a chip and sent inline. */
export function contextNote(name: string, text: string): Attachment {
  noteSeq += 1;
  return {
    id: `note-${Date.now().toString(36)}-${noteSeq}`,
    name,
    mimeType: CONTEXT_NOTE_MIME,
    kind: "file",
    size: new TextEncoder().encode(text).length,
    text,
  };
}

/**
 * Attachments made while no chat could take them (the Browser open as a
 * full view hides the chat). They go to the next chat that can.
 */
let waiting: Attachment[] = [];

/** Adds attachments now, or keeps them for when a chat is showing again. */
export function attachOrKeep(attachments: Attachment[]): "added" | "kept" {
  if (attachToChat(attachments)) return "added";
  waiting = [...waiting, ...attachments];
  return "kept";
}

/** Tries the kept attachments again; call after the chat comes back. */
export function deliverKeptAttachments() {
  if (waiting.length === 0) return;
  const batch = waiting;
  if (attachToChat(batch)) waiting = waiting.filter((file) => !batch.includes(file));
}

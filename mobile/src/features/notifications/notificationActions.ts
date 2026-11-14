import type { FeedItem } from "./notificationFeed";

/**
 * Fork (Hari, L-278): the buttons on the desktop's notifications in Android's
 * panel. An approval gets Approve and Deny; a question and a finished chat get
 * a reply box. Each sends the matching command to the computer without
 * opening Hari. Pure, so it can be tested without the native module.
 */

/** Category ids: no ":" or "-" (expo-notifications splits on them). */
export const PANEL_CATEGORIES = {
  approval: "hari_approval",
  answer: "hari_answer",
  reply: "hari_reply",
} as const;

export const PANEL_ACTIONS = {
  approve: "approve",
  deny: "deny",
  answer: "answer",
  reply: "reply",
} as const;

/** Longest answer the desktop takes for a question, and for a message. */
const ANSWER_CHARS = 10_000;
const MESSAGE_CHARS = 100_000;

/** The buttons for this entry, if it can be acted on from the panel. */
export function categoryFor(item: FeedItem): string | undefined {
  if (!item.sessionId) return undefined;
  if (item.kind === "approval" && item.requestId !== undefined) return PANEL_CATEGORIES.approval;
  if (item.kind === "question" && item.requestId !== undefined) return PANEL_CATEGORIES.answer;
  if (item.kind === "finished") return PANEL_CATEGORIES.reply;
  return undefined;
}

/** What the posted notification carries for its default tap and its buttons. */
export type PanelData = {
  feedId: string;
  kind: FeedItem["kind"];
  /** The entry's own text, so a failure note can show it again. */
  text: string;
  sessionId?: string;
  projectId?: string;
  requestId?: number;
};

export function panelData(item: FeedItem): PanelData {
  return {
    feedId: item.id,
    kind: item.kind,
    text: item.body,
    ...(item.sessionId ? { sessionId: item.sessionId } : {}),
    ...(item.projectId && item.sessionId ? { projectId: item.projectId } : {}),
    ...(item.requestId !== undefined ? { requestId: item.requestId } : {}),
  };
}

export type PanelCommand =
  | {
      ok: true;
      method: string;
      params: Record<string, unknown>;
      /** Names the attempt in a failure note: "Couldn't approve". */
      verb: string;
    }
  | { ok: false; verb: string; error: string };

const record = (value: unknown, name: string): unknown =>
  typeof value === "object" && value !== null ? Reflect.get(value, name) : undefined;

/**
 * The command a button tap sends; null for a tap that isn't one of ours (the
 * default tap, or a notification Hari didn't post with buttons).
 */
export function panelCommand(
  data: unknown,
  actionId: string,
  userText: string | undefined,
): PanelCommand | null {
  const kind = record(data, "kind");
  const sessionId = record(data, "sessionId");
  const requestId = record(data, "requestId");
  if (typeof sessionId !== "string" || !sessionId) return null;
  const request =
    typeof requestId === "number" && Number.isSafeInteger(requestId) ? requestId : undefined;
  const text = (userText ?? "").trim();

  if (actionId === PANEL_ACTIONS.approve || actionId === PANEL_ACTIONS.deny) {
    if (kind !== "approval" || request === undefined) return null;
    const approve = actionId === PANEL_ACTIONS.approve;
    return {
      ok: true,
      method: "session.approve",
      params: { conversationId: sessionId, requestId: request, decision: approve ? "allow" : "deny" },
      verb: approve ? "approve" : "deny",
    };
  }
  if (actionId === PANEL_ACTIONS.answer) {
    if (kind !== "question" || request === undefined) return null;
    const verb = "send the answer";
    if (!text) return { ok: false, verb, error: "Type an answer first" };
    if (text.length > ANSWER_CHARS) return { ok: false, verb, error: "That answer is too long" };
    return {
      ok: true,
      method: "session.answerQuestion",
      params: { conversationId: sessionId, requestId: request, reply: { kind: "text", text } },
      verb,
    };
  }
  if (actionId === PANEL_ACTIONS.reply) {
    if (kind !== "finished") return null;
    const verb = "send the reply";
    if (!text) return { ok: false, verb, error: "Type a reply first" };
    if (text.length > MESSAGE_CHARS) return { ok: false, verb, error: "That reply is too long" };
    return { ok: true, method: "conversation.send", params: { conversationId: sessionId, text }, verb };
  }
  return null;
}

/** The note a failed tap leaves in place of the entry, buttons kept to retry. */
export function failureNote(verb: string, error: string, text: unknown): string {
  const original = typeof text === "string" && text ? `\n\n${text}` : "";
  return `Couldn't ${verb}: ${error}${original}`;
}

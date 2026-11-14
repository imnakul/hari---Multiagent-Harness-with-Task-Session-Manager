/**
 * Fork (L-274): what Aside's "Ask Aside" panel sends to MonoCode's local
 * OpenAI-compatible endpoint, read without trusting it.
 *
 * Aside resends the whole chat on every request and names no conversation, so
 * each request is classified here: the chat-title and memory-extraction
 * requests are answered without a CLI, and a turn yields the newest user text
 * plus what MonoCode needs to find or rebuild the session it belongs to.
 */

export type AsideRole = "system" | "developer" | "user" | "assistant" | "tool";

export type AsideMessage = {
  role: AsideRole;
  text: string;
  /** The message carried an image, which the CLIs are not sent yet. */
  hasImage: boolean;
};

export type AsideRequest = {
  model: string;
  stream: boolean;
  /** Aside's Reasoning menu choice, already mapped through `thinkingLevelMap`. */
  effort?: string;
  messages: AsideMessage[];
  toolCount: number;
  maxTokens?: number;
};

export type AsideWork =
  | { kind: "title"; title: string }
  | { kind: "memory" }
  /** Aside's background pass that tidies its memories; nothing to change. */
  | { kind: "dream" }
  | {
      kind: "turn";
      /** Every real user text in order, the newest last; keys the conversation. */
      texts: string[];
      /** The user texts before this turn; keys the session it continues. */
      priorTexts: string[];
      /** What the CLI is sent: the newest text and the page Aside has open. */
      prompt: string;
      /** Earlier exchanges, for a chat MonoCode has no session for. */
      history: string;
      droppedImages: boolean;
      /**
       * Sent from Aside's side panel with the open tab. A chat started by
       * `aside exec` (an agent delegating to Aside) has no such note.
       */
      fromPanel: boolean;
    }
  | { kind: "unsupported"; message: string };

const ROLES: readonly AsideRole[] = ["system", "developer", "user", "assistant", "tool"];
const MAX_MESSAGES = 5_000;
const PAGE_NOTE = "<system_message>";
const MEMORIES = "<recalled_memories>";
const MEMORY_TASK = "You are now acting as the memory extraction subagent";
const TITLE_TASK = "You name conversations";
const DREAM_TASK = "You are Aside's memory dreaming pass";
const DREAM_SESSION = "aside:aux:memory-dream";
const PANEL_NOTE = "You're being opened as a sidepanel";
/** Aside asks for a title with a tiny budget and no tools. */
const TITLE_MAX_TOKENS = 256;
const MAX_PROMPT = 100_000;
const MAX_HISTORY = 20_000;
const MAX_NOTE = 2_000;

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? // A non-array object; TypeScript cannot narrow `object` to an index signature.
      (value as Record<string, unknown>)
    : undefined;
}

function readContent(content: unknown): { text: string; hasImage: boolean } {
  if (typeof content === "string") return { text: content, hasImage: false };
  if (!Array.isArray(content)) return { text: "", hasImage: false };
  let hasImage = false;
  const parts: string[] = [];
  for (const part of content) {
    const entry = record(part);
    if (!entry) continue;
    if (entry.type === "text" && typeof entry.text === "string") parts.push(entry.text);
    else if (entry.type === "image_url" || entry.type === "image") hasImage = true;
  }
  return { text: parts.join("\n"), hasImage };
}

/**
 * The request as far as MonoCode uses it.
 * @throws Error with a message Aside can show when the body is malformed.
 */
export function parseAsideRequest(body: unknown): AsideRequest {
  const root = record(body);
  if (!root) throw new Error("Expected a JSON object");
  if (typeof root.model !== "string" || !root.model || root.model.length > 300)
    throw new Error("Missing model");
  if (!Array.isArray(root.messages) || root.messages.length === 0)
    throw new Error("Missing messages");
  if (root.messages.length > MAX_MESSAGES) throw new Error("The chat is too long");
  const messages = root.messages.map((raw): AsideMessage => {
    const entry = record(raw);
    const role = ROLES.find((candidate) => candidate === entry?.role);
    if (!entry || !role) throw new Error("Unknown message role");
    return { role, ...readContent(entry.content) };
  });
  const maxTokens = [root.max_completion_tokens, root.max_tokens].find(
    (value): value is number => typeof value === "number" && Number.isFinite(value),
  );
  return {
    model: root.model,
    stream: root.stream === true,
    ...(typeof root.reasoning_effort === "string" && root.reasoning_effort.length <= 32
      ? { effort: root.reasoning_effort }
      : {}),
    messages,
    toolCount: Array.isArray(root.tools) ? root.tools.length : 0,
    ...(maxTokens === undefined ? {} : { maxTokens }),
  };
}

const isNote = (message: AsideMessage): boolean =>
  message.role === "user" && message.text.trimStart().startsWith(PAGE_NOTE);
const isMemories = (message: AsideMessage): boolean =>
  message.role === "user" && message.text.trimStart().startsWith(MEMORIES);
const isUserText = (message: AsideMessage): boolean =>
  message.role === "user" && !isNote(message) && !isMemories(message);

function stripNote(text: string): string {
  return text
    .replace(/<\/?system_message>/g, "")
    .trim()
    .slice(0, MAX_NOTE);
}

/** A short title from the user's first words, as Aside's titler would give. */
export function asideTitle(text: string): string {
  const words = text
    .replace(/<[^>]*>/g, " ")
    .replace(/[\r\n]+/g, " ")
    .split(/\s+/)
    .map((word) => word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
    .filter(Boolean)
    .slice(0, 6);
  const title = words.join(" ").slice(0, 60).trim();
  return title ? title[0].toUpperCase() + title.slice(1) : "New chat";
}

function keepEnd(text: string, limit: number): string {
  return text.length <= limit ? text : `…${text.slice(text.length - limit)}`;
}

/**
 * @param session Aside's own chat ID from its `x-session-affinity` header,
 * when the model asks for it; background passes are named `aside:aux:…`.
 */
export function classifyAsideRequest(request: AsideRequest, session?: string): AsideWork {
  const { messages } = request;
  const system = messages
    .filter((message) => message.role === "system" || message.role === "developer")
    .map((message) => message.text)
    .join("\n");
  const users = messages.filter(isUserText);
  const lastUser = users[users.length - 1];
  if (lastUser?.text.trimStart().startsWith(MEMORY_TASK)) return { kind: "memory" };
  if (session === DREAM_SESSION || system.trimStart().startsWith(DREAM_TASK))
    return { kind: "dream" };
  if (
    system.trimStart().startsWith(TITLE_TASK) ||
    (request.toolCount === 0 &&
      request.maxTokens !== undefined &&
      request.maxTokens <= TITLE_MAX_TOKENS)
  )
    return { kind: "title", title: asideTitle(lastUser?.text ?? "") };

  const last = messages[messages.length - 1];
  if (last.role !== "user")
    return {
      kind: "unsupported",
      message: "Hari answers in its own words and doesn't run Aside's tools. Send your message again.",
    };
  // The newest turn: the user messages after the last reply.
  let start = messages.length;
  while (start > 0 && messages[start - 1].role === "user") start -= 1;
  const turn = messages.slice(start);
  const texts = turn.filter(isUserText);
  if (texts.length === 0 || !texts.some((message) => message.text.trim()))
    return { kind: "unsupported", message: "Type a message for Hari to answer." };
  const note = [...messages].reverse().find(isNote);
  const text = texts.map((message) => message.text.trim()).filter(Boolean).join("\n\n");
  const page = note ? stripNote(note.text) : "";
  const prompt = (page ? `${text}\n\n<aside_page>\n${page}\n</aside_page>` : text).slice(
    0,
    MAX_PROMPT,
  );
  const history = messages
    .slice(0, start)
    .filter(
      (message) =>
        (isUserText(message) || message.role === "assistant") && message.text.trim(),
    )
    .map(
      (message) =>
        `${message.role === "assistant" ? "Assistant" : "User"}: ${message.text.trim()}`,
    )
    .join("\n\n");
  return {
    kind: "turn",
    texts: users.map((message) => message.text.trim()),
    priorTexts: messages
      .slice(0, start)
      .filter(isUserText)
      .map((message) => message.text.trim()),
    prompt,
    history: keepEnd(history, MAX_HISTORY),
    droppedImages: turn.some((message) => message.hasImage),
    fromPanel: messages.some(
      (message) => message.role === "user" && message.text.includes(PANEL_NOTE),
    ),
  };
}

/** The first message of a session that picks up a chat MonoCode never saw. */
export function promptWithHistory(prompt: string, history: string): string {
  if (!history) return prompt;
  return `Earlier in this Aside chat:\n\n<aside_history>\n${history}\n</aside_history>\n\n${prompt}`;
}

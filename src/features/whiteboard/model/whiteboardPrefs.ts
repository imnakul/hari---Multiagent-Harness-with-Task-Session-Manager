/**
 * Whiteboard choices kept across restarts (fork, L-199): tool lock, where the
 * agent panel sits and how big it is.
 */
export type ChatDock = "side" | "bottom";

const TOOL_LOCK_KEY = "monocode.whiteboard.toolLock";
const DOCK_KEY = "monocode.whiteboard.chatDock";
const SIZE_KEY = "monocode.whiteboard.chatSize";

export const CHAT_SIZE_LIMITS: Record<ChatDock, { min: number; max: number; initial: number }> = {
  side: { min: 260, max: 720, initial: 320 },
  bottom: { min: 160, max: 560, initial: 260 },
};

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage full or blocked: the choice lasts for this run only.
  }
}

/** On until the user turns it off, so a tool stays picked after each shape. */
export function loadToolLock(): boolean {
  return read(TOOL_LOCK_KEY) !== "false";
}

export function saveToolLock(locked: boolean): void {
  write(TOOL_LOCK_KEY, String(locked));
}

export function loadChatDock(): ChatDock {
  return read(DOCK_KEY) === "bottom" ? "bottom" : "side";
}

export function saveChatDock(dock: ChatDock): void {
  write(DOCK_KEY, dock);
}

export function clampChatSize(dock: ChatDock, size: number): number {
  const { min, max } = CHAT_SIZE_LIMITS[dock];
  return Math.round(Math.min(max, Math.max(min, size)));
}

export function loadChatSize(dock: ChatDock): number {
  let stored: Partial<Record<ChatDock, number>> = {};
  try {
    stored = JSON.parse(read(SIZE_KEY) ?? "{}") as Partial<Record<ChatDock, number>>;
  } catch {
    stored = {};
  }
  const value = stored[dock];
  return typeof value === "number" && Number.isFinite(value)
    ? clampChatSize(dock, value)
    : CHAT_SIZE_LIMITS[dock].initial;
}

export function saveChatSize(dock: ChatDock, size: number): void {
  let stored: Partial<Record<ChatDock, number>> = {};
  try {
    stored = JSON.parse(read(SIZE_KEY) ?? "{}") as Partial<Record<ChatDock, number>>;
  } catch {
    stored = {};
  }
  write(SIZE_KEY, JSON.stringify({ ...stored, [dock]: clampChatSize(dock, size) }));
}

/** Model, effort and account picked in the agent chat, per provider (L-199). */
export type AgentChoice = {
  model?: string;
  effort?: string;
  accountId?: string;
  /** Claude only: run the Claude CLI in a hidden terminal (L-204). */
  execution?: "interactive";
};

const CHOICE_KEY = "monocode.whiteboard.agentChoice";

export function loadAgentChoice(provider: string): AgentChoice {
  try {
    const stored = JSON.parse(read(CHOICE_KEY) ?? "{}") as Record<string, AgentChoice | undefined>;
    const choice = stored[provider];
    return choice && typeof choice === "object" ? choice : {};
  } catch {
    return {};
  }
}

export function saveAgentChoice(provider: string, choice: AgentChoice): void {
  let stored: Record<string, AgentChoice> = {};
  try {
    stored = JSON.parse(read(CHOICE_KEY) ?? "{}") as Record<string, AgentChoice>;
  } catch {
    stored = {};
  }
  write(CHOICE_KEY, JSON.stringify({ ...stored, [provider]: choice }));
}

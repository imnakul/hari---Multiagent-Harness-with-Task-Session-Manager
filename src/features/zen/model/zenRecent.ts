/**
 * The chats Zen's dropdown lists (fork, L-230): every saved chat, newest
 * activity first, from what the app knows about each one (open sessions,
 * saved history, Session Manager cards).
 */
import { projectKey } from "../../../shared/lib/paths";

/** Chats listed before a search; the search covers all. */
export const ZEN_RECENT_LIMIT = 12;

export type ZenChatStatus = "working" | "waiting";

/** One thing the app knows about a chat. */
export type ZenChatSource = {
  id: string;
  cwd: string;
  title: string;
  harness: string;
  model: string;
  updatedAt: number;
  providerAccountId?: string;
  /** Not a chat to list: hidden, archived, a worker, an automation's or a habit's run. */
  hidden?: boolean;
  status?: ZenChatStatus;
};

export type ZenChat = Omit<ZenChatSource, "hidden">;

/**
 * One entry per chat, newest activity first. Each takes the newest
 * source's details; a chat any source hides stays out, and a status from
 * any source holds (working before waiting).
 */
export function zenChats(sources: readonly ZenChatSource[]): ZenChat[] {
  const hidden = new Set<string>();
  const newest = new Map<string, ZenChat>();
  const status = new Map<string, ZenChatStatus>();
  for (const source of sources) {
    if (source.hidden) {
      hidden.add(source.id);
      continue;
    }
    if (source.status && status.get(source.id) !== "working")
      status.set(source.id, source.status);
    const seen = newest.get(source.id);
    if (!seen || source.updatedAt > seen.updatedAt) {
      const { hidden: _hidden, status: _status, ...chat } = source;
      newest.set(source.id, {
        ...chat,
        providerAccountId: chat.providerAccountId ?? seen?.providerAccountId,
      });
    } else if (!seen.providerAccountId && source.providerAccountId) {
      seen.providerAccountId = source.providerAccountId;
    }
  }
  return [...newest.values()]
    .filter((chat) => !hidden.has(chat.id))
    .map((chat) => {
      const mark = status.get(chat.id);
      return mark ? { ...chat, status: mark } : chat;
    })
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Chats grouped by project: projects by their newest chat, each newest first. */
export type ZenChatGroup = {
  /** Project key; null for chats with no known project ("Other", last). */
  key: string | null;
  cwd: string | null;
  chats: ZenChat[];
};

function hasProject(cwd: string): boolean {
  return cwd.trim() !== "" && cwd !== "~";
}

/** `chats` (newest first) grouped by project, "Other" at the end. */
export function zenChatGroups(chats: readonly ZenChat[]): ZenChatGroup[] {
  const groups = new Map<string, ZenChatGroup>();
  const other: ZenChat[] = [];
  for (const chat of chats) {
    if (!hasProject(chat.cwd)) {
      other.push(chat);
      continue;
    }
    const key = projectKey(chat.cwd);
    const group = groups.get(key);
    if (group) group.chats.push(chat);
    else groups.set(key, { key, cwd: chat.cwd, chats: [chat] });
  }
  const list = [...groups.values()];
  if (other.length > 0) list.push({ key: null, cwd: null, chats: other });
  return list;
}

type SavedChat = {
  id: string;
  cwd: string;
  title: string;
  harness: string;
  model: string;
  updatedAt: number;
  providerAccountId?: string;
  sidebarHidden?: boolean;
  orchestrationLeadId?: string;
  archived?: boolean;
  /** Started by an automation: never listed. */
  automationId?: string;
};

type OpenChat = {
  id: string;
  cwd: string;
  title: string;
  harness: string;
  model: string;
  providerAccountId?: string;
  automationId?: string;
};

type ChatCard = {
  sessionId: string;
  runId: string;
  hiddenRunId?: string;
  cwd: string;
  title: string;
  harness: string;
  model: string;
  updatedAt: number;
  /** True when the run waits for the user (Needs attention). */
  waiting: boolean;
  /** The chat was started by an automation. */
  automation?: boolean;
};

/**
 * What the app knows about each chat, for `zenChats`: saved history, open
 * sessions (working or hidden), and each chat's newest Session Manager card
 * (a run hidden from the board adds nothing; waiting comes from it).
 */
export function zenChatSources({
  history,
  sessions,
  cards,
  working,
  listed,
  hiddenId,
}: {
  history: readonly SavedChat[];
  sessions: readonly OpenChat[];
  cards: readonly ChatCard[];
  working: ReadonlySet<string>;
  /** False for an open session Zen never shows (a worker, a blank tab). */
  listed: (session: OpenChat) => boolean;
  /** True for ids Zen never shows, e.g. Mono chats. */
  hiddenId: (id: string) => boolean;
}): ZenChatSource[] {
  const sources: ZenChatSource[] = [];
  for (const entry of history) {
    sources.push({
      id: entry.id,
      cwd: entry.cwd,
      title: entry.title,
      harness: entry.harness,
      model: entry.model,
      updatedAt: entry.updatedAt,
      providerAccountId: entry.providerAccountId,
      hidden:
        !!entry.sidebarHidden ||
        !!entry.orchestrationLeadId ||
        !!entry.archived ||
        !!entry.automationId ||
        hiddenId(entry.id),
    });
  }
  for (const session of sessions) {
    sources.push({
      id: session.id,
      cwd: session.cwd,
      title: session.title,
      harness: session.harness,
      model: session.model,
      // Open sessions carry no time; history and cards date them.
      updatedAt: 0,
      providerAccountId: session.providerAccountId,
      hidden:
        !listed(session) || !!session.automationId || hiddenId(session.id),
      status: working.has(session.id) ? "working" : undefined,
    });
  }
  const newest = new Map<string, ChatCard>();
  for (const card of cards) {
    if (card.hiddenRunId === card.runId) continue;
    const seen = newest.get(card.sessionId);
    if (!seen || card.updatedAt > seen.updatedAt)
      newest.set(card.sessionId, card);
  }
  for (const card of newest.values()) {
    sources.push({
      id: card.sessionId,
      cwd: card.cwd,
      title: card.title,
      harness: card.harness,
      model: card.model,
      updatedAt: card.updatedAt,
      hidden: card.automation || hiddenId(card.sessionId) || undefined,
      status: card.waiting ? "waiting" : undefined,
    });
  }
  return sources;
}

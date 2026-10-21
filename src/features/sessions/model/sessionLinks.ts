import type { SessionSummary } from "../data/sessionStore";

/**
 * Parent links for chats started from another chat (fork, sidechat, second
 * opinion), so the sidebar can nest them under their source.
 *
 * Fork-only (L-88). Kept in localStorage rather than a sessions column so the
 * upstream schema stays untouched; sidechats also carry their source on the
 * saved row (`sidechat.sourceSessionId`), which wins when both exist. Losing
 * this store only flattens the tree; no chat is lost.
 */
export type SessionLinkRelation = "fork" | "sidechat" | "secondOpinion";
export type SessionLink = { parentId: string; relation: SessionLinkRelation };

const STORAGE_KEY = "monocode.sessionLinks.v1";
const CHANGED_EVENT = "monocode:session-links-changed";
/** Oldest links are dropped past this, so the store cannot grow without bound. */
const MAX_LINKS = 2000;

const RELATIONS: readonly string[] = ["fork", "sidechat", "secondOpinion"];

function isSessionLink(value: unknown): value is SessionLink {
  if (typeof value !== "object" || value === null) return false;
  const parentId: unknown = Reflect.get(value, "parentId");
  const relation: unknown = Reflect.get(value, "relation");
  return (
    typeof parentId === "string" &&
    parentId.length > 0 &&
    typeof relation === "string" &&
    RELATIONS.includes(relation)
  );
}

let cached: { raw: string | null; links: Record<string, SessionLink> } | null =
  null;

function readLinks(): Record<string, SessionLink> {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return {};
  }
  if (cached && cached.raw === raw) return cached.links;
  let links: Record<string, SessionLink> = {};
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed === "object" && parsed !== null)
        for (const [id, link] of Object.entries(parsed))
          if (isSessionLink(link)) links[id] = link;
    } catch {
      // Corrupt JSON: start a fresh map; the next save overwrites it.
    }
  }
  cached = { raw, links };
  return links;
}

/** Snapshot for `useSyncExternalStore`; stable until the store changes. */
export function sessionLinksSnapshot(): Record<string, SessionLink> {
  return readLinks();
}

export function subscribeSessionLinks(onChange: () => void): () => void {
  window.addEventListener(CHANGED_EVENT, onChange);
  return () => window.removeEventListener(CHANGED_EVENT, onChange);
}

export function saveSessionLink(childId: string, link: SessionLink): void {
  if (!childId || childId === link.parentId) return;
  const next = { ...readLinks(), [childId]: link };
  const ids = Object.keys(next);
  for (const id of ids.slice(0, Math.max(0, ids.length - MAX_LINKS)))
    delete next[id];
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage full or unavailable: the chat still works, it just shows flat.
    return;
  }
  window.dispatchEvent(new Event(CHANGED_EVENT));
}

/** The chat this one was started from, if known. */
export function sessionParentLink(
  session: Pick<SessionSummary, "id" | "sidechat">,
  links: Record<string, SessionLink>,
): SessionLink | undefined {
  if (session.sidechat?.sourceSessionId)
    return { parentId: session.sidechat.sourceSessionId, relation: "sidechat" };
  return links[session.id];
}

export type LinkedChild = { session: SessionSummary; relation: SessionLinkRelation };

export const SESSION_LINK_LABEL: Record<SessionLinkRelation, string> = {
  fork: "Fork",
  sidechat: "Sidechat",
  secondOpinion: "Second opinion",
};

/**
 * Splits a sidebar list into top-level rows and children by parent id.
 *
 * A row nests only when its parent is also listed (directly or as another
 * child), so filters and search never hide a chat whose parent is filtered
 * out. `extra` rows (saved sidechats, listed separately upstream) are added
 * only as children. A link loop is broken at its first listed row. Order within each list is
 * kept as given.
 */
export function nestLinkedSessions(
  rows: readonly SessionSummary[],
  extra: readonly SessionSummary[],
  links: Record<string, SessionLink>,
): { top: SessionSummary[]; children: Map<string, LinkedChild[]> } {
  const byId = new Map<string, SessionSummary>();
  for (const row of rows) byId.set(row.id, row);
  const extraIds = new Set<string>();
  for (const row of extra)
    if (!byId.has(row.id)) {
      byId.set(row.id, row);
      extraIds.add(row.id);
    }

  const parentOf = new Map<string, SessionLink>();
  for (const row of byId.values()) {
    const link = sessionParentLink(row, links);
    if (link && link.parentId !== row.id && byId.has(link.parentId))
      parentOf.set(row.id, link);
  }
  // Break link loops (a → b → a) at the first row met, which stays on top.
  for (const id of [...parentOf.keys()]) {
    const seen = new Set([id]);
    let current = parentOf.get(id)?.parentId;
    while (current && parentOf.has(current) && !seen.has(current)) {
      seen.add(current);
      current = parentOf.get(current)?.parentId;
    }
    if (current && seen.has(current)) parentOf.delete(id);
  }
  // An extra row shows only when its parent chain reaches a listed row, so a
  // sidechat of a sidechat nests too (L-165); a listed row never nests under
  // an extra row that is itself hidden, so listed chats can never disappear.
  // Loops were broken above, so every chain ends.
  const reachesListedRow = (id: string): boolean => {
    let current = parentOf.get(id)?.parentId;
    while (current && extraIds.has(current))
      current = parentOf.get(current)?.parentId;
    return current !== undefined;
  };
  const shownExtra = new Set<string>();
  for (const id of extraIds) if (reachesListedRow(id)) shownExtra.add(id);
  for (const id of extraIds) if (!shownExtra.has(id)) parentOf.delete(id);
  for (const [id, link] of parentOf)
    if (extraIds.has(link.parentId) && !shownExtra.has(link.parentId))
      parentOf.delete(id);

  const children = new Map<string, LinkedChild[]>();
  const top: SessionSummary[] = [];
  for (const row of [...rows, ...extra]) {
    if (row !== byId.get(row.id)) continue;
    const link = parentOf.get(row.id);
    if (!link) {
      if (!extraIds.has(row.id)) top.push(row);
      continue;
    }
    const list = children.get(link.parentId) ?? [];
    list.push({ session: row, relation: link.relation });
    children.set(link.parentId, list);
  }
  return { top, children };
}

import type { Project, SessionSummary } from "@/features/workspace/types";

/**
 * Fork (Hari, L-239): what the Live Update shows — the sessions the user
 * started (on the phone or the computer, not a Mono's) while they run, in
 * the status bar chip, the Super Island, the top of the shade and the lock
 * screen. Pure, so the rules are tested apart from Android.
 */

export type LiveMode = "combined" | "each";

export type LiveCardAction = {
  kind: "stop" | "approve" | "deny" | "open";
  label: string;
  sessionId: string;
  requestId?: number;
  url?: string;
};

export type LiveCard = {
  /** "all" for the one combined card, else the session's ID. */
  key: string;
  title: string;
  text: string;
  /** What the lock screen shows when the phone hides private content. */
  publicTitle: string;
  publicText: string;
  /** The chip's words; none shows the time running (chronometer). */
  chip: string | null;
  startedAt: number | null;
  url: string;
  sessionIds: string[];
  actions: LiveCardAction[];
};

/** A button pressed on a card, until the computer's answer shows. */
export type LivePress = {
  label: string;
  busy?: boolean;
  requestId?: number;
  at: number;
};

export type LiveInput = {
  sessions: SessionSummary[];
  projects: Project[];
  mode: LiveMode;
  /** Sessions whose card the user swiped away, until they stop running. */
  dismissed: ReadonlySet<string>;
  pressed: Readonly<Record<string, LivePress>>;
  reconnecting: boolean;
};

const MAX_CARDS = 6;
const HOME_URL = "monocode:///";

export const sessionUrl = (session: Pick<SessionSummary, "id" | "projectId">) =>
  `monocode:///project/${encodeURIComponent(session.projectId)}/session/${encodeURIComponent(session.id)}`;

/** Running, or waiting on the user mid-turn. */
export const isRunning = (session: SessionSummary) =>
  !session.monoId && (!!session.busy || !!session.waiting);

/** The sessions the cards follow: those needing the user first, then the newest. */
export function followedSessions(
  sessions: SessionSummary[],
  dismissed: ReadonlySet<string>,
): SessionSummary[] {
  return sessions
    .filter((session) => isRunning(session) && !dismissed.has(session.id))
    .sort(
      (a, b) =>
        Number(!!b.waiting) - Number(!!a.waiting) || b.updatedAt - a.updatedAt,
    );
}

/** A press is shown until the session changes as asked, or 30 seconds pass. */
export function pressSettled(
  press: LivePress,
  session: SessionSummary | undefined,
  now: number,
): boolean {
  if (!session || now - press.at > 30_000) return true;
  if (press.requestId !== undefined)
    return session.approval?.requestId !== press.requestId;
  if (press.busy !== undefined) return !!session.busy !== press.busy;
  return false;
}

export function liveCards(input: LiveInput): LiveCard[] {
  const followed = followedSessions(input.sessions, input.dismissed);
  if (!followed.length) return [];
  const projectName = (session: SessionSummary) =>
    input.projects.find((project) => project.id === session.projectId)?.name;
  if (input.mode === "each" || followed.length === 1) {
    return followed.slice(0, MAX_CARDS).map((session) => ({
      ...sessionCard(session, projectName(session), input),
      key: input.mode === "each" ? session.id : "all",
    }));
  }
  return [combinedCard(followed, input)];
}

function sessionCard(
  session: SessionSummary,
  project: string | undefined,
  input: LiveInput,
): LiveCard {
  const press = input.pressed[session.id];
  const url = sessionUrl(session);
  const open = (label = "Open"): LiveCardAction => ({
    kind: "open",
    label,
    sessionId: session.id,
    url,
  });
  const approval = session.waiting === "approval" ? session.approval : undefined;
  const status = input.reconnecting
    ? "Reconnecting…"
    : press
      ? press.label
      : session.waiting === "approval"
        ? approval
          ? `Needs approval: ${approval.label}`
          : "Needs your approval"
        : session.waiting === "question"
          ? "Has a question for you"
          : "Thinking…";
  const actions: LiveCardAction[] =
    input.reconnecting || press
      ? [open()]
      : approval
        ? [
            {
              kind: "approve",
              label: "Approve",
              sessionId: session.id,
              requestId: approval.requestId,
            },
            {
              kind: "deny",
              label: "Deny",
              sessionId: session.id,
              requestId: approval.requestId,
            },
            open(),
          ]
        : session.waiting === "question"
          ? [open("Reply")]
          : [{ kind: "stop", label: "Stop", sessionId: session.id }, open()];
  return {
    key: session.id,
    title: session.title || "Session",
    text: project ? `${status} · ${project}` : status,
    publicTitle: "Hari",
    publicText: session.waiting ? "A session needs you" : "1 session running",
    chip: chipFor(session),
    startedAt: session.updatedAt > 0 ? session.updatedAt : null,
    url,
    sessionIds: [session.id],
    actions,
  };
}

function combinedCard(followed: SessionSummary[], input: LiveInput): LiveCard {
  const count = followed.length;
  const first = followed[0];
  const waiting = followed.filter((session) => session.waiting);
  // The one needing the user leads: its question or approval, with its buttons.
  if (waiting.length) {
    const card = sessionCard(first, undefined, input);
    const others = count - 1;
    return {
      ...card,
      key: "all",
      text: `${card.text} · ${others} more running`,
      publicText: "A session needs you",
      sessionIds: followed.map((session) => session.id),
    };
  }
  const started = followed
    .map((session) => session.updatedAt)
    .filter((at) => at > 0);
  return {
    key: "all",
    title: `${count} sessions running`,
    text: input.reconnecting
      ? "Reconnecting…"
      : followed.map((session) => session.title || "Session").join(" · "),
    publicTitle: "Hari",
    publicText: `${count} sessions running`,
    chip: `${count} busy`,
    startedAt: started.length ? Math.min(...started) : null,
    url: HOME_URL,
    sessionIds: followed.map((session) => session.id),
    actions: [{ kind: "open", label: "Open", sessionId: "", url: HOME_URL }],
  };
}

function chipFor(session: SessionSummary): string | null {
  if (session.waiting === "approval") return "Approve";
  if (session.waiting === "question") return "Reply";
  return session.updatedAt > 0 ? null : "Working";
}

/** How long the cards wait for the computer before closing. */
export const LOST_AFTER_MS = 2 * 60_000;

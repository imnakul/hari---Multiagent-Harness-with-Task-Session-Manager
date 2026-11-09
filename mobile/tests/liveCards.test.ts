import { describe, expect, it } from "vitest";

import {
  liveCards,
  pressSettled,
  sessionUrl,
  type LiveInput,
} from "@/features/liveUpdates/liveCards";
import type { Project, SessionSummary } from "@/features/workspace/types";

const project: Project = {
  id: "p1",
  name: "hari",
  path: "E:/hari",
  machine: "pc",
  branch: "main",
  color: "#fff",
  additions: 0,
  deletions: 0,
};

function session(id: string, change: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id,
    projectId: "p1",
    title: `Session ${id}`,
    harness: "claude",
    model: "opus",
    branch: "main",
    updatedAt: 1_000,
    busy: true,
    ...change,
  };
}

function input(sessions: SessionSummary[], change: Partial<LiveInput> = {}): LiveInput {
  return {
    sessions,
    projects: [project],
    mode: "combined",
    dismissed: new Set(),
    pressed: {},
    reconnecting: false,
    ...change,
  };
}

const kinds = (actions: { kind: string }[]) => actions.map((action) => action.kind);

describe("liveCards", () => {
  it("shows nothing when no session runs", () => {
    expect(liveCards(input([session("a", { busy: false })]))).toEqual([]);
  });

  it("leaves out a Mono's sessions", () => {
    expect(liveCards(input([session("a", { monoId: "m1" })]))).toEqual([]);
  });

  it("times one working session, with Stop and Open", () => {
    const [card] = liveCards(input([session("a")]));
    expect(card).toMatchObject({
      key: "all",
      title: "Session a",
      text: "Thinking… · hari",
      chip: null,
      startedAt: 1_000,
      url: sessionUrl(session("a")),
    });
    expect(kinds(card.actions)).toEqual(["stop", "open"]);
  });

  it("names the approval, with Approve, Deny and Open", () => {
    const [card] = liveCards(
      input([
        session("a", {
          busy: true,
          waiting: "approval",
          approval: { requestId: 7, label: "Run: npm test" },
        }),
      ]),
    );
    expect(card.chip).toBe("Approve");
    expect(card.text).toBe("Needs approval: Run: npm test · hari");
    expect(kinds(card.actions)).toEqual(["approve", "deny", "open"]);
    expect(card.actions[0].requestId).toBe(7);
    expect(card.publicText).toBe("A session needs you");
  });

  it("only opens an approval it can't name", () => {
    const [card] = liveCards(input([session("a", { waiting: "approval" })]));
    expect(card.text).toBe("Needs your approval · hari");
    expect(kinds(card.actions)).toEqual(["stop", "open"]);
  });

  it("asks for a reply to a question", () => {
    const [card] = liveCards(input([session("a", { busy: false, waiting: "question" })]));
    expect(card.chip).toBe("Reply");
    expect(card.actions).toEqual([
      expect.objectContaining({ kind: "open", label: "Reply" }),
    ]);
  });

  it("counts several sessions on one card, opening the app", () => {
    const cards = liveCards(
      input([session("a", { updatedAt: 3_000 }), session("b", { updatedAt: 2_000 })]),
    );
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      key: "all",
      title: "2 sessions running",
      text: "Session a · Session b",
      chip: "2 busy",
      startedAt: 2_000,
      sessionIds: ["a", "b"],
    });
    expect(kinds(cards[0].actions)).toEqual(["open"]);
  });

  it("leads the combined card with the session that needs the user", () => {
    const [card] = liveCards(
      input([
        session("a", { updatedAt: 3_000 }),
        session("b", {
          updatedAt: 1_000,
          waiting: "approval",
          approval: { requestId: 2, label: "Edit app.ts" },
        }),
      ]),
    );
    expect(card.key).toBe("all");
    expect(card.title).toBe("Session b");
    expect(card.chip).toBe("Approve");
    expect(card.text).toBe("Needs approval: Edit app.ts · 1 more running");
    expect(card.sessionIds).toEqual(["b", "a"]);
  });

  it("gives each session its own card when asked", () => {
    const cards = liveCards(
      input([session("a", { updatedAt: 3_000 }), session("b", { updatedAt: 2_000 })], {
        mode: "each",
      }),
    );
    expect(cards.map((card) => card.key)).toEqual(["a", "b"]);
    expect(cards.every((card) => card.actions[0].kind === "stop")).toBe(true);
  });

  it("keeps a swiped-away session off the cards", () => {
    expect(
      liveCards(input([session("a")], { dismissed: new Set(["a"]) })),
    ).toEqual([]);
  });

  it("shows a pressed button until the computer answers", () => {
    const [card] = liveCards(
      input([session("a")], { pressed: { a: { label: "Stopping…", busy: true, at: 0 } } }),
    );
    expect(card.text).toBe("Stopping… · hari");
    expect(kinds(card.actions)).toEqual(["open"]);
  });

  it("only opens while reconnecting", () => {
    const [card] = liveCards(input([session("a")], { reconnecting: true }));
    expect(card.text).toBe("Reconnecting… · hari");
    expect(kinds(card.actions)).toEqual(["open"]);
  });
});

describe("pressSettled", () => {
  it("settles a Stop once the session is idle", () => {
    const press = { label: "Stopping…", busy: true, at: 0 };
    expect(pressSettled(press, session("a"), 1_000)).toBe(false);
    expect(pressSettled(press, session("a", { busy: false }), 1_000)).toBe(true);
  });

  it("settles an Approve once that request is gone", () => {
    const press = { label: "Approving…", requestId: 7, at: 0 };
    const waiting = session("a", {
      waiting: "approval",
      approval: { requestId: 7, label: "Run" },
    });
    expect(pressSettled(press, waiting, 1_000)).toBe(false);
    expect(pressSettled(press, session("a"), 1_000)).toBe(true);
  });

  it("settles after 30 seconds or once the session is gone", () => {
    const press = { label: "Stopping…", busy: true, at: 0 };
    expect(pressSettled(press, session("a"), 31_000)).toBe(true);
    expect(pressSettled(press, undefined, 1_000)).toBe(true);
  });
});

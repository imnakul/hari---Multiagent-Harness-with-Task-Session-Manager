import { describe, expect, it } from "vitest";
import type { BoardCard } from "../../session-board/sessionBoard";
import { focusPaneTag, newestBoardCards } from "./focusPaneTag";

const idle = { busy: false, blocks: [] };

const card = (overrides: Partial<BoardCard>): BoardCard => ({
  sessionId: "s1",
  runId: "r1",
  title: "Fix it",
  cwd: "/repo",
  harness: "claude",
  model: "opus",
  status: "done",
  queuedCount: 0,
  updatedAt: 1,
  ...overrides,
});

describe("focusPaneTag", () => {
  it("shows a pending permission or question before anything else", () => {
    const asking = {
      ...idle,
      busy: true,
      blocks: [
        {
          id: "ask",
          role: "approval" as const,
          text: "",
          approval: { requestId: 7 },
        },
      ],
    };
    expect(focusPaneTag(asking, card({}))).toEqual({
      label: "Permission",
      tone: "attention",
    });
    expect(
      focusPaneTag(
        { ...idle, pendingQuestion: { requestId: 3, questions: [] } },
        undefined,
      )?.label,
    ).toBe("Question");
  });

  it("counts external turns as working", () => {
    expect(focusPaneTag({ ...idle, externalTurnId: "t" }, card({}))).toEqual({
      label: "Working…",
      tone: "working",
    });
  });

  it("uses the board card once the turn ends, and nothing for a new chat", () => {
    expect(focusPaneTag(idle, card({ status: "stopped" }))?.label).toBe(
      "Stopped",
    );
    expect(focusPaneTag(idle, card({ status: "in_progress" }))).toBeNull();
    expect(focusPaneTag(idle, undefined)).toBeNull();
  });
});

describe("newestBoardCards", () => {
  it("keeps each chat's newest run", () => {
    const newest = newestBoardCards([
      card({ runId: "a", updatedAt: 2 }),
      card({ runId: "b", updatedAt: 5 }),
      card({ sessionId: "s2", runId: "c" }),
    ]);
    expect(newest.get("s1")?.runId).toBe("b");
    expect(newest.size).toBe(2);
  });
});

import { describe, expect, it } from "vitest";
import { paneStatus } from "./paneStatus";
import type { Block } from "./session";

function block(partial: Partial<Block> & Pick<Block, "role">): Block {
  return { id: Math.random().toString(36), text: "", ...partial };
}

const quiet = { busy: false, blocks: [] as Block[] };

describe("paneStatus", () => {
  it("is idle for file panes, new chats and finished turns", () => {
    expect(paneStatus(undefined)).toBe("idle");
    expect(paneStatus(quiet)).toBe("idle");
    expect(
      paneStatus({
        ...quiet,
        blocks: [block({ role: "user" }), block({ role: "assistant", text: "done" })],
      }),
    ).toBe("idle");
  });

  it("is working while a turn runs, including one started outside the app", () => {
    expect(paneStatus({ ...quiet, busy: true })).toBe("working");
    expect(paneStatus({ ...quiet, externalTurnId: "turn-1" })).toBe("working");
  });

  it("puts waiting on you above working", () => {
    expect(
      paneStatus({
        busy: true,
        blocks: [
          block({
            role: "approval",
            approval: { requestId: 1 },
          }),
        ],
      }),
    ).toBe("attention");
  });

  it("shows an error only for the latest turn", () => {
    const failed = [
      block({ role: "user" }),
      block({ role: "system", notice: "error", text: "Provider crashed" }),
    ];
    expect(paneStatus({ ...quiet, blocks: failed })).toBe("error");
    expect(
      paneStatus({ ...quiet, blocks: [...failed, block({ role: "user" })] }),
    ).toBe("idle");
  });

  it("ignores a stale question once the worktree is gone", () => {
    expect(
      paneStatus({ ...quiet, pendingQuestion: undefined, worktreeRemoved: true }),
    ).toBe("idle");
  });
});

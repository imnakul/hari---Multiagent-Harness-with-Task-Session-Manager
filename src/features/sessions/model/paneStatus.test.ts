import { describe, expect, it } from "vitest";
import { paneStatus } from "./paneStatus";
import type { Block } from "./session";

let nextId = 0;
function block(partial: Partial<Block> & Pick<Block, "role">): Block {
  nextId += 1;
  return { id: `b${nextId}`, text: "", ...partial };
}

const quiet = { busy: false, blocks: [] as Block[] };
const finished = [block({ role: "user" }), block({ role: "assistant", text: "done" })];

describe("paneStatus", () => {
  it("is idle for file panes, new chats and unsent drafts", () => {
    expect(paneStatus(undefined)).toBe("idle");
    expect(paneStatus(quiet)).toBe("idle");
    expect(paneStatus({ ...quiet, blocks: [block({ role: "user", draft: true })] })).toBe(
      "idle",
    );
  });

  it("is done once a turn has finished", () => {
    expect(paneStatus({ ...quiet, blocks: finished })).toBe("done");
    expect(
      paneStatus({ ...quiet, blocks: [...finished, block({ role: "user", draft: true })] }),
    ).toBe("done");
  });

  it("is working while a turn runs, including one started outside the app", () => {
    expect(paneStatus({ ...quiet, blocks: finished, busy: true })).toBe("working");
    expect(paneStatus({ ...quiet, externalTurnId: "turn-1" })).toBe("working");
  });

  it("puts waiting on you above working", () => {
    expect(
      paneStatus({
        busy: true,
        blocks: [block({ role: "approval", approval: { requestId: 1 } })],
      }),
    ).toBe("attention");
  });

  it("treats a paused or held queue as waiting on you", () => {
    expect(paneStatus({ ...quiet, blocks: finished, queueStatus: "held" })).toBe("attention");
    expect(paneStatus({ ...quiet, blocks: finished, queueStatus: "paused" })).toBe(
      "attention",
    );
    expect(paneStatus({ ...quiet, blocks: finished, queueStatus: "active" })).toBe("done");
  });

  it("is an error when the latest turn failed or was stopped", () => {
    const failed = [
      block({ role: "user" }),
      block({ role: "system", notice: "error", text: "Provider crashed" }),
    ];
    expect(paneStatus({ ...quiet, blocks: failed })).toBe("error");
    expect(
      paneStatus({
        ...quiet,
        blocks: [block({ role: "user" }), block({ role: "system", notice: "interrupt" })],
      }),
    ).toBe("error");
    // A newer turn that finished clears it.
    expect(paneStatus({ ...quiet, blocks: [...failed, ...finished] })).toBe("done");
  });

  it("ignores a stale question once the worktree is gone", () => {
    expect(
      paneStatus({ ...quiet, pendingQuestion: undefined, worktreeRemoved: true }),
    ).toBe("idle");
  });
});

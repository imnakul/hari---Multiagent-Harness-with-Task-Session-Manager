import { describe, expect, it, vi } from "vitest";
import { newSession } from "./session";
import { SidechatSubmitPreflight } from "./sidechatSubmit";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

async function flushAsyncSubmit() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function source() {
  const session = newSession("claude", "/repo", "claude:sonnet-5");
  session.title = "Parent chat";
  session.blocks = [
    { id: "parent-user", role: "user", text: "Original question" },
    { id: "parent-answer", role: "assistant", text: "Original answer" },
  ];
  return session;
}

const fallback = {
  sourceTitle: "Parent chat",
  sourceContext: 'Saved source snapshot for "Parent chat"',
};

describe("SidechatSubmitPreflight", () => {
  it("loads a closed parent once and submits exactly once under the sidechat identity", async () => {
    const load = deferred<ReturnType<typeof source> | null>();
    const parent = source();
    const submitted: Array<{
      id: string;
      prepared: { sourceTitle: string; sourceContext?: string };
    }> = [];
    const gate = new SidechatSubmitPreflight();
    const input = {
      sessionId: "saved-sidechat",
      sourceSessionId: "closed-parent",
      fallback,
      findLiveSource: () => undefined,
      loadSavedSource: vi.fn(async (id: string) => {
        expect(id).toBe("closed-parent");
        return load.promise;
      }),
      isStillOpen: () => true,
      submitPrepared: (id: string, prepared: typeof fallback) => {
        submitted.push({ id, prepared });
        return true;
      },
      onAsyncFailure: vi.fn(),
    };

    expect(gate.submit(input)).toBe(true);
    expect(gate.has("saved-sidechat")).toBe(true);
    expect(gate.submit(input)).toBe(false);
    await flushAsyncSubmit();
    expect(input.loadSavedSource).toHaveBeenCalledTimes(1);
    load.resolve(parent);
    await load.promise;
    await flushAsyncSubmit();

    expect(submitted).toHaveLength(1);
    expect(submitted[0].id).toBe("saved-sidechat");
    expect(submitted[0].prepared.sourceTitle).toBe("Parent chat");
    expect(submitted[0].prepared.sourceContext).toContain("Original answer");
    expect(input.onAsyncFailure).not.toHaveBeenCalled();
    expect(gate.has("saved-sidechat")).toBe(false);
  });

  it("uses the bounded source snapshot when the parent record is gone", async () => {
    const submitted: Array<{ id: string; prepared: typeof fallback }> = [];
    const gate = new SidechatSubmitPreflight();
    gate.submit({
      sessionId: "sidechat",
      sourceSessionId: "deleted-parent",
      fallback,
      findLiveSource: () => undefined,
      loadSavedSource: async () => null,
      isStillOpen: () => true,
      submitPrepared: (id, prepared) => {
        submitted.push({ id, prepared });
        return true;
      },
      onAsyncFailure: vi.fn(),
    });
    await flushAsyncSubmit();
    expect(submitted).toEqual([{ id: "sidechat", prepared: fallback }]);
  });

  it("reports a failed saved-parent lookup only while the sidechat remains open", async () => {
    const failure = vi.fn();
    const gate = new SidechatSubmitPreflight();
    gate.submit({
      sessionId: "sidechat-error",
      sourceSessionId: "parent",
      fallback,
      findLiveSource: () => undefined,
      loadSavedSource: async () => {
        throw new Error("storage unavailable");
      },
      isStillOpen: () => true,
      submitPrepared: vi.fn(() => true),
      onAsyncFailure: failure,
    });
    await flushAsyncSubmit();
    expect(failure).toHaveBeenCalledWith(
      "The sidechat could not load its source context.",
    );

    const closedFailure = vi.fn();
    gate.submit({
      sessionId: "sidechat-closed-error",
      sourceSessionId: "parent",
      fallback,
      findLiveSource: () => undefined,
      loadSavedSource: async () => {
        throw new Error("storage unavailable");
      },
      isStillOpen: () => false,
      submitPrepared: vi.fn(() => true),
      onAsyncFailure: closedFailure,
    });
    await flushAsyncSubmit();
    expect(closedFailure).not.toHaveBeenCalled();
  });

  it("cancels a pending lookup when the sidechat closes or is deleted", async () => {
    const load = deferred<ReturnType<typeof source> | null>();
    const submitPrepared = vi.fn(() => true);
    const gate = new SidechatSubmitPreflight();
    gate.submit({
      sessionId: "closing-sidechat",
      sourceSessionId: "parent",
      fallback,
      findLiveSource: () => undefined,
      loadSavedSource: () => load.promise,
      isStillOpen: () => true,
      submitPrepared,
      onAsyncFailure: vi.fn(),
    });
    gate.cancel("closing-sidechat");
    load.resolve(source());
    await load.promise;
    await Promise.resolve();
    await Promise.resolve();
    expect(submitPrepared).not.toHaveBeenCalled();
    expect(gate.has("closing-sidechat")).toBe(false);
  });

  it("submits the saved fallback once after timeout and ignores a late parent read", async () => {
    const load = deferred<ReturnType<typeof source> | null>();
    const submitted: unknown[] = [];
    const gate = new SidechatSubmitPreflight();
    gate.submit({
      sessionId: "timed-sidechat",
      sourceSessionId: "slow-parent",
      fallback,
      findLiveSource: () => undefined,
      loadSavedSource: () => load.promise,
      isStillOpen: () => true,
      submitPrepared: (id, prepared) => {
        submitted.push({ id, prepared });
        return true;
      },
      onAsyncFailure: vi.fn(),
      timeoutMs: 1,
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    load.resolve(source());
    await load.promise;
    await Promise.resolve();
    expect(submitted).toEqual([{ id: "timed-sidechat", prepared: fallback }]);
  });
});

it("keeps Interactive sidechat on its own native conversation and account", async () => {
  const { createSidechatSession } = await import("./sidechatSubmit");
  const { newSession } = await import("./session");
  const source = {
    ...newSession("claude", "/repo", "claude:sonnet-5", "supervised", {
      claudeExecution: "interactive",
      effort: "low",
    }),
    modelSettings: { claudeExecution: "interactive", effort: "low" },
    providerSessionId: "source-native",
    providerAccountId: "work",
    title: "Source",
    worktreeCwd: "/worktree",
    blocks: [{ id: "u", role: "user" as const, text: "Explain this function" }],
  };
  const side = createSidechatSession(source);
  expect(side.id).not.toBe(source.id);
  expect(side.providerSessionId).toBeUndefined();
  expect(side.modelSettings).toMatchObject({
    claudeExecution: "interactive",
    effort: "low",
  });
  expect(side.providerAccountId).toBe("work");
  expect(side.worktreeCwd).toBe("/worktree");
  expect(side.sidechat?.sourceContext).toContain("Explain this function");
  expect(source.providerSessionId).toBe("source-native");
});

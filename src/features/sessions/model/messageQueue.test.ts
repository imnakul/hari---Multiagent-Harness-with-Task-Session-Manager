import { describe, expect, it, vi } from "vitest";
import { appendUser } from "../../../integrations/harness/core/apply";
import { appendPreparingHandoff } from "./handoff";
import {
  beginQueuedSteerCancellation,
  appendQueuedMessage,
  canDispatchQueuedHead,
  dismissUsageLimitNotice,
  canSteerQueuedHead,
  dequeueQueuedMessage,
  finalizeTurnSession,
  orchestrateTurnCompletion,
  finishQueuedSteerCancellation,
  isEditingQueuedHead,
  lastAssistantTextInTurn,
  prepareUsageLimitContinue,
  queuedHead,
  queuedMessageForSubmit,
  releaseHeldQueue,
  settleQueuedSteerCancellations,
} from "./messageQueue";
import { isProviderFailureText } from "./plan";
import { newSession, type QueuedMessage, type Session } from "./session";

function queued(id: string, text = id): QueuedMessage {
  return { id, text, attachments: [] };
}

function chat(patch: Partial<Session> = {}): Session {
  return {
    ...newSession("claude", "/tmp/project"),
    queuedMessages: [queued("a", "first"), queued("b", "second")],
    queueStatus: "active",
    ...patch,
  };
}

describe("queuedHead", () => {
  it("returns the first queued follow-up", () => {
    expect(queuedHead(chat())?.id).toBe("a");
    expect(queuedHead(chat({ queuedMessages: undefined }))).toBeUndefined();
  });
});

describe("quota holds and manual queue resume", () => {
  it("keeps late queue additions held after a usage limit and dismiss", () => {
    const limited = chat({
      busy: true,
      queuedMessages: undefined,
      queueStatus: undefined,
      usageLimit: { resetsAt: 10_000 },
    });
    const withQueue = appendQueuedMessage(limited, queued("late"));
    expect(withQueue.queueStatus).toBe("held");
    expect(withQueue.queueHoldReason).toMatch(/usage limit/i);
    expect(canDispatchQueuedHead(withQueue)).toBe(false);

    const dismissed = dismissUsageLimitNotice(withQueue);
    expect(dismissed.usageLimit).toBeUndefined();
    expect(dismissed.queueStatus).toBe("held");
    expect(dismissed.queueHoldReason).toMatch(/usage limit/i);
    expect(canDispatchQueuedHead(dismissed)).toBe(false);

    expect(canDispatchQueuedHead(releaseHeldQueue(dismissed))).toBe(false);
    const resumed = releaseHeldQueue({ ...dismissed, busy: false });
    expect(resumed.queueStatus).toBe("active");
    expect(resumed.queueHoldReason).toBeUndefined();
    expect(canDispatchQueuedHead(resumed)).toBe(true);
  });

  it("keeps a paused queue paused when the quota notice is dismissed", () => {
    const dismissed = dismissUsageLimitNotice(
      chat({
        queueStatus: "paused",
        usageLimit: { resetsAt: 10_000 },
      }),
    );
    expect(dismissed.queueStatus).toBe("paused");
    expect(canDispatchQueuedHead(dismissed)).toBe(false);
  });

  it("keeps a hidden quota hold when a queue is added after notice dismissal", () => {
    const dismissed = dismissUsageLimitNotice(
      chat({
        busy: true,
        queuedMessages: undefined,
        queueStatus: undefined,
        usageLimit: { resetsAt: 10_000 },
      }),
    );
    expect(dismissed.queueStatus).toBe("held");
    const withQueue = appendQueuedMessage(dismissed, queued("late"));
    expect(withQueue.queueStatus).toBe("held");
    expect(withQueue.queueHoldReason).toMatch(/usage limit/i);
    expect(canDispatchQueuedHead({ ...withQueue, busy: false })).toBe(false);

    const withoutQueue = finalizeTurnSession(
      { ...dismissed, busy: true },
      { providerFailed: false },
    );
    expect(withoutQueue.queueStatus).toBeUndefined();
    expect(withoutQueue.queueHoldReason).toBeUndefined();
  });

  it("keeps the queue blocked while an explicit quota Continue runs", () => {
    const held = chat({
      busy: false,
      queueStatus: "held",
      queueHoldReason: "The provider reached its usage limit.",
      usageLimit: { resetsAt: 10_000, resumeAtReset: true },
    });
    const continuing = prepareUsageLimitContinue(held);
    expect(continuing.usageLimit).toBeUndefined();
    expect(continuing.queueStatus).toBe("resuming");
    expect(continuing.queueHoldReason).toBeUndefined();
    expect(canDispatchQueuedHead(continuing)).toBe(false);

    const failed = finalizeTurnSession(
      {
        ...continuing,
        busy: true,
        blocks: [
          { id: "u1", role: "user", text: "continue" },
          {
            id: "e1",
            role: "system",
            text: "Quota is still exhausted",
            notice: "error",
          },
        ],
      },
      { providerFailed: true },
    );
    expect(failed.queueStatus).toBe("held");
    expect(failed.queueHoldReason).toBe("Quota is still exhausted");
    expect(canDispatchQueuedHead(failed)).toBe(false);
  });
});

describe("isEditingQueuedHead", () => {
  it("is true only when the head row is the one being edited", () => {
    expect(isEditingQueuedHead(chat())).toBe(false);
    expect(isEditingQueuedHead(chat({ editingQueuedMessageId: "a" }))).toBe(
      true,
    );
    expect(isEditingQueuedHead(chat({ editingQueuedMessageId: "b" }))).toBe(
      false,
    );
  });
});

describe("canDispatchQueuedHead", () => {
  it("dispatches an idle session with a queued head", () => {
    expect(canDispatchQueuedHead(chat())).toBe(true);
  });

  it("holds while the session is busy, paused, or resuming", () => {
    expect(canDispatchQueuedHead(chat({ busy: true }))).toBe(false);
    expect(canDispatchQueuedHead(chat({ queueStatus: "paused" }))).toBe(false);
    expect(canDispatchQueuedHead(chat({ queueStatus: "resuming" }))).toBe(
      false,
    );
  });

  it("holds while Interactive Claude works on a turn the app did not send", () => {
    const interactive = { claudeExecution: "interactive" };
    // Claude refuses input until idle, so the head waits for that turn to end.
    expect(
      canDispatchQueuedHead(
        chat({ modelSettings: interactive, externalTurnId: "interactive:1" }),
      ),
    ).toBe(false);
    expect(canDispatchQueuedHead(chat({ modelSettings: interactive }))).toBe(
      true,
    );
    expect(canDispatchQueuedHead(chat({ externalTurnId: "phone:1" }))).toBe(
      true,
    );
  });

  it("holds while the last turn is stopped at a usage limit", () => {
    expect(
      canDispatchQueuedHead(chat({ usageLimit: { resetsAt: 1_000 } })),
    ).toBe(false);
  });

  it("holds the queue after a failed turn until the user resumes", () => {
    expect(canDispatchQueuedHead(chat({ queueStatus: "held" }))).toBe(false);
  });

  it("holds only when the head item is being edited", () => {
    expect(canDispatchQueuedHead(chat({ editingQueuedMessageId: "a" }))).toBe(
      false,
    );
    expect(canDispatchQueuedHead(chat({ editingQueuedMessageId: "b" }))).toBe(
      true,
    );
  });

  it("does not dispatch during a preparing handoff", () => {
    const preparing = appendPreparingHandoff(
      chat({ queuedMessages: [queued("a")] }),
      "claude",
      "cursor",
    );
    expect(canDispatchQueuedHead(preparing)).toBe(false);
  });

  it("does not dispatch an empty queue", () => {
    expect(canDispatchQueuedHead(chat({ queuedMessages: undefined }))).toBe(
      false,
    );
  });
});

describe("canSteerQueuedHead", () => {
  it("still takes follow-ups while an optional asynchronous question is open", () => {
    expect(
      canSteerQueuedHead(
        chat({
          busy: true,
          turnReady: true,
          pendingQuestion: { requestId: 1, questions: [], autoResolveAt: 1000 },
        }),
      ),
    ).toBe(true);
  });
  it("holds during startup and allows delivery once the busy turn is ready", () => {
    expect(canSteerQueuedHead(chat({ busy: true }))).toBe(false);
    expect(canSteerQueuedHead(chat({ busy: true, turnReady: true }))).toBe(
      true,
    );
    expect(canSteerQueuedHead(chat({ turnReady: true }))).toBe(false);
  });

  it.each([
    { queueStatus: "paused" as const },
    { queueStatus: "resuming" as const },
    { editingQueuedMessageId: "a" },
    { worktreePreparing: true },
    { worktreeRemoved: true },
    { usageLimit: { resetsAt: 1000 } },
    { pendingQuestion: { requestId: 1, questions: [] } },
  ])("holds an unavailable session: %j", (patch) => {
    expect(
      canSteerQueuedHead(chat({ busy: true, turnReady: true, ...patch })),
    ).toBe(false);
  });

  it.each(["plan", "orchestrate"] as const)(
    "waits for an idle turn for %s",
    (intent) => {
      expect(
        canSteerQueuedHead(
          chat({
            busy: true,
            turnReady: true,
            queuedMessages: [{ ...queued("a"), intent }],
          }),
        ),
      ).toBe(false);
    },
  );
});

describe("dequeueQueuedMessage", () => {
  it("drops the id and clears queue state when the last item goes", () => {
    const one = chat({ queuedMessages: [queued("a")], queueStatus: "active" });
    expect(dequeueQueuedMessage(one, "a")).toMatchObject({
      queuedMessages: undefined,
      queueStatus: undefined,
    });
  });

  it("keeps editing another row after the head is sent", () => {
    const next = dequeueQueuedMessage(
      chat({ editingQueuedMessageId: "b" }),
      "a",
    );
    expect(next.queuedMessages?.map((message) => message.id)).toEqual(["b"]);
    expect(next.editingQueuedMessageId).toBe("b");
    expect(next.queueStatus).toBe("active");
  });
});

describe("queuedMessageForSubmit", () => {
  it("only auto-dispatches the idle head", () => {
    expect(queuedMessageForSubmit(chat(), "a", "dispatch")?.id).toBe("a");
    expect(queuedMessageForSubmit(chat(), "b", "dispatch")).toBeUndefined();
    expect(
      queuedMessageForSubmit(chat({ busy: true }), "a", "dispatch"),
    ).toBeUndefined();
  });

  it("lets Steer target any remaining row, including while busy or paused", () => {
    expect(queuedMessageForSubmit(chat({ busy: true }), "b", "steer")?.id).toBe(
      "b",
    );
    expect(
      queuedMessageForSubmit(chat({ queueStatus: "paused" }), "a", "steer")?.id,
    ).toBe("a");
    expect(
      queuedMessageForSubmit(chat({ queueStatus: "held" }), "b", "steer")?.id,
    ).toBe("b");
    expect(queuedMessageForSubmit(chat(), "missing", "steer")).toBeUndefined();
  });
});

describe("queued Steer cancellation", () => {
  it("holds dispatch while cancellation settles and prioritizes the selected row", () => {
    const selected: QueuedMessage = {
      ...queued("b", "make a plan"),
      intent: "plan",
      noteCard: {
        id: "note-1",
        slug: "queue-note",
        title: "Queue note",
        body: "Keep this context",
      },
    };
    const starting = chat({
      busy: true,
      editingQueuedMessageId: "b",
      queuedMessages: [queued("a", "first"), selected],
      blocks: [
        { id: "user", role: "user", text: "working" },
        {
          id: "assistant",
          role: "assistant",
          text: "partial",
          streaming: true,
        },
      ],
    });
    const cancelling = beginQueuedSteerCancellation(starting, "b");

    expect(cancelling.queuedMessages?.map((message) => message.id)).toEqual([
      "b",
      "a",
    ]);
    expect(cancelling.queuedMessages?.[0]).toEqual(selected);
    expect(cancelling.queueStatus).toBe("steering");
    expect(cancelling.busy).toBe(true);
    expect(cancelling.editingQueuedMessageId).toBeUndefined();
    expect(cancelling.blocks[1]).toMatchObject({ streaming: false });
    expect(canDispatchQueuedHead(cancelling)).toBe(false);

    expect(finishQueuedSteerCancellation(cancelling, true)).toMatchObject({
      busy: false,
      queueStatus: "active",
    });
    expect(finishQueuedSteerCancellation(cancelling, false)).toMatchObject({
      busy: false,
      queueStatus: "held",
    });
  });

  it("does not alter the active turn when the queued id is stale", () => {
    const starting = chat({ busy: true });

    expect(beginQueuedSteerCancellation(starting, "missing")).toBe(starting);
  });

  it("reports success only when every provider cancellation acknowledges", async () => {
    await expect(
      settleQueuedSteerCancellations([Promise.resolve(), Promise.resolve()]),
    ).resolves.toBe(true);
    await expect(
      settleQueuedSteerCancellations([
        Promise.resolve(),
        Promise.reject(new Error("cancel failed")),
      ]),
    ).resolves.toBe(false);
  });

  it("fails closed when a provider cancellation never settles", async () => {
    vi.useFakeTimers();
    try {
      const result = settleQueuedSteerCancellations([
        new Promise<void>(() => undefined),
      ]);

      await vi.advanceTimersByTimeAsync(15_000);

      await expect(
        Promise.race([result, Promise.resolve("still-pending")]),
      ).resolves.toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("finalizeTurnSession and failure-to-held ordering", () => {
  it("transitions a session with a queue to held on structured provider failure", () => {
    const session = chat({
      busy: true,
      blocks: [
        { id: "u1", role: "user", text: "hello" },
        {
          id: "s1",
          role: "system",
          text: "Anthropic API 500 internal error",
          notice: "error",
        },
      ],
    });

    const finalized = finalizeTurnSession(session, { providerFailed: true });

    expect(finalized.busy).toBe(false);
    expect(finalized.queueStatus).toBe("held");
    expect(finalized.queueHoldReason).toBe("Anthropic API 500 internal error");
    expect(canDispatchQueuedHead(finalized)).toBe(false);
  });

  it("transitions to held on direct provider rejection", () => {
    const session = chat({
      busy: true,
      blocks: [{ id: "u1", role: "user", text: "hello" }],
    });

    const directRejectionFailed = true;
    const finalized = finalizeTurnSession(session, {
      providerFailed: directRejectionFailed,
    });

    expect(finalized.busy).toBe(false);
    expect(finalized.queueStatus).toBe("held");
    expect(finalized.queueHoldReason).toMatch(/last turn failed/i);
    expect(canDispatchQueuedHead(finalized)).toBe(false);
  });

  it("transitions to held on failure-text detection in the assistant turn", () => {
    const session = chat({
      busy: true,
      blocks: [
        { id: "u1", role: "user", text: "write code" },
        {
          id: "a1",
          role: "assistant",
          text: "Upgrade your plan to continue.",
        },
      ],
    });

    const lastText = lastAssistantTextInTurn(session);
    const failureTextDetected = isProviderFailureText(lastText);
    expect(failureTextDetected).toBe(true);

    const finalized = finalizeTurnSession(session, {
      providerFailed: failureTextDetected,
    });

    expect(finalized.busy).toBe(false);
    expect(finalized.queueStatus).toBe("held");
    expect(finalized.queueHoldReason).toBe("Upgrade your plan to continue.");
    expect(canDispatchQueuedHead(finalized)).toBe(false);
  });

  it("keeps a successful turn eligible for ordinary queue dispatch", () => {
    const session = chat({
      busy: true,
      blocks: [
        { id: "u1", role: "user", text: "write code" },
        { id: "a1", role: "assistant", text: "Here is the code" },
      ],
    });

    const finalized = finalizeTurnSession(session, { providerFailed: false });

    expect(finalized.busy).toBe(false);
    expect(finalized.queueStatus).toBe("active");
    expect(canDispatchQueuedHead(finalized)).toBe(true);
  });

  it("ensures held transition occurs before mocked checkpoint resolves and prevents submission", async () => {
    let session = chat({
      busy: true,
      blocks: [{ id: "u1", role: "user", text: "test" }],
    });

    let checkpointResolved = false;
    let attemptedSubmitDuringWindow = false;

    // Simulate checkpoint flush promise
    let resolveCheckpoint!: () => void;
    const checkpointPromise = new Promise<void>((resolve) => {
      resolveCheckpoint = () => {
        checkpointResolved = true;
        resolve();
      };
    });

    // Production flow on failure:
    // 1. Finalize session turn synchronously before awaiting checkpoint
    session = finalizeTurnSession(session, { providerFailed: true });

    // Assert synchronously held BEFORE checkpoint resolves
    expect(checkpointResolved).toBe(false);
    expect(session.queueStatus).toBe("held");
    expect(canDispatchQueuedHead(session)).toBe(false);

    // Auto-dispatch check during checkpoint window
    if (canDispatchQueuedHead(session)) {
      attemptedSubmitDuringWindow = true;
    }

    // Now resolve checkpoint
    resolveCheckpoint();
    await checkpointPromise;

    expect(attemptedSubmitDuringWindow).toBe(false);
    expect(session.queueStatus).toBe("held");
    expect(canDispatchQueuedHead(session)).toBe(false);
  });
});

describe("queued Steer cancellation unconditional editing owner clear", () => {
  it("starting cancellation while another row is being edited clears the editing owner", () => {
    const starting = chat({
      busy: true,
      editingQueuedMessageId: "b", // Row b is being edited
      queuedMessages: [queued("a", "first"), queued("b", "second")],
    });

    // Steer row "a" (not "b")
    const cancelling = beginQueuedSteerCancellation(starting, "a");

    expect(cancelling.queueStatus).toBe("steering");
    expect(cancelling.editingQueuedMessageId).toBeUndefined();
    expect(canDispatchQueuedHead(cancelling)).toBe(false);
  });
  it("preserves the selected queued row and its rich metadata intact at the queue head", () => {
    const selected: QueuedMessage = {
      id: "target",
      text: "plan migration",
      attachments: [
        {
          id: "att-1",
          name: "doc.md",
          mimeType: "text/markdown",
          kind: "file",
          size: 50,
          path: "/tmp/doc.md",
        },
      ],
      intent: "plan",
      noteCard: { id: "n1", slug: "card", title: "Card", body: "detail" },
      handoffCard: { from: "claude", to: "codex", brief: "continue", files: 1 },
    };
    const starting = chat({
      busy: true,
      queuedMessages: [queued("other", "first"), selected],
    });

    const cancelling = beginQueuedSteerCancellation(starting, "target");

    expect(cancelling.queuedMessages?.[0]).toEqual(selected);
    expect(cancelling.queuedMessages?.[0].intent).toBe("plan");
    expect(cancelling.queuedMessages?.[0].noteCard?.title).toBe("Card");
    expect(cancelling.queuedMessages?.[0].handoffCard?.to).toBe("codex");
  });

  it("locks queue mutations during steering and restores controls when cancellation settles", () => {
    const starting = chat({
      busy: true,
      queuedMessages: [queued("a", "first"), queued("b", "second")],
    });
    const cancelling = beginQueuedSteerCancellation(starting, "b");
    expect(cancelling.queueStatus).toBe("steering");

    // Guarded mutations during steering leave session unchanged
    const applyEdit = (session: Session, messageId: string, text: string) =>
      session.queueStatus !== "steering"
        ? {
            ...session,
            queuedMessages: session.queuedMessages?.map((m) =>
              m.id === messageId ? { ...m, text } : m,
            ),
          }
        : session;
    const applyDelete = (session: Session, messageId: string) =>
      session.queueStatus !== "steering"
        ? dequeueQueuedMessage(session, messageId)
        : session;

    expect(applyEdit(cancelling, "b", "mutated")).toBe(cancelling);
    expect(applyDelete(cancelling, "b")).toBe(cancelling);

    // After cancellation settles, controls return
    const finished = finishQueuedSteerCancellation(cancelling, true);
    expect(finished.queueStatus).toBe("active");
    expect(finished.busy).toBe(false);
    expect(canDispatchQueuedHead(finished)).toBe(true);

    const edited = applyEdit(finished, "b", "mutated after finish");
    expect(edited.queuedMessages?.[0].text).toBe("mutated after finish");

    const deleted = applyDelete(finished, "b");
    expect(deleted.queuedMessages?.map((m) => m.id)).toEqual(["a"]);
  });
});

describe("orchestrateTurnCompletion (production-used orchestration, Defect 2)", () => {
  it("synchronously sets queueStatus to held on session.error before checkpoint Promise resolves", async () => {
    let currentSession = chat({
      busy: true,
      queueStatus: "active",
      queuedMessages: [queued("q1", "queued row")],
    });
    let checkpointResolved = false;
    let resolveCheckpoint!: () => void;
    const checkpointPromise = new Promise<void>((resolve) => {
      resolveCheckpoint = () => {
        checkpointResolved = true;
        resolve();
      };
    });

    const completionPromise = orchestrateTurnCompletion({
      sessionId: currentSession.id,
      getSessions: () => [currentSession],
      setSessions: (sessions) => {
        currentSession = sessions[0];
      },
      flushCheckpoint: async () => checkpointPromise,
      providerFailureSeen: true, // session.error encountered
      buildSucceeded: false,
      nativePlanSeen: false,
      planEventKey: "plan-1",
    });

    // SYNCHRONOUS ASSERTIONS before checkpoint resolves:
    expect(checkpointResolved).toBe(false);
    expect(currentSession.queueStatus).toBe("held");
    expect(currentSession.busy).toBe(false);
    // canDispatchQueuedHead MUST be false synchronously!
    expect(canDispatchQueuedHead(currentSession)).toBe(false);

    // Resolve checkpoint flush
    resolveCheckpoint();
    await completionPromise;

    expect(checkpointResolved).toBe(true);
    expect(currentSession.queueStatus).toBe("held");
    expect(canDispatchQueuedHead(currentSession)).toBe(false);
  });

  it("synchronously sets queueStatus to held on direct send rejection before checkpoint Promise resolves", async () => {
    let currentSession = chat({
      busy: true,
      queueStatus: "active",
      queuedMessages: [queued("q1", "queued row")],
    });
    let failureCallbackCalled = false;
    let checkpointResolved = false;
    let resolveCheckpoint!: () => void;
    const checkpointPromise = new Promise<void>((resolve) => {
      resolveCheckpoint = () => {
        checkpointResolved = true;
        resolve();
      };
    });

    // In App.tsx catch block: providerFailureSeen = true
    const completionPromise = orchestrateTurnCompletion({
      sessionId: currentSession.id,
      getSessions: () => [currentSession],
      setSessions: (sessions) => {
        currentSession = sessions[0];
      },
      beforeFailureCheckpoint: async () => {
        failureCallbackCalled = true;
        expect(currentSession.queueStatus).toBe("held");
        expect(canDispatchQueuedHead(currentSession)).toBe(false);
      },
      flushCheckpoint: async () => checkpointPromise,
      providerFailureSeen: true,
      buildSucceeded: false,
      nativePlanSeen: false,
      planEventKey: "plan-1",
    });

    expect(checkpointResolved).toBe(false);
    expect(currentSession.queueStatus).toBe("held");
    expect(canDispatchQueuedHead(currentSession)).toBe(false);

    resolveCheckpoint();
    await completionPromise;
    expect(failureCallbackCalled).toBe(true);
    expect(currentSession.queueStatus).toBe("held");
  });

  it("enforces ordering: held state established -> failure callback begins -> checkpoint begins, keeping auto-dispatch blocked", async () => {
    let currentSession = chat({
      busy: true,
      queueStatus: "active",
      queuedMessages: [queued("q1", "queued row")],
    });
    const order: string[] = [];

    let resolveFailureCallback!: () => void;
    const failureCallbackPromise = new Promise<void>((resolve) => {
      resolveFailureCallback = resolve;
    });

    let resolveCheckpoint!: () => void;
    const checkpointPromise = new Promise<void>((resolve) => {
      resolveCheckpoint = resolve;
    });

    const completionPromise = orchestrateTurnCompletion({
      sessionId: currentSession.id,
      getSessions: () => [currentSession],
      setSessions: (sessions) => {
        currentSession = sessions[0];
      },
      beforeFailureCheckpoint: async () => {
        order.push("failureCallback");
        // Held state must already be established before failure callback begins
        expect(currentSession.queueStatus).toBe("held");
        expect(currentSession.busy).toBe(false);
        expect(canDispatchQueuedHead(currentSession)).toBe(false);
        await failureCallbackPromise;
      },
      flushCheckpoint: async () => {
        order.push("checkpoint");
        await checkpointPromise;
      },
      providerFailureSeen: true,
      buildSucceeded: false,
      nativePlanSeen: false,
      planEventKey: "plan-1",
    });

    // Synchronously before any Promise yield:
    expect(currentSession.queueStatus).toBe("held");
    expect(currentSession.busy).toBe(false);
    expect(canDispatchQueuedHead(currentSession)).toBe(false);
    expect(order).toEqual(["failureCallback"]);

    // While failure callback is unresolved, auto-dispatch remains impossible
    expect(canDispatchQueuedHead(currentSession)).toBe(false);

    // Resolve failure callback -> checkpoint begins next
    resolveFailureCallback();
    await Promise.resolve();
    await Promise.resolve();

    expect(order).toEqual(["failureCallback", "checkpoint"]);
    expect(canDispatchQueuedHead(currentSession)).toBe(false);

    // Resolve checkpoint flush
    resolveCheckpoint();
    await completionPromise;

    expect(order).toEqual(["failureCallback", "checkpoint"]);
    expect(currentSession.queueStatus).toBe("held");
    expect(canDispatchQueuedHead(currentSession)).toBe(false);
  });

  it("synchronously sets queueStatus to held on assistant failure-text detection before checkpoint Promise resolves", async () => {
    let currentSession = chat({
      busy: true,
      queueStatus: "active",
      blocks: [
        { id: "u1", role: "user", text: "hello" },
        {
          id: "a1",
          role: "assistant",
          text: "You have reached your usage limit. Upgrade your plan.",
        },
      ],
      queuedMessages: [queued("q1", "queued row")],
    });
    let checkpointResolved = false;
    let resolveCheckpoint!: () => void;
    const checkpointPromise = new Promise<void>((resolve) => {
      resolveCheckpoint = () => {
        checkpointResolved = true;
        resolve();
      };
    });

    const completionPromise = orchestrateTurnCompletion({
      sessionId: currentSession.id,
      getSessions: () => [currentSession],
      setSessions: (sessions) => {
        currentSession = sessions[0];
      },
      flushCheckpoint: async () => checkpointPromise,
      providerFailureSeen: false, // failure detected via text
      buildSucceeded: false,
      nativePlanSeen: false,
      planEventKey: "plan-1",
    });

    // Synchronously before checkpoint resolves:
    expect(checkpointResolved).toBe(false);
    expect(currentSession.queueStatus).toBe("held");
    expect(canDispatchQueuedHead(currentSession)).toBe(false);

    resolveCheckpoint();
    await completionPromise;
    expect(currentSession.queueStatus).toBe("held");
  });

  it("preserves busy: true and prevents auto-dispatch on successful turn until checkpoint Promise resolves", async () => {
    let currentSession = chat({
      busy: true,
      queueStatus: "active",
      blocks: [
        { id: "u1", role: "user", text: "hello" },
        { id: "a1", role: "assistant", text: "Here is your answer." },
      ],
      queuedMessages: [queued("q1", "queued row")],
    });
    let checkpointResolved = false;
    let resolveCheckpoint!: () => void;
    const checkpointPromise = new Promise<void>((resolve) => {
      resolveCheckpoint = () => {
        checkpointResolved = true;
        resolve();
      };
    });

    const completionPromise = orchestrateTurnCompletion({
      sessionId: currentSession.id,
      getSessions: () => [currentSession],
      setSessions: (sessions) => {
        currentSession = sessions[0];
      },
      flushCheckpoint: async () => checkpointPromise,
      providerFailureSeen: false,
      buildSucceeded: true,
      nativePlanSeen: false,
      planEventKey: "plan-1",
    });

    // BEFORE checkpoint resolves: session remains busy, preventing premature dispatch!
    expect(checkpointResolved).toBe(false);
    expect(currentSession.busy).toBe(true);
    expect(canDispatchQueuedHead(currentSession)).toBe(false);

    // Resolve checkpoint flush
    resolveCheckpoint();
    await completionPromise;

    // AFTER checkpoint resolves: session is un-busied, allowing next auto-dispatch!
    expect(checkpointResolved).toBe(true);
    expect(currentSession.busy).toBe(false);
    expect(currentSession.queueStatus).toBe("active");
    expect(canDispatchQueuedHead(currentSession)).toBe(true);
  });

  it("applies the caller's last changes in the update that releases busy", async () => {
    let currentSession = chat({
      busy: true,
      blocks: [
        { id: "u0", role: "user", text: "build it", startedAt: 1 },
        { id: "a0", role: "assistant", text: "Done." },
      ],
    });
    const released: Session[] = [];
    const failures: boolean[] = [];

    await orchestrateTurnCompletion({
      sessionId: currentSession.id,
      getSessions: () => [currentSession],
      setSessions: (sessions) => {
        currentSession = sessions[0];
        if (!currentSession.busy) released.push(currentSession);
      },
      flushCheckpoint: async () => undefined,
      finalizeSession: (session, providerFailed) => {
        failures.push(providerFailed);
        return { ...session, title: "finalized" };
      },
      providerFailureSeen: false,
      buildSucceeded: true,
      nativePlanSeen: false,
      planEventKey: "plan-1",
    });

    expect(failures).toEqual([false]);
    expect(released).toHaveLength(1);
    expect(released[0].title).toBe("finalized");
  });

  it("passes provider failure to the caller's last changes before holding the queue", async () => {
    let currentSession = chat({ busy: true });
    const failures: boolean[] = [];

    const completion = orchestrateTurnCompletion({
      sessionId: currentSession.id,
      getSessions: () => [currentSession],
      setSessions: (sessions) => {
        currentSession = sessions[0];
      },
      flushCheckpoint: () => new Promise<void>(() => undefined),
      finalizeSession: (session, providerFailed) => {
        failures.push(providerFailed);
        return { ...session, title: "finalized" };
      },
      providerFailureSeen: true,
      buildSucceeded: false,
      nativePlanSeen: false,
      planEventKey: "plan-1",
    });
    void completion;

    expect(failures).toEqual([true]);
    expect(currentSession.title).toBe("finalized");
    expect(currentSession.queueStatus).toBe("held");
  });

  // A late second seal from the finished turn ended the queued head's turn
  // after ~0.3 s, so the queue sent the next row over it and the head was lost.
  it("leaves the dispatched queue head running once the finished turn is released", async () => {
    let currentSession = chat({
      busy: true,
      blocks: [
        { id: "u0", role: "user", text: "fix the hero", startedAt: 1 },
        { id: "a0", role: "assistant", text: "Fixed." },
      ],
    });

    await orchestrateTurnCompletion({
      sessionId: currentSession.id,
      getSessions: () => [currentSession],
      setSessions: (sessions) => {
        currentSession = sessions[0];
      },
      flushCheckpoint: async () => undefined,
      providerFailureSeen: false,
      buildSucceeded: true,
      nativePlanSeen: false,
      planEventKey: "plan-1",
    });
    expect(canDispatchQueuedHead(currentSession)).toBe(true);

    // The queue sends its head as a new turn, as App.submitSession does.
    const head = queuedHead(currentSession)!;
    currentSession = appendUser(
      dequeueQueuedMessage(currentSession, head.id),
      head.text,
    );
    await Promise.resolve();

    const headTurn = currentSession.blocks.at(-1)!;
    expect(headTurn.text).toBe("first");
    expect(headTurn.durationMs).toBeUndefined();
    expect(currentSession.busy).toBe(true);
    expect(queuedHead(currentSession)?.id).toBe("b");
    expect(canDispatchQueuedHead(currentSession)).toBe(false);
  });
});

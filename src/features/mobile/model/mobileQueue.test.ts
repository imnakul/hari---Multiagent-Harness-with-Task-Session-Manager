import { describe, expect, it } from "vitest";
import { newSession, type QueuedMessage, type Session } from "../../sessions/model/session";
import { checkMobileQueueAction, mobileQueue } from "./mobileQueue";

const message = (id: string, change: Partial<QueuedMessage> = {}): QueuedMessage => ({
  id,
  text: `text ${id}`,
  attachments: [],
  ...change,
});
const session = (change: Partial<Session> = {}): Session => ({
  ...newSession("codex", "/fixture"),
  ...change,
});

describe("mobileQueue", () => {
  it("is null with nothing queued", () => {
    expect(mobileQueue(session())).toBeNull();
    expect(mobileQueue(session({ queuedMessages: [] }))).toBeNull();
  });

  it("carries the queue as the desktop's strip shows it", () => {
    const queue = mobileQueue(
      session({
        queuedMessages: [
          message("a"),
          message("b", { text: " ", attachments: [{} as never], error: "Failed" }),
        ],
        queueStatus: "paused",
        sendingQueuedMessageId: "a",
      }),
    );
    expect(queue).toEqual({
      status: "paused",
      sendingId: "a",
      steer: "steer",
      messages: [
        { id: "a", label: "text a", text: "text a", attachments: 0, canEdit: true },
        { id: "b", label: "1 attachment", text: " ", attachments: 1, error: "Failed", canEdit: true },
      ],
    });
  });

  it("shows a Mono only its session-finished notices, without send now", () => {
    const queue = mobileQueue(
      session({
        busy: true,
        queuedMessages: [
          message("own"),
          message("done", {
            monoSessionCompletion: { sessionId: "s", title: "Fix", status: "completed" },
          }),
        ],
      }),
      true,
    );
    expect(queue?.steer).toBeNull();
    expect(queue?.messages).toEqual([
      { id: "done", label: "Session completed: Fix", text: "text done", attachments: 0, canEdit: false },
    ]);
  });
});

describe("checkMobileQueueAction", () => {
  const queued = session({ queuedMessages: [message("a"), message("b")], queueStatus: "paused" });

  it("returns the edited text, and refuses an empty one", () => {
    expect(checkMobileQueueAction(queued, "edit", { messageId: "a", text: "new" })).toBe("new");
    expect(() => checkMobileQueueAction(queued, "edit", { messageId: "a", text: "  " })).toThrow(
      "under 100,000",
    );
  });

  it("refuses a message that already left the queue, or is sending", () => {
    expect(() => checkMobileQueueAction(queued, "delete", { messageId: "gone" })).toThrow(
      "already sent",
    );
    expect(() =>
      checkMobileQueueAction({ ...queued, sendingQueuedMessageId: "a" }, "steer", { messageId: "a" }),
    ).toThrow("sending now");
  });

  it("waits while the queue steers", () => {
    expect(() =>
      checkMobileQueueAction({ ...queued, queueStatus: "steering" }, "delete", { messageId: "a" }),
    ).toThrow("Try again");
  });

  it("resumes only a paused or held queue", () => {
    expect(checkMobileQueueAction(queued, "resume", {})).toBeUndefined();
    expect(() =>
      checkMobileQueueAction({ ...queued, queueStatus: "active" }, "resume", {}),
    ).toThrow("already running");
  });
});

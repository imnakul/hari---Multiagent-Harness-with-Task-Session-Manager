import { describe, expect, it, vi } from "vitest";

import {
  categoryFor,
  failureNote,
  PANEL_CATEGORIES,
  panelCommand,
  panelData,
} from "../src/features/notifications/notificationActions";
import { parseFeed, type FeedItem } from "../src/features/notifications/notificationFeed";

// Hoisted above the imports by vitest.
vi.mock("expo-sqlite/kv-store", () => ({
  default: { getItemSync: () => null, setItem: async () => {} },
}));

const base: FeedItem = { id: "s1:finished", kind: "finished", title: "Chat", body: "Done", at: 1, read: false };

describe("panel notification buttons (L-278)", () => {
  it("reads the request id from the computer's list", () => {
    const parsed = parseFeed({
      available: true,
      items: [
        { ...base, id: "s1:approval:4", kind: "approval", requestId: 4 },
        { ...base, requestId: "4" },
        { ...base, requestId: -1 },
      ],
    });
    expect(parsed?.items.map((item) => item.requestId)).toEqual([4, undefined, undefined]);
  });

  it("gives each entry the buttons it can take", () => {
    const approval: FeedItem = { ...base, kind: "approval", sessionId: "s1", requestId: 4 };
    expect(categoryFor(approval)).toBe(PANEL_CATEGORIES.approval);
    expect(categoryFor({ ...approval, kind: "question" })).toBe(PANEL_CATEGORIES.answer);
    expect(categoryFor({ ...base, sessionId: "s1" })).toBe(PANEL_CATEGORIES.reply);
    expect(categoryFor({ ...approval, requestId: undefined })).toBeUndefined();
    expect(categoryFor({ ...approval, sessionId: undefined })).toBeUndefined();
    expect(categoryFor({ ...base, kind: "automationFailed", sessionId: "s1" })).toBeUndefined();
  });

  it("carries what the default tap and the buttons need", () => {
    expect(panelData({ ...base, kind: "approval", sessionId: "s1", requestId: 4 })).toEqual({
      feedId: "s1:finished",
      kind: "approval",
      text: "Done",
      sessionId: "s1",
      requestId: 4,
    });
    expect(panelData({ ...base, sessionId: "s1", projectId: "p" })).toMatchObject({ projectId: "p" });
    expect(panelData({ ...base, projectId: "p" })).not.toHaveProperty("projectId");
  });

  it("turns Approve and Deny into the approval decision", () => {
    const data = { kind: "approval", sessionId: "s1", requestId: 4 };
    expect(panelCommand(data, "approve", undefined)).toEqual({
      ok: true,
      method: "session.approve",
      params: { conversationId: "s1", requestId: 4, decision: "allow" },
      verb: "approve",
    });
    expect(panelCommand(data, "deny", undefined)).toMatchObject({ params: { decision: "deny" } });
    expect(panelCommand({ ...data, requestId: undefined }, "approve", undefined)).toBeNull();
    expect(panelCommand({ ...data, kind: "question" }, "approve", undefined)).toBeNull();
  });

  it("sends a typed answer or reply, trimmed, and refuses an empty one", () => {
    expect(panelCommand({ kind: "question", sessionId: "s1", requestId: 5 }, "answer", " Blue ")).toEqual({
      ok: true,
      method: "session.answerQuestion",
      params: { conversationId: "s1", requestId: 5, reply: { kind: "text", text: "Blue" } },
      verb: "send the answer",
    });
    expect(panelCommand({ kind: "finished", sessionId: "s1" }, "reply", "Now add tests")).toEqual({
      ok: true,
      method: "conversation.send",
      params: { conversationId: "s1", text: "Now add tests" },
      verb: "send the reply",
    });
    expect(panelCommand({ kind: "finished", sessionId: "s1" }, "reply", "  ")).toEqual({
      ok: false,
      verb: "send the reply",
      error: "Type a reply first",
    });
    expect(
      panelCommand({ kind: "question", sessionId: "s1", requestId: 5 }, "answer", "x".repeat(10_001)),
    ).toMatchObject({ ok: false });
  });

  it("ignores the default tap and notifications without a chat", () => {
    expect(panelCommand({ kind: "finished", sessionId: "s1" }, "expo.modules.notifications.actions.DEFAULT", "")).toBeNull();
    expect(panelCommand({ kind: "finished" }, "reply", "Hi")).toBeNull();
    expect(panelCommand(null, "reply", "Hi")).toBeNull();
  });

  it("says why a tap failed and keeps the entry's text", () => {
    expect(failureNote("approve", "Desktop is offline", "Run npm test?")).toBe(
      "Couldn't approve: Desktop is offline\n\nRun npm test?",
    );
    expect(failureNote("send the reply", "Timed out", undefined)).toBe("Couldn't send the reply: Timed out");
  });
});

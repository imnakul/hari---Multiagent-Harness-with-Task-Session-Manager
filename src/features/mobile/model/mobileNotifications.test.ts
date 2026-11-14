// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  centerNotificationsSnapshot,
  recordCenterNotification,
} from "../../notifications/model/notificationCenter";
import {
  applyMobileNotificationAction,
  mobileNotificationFeed,
  parseMobileNotificationAction,
} from "./mobileNotifications";

beforeEach(() => {
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("phone notification feed (L-275)", () => {
  it("gives the phone the chat, its project id and name, and no folder path", () => {
    const feed = mobileNotificationFeed([
      {
        id: "s1:finished",
        kind: "finished",
        title: "Fix login",
        body: "Done",
        at: 5,
        read: false,
        cwd: "E:\\repo\\web",
        harness: "claude",
        model: "opus",
        sessionId: "s1",
        seenOnDesktop: true,
      },
      { id: "auto", kind: "automationFailed", title: "Nightly", body: "Run failed.", at: 4, read: true },
    ]);
    expect(feed).toEqual([
      {
        id: "s1:finished",
        kind: "finished",
        title: "Fix login",
        body: "Done",
        at: 5,
        read: false,
        sessionId: "s1",
        projectId: encodeURIComponent("E:\\repo\\web"),
        projectName: "web",
        seenOnDesktop: true,
      },
      { id: "auto", kind: "automationFailed", title: "Nightly", body: "Run failed.", at: 4, read: true },
    ]);
  });

  it("gives approvals and questions the request the phone's buttons answer (L-278)", () => {
    const base = { title: "Chat", body: "B", at: 1, read: false, sessionId: "s1" };
    const feed = mobileNotificationFeed([
      { ...base, id: "s1:approval:12", kind: "approval" },
      { ...base, id: "s1:question:13", kind: "question" },
      { ...base, id: "s1:finished", kind: "finished" },
      { ...base, id: "s1:approval:x", kind: "approval" },
    ]);
    expect(feed.map((item) => item.requestId)).toEqual([12, 13, undefined, undefined]);
  });

  it("reads only well-formed changes", () => {
    expect(parseMobileNotificationAction({ action: "clear" })).toEqual({ action: "clear" });
    expect(parseMobileNotificationAction({ action: "read" })).toEqual({ action: "read" });
    expect(parseMobileNotificationAction({ action: "read", ids: ["a"] })).toEqual({ action: "read", ids: ["a"] });
    expect(parseMobileNotificationAction({ action: "dismiss", ids: ["a", 2] })).toBeNull();
    expect(parseMobileNotificationAction({ action: "dismiss" })).toBeNull();
    expect(parseMobileNotificationAction({ action: "delete", ids: ["a"] })).toBeNull();
    expect(parseMobileNotificationAction(null)).toBeNull();
  });

  it("applies the phone's dismiss, read and clear to the bell's history", () => {
    const base = { kind: "finished" as const, title: "Chat", body: "Done" };
    recordCenterNotification({ ...base, key: "a", at: 1 });
    recordCenterNotification({ ...base, key: "b", at: 2 });
    applyMobileNotificationAction({ action: "dismiss", ids: ["a"] });
    expect(centerNotificationsSnapshot().map((item) => item.id)).toEqual(["b"]);
    applyMobileNotificationAction({ action: "read", ids: ["b"] });
    expect(centerNotificationsSnapshot()[0]!.read).toBe(true);
    applyMobileNotificationAction({ action: "clear" });
    expect(centerNotificationsSnapshot()).toEqual([]);
  });
});

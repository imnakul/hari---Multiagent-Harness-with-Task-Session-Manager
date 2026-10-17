// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  MAX_CENTER_NOTIFICATIONS,
  centerNotificationsSnapshot,
  dismissAllCenterNotifications,
  dismissCenterNotification,
  markCenterNotificationsRead,
  recordAutomationNotification,
  recordCenterNotification,
  subscribeCenterNotifications,
} from "./notificationCenter";

beforeEach(() => {
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
});
afterEach(() => vi.unstubAllGlobals());

const base = { kind: "finished" as const, title: "Chat", body: "Done" };

it("records newest first, replaces by key and notifies subscribers", () => {
  const onChange = vi.fn();
  const stop = subscribeCenterNotifications(onChange);
  recordCenterNotification({ ...base, key: "a", at: 1 });
  recordCenterNotification({ ...base, key: "b", at: 2 });
  recordCenterNotification({ ...base, key: "a", at: 3, body: "Again" });
  stop();
  const items = centerNotificationsSnapshot();
  expect(items.map((item) => [item.id, item.body])).toEqual([
    ["a", "Again"],
    ["b", "Done"],
  ]);
  expect(items.every((item) => !item.read)).toBe(true);
  expect(onChange).toHaveBeenCalledTimes(3);
  expect(centerNotificationsSnapshot()).toBe(items);
});

it("caps the history, dismisses one or all, and marks read", () => {
  for (let i = 0; i < MAX_CENTER_NOTIFICATIONS + 5; i += 1)
    recordCenterNotification({ ...base, key: `n${i}`, at: i });
  expect(centerNotificationsSnapshot()).toHaveLength(MAX_CENTER_NOTIFICATIONS);
  expect(centerNotificationsSnapshot()[0]!.id).toBe(`n${MAX_CENTER_NOTIFICATIONS + 4}`);
  dismissCenterNotification("n104");
  expect(centerNotificationsSnapshot().some((item) => item.id === "n104")).toBe(false);
  markCenterNotificationsRead();
  expect(centerNotificationsSnapshot().every((item) => item.read)).toBe(true);
  dismissAllCenterNotifications();
  expect(centerNotificationsSnapshot()).toEqual([]);
});

it("records automation runs with project, model and failure reason", () => {
  const automation = { name: "Nightly", cwd: "/work/app", harness: "claude" as const, model: "opus" };
  recordAutomationNotification(automation, "failed", { sessionId: "s1", error: "boom" });
  recordAutomationNotification(automation, "succeeded");
  const [ok, failed] = centerNotificationsSnapshot();
  expect(ok).toMatchObject({ kind: "automationSucceeded", title: "Nightly", body: "Run finished." });
  expect(ok!.sessionId).toBeUndefined();
  expect(failed).toMatchObject({
    kind: "automationFailed",
    body: "Run failed: boom",
    cwd: "/work/app",
    harness: "claude",
    model: "opus",
    sessionId: "s1",
  });
});

it("ignores malformed stored entries", () => {
  localStorage.setItem(
    "monocode.notificationCenter.v1",
    JSON.stringify([
      { id: "ok", kind: "question", title: "t", body: "b", at: 1, read: false },
      { id: "bad", kind: "nope", title: "t", body: "b", at: 1, read: false },
      { id: 3 },
    ]),
  );
  expect(centerNotificationsSnapshot().map((item) => item.id)).toEqual(["ok"]);
  localStorage.setItem("monocode.notificationCenter.v1", "{not json");
  expect(centerNotificationsSnapshot()).toEqual([]);
});

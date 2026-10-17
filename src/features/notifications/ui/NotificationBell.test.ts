// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NotificationBell, relativeAge } from "./NotificationBell";
import {
  OPEN_NOTIFICATION_SESSION_EVENT,
  centerNotificationsSnapshot,
  recordCenterNotification,
} from "../model/notificationCenter";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

function render(): HTMLButtonElement {
  act(() => root.render(createElement(NotificationBell)));
  return container.querySelector<HTMLButtonElement>('button[title="Notifications"]')!;
}
const click = (el: Element | null) => act(() => (el as HTMLElement).click());
const panel = () => document.querySelector('[role="dialog"][aria-label="Notifications"]');

it("shows the unread dot and clears it once the panel closes", () => {
  recordCenterNotification({ kind: "finished", title: "Fix bug", body: "Done", key: "a" });
  const bell = render();
  expect(container.querySelector('[data-testid="notification-dot"]')).not.toBeNull();
  click(bell);
  expect(panel()?.textContent).toContain("Fix bug");
  click(bell);
  expect(panel()).toBeNull();
  expect(container.querySelector('[data-testid="notification-dot"]')).toBeNull();
  expect(centerNotificationsSnapshot()[0]!.read).toBe(true);
});

it("expands a card with project, model and body, and opens its chat", () => {
  recordCenterNotification({
    kind: "automationFailed",
    title: "Nightly",
    body: "Run failed: boom",
    cwd: "/work/app",
    harness: "claude",
    model: "opus",
    sessionId: "s1",
  });
  click(render());
  const card = document.querySelector<HTMLButtonElement>('li button[aria-expanded]')!;
  expect(card.textContent).toContain("Automation failed");
  expect(card.textContent).toContain("app");
  expect(card.textContent).toContain("opus");
  expect(card.textContent).not.toContain("boom");
  click(card);
  expect(card.textContent).toContain("Run failed: boom");
  const opened = vi.fn();
  window.addEventListener(OPEN_NOTIFICATION_SESSION_EVENT, (event) =>
    opened((event as CustomEvent).detail),
  );
  click([...document.querySelectorAll("button")].find((b) => b.textContent === "Open chat")!);
  expect(opened).toHaveBeenCalledWith("s1");
  expect(panel()).toBeNull();
});

it("dismisses one card or all of them", () => {
  recordCenterNotification({ kind: "finished", title: "One", body: "", key: "1" });
  recordCenterNotification({ kind: "question", title: "Two", body: "", key: "2" });
  click(render());
  click(document.querySelector('[aria-label="Dismiss Two"]'));
  expect(document.querySelectorAll("li")).toHaveLength(1);
  click(document.querySelector('[aria-label="Dismiss all notifications"]'));
  expect(panel()?.textContent).toContain("No notifications");
  expect(centerNotificationsSnapshot()).toEqual([]);
});

it("formats ages compactly", () => {
  const now = 10_000_000;
  expect(relativeAge(now - 5_000, now)).toBe("just now");
  expect(relativeAge(now - 10 * 60_000, now)).toBe("10m ago");
  expect(relativeAge(now - 3 * 3_600_000, now)).toBe("3h ago");
});

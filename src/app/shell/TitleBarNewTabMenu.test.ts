// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { newTabViews, type AppView } from "../../features/workspace/model/appViewTabs";
import { TitleBar, type Tab } from "./TitleBar";

vi.mock("./WindowControls", () => ({ WindowControls: () => null }));

let container: HTMLDivElement;
let root: Root;

const TAB: Tab = {
  id: "session-1",
  project: "project",
  title: "session-1",
  more: [],
  sessionCount: 1,
  harnesses: [],
  busyHarnesses: [],
  files: [],
};

function render(props: { onOpenView?: (view: AppView) => void; views?: AppView[] }) {
  const onNewSession = vi.fn();
  act(() =>
    root.render(
      createElement(TitleBar, {
        tabs: [TAB],
        activeId: TAB.id,
        cwd: "/project",
        inset: true,
        onToggleSidebar: vi.fn(),
        onSelect: vi.fn(),
        onNewSession,
        newTabViews: props.views ?? newTabViews(),
        onOpenView: props.onOpenView,
        onClose: vi.fn(),
        onCloseMany: vi.fn(),
        onReorder: vi.fn(),
      }),
    ),
  );
  return onNewSession;
}

const trigger = () =>
  container.querySelector<HTMLButtonElement>('[aria-label="Open a view in a new tab"]');
const menu = () => document.querySelector<HTMLElement>('[role="menu"][aria-label="New tab"]');
const itemLabels = () =>
  Array.from(menu()!.querySelectorAll<HTMLButtonElement>("button")).map((b) => b.textContent);

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("new tab menu beside + (L-206)", () => {
  it("keeps + as New session and lists the views under the arrow", () => {
    const onOpenView = vi.fn();
    const onNewSession = render({ onOpenView });
    act(() => container.querySelector<HTMLButtonElement>('[aria-label^="New session"]')!.click());
    expect(onNewSession).toHaveBeenCalledTimes(1);
    expect(menu()).toBeNull();

    act(() => trigger()!.click());
    expect(trigger()!.getAttribute("aria-expanded")).toBe("true");
    const labels = itemLabels();
    expect(labels[0]).toMatch(/^New session/);
    expect(labels.slice(1)).toEqual([
      "Browser",
      "Whiteboard",
      "Notes",
      "Task Manager",
      "Session Manager",
      "Automations",
      "Inbox",
    ]);

    const browser = Array.from(menu()!.querySelectorAll<HTMLButtonElement>("button")).find(
      (b) => b.textContent === "Browser",
    )!;
    act(() => browser.click());
    expect(onOpenView).toHaveBeenCalledWith("browser");
    expect(menu()).toBeNull();
  });

  it("opens the same list on right-click of +", () => {
    render({ onOpenView: vi.fn() });
    act(() => {
      container
        .querySelector('[aria-label^="New session"]')!
        .dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    });
    expect(menu()).not.toBeNull();
  });

  it("shows a plain + when there are no views to offer", () => {
    render({ views: [] });
    expect(trigger()).toBeNull();
  });

  it("leaves Notes out when Notes is off", () => {
    expect(newTabViews((view) => view !== "notes")).not.toContain("notes");
    expect(newTabViews()[0]).toBe("browser");
  });
});

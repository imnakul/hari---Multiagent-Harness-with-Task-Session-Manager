// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FocusTabRow, type FocusTab } from "./FocusGroupTabs";

const TABS: FocusTab[] = [
  { id: "alpha", title: "alpha, 3 chats", content: "alpha", closeLabel: "Remove alpha from Focus" },
  { id: "beta", title: "beta, 1 chat", content: "beta", closeLabel: "Remove beta from Focus" },
];

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function render(onClose?: (id: string) => void, onSelect = vi.fn()) {
  act(() =>
    root.render(
      createElement(FocusTabRow, {
        label: "Projects in Focus",
        tabs: TABS,
        selectedId: "alpha",
        onSelect,
        onClose,
      }),
    ),
  );
  return onSelect;
}

describe("FocusTabRow close buttons (L-158)", () => {
  it("closes a tab from its close button without selecting it", () => {
    const onClose = vi.fn();
    const onSelect = render(onClose);
    const close = host.querySelector<HTMLButtonElement>(
      '[data-focus-tab-close="beta"]',
    );
    expect(close?.getAttribute("aria-label")).toBe("Remove beta from Focus");
    // Out of the Tab order, so the row keeps one tab stop.
    expect(close?.tabIndex).toBe(-1);
    act(() => close?.click());
    expect(onClose).toHaveBeenCalledWith("beta");
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("closes the focused tab with Delete", () => {
    const onClose = vi.fn();
    render(onClose);
    const tab = host.querySelector<HTMLButtonElement>('[role="tab"]');
    act(() => {
      tab?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Delete", bubbles: true }),
      );
    });
    expect(onClose).toHaveBeenCalledWith("alpha");
  });

  it("has no close buttons when the row cannot close tabs", () => {
    render();
    expect(host.querySelector("[data-focus-tab-close]")).toBeNull();
  });
});

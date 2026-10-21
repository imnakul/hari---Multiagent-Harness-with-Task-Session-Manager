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

function render(
  onClose?: (id: string) => void,
  onSelect = vi.fn(),
  onReorder?: (id: string, to: number) => void,
) {
  act(() =>
    root.render(
      createElement(FocusTabRow, {
        label: "Projects in Focus",
        tabs: TABS,
        selectedId: "alpha",
        onSelect,
        onClose,
        onReorder,
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

describe("FocusTabRow drag to reorder (L-159)", () => {
  const pointer = (type: string, clientX: number) =>
    new PointerEvent(type, { bubbles: true, button: 0, pointerId: 1, clientX });

  beforeEach(() => {
    HTMLElement.prototype.setPointerCapture = () => {};
    // Tabs 80px wide with the row's 4px gap: centres at 40 and 124.
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        const index = TABS.findIndex((tab) => tab.id === this.dataset.focusTab);
        return DOMRect.fromRect({ x: Math.max(index, 0) * 84, y: 0, width: 80, height: 24 });
      },
    );
  });
  afterEach(() => vi.restoreAllMocks());

  it("drops a dragged tab past its neighbour without selecting it", () => {
    const onReorder = vi.fn();
    const onSelect = render(undefined, vi.fn(), onReorder);
    const tab = host.querySelector<HTMLButtonElement>('[role="tab"]');
    if (!tab) throw new Error("no tab");
    act(() => {
      tab.dispatchEvent(pointer("pointerdown", 40));
      tab.dispatchEvent(pointer("pointermove", 140));
    });
    const beta = host.querySelector<HTMLElement>('[data-focus-tab="beta"]');
    expect(beta?.style.transform).toBe("translateX(-84px)");
    act(() => {
      tab.dispatchEvent(pointer("pointerup", 140));
      tab.click();
    });
    expect(onReorder).toHaveBeenCalledWith("alpha", 1);
    expect(onSelect).not.toHaveBeenCalled();
    expect(beta?.style.transform).toBe("");
  });

  it("treats a short press as a click", () => {
    const onReorder = vi.fn();
    const onSelect = render(undefined, vi.fn(), onReorder);
    const tabs = host.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    act(() => {
      tabs[1].dispatchEvent(pointer("pointerdown", 124));
      tabs[1].dispatchEvent(pointer("pointermove", 126));
      tabs[1].dispatchEvent(pointer("pointerup", 126));
      tabs[1].click();
    });
    expect(onReorder).not.toHaveBeenCalled();
    expect(onSelect).toHaveBeenCalledWith("beta");
  });

  it("moves the focused tab with Ctrl+Shift+Arrow", () => {
    const onReorder = vi.fn();
    render(undefined, vi.fn(), onReorder);
    const tab = host.querySelector<HTMLButtonElement>('[role="tab"]');
    const key = (k: string) =>
      new KeyboardEvent("keydown", { key: k, ctrlKey: true, shiftKey: true, bubbles: true });
    act(() => {
      tab?.dispatchEvent(key("ArrowLeft"));
      tab?.dispatchEvent(key("ArrowRight"));
    });
    expect(onReorder).toHaveBeenCalledTimes(1);
    expect(onReorder).toHaveBeenCalledWith("alpha", 1);
  });
});

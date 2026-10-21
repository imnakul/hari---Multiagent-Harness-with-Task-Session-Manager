// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Popover, type PopoverDismissReason } from "./Popover";

/**
 * A menu opened from inside a popover (the Focus picker's project filter,
 * L-174) sits above it on the dismiss stack: a click in the menu is not
 * outside the popover, and Escape closes only the menu.
 */
describe("Popover dismiss stack", () => {
  let container: HTMLDivElement;
  let anchor: HTMLButtonElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe(): void {}
        disconnect(): void {}
      },
    );
    container = document.createElement("div");
    anchor = document.createElement("button");
    document.body.append(container, anchor);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    anchor.remove();
    vi.unstubAllGlobals();
  });

  function renderStack(inner: boolean): {
    outer: PopoverDismissReason[];
    menu: PopoverDismissReason[];
  } {
    const outer: PopoverDismissReason[] = [];
    const menu: PopoverDismissReason[] = [];
    const tree = (): ReactNode =>
      createElement(
        Popover,
        {
          anchor,
          "aria-label": "Outer",
          onDismiss: (reason) => outer.push(reason),
        },
        createElement("p", null, "Outer body"),
        inner
          ? createElement(
              Popover,
              {
                anchor: { x: 0, y: 0 },
                "aria-label": "Menu",
                onDismiss: (reason) => menu.push(reason),
              },
              createElement("button", { type: "button" }, "Menu row"),
            )
          : null,
      );
    act(() => root.render(tree()));
    return { outer, menu };
  }

  const inside = (label: string): Element => {
    const surface = document.body.querySelector(`[aria-label="${label}"]`);
    if (!surface) throw new Error(`no ${label} surface`);
    return surface.firstElementChild ?? surface;
  };
  const pointerDown = (target: Element) =>
    act(() => {
      target.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    });
  const escape = () =>
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });

  it("keeps the popover open for a click in the menu above it", () => {
    const { outer, menu } = renderStack(true);
    pointerDown(inside("Menu"));
    expect(outer).toEqual([]);
    expect(menu).toEqual([]);
  });

  it("closes only the menu for a click in the popover below", () => {
    const { outer, menu } = renderStack(true);
    pointerDown(inside("Outer"));
    expect(outer).toEqual([]);
    expect(menu).toEqual(["outside"]);
  });

  it("closes both for a click outside everything", () => {
    const { outer, menu } = renderStack(true);
    pointerDown(document.body);
    expect(outer).toEqual(["outside"]);
    expect(menu).toEqual(["outside"]);
  });

  it("gives Escape to the topmost layer only", () => {
    const { outer, menu } = renderStack(true);
    escape();
    expect(menu).toEqual(["escape"]);
    expect(outer).toEqual([]);
  });

  it("still closes a lone popover on Escape", () => {
    const { outer } = renderStack(false);
    escape();
    expect(outer).toEqual(["escape"]);
  });
});

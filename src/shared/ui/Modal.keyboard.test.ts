// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { ModalPanel } from "./Modal";

it("leaves Escape available to embedded terminals while keeping the close button", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const element = document.createElement("div");
  document.body.append(element);
  const root = createRoot(element);
  const onClose = vi.fn();
  try {
    act(() =>
      root.render(
        createElement(ModalPanel, {
          title: "Terminal",
          onClose,
          closeOnEscape: false,
          children: "Native menus",
        }),
      ),
    );
    const escape = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    act(() => element.dispatchEvent(escape));
    expect(escape.defaultPrevented).toBe(false);
    expect(onClose).not.toHaveBeenCalled();
    act(() =>
      element.querySelector<HTMLButtonElement>('[aria-label="Close"]')!.click(),
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  } finally {
    act(() => root.unmount());
    element.remove();
    vi.unstubAllGlobals();
  }
});

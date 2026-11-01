// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PointerEvent as ReactPointerEvent } from "react";
import { startZenChatDrag } from "./zenChatDrag";

function press(x: number, y: number): ReactPointerEvent<HTMLElement> {
  const handle = document.createElement("button");
  handle.setPointerCapture = () => {};
  handle.releasePointerCapture = () => {};
  return {
    button: 0,
    pointerId: 1,
    clientX: x,
    clientY: y,
    currentTarget: handle,
  } as unknown as ReactPointerEvent<HTMLElement>;
}

function pointer(type: string, x: number, y: number): void {
  const event = new MouseEvent(type, { clientX: x, clientY: y });
  window.dispatchEvent(event);
}

/** Every point is over the drop area when `over` is true. */
function dropAreaEverywhere(over: boolean): void {
  const area = document.createElement("div");
  if (over) area.setAttribute("data-zen-drop-below", "");
  document.elementFromPoint = () => area;
}

afterEach(() => vi.restoreAllMocks());

describe("Zen chat drag (L-230)", () => {
  it("drops the chat when released over the lower half", () => {
    dropAreaEverywhere(true);
    const onDrop = vi.fn();
    startZenChatDrag(press(10, 10), "s1", "Chat", onDrop);
    pointer("pointermove", 10, 40);
    pointer("pointerup", 10, 40);
    expect(onDrop).toHaveBeenCalledWith("s1");
  });

  it("a short press stays a click", () => {
    dropAreaEverywhere(true);
    const onDrop = vi.fn();
    startZenChatDrag(press(10, 10), "s1", "Chat", onDrop);
    pointer("pointermove", 12, 11);
    pointer("pointerup", 12, 11);
    expect(onDrop).not.toHaveBeenCalled();
  });

  it("ignores a release outside the drop area", () => {
    dropAreaEverywhere(false);
    const onDrop = vi.fn();
    startZenChatDrag(press(10, 10), "s1", "Chat", onDrop);
    pointer("pointermove", 10, 40);
    pointer("pointerup", 10, 40);
    expect(onDrop).not.toHaveBeenCalled();
  });

  it("Escape cancels the drag", () => {
    dropAreaEverywhere(true);
    const onDrop = vi.fn();
    startZenChatDrag(press(10, 10), "s1", "Chat", onDrop);
    pointer("pointermove", 10, 40);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    pointer("pointerup", 10, 40);
    expect(onDrop).not.toHaveBeenCalled();
  });
});

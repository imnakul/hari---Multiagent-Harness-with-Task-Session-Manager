// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PointerEvent as ReactPointerEvent } from "react";
import { startZenChatDrag, zenDropZone } from "./zenChatDrag";

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

/** Every point is over chat "a"'s pane, 100×100 at the origin, when `over` is true. */
function paneEverywhere(over: boolean): void {
  const pane = document.createElement("section");
  if (over) pane.setAttribute("data-zen-drop-pane", "a");
  pane.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 100, height: 100 }) as DOMRect;
  document.elementFromPoint = () => pane;
}

const fitsBoth = (): boolean => true;

afterEach(() => vi.restoreAllMocks());

describe("Zen chat drag (L-230)", () => {
  it("drops the chat below when released over the lower half", () => {
    paneEverywhere(true);
    const onDrop = vi.fn();
    startZenChatDrag(press(10, 10), "s1", "Chat", fitsBoth, onDrop);
    pointer("pointermove", 20, 80);
    pointer("pointerup", 20, 80);
    expect(onDrop).toHaveBeenCalledWith({ pane: "a", where: "below" });
  });

  it("drops the chat beside when released over the right half", () => {
    paneEverywhere(true);
    const onDrop = vi.fn();
    startZenChatDrag(press(10, 10), "s1", "Chat", fitsBoth, onDrop);
    pointer("pointermove", 80, 20);
    pointer("pointerup", 80, 20);
    expect(onDrop).toHaveBeenCalledWith({ pane: "a", where: "beside" });
  });

  it("ignores a spot where the chat does not fit", () => {
    paneEverywhere(true);
    const onDrop = vi.fn();
    const belowOnly = (_pane: string, where: string): boolean =>
      where === "below";
    startZenChatDrag(press(10, 10), "s1", "Chat", belowOnly, onDrop);
    pointer("pointermove", 80, 20);
    pointer("pointerup", 80, 20);
    expect(onDrop).not.toHaveBeenCalled();
  });

  it("a short press stays a click", () => {
    paneEverywhere(true);
    const onDrop = vi.fn();
    startZenChatDrag(press(10, 10), "s1", "Chat", fitsBoth, onDrop);
    pointer("pointermove", 12, 11);
    pointer("pointerup", 12, 11);
    expect(onDrop).not.toHaveBeenCalled();
  });

  it("ignores a release outside a chat", () => {
    paneEverywhere(false);
    const onDrop = vi.fn();
    startZenChatDrag(press(10, 10), "s1", "Chat", fitsBoth, onDrop);
    pointer("pointermove", 10, 80);
    pointer("pointerup", 10, 80);
    expect(onDrop).not.toHaveBeenCalled();
  });

  it("Escape cancels the drag", () => {
    paneEverywhere(true);
    const onDrop = vi.fn();
    startZenChatDrag(press(10, 10), "s1", "Chat", fitsBoth, onDrop);
    pointer("pointermove", 10, 80);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    pointer("pointerup", 10, 80);
    expect(onDrop).not.toHaveBeenCalled();
  });
});

describe("Zen drop zones (L-230)", () => {
  const rect = { left: 0, top: 0, width: 100, height: 200 };

  it("the right half is beside, the lower half below", () => {
    expect(zenDropZone(rect, 80, 20, true, true)).toBe("beside");
    expect(zenDropZone(rect, 20, 180, true, true)).toBe("below");
    expect(zenDropZone(rect, 20, 20, true, true)).toBeNull();
  });

  it("in the lower right the nearer edge wins", () => {
    expect(zenDropZone(rect, 95, 120, true, true)).toBe("beside");
    expect(zenDropZone(rect, 60, 190, true, true)).toBe("below");
  });

  it("a spot that does not fit gives way to the other", () => {
    expect(zenDropZone(rect, 95, 120, false, true)).toBe("below");
    expect(zenDropZone(rect, 60, 190, true, false)).toBe("beside");
    expect(zenDropZone(rect, 80, 20, false, true)).toBeNull();
  });
});

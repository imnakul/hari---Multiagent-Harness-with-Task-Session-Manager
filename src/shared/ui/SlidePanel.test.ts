// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SlidePanel } from "./SlidePanel";

// Fork (L-376): the Share panel folds down out of the top bar and back up,
// staying where it rests (no slide from the right) while its slot makes room.

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const render = (open: boolean, onGone: () => void) =>
  act(() =>
    root.render(
      createElement(
        SlidePanel,
        { open, appear: true, motion: "fold", onGone },
        createElement("aside", { "aria-label": "Panel" }),
      ),
    ),
  );

it("folds down from the top, pinned in place, then rests with no inline motion", () => {
  render(true, vi.fn());
  const panel = container.querySelector("aside")!;
  const slot = container.firstElementChild as HTMLElement;
  expect(panel.style.transformOrigin).toBe("top center");
  expect(panel.style.transform).not.toContain("translate");
  expect(panel.style.opacity).toBe("1");
  expect(panel.style.position).toBe("absolute");
  expect(panel.style.right).toBe("0px");
  // It folds down over the chat first: the slot makes no room yet, so nothing moves sideways.
  expect(slot.style.width).toBe("0px");
  expect(slot.style.transition).toBe("none");
  expect(slot.style.overflow).toBe("visible");
  // Once unfolded, the slot widens underneath it so the chat narrows smoothly.
  act(() => vi.advanceTimersByTime(300));
  expect(slot.style.transition).toContain("width");
  expect(panel.style.position).toBe("absolute");
  act(() => vi.runAllTimers());
  expect(panel.style.transform).toBe("");
  expect(panel.style.position).toBe("");
  expect(slot.style.width).toBe("");
});

it("folds back up, then reports it is gone", async () => {
  const onGone = vi.fn();
  render(true, onGone);
  act(() => vi.runAllTimers());
  render(false, onGone);
  await act(async () => {
    await Promise.resolve();
  });
  const panel = container.querySelector("aside")!;
  const slot = container.firstElementChild as HTMLElement;
  expect(panel.style.position).toBe("absolute");
  expect(slot.style.width).toBe("0px");
  // With no room held (happy-dom lays nothing out) it folds up at once; a docked
  // panel with room first lets the chat widen back underneath it.
  expect(panel.style.transformOrigin).toBe("top center");
  expect(panel.style.transform).not.toContain("translate");
  expect(panel.style.opacity).toBe("0");
  expect(onGone).not.toHaveBeenCalled();
  act(() => vi.runAllTimers());
  expect(onGone).toHaveBeenCalledOnce();
});

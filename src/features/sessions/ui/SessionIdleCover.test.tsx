// @vitest-environment happy-dom
import { act, createElement, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useIdleCover, type IdleCoverState } from "./SessionIdleCover";

let root: Root | undefined;
let container: HTMLDivElement;
let state: IdleCoverState;

function Probe({ idleMs, enabled }: { idleMs: number | null; enabled: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  state = useIdleCover(ref, idleMs, enabled);
  return createElement("div", { ref, "data-testid": "pane" });
}

function render(idleMs: number | null, enabled = true): HTMLElement {
  act(() => {
    root ??= createRoot(container);
    root.render(createElement(Probe, { idleMs, enabled }));
  });
  return container.querySelector<HTMLElement>("[data-testid=pane]")!;
}

function fire(element: HTMLElement, type: string): void {
  act(() => {
    element.dispatchEvent(new Event(type, { bubbles: true }));
  });
}

function wait(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  container = document.createElement("div");
  document.body.append(container);
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useIdleCover (L-185)", () => {
  it("covers once the pane has been idle for the wait", () => {
    render(10_000);
    wait(5_000);
    expect(state.covered).toBe(false);
    wait(5_000);
    expect(state).toEqual({ covered: true, peeking: false });
  });

  it("peeks while the pointer moves over a covered pane, until it leaves", () => {
    const pane = render(10_000);
    wait(10_000);
    fire(pane, "pointermove");
    expect(state).toEqual({ covered: true, peeking: true });
    fire(pane, "pointerleave");
    expect(state).toEqual({ covered: true, peeking: false });
  });

  it("uncovers on a click or key and waits the full time again", () => {
    const pane = render(10_000);
    wait(10_000);
    fire(pane, "pointerdown");
    expect(state.covered).toBe(false);
    wait(5_000);
    expect(state.covered).toBe(false);
    wait(5_000);
    expect(state.covered).toBe(true);
    fire(pane, "keydown");
    expect(state.covered).toBe(false);
  });

  it("counts pointer movement on an uncovered pane as activity", () => {
    const pane = render(10_000);
    wait(5_000);
    fire(pane, "pointermove");
    wait(5_000);
    expect(state.covered).toBe(false);
    wait(5_000);
    expect(state.covered).toBe(true);
  });

  it("never covers when off or not eligible, and uncovers when it stops being eligible", () => {
    render(null);
    wait(60_000);
    expect(state.covered).toBe(false);
    render(10_000, false);
    wait(60_000);
    expect(state.covered).toBe(false);
    render(10_000, true);
    wait(10_000);
    expect(state.covered).toBe(true);
    render(10_000, false);
    expect(state.covered).toBe(false);
  });
});

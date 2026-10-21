// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  focusDropFromPoint,
  setFocusSessionDropOver,
  useFocusSessionDropOver,
} from "./focusSessionDrop";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  setFocusSessionDropOver(false);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("focusSessionDrop (L-153)", () => {
  it("finds the Focus drop area under the point", () => {
    const area = document.createElement("main");
    area.setAttribute("data-focus-drop-area", "");
    const inner = document.createElement("span");
    area.append(inner);
    const spy = vi.spyOn(document, "elementFromPoint").mockReturnValue(inner);
    expect(focusDropFromPoint(1, 1)).toBe(true);
    spy.mockReturnValue(container);
    expect(focusDropFromPoint(1, 1)).toBe(false);
  });

  it("tells subscribers while a session is held over Focus", () => {
    function Probe() {
      return createElement("p", null, String(useFocusSessionDropOver()));
    }
    act(() => root.render(createElement(Probe)));
    expect(container.textContent).toBe("false");
    act(() => setFocusSessionDropOver(true));
    expect(container.textContent).toBe("true");
    act(() => setFocusSessionDropOver(false));
    expect(container.textContent).toBe("false");
  });
});

// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { newDefaultSession } from "../../sessions/model/session";
import { FocusView } from "./FocusView";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `asset://${path}`,
  invoke: vi.fn(),
}));
vi.mock("../../../app/shell/WindowControls", () => ({
  WindowControls: () => null,
}));

const SESSIONS = [
  { ...newDefaultSession("C:/work/alpha"), id: "a1", title: "Alpha one" },
  { ...newDefaultSession("C:/work/beta"), id: "b1", title: "Beta one" },
];

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal("requestAnimationFrame", (run: FrameRequestCallback) => {
    run(0);
    return 1;
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
    DOMRect.fromRect({ x: 0, y: 0, width: 1000, height: 600 }),
  );
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(480);
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(560);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1000);
  HTMLElement.prototype.setPointerCapture = () => {};
  HTMLElement.prototype.hasPointerCapture = () => false;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const noop = () => {};
  act(() =>
    root.render(
      createElement(FocusView, {
        grid: { columns: [["a1"], ["b1"]], overflow: [] },
        sessions: SESSIONS,
        boardCards: [],
        recents: [],
        focusedId: "a1",
        renderPane: (s) => createElement("p", { "data-pane-body": s.id }),
        onGridChange: noop,
        onFocusPane: noop,
        onClosePane: noop,
        onClosePanes: noop,
        onColumnCapChange: noop,
        onExit: noop,
        onNewChat: noop,
        onStartNew: noop,
        onOpenChat: noop,
      }),
    ),
  );
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const bodies = () =>
  [...host.querySelectorAll<HTMLElement>("[data-focus-pane-body]")];
const pointer = (type: string, clientX: number) =>
  new PointerEvent(type, { bubbles: true, button: 0, pointerId: 1, clientX });

describe("FocusView resize keeps transcripts still (L-156)", () => {
  it("holds each pane body at its starting size until the drag ends", () => {
    const sash = host.querySelector<HTMLElement>('[role="separator"]');
    if (!sash) throw new Error("no separator");
    expect(bodies().every((body) => body.style.width === "")).toBe(true);

    act(() => {
      sash.dispatchEvent(pointer("pointerdown", 500));
      sash.dispatchEvent(pointer("pointermove", 400));
    });
    expect(bodies()).toHaveLength(2);
    for (const body of bodies()) {
      expect(body.style.width).toBe("480px");
      expect(body.style.height).toBe("560px");
      expect(body.style.contain).toBe("layout paint");
    }
    // The pane boxes still follow the pointer.
    const first = host.querySelector<HTMLElement>('[data-focus-pane="a1"]');
    expect(first?.style.width).toBe("calc(40% - 6px)");

    act(() => sash.dispatchEvent(pointer("pointerup", 400)));
    expect(bodies().every((body) => body.style.width === "")).toBe(true);
    expect(first?.style.width).toBe("calc(40% - 6px)");
  });

  it("releases the bodies when Escape cancels the drag", () => {
    const sash = host.querySelector<HTMLElement>('[role="separator"]');
    if (!sash) throw new Error("no separator");
    act(() => {
      sash.dispatchEvent(pointer("pointerdown", 500));
      sash.dispatchEvent(pointer("pointermove", 300));
    });
    expect(bodies()[0].style.width).toBe("480px");
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(bodies().every((body) => body.style.width === "")).toBe(true);
  });
});

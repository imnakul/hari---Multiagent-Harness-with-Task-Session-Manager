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
  localStorage.clear();
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

const pane = (id: string) =>
  host.querySelector<HTMLElement>(`[data-focus-pane="${id}"]`);
const pointer = (type: string, clientX: number) =>
  new PointerEvent(type, { bubbles: true, button: 0, pointerId: 1, clientX });

describe("FocusView resize reflows live (L-176)", () => {
  it("moves the panes on every frame and keeps the release", () => {
    const sash = host.querySelector<HTMLElement>('[role="separator"]');
    if (!sash) throw new Error("no separator");
    expect(pane("a1")?.style.width).toBe("calc(50% - 6px)");

    act(() => {
      sash.dispatchEvent(pointer("pointerdown", 500));
      sash.dispatchEvent(pointer("pointermove", 400));
    });
    // Pane bodies are never frozen, so their text re-wraps as the edge moves.
    const bodies = [
      ...host.querySelectorAll<HTMLElement>("[data-focus-pane-body]"),
    ];
    expect(bodies).toHaveLength(2);
    expect(bodies.every((body) => body.style.width === "")).toBe(true);
    expect(pane("a1")?.style.width).toBe("calc(40% - 6px)");
    expect(pane("b1")?.style.left).toBe("calc(40% + 3px)");
    expect(sash.style.left).toBe("calc(40% - 3px)");
    expect(sash.getAttribute("aria-valuenow")).toBe("40");
    expect(host.querySelector("[data-focus-resizing]")).not.toBeNull();

    act(() => sash.dispatchEvent(pointer("pointerup", 400)));
    expect(pane("a1")?.style.width).toBe("calc(40% - 6px)");
    expect(host.querySelector("[data-focus-resizing]")).toBeNull();
  });

  it("puts the saved layout back when Escape cancels the drag", () => {
    const sash = host.querySelector<HTMLElement>('[role="separator"]');
    if (!sash) throw new Error("no separator");
    act(() => {
      sash.dispatchEvent(pointer("pointerdown", 500));
      sash.dispatchEvent(pointer("pointermove", 300));
    });
    expect(pane("a1")?.style.width).toBe("calc(30% - 6px)");
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(pane("a1")?.style.width).toBe("calc(50% - 6px)");
    expect(sash.style.left).toBe("calc(50% - 3px)");
    expect(host.querySelector("[data-focus-resizing]")).toBeNull();
  });
});

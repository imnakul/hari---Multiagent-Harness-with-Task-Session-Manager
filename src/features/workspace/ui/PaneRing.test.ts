// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PaneStatus } from "../../sessions/model/paneStatus";
import type { ActivePaneStyle } from "../../settings/model/settings";
import { PaneFocusRing, PaneStatusEdge, paneDimAttribute } from "./PaneRing";

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function ring(
  paneId: string,
  status: PaneStatus,
  paneStyle: ActivePaneStyle = "status",
): Promise<HTMLElement> {
  await act(async () =>
    root.render(
      createElement(PaneFocusRing, {
        ringAttribute: "data-pane-ring",
        paneId,
        paneStyle,
        status,
      }),
    ),
  );
  return container.querySelector<HTMLElement>("[data-pane-ring]")!;
}

describe("PaneFocusRing", () => {
  it("keeps the original ring for the static style", async () => {
    const element = await ring("a", "working", "static");
    expect(element.classList.contains("focus-ring")).toBe(true);
    expect(element.dataset.paneStatus).toBeUndefined();
    expect(element.querySelector(".pane-ring-edge")).toBeNull();
  });

  it("colours the status ring by state", async () => {
    for (const status of ["working", "attention", "error", "done", "idle"] as const) {
      const element = await ring("a", status);
      expect(element.dataset.paneStatus).toBe(status);
      expect(element.querySelector(".pane-ring-edge")).not.toBeNull();
    }
  });

  it("pulses once when a turn finishes", async () => {
    await ring("a", "working");
    const element = await ring("a", "done");
    expect(element.dataset.paneStatus).toBe("done");
    expect(element.dataset.paneFlash).toBe("");
    await act(async () => vi.advanceTimersByTime(1_700));
    expect(element.dataset.paneFlash).toBeUndefined();
  });

  it("does not pulse when focus moves from a working pane to a done one", async () => {
    await ring("a", "working");
    const element = await ring("b", "done");
    expect(element.dataset.paneFlash).toBeUndefined();
  });
});

describe("PaneStatusEdge", () => {
  async function edge(status: PaneStatus, hidden = false): Promise<HTMLElement | null> {
    await act(async () =>
      root.render(createElement(PaneStatusEdge, { paneId: "a", status, hidden })),
    );
    return container.querySelector<HTMLElement>(".pane-status-edge");
  }

  it("draws nothing where nothing ran, or for the focused pane", async () => {
    expect(await edge("idle")).toBeNull();
    expect(await edge("attention", true)).toBeNull();
  });

  it("shows waiting, failed and done panes, and pulses on finishing", async () => {
    expect((await edge("attention"))?.dataset.paneStatus).toBe("attention");
    expect((await edge("error"))?.dataset.paneStatus).toBe("error");
    await edge("working");
    const done = await edge("done");
    expect(done?.dataset.paneStatus).toBe("done");
    expect(done?.dataset.paneFlash).toBe("");
  });
});

describe("paneDimAttribute", () => {
  it("dims only unfocused panes among several", () => {
    expect(paneDimAttribute("subtle", false, true)).toBe("subtle");
    expect(paneDimAttribute("strong", true, true)).toBeUndefined();
    expect(paneDimAttribute("strong", false, false)).toBeUndefined();
    expect(paneDimAttribute("off", false, true)).toBeUndefined();
  });
});

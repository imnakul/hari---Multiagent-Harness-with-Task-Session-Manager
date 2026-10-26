// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PaneStatus } from "../../sessions/model/paneStatus";
import type { ActivePaneStyle } from "../../settings/model/settings";
import { PaneFocusRing, paneDimAttribute } from "./PaneRing";

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

describe("paneDimAttribute", () => {
  it("dims only unfocused panes among several", () => {
    expect(paneDimAttribute("subtle", false, true)).toBe("subtle");
    expect(paneDimAttribute("strong", true, true)).toBeUndefined();
    expect(paneDimAttribute("strong", false, false)).toBeUndefined();
    expect(paneDimAttribute("off", false, true)).toBeUndefined();
  });
});

describe("focus ring glide CSS", () => {
  // Top-level rules only: the reduced-motion `transition: none` is intended.
  function topLevelRules(css: string): { selector: string; body: string }[] {
    const rules: { selector: string; body: string }[] = [];
    let depth = 0;
    let start = 0;
    let selector = "";
    for (let index = 0; index < css.length; index += 1) {
      if (css[index] === "{") {
        if (depth === 0) {
          selector = css.slice(start, index).replace(/\/\*[\s\S]*?\*\//g, "").trim();
          start = index + 1;
        }
        depth += 1;
      } else if (css[index] === "}") {
        depth -= 1;
        if (depth === 0) {
          rules.push({ selector, body: css.slice(start, index) });
          start = index + 1;
        }
      }
    }
    return rules;
  }

  it("lets no other ring rule replace the glide transition", () => {
    const rules = topLevelRules(readFileSync("src/styles/index.css", "utf8"));
    const glide = rules.filter((rule) =>
      /^\.(pane|focus)-ring-glide$/.test(rule.selector),
    );
    expect(glide).toHaveLength(2);
    for (const rule of glide) {
      expect(rule.body).toMatch(/transition-property:\s*left, top, width, height/);
    }
    const overriding = rules.filter(
      (rule) =>
        /\.(pane|focus)-ring\b/.test(rule.selector) &&
        !/resizing/.test(rule.selector) &&
        !/-glide$/.test(rule.selector) &&
        /(^|[\s;])transition(-property)?\s*:/.test(rule.body),
    );
    expect(overriding.map((rule) => rule.selector)).toEqual([]);
  });

  it("keeps the static ring's glow inside the focused pane", () => {
    const rules = topLevelRules(readFileSync("src/styles/index.css", "utf8"));
    const staticRing = rules.find((rule) => rule.selector === ".focus-ring");
    const shadow = /box-shadow:([^;]*);/.exec(staticRing?.body ?? "")?.[1] ?? "";
    const layers = shadow.split(/,\s*(?=inset|\d)/).map((layer) => layer.trim());
    expect(layers.length).toBeGreaterThan(0);
    for (const layer of layers) expect(layer.startsWith("inset")).toBe(true);
  });

  it("draws no status edge on unfocused panes", () => {
    const css = readFileSync("src/styles/index.css", "utf8");
    expect(css).not.toMatch(/\.pane-status-edge/);
  });
});

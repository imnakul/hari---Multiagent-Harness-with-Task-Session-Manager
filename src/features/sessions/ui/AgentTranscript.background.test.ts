// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Block } from "../model/session";
import { AgentTranscript } from "./AgentTranscript";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe(): void {}
      disconnect(): void {}
    },
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const blocks: Block[] = [
  { id: "u", role: "user", text: "Release it" },
  { id: "a", role: "assistant", text: "Watching the release run." },
];

function line(): HTMLElement | null {
  return container.querySelector<HTMLElement>("[data-idle-background]");
}

describe("AgentTranscript idle background tasks (L-265)", () => {
  it("says what is still running after the reply finished", () => {
    act(() =>
      root.render(
        createElement(AgentTranscript, {
          blocks,
          busy: false,
          backgroundTasks: ["Wait for release run"],
        }),
      ),
    );
    expect(line()?.textContent).toContain("1 task running in background");
    expect(line()?.textContent).toContain("Wait for release run");
  });

  it("stays hidden with nothing running or while the turn is live", () => {
    act(() =>
      root.render(createElement(AgentTranscript, { blocks, busy: false })),
    );
    expect(line()).toBeNull();
    act(() =>
      root.render(
        createElement(AgentTranscript, {
          blocks,
          busy: true,
          backgroundTasks: ["npm run dev"],
        }),
      ),
    );
    expect(line()).toBeNull();
  });
});

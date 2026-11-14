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

const COMMAND =
  "cd /e/Developing/OpenSource/mono-clone && npx vitest run src/features/sessions/ui/AgentTranscript.toolWrap.test.ts";

const blocks: Block[] = [
  { id: "u", role: "user", text: "Run the tests" },
  {
    id: "t",
    role: "tool",
    text: COMMAND,
    tool: { kind: "shell", status: "in_progress" },
  },
];

function commandText(): HTMLButtonElement | undefined {
  return [
    ...container.querySelectorAll<HTMLButtonElement>("button[aria-expanded]"),
  ].find((button) => button.textContent?.includes("npx vitest run"));
}

describe("AgentTranscript tool command wrapping (L-267)", () => {
  it("shows a command on one line and unfolds it in full on click", () => {
    act(() =>
      root.render(createElement(AgentTranscript, { blocks, busy: true })),
    );
    const button = commandText();
    expect(button).toBeDefined();
    expect(button?.className).toContain("truncate");
    expect(button?.getAttribute("aria-expanded")).toBe("false");
    expect(button?.title).toContain("npx vitest run");

    act(() => button?.click());
    expect(button?.getAttribute("aria-expanded")).toBe("true");
    expect(button?.className).not.toContain("truncate");
    expect(button?.className).toContain("whitespace-pre-wrap");

    act(() => button?.click());
    expect(button?.className).toContain("truncate");
  });
});

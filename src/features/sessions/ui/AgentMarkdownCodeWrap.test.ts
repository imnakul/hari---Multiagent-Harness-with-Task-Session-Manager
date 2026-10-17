// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AgentMarkdown } from "./AgentMarkdown";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  convertFileSrc: (path: string) => path,
}));

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("wraps code fences by default and lets each block switch wrapping off and back", async () => {
  await act(async () =>
    root.render(
      createElement(AgentMarkdown, {
        text: "```text\none very long line\n```\n\n```text\nsecond block\n```",
      }),
    ),
  );
  const toggles = [
    ...container.querySelectorAll<HTMLButtonElement>(
      'button[aria-label="Wrap lines"]',
    ),
  ];
  expect(toggles).toHaveLength(2);
  const wrapped = (index: number): boolean =>
    container
      .querySelectorAll(".markdown-code-shell pre")
      [index]!.className.includes("!whitespace-pre-wrap");
  expect(toggles.map((t) => t.getAttribute("aria-pressed"))).toEqual([
    "true",
    "true",
  ]);
  expect([wrapped(0), wrapped(1)]).toEqual([true, true]);
  await act(async () => toggles[0]!.click());
  expect(toggles[0]!.getAttribute("aria-pressed")).toBe("false");
  // Only the clicked block stops wrapping; its lines keep the vendor scroll layout.
  expect([wrapped(0), wrapped(1)]).toEqual([false, true]);
  expect(
    container
      .querySelector(".markdown-code-shell pre span")!
      .className.includes("!whitespace-pre-wrap"),
  ).toBe(false);
  await act(async () => toggles[0]!.click());
  expect(wrapped(0)).toBe(true);
});

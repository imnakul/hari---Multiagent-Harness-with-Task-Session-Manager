// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AgentMarkdown } from "./AgentMarkdown";
import { saveCodeWrap } from "../../settings/model/displayPrefs";

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
  localStorage.removeItem("monocode.codeWrap");
  container.remove();
  vi.unstubAllGlobals();
});

it("wraps code fences by default and follows the Wrap code chat setting (L-197)", async () => {
  await act(async () =>
    root.render(
      createElement(AgentMarkdown, {
        text: "```text\none very long line\n```\n\n```text\nsecond block\n```",
      }),
    ),
  );
  // No per-block toggle any more; the setting lives in Settings → Chat.
  expect(container.querySelector('button[aria-label="Wrap lines"]')).toBeNull();
  const wrapped = (index: number): boolean =>
    container
      .querySelectorAll(".markdown-code-shell pre")
      [index]!.className.includes("!whitespace-pre-wrap");
  expect([wrapped(0), wrapped(1)]).toEqual([true, true]);
  expect(
    container.querySelector(".markdown-code-shell pre code > span")!.className,
  ).toContain("markdown-code-wrapped");
  await act(async () => saveCodeWrap(false));
  // Every block stops wrapping; lines keep the vendor scroll layout.
  expect([wrapped(0), wrapped(1)]).toEqual([false, false]);
  expect(
    container
      .querySelector(".markdown-code-shell pre span")!
      .className.includes("!whitespace-pre-wrap"),
  ).toBe(false);
  await act(async () => saveCodeWrap(true));
  expect(wrapped(0)).toBe(true);
});

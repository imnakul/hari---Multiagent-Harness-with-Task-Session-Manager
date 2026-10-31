// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentMarkdown } from "./AgentMarkdown";

const copy = vi.hoisted(() =>
  vi.fn(async (_text: string, _html: string) => {}),
);
vi.mock("../../../platform/tauri/clipboard", async (original) => ({
  ...(await original<typeof import("../../../platform/tauri/clipboard")>()),
  copyFormattedText: copy,
}));

let container: HTMLDivElement;
let root: Root;
const first = "| Item | Count |\n| --- | ---: |\n| First | 2 |";
const second = "| Other |\n| --- |\n| Second |";
function render(
  onSaveNote?: (text: string) => Promise<void>,
  streaming = false,
) {
  act(() =>
    root.render(
      createElement(AgentMarkdown, {
        text: `${first}\n\n${second}`,
        onSaveNote,
        streaming,
        // Test the controls on a painted table. Initial reveal pacing has its
        // own tests; the provider is still streaming throughout this fixture.
        revealOnMount: false,
      }),
    ),
  );
}
function action(index: number, label: string) {
  return container
    .querySelectorAll('[aria-label="Table actions"]')
    [index].querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!;
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  copy.mockClear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("table actions", () => {
  it("copies only the chosen table with Markdown and rich table formats", async () => {
    render();
    await act(async () => action(1, "Copy table").click());
    expect(copy).toHaveBeenCalledOnce();
    expect(copy.mock.calls[0][0]).toBe(second);
    expect(copy.mock.calls[0][1]).toContain("<table>");
    expect(copy.mock.calls[0][1]).not.toMatch(/First|Copy|data-streamdown/);
    // Icon-only: the result shows as a check, in the tooltip and to screen readers.
    expect(action(1, "Copy table").getAttribute("title")).toBe("Table copied");
    expect(action(1, "Copy table").textContent).toBe("");
    expect(container.textContent).toContain("Table copied");
  });

  it("saves the chosen Markdown table through the existing note callback", async () => {
    const save = vi.fn(async (_text: string) => {});
    render(save);
    await act(async () => action(0, "Add to notes").click());
    expect(save).toHaveBeenCalledWith(first);
    expect(action(0, "Add to notes").getAttribute("title")).toBe(
      "Table saved to Notes",
    );
    expect(container.textContent).toContain("Table saved to Notes");
  });

  it("surfaces a save failure and allows retry", async () => {
    const save = vi
      .fn(async (_text: string) => {})
      .mockRejectedValueOnce(new Error("disk full"));
    render(save);
    await act(async () => action(0, "Add to notes").click());
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "disk full",
    );
    await act(async () => action(0, "Add to notes").click());
    expect(save).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("does not offer note saving when notes are unavailable", () => {
    render();
    expect(
      container.querySelector('[aria-label="Add to notes"]'),
    ).toBeNull();
  });

  it("keeps unfinished streamed tables from being saved or copied", () => {
    render(
      vi.fn(async () => {}),
      true,
    );
    expect(action(0, "Copy table").disabled).toBe(true);
    expect(action(0, "Add to notes").disabled).toBe(true);
  });
});

describe("table actions layout", () => {
  it("shows icon-only Add to notes, Add Draft to Sessions and Copy, in that order", async () => {
    const compose = vi.fn();
    const { SessionManagerCaptureContext } = await import(
      "../../session-board/ui/SessionManagerCapture"
    );
    act(() =>
      root.render(
        createElement(
          SessionManagerCaptureContext.Provider,
          { value: compose },
          createElement(AgentMarkdown, {
            text: first,
            onSaveNote: async () => {},
          }),
        ),
      ),
    );
    const group = container.querySelector('[aria-label="Table actions"]')!;
    const buttons = [...group.querySelectorAll("button")];
    expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual([
      "Add to notes",
      "Add Draft to Sessions",
      "Copy table",
    ]);
    for (const button of buttons) expect(button.textContent).toBe("");
    await act(async () => buttons[1].click());
    // The table is read at click time, so the captured text is the Markdown.
    expect(compose).toHaveBeenCalledWith(first);
  });
});

describe("table column widths (L-197)", () => {
  it("shrinks columns whose cells are all short and keeps text columns readable", () => {
    act(() =>
      root.render(
        createElement(AgentMarkdown, {
          text: "| # | Notes |\n| --- | --- |\n| 1 | A longer sentence that needs room to read |",
          revealOnMount: false,
        }),
      ),
    );
    const cells = [...container.querySelectorAll("th, td")];
    expect(cells.map((cell) => cell.hasAttribute("data-narrow"))).toEqual([
      true,
      false,
      true,
      false,
    ]);
  });
});

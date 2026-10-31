// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentMarkdown } from "./AgentMarkdown";
import { MarkdownTableContext } from "./MarkdownTable";

const copy = vi.hoisted(() => vi.fn(async (_text: string) => {}));
vi.mock("../../../platform/tauri/clipboard", async (original) => ({
  ...(await original<typeof import("../../../platform/tauri/clipboard")>()),
  copyText: copy,
}));

let container: HTMLDivElement;
let root: Root;
const reply = [
  "Intro paragraph.",
  "",
  "> You can send this to the **backend** developer:",
  ">",
  "> ```json",
  '> { "status": "ok" }',
  "> ```",
  ">",
  "> - first",
  "> - second",
].join("\n");
const quoted = [
  "You can send this to the **backend** developer:",
  "",
  "```json",
  '{ "status": "ok" }',
  "```",
  "",
  "- first",
  "- second",
].join("\n");

function render(
  actions: {
    onSaveNote?: (text: string) => Promise<void>;
    onAddToTask?: (text: string, blockId?: string) => Promise<void>;
  } = {},
  streaming = false,
) {
  act(() =>
    root.render(
      createElement(
        "div",
        { "data-selectable-agent-response": "reply-1" },
        createElement(
          MarkdownTableContext.Provider,
          { value: { onAddToTask: actions.onAddToTask } },
          createElement(AgentMarkdown, {
            text: reply,
            onSaveNote: actions.onSaveNote,
            streaming,
            revealOnMount: false,
          }),
        ),
      ),
    ),
  );
}
function action(label: string) {
  return container
    .querySelector('[aria-label="Quote actions"]')
    ?.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`);
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

describe("quote actions (L-188)", () => {
  it("copies the quote's own Markdown without the > markers or controls", async () => {
    render();
    const quote = container.querySelector('[data-streamdown="blockquote"]');
    expect(quote?.querySelector('[aria-label="Quote actions"]')).not.toBeNull();
    // Floated ahead of the text so the first line leaves room for it.
    const bar = quote?.firstElementChild;
    expect(bar?.getAttribute("aria-label")).toBe("Quote actions");
    expect(bar?.className).toContain("float-right");
    await act(async () => action("Copy quote")!.click());
    expect(copy).toHaveBeenCalledWith(quoted);
    expect(action("Copy quote")!.title).toBe("Quote copied");
  });

  it("adds the quote to notes and to a task with its reply id", async () => {
    const onSaveNote = vi.fn(async (_text: string) => {});
    const onAddToTask = vi.fn(async (_text: string, _id?: string) => {});
    render({ onSaveNote, onAddToTask });
    await act(async () => action("Add to notes")!.click());
    expect(onSaveNote).toHaveBeenCalledWith(quoted);
    await act(async () => action("Add Task")!.click());
    expect(onAddToTask).toHaveBeenCalledWith(quoted, "reply-1");
  });

  it("hides Notes and Task without handlers and waits while streaming", async () => {
    render({}, true);
    expect(action("Add to notes")).toBeNull();
    expect(action("Add Task")).toBeNull();
    const button = action("Copy quote")!;
    expect(button.title).toBe("Wait for the response to finish");
    expect(button.disabled).toBe(true);
  });

  it("shows an error when saving fails", async () => {
    render({
      onSaveNote: async () => {
        throw new Error("Disk full");
      },
    });
    await act(async () => action("Add to notes")!.click());
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "Could not save quote to Notes. Disk full",
    );
  });
});

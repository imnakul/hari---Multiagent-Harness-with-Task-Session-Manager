// @vitest-environment happy-dom
import { EditorView } from "@codemirror/view";
import { act, createElement, useRef, useState, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { MarkdownCaretTarget } from "./markdownCaret";
import { MarkdownEditorPanel } from "./MarkdownEditorPanel";
import type { MarkdownViewMode } from "./MarkdownModeToggle";
import { IS_MAC } from "../../../platform/tauri/platform";

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

const BODY = "# Title\n\nHello world";

let root: Root;
let container: HTMLDivElement;
let modes: MarkdownViewMode[];

function Harness(): ReactElement {
  const [mode, setMode] = useState<MarkdownViewMode>("preview");
  const [value, setValue] = useState(BODY);
  const caret = useRef<MarkdownCaretTarget | null>(null);
  modes.push(mode);
  return createElement(MarkdownEditorPanel, {
    mode,
    onModeChange: setMode,
    value,
    onChange: setValue,
    caretRef: caret,
    label: "Body",
    preview: createElement(
      "div",
      null,
      createElement("h1", null, "Title"),
      createElement("p", null, "Hello world"),
    ),
    emptyPreview: null,
  });
}

async function liveView(): Promise<EditorView> {
  await vi.waitFor(async () => {
    await act(async () => {
      await vi.dynamicImportSettled();
    });
    expect(container.querySelector(".cm-editor")).not.toBeNull();
  });
  return EditorView.findFromDOM(container.querySelector<HTMLElement>(".cm-editor")!)!;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  modes = [];
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("opens Live at the double-clicked paragraph", async () => {
  await act(async () => root.render(createElement(Harness)));
  const paragraph = container.querySelector("p")!;
  await act(async () => {
    paragraph.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, button: 0 }));
  });
  expect(modes.at(-1)).toBe("live");
  const view = await liveView();
  expect(view.state.doc.toString()).toBe(BODY);
  // "Hello world" starts line 3, at offset 9.
  await vi.waitFor(() => expect(view.state.selection.main.head).toBe(9));
});

it("ignores double-clicks on links in the preview", async () => {
  await act(async () => root.render(createElement(Harness)));
  const link = document.createElement("a");
  link.textContent = "docs";
  container.querySelector("p")!.append(link);
  await act(async () => {
    link.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, button: 0 }));
  });
  expect(modes.at(-1)).toBe("preview");
});

it("toggles Live and Preview with Ctrl+E", async () => {
  await act(async () => root.render(createElement(Harness)));
  const press = async (target: Element): Promise<void> => {
    await act(async () => {
      target.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "e",
          ctrlKey: !IS_MAC,
          metaKey: IS_MAC,
          bubbles: true,
        }),
      );
    });
  };
  await press(container.querySelector("p")!);
  expect(modes.at(-1)).toBe("live");
  const view = await liveView();
  await press(view.contentDOM);
  expect(modes.at(-1)).toBe("preview");
});

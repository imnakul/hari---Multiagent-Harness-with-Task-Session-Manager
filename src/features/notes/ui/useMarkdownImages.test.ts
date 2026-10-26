// @vitest-environment happy-dom
import { act, createElement, useCallback, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  InsertImageButton,
  pastedImages,
  useMarkdownImages,
} from "./useMarkdownImages";
import {
  textareaCaretTarget,
  type MarkdownCaretTarget,
} from "../../sessions/ui/markdownCaret";

const save = vi.hoisted(() => vi.fn());
vi.mock("../noteImages", async (original) => ({
  ...(await original<typeof import("../noteImages")>()),
  saveNoteImagesFromFiles: save,
}));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ onDragDropEvent: async () => () => {} }),
}));

let root: Root;
let container: HTMLDivElement;
let errors: (string | null)[];

function Editor() {
  const [value, setValue] = useState("Before\n\nAfter");
  const caret = useRef<MarkdownCaretTarget | null>(null);
  const field = useCallback((element: HTMLTextAreaElement | null) => {
    caret.current = element ? textareaCaretTarget(element) : null;
  }, []);
  const valueRef = useRef(value);
  valueRef.current = value;
  const images = useMarkdownImages({
    ownerId: "task-1",
    caretRef: caret,
    getValue: () => valueRef.current,
    onInsert: setValue,
    onError: (message) => errors.push(message),
  });
  return createElement(
    "div",
    { ref: images.dropZoneRef, ...images.dropZoneProps },
    createElement(InsertImageButton, { images }),
    createElement("textarea", {
      ref: field,
      value,
      onChange: (event: { target: HTMLTextAreaElement }) =>
        setValue(event.target.value),
    }),
  );
}

function clipboard(files: File[]): DataTransfer {
  return {
    files,
    items: files.map((file) => ({
      kind: "file",
      type: file.type,
      getAsFile: () => file,
    })),
  } as unknown as DataTransfer; // Test double: happy-dom has no DataTransfer constructor.
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  errors = [];
  save.mockReset();
  save.mockImplementation(async (_id: string, files: File[]) =>
    files.map((f) => ({ name: f.name, markdownPath: `/note-assets/task-1/${f.name}` })),
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("pastes a clipboard image at the cursor under the owner's id", async () => {
  await act(async () => root.render(createElement(Editor)));
  const field = container.querySelector("textarea")!;
  field.setSelectionRange(6, 6);
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: clipboard([new File(["x"], "shot.png", { type: "image/png" })]),
  });
  await act(async () => {
    field.dispatchEvent(event);
  });
  expect(event.defaultPrevented).toBe(true);
  expect(save).toHaveBeenCalledWith("task-1", [expect.any(File)]);
  expect(field.value).toBe(
    "Before\n\n![shot.png](/note-assets/task-1/shot.png)\n\nAfter",
  );
  expect(errors).toEqual([null]);
});

it("leaves text pastes to the field", async () => {
  await act(async () => root.render(createElement(Editor)));
  const field = container.querySelector("textarea")!;
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", { value: clipboard([]) });
  await act(async () => {
    field.dispatchEvent(event);
  });
  expect(event.defaultPrevented).toBe(false);
  expect(save).not.toHaveBeenCalled();
});

it("inserts images picked with the Insert image button and reports failures", async () => {
  await act(async () => root.render(createElement(Editor)));
  const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
  const pick = async (file: File) => {
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
  };
  await pick(new File(["x"], "a.jpg", { type: "image/jpeg" }));
  expect(container.querySelector("textarea")!.value).toContain(
    "![a.jpg](/note-assets/task-1/a.jpg)",
  );
  save.mockRejectedValueOnce(new Error("Add a PNG, JPG, GIF, WebP, or SVG image."));
  await pick(new File(["x"], "b.txt", { type: "text/plain" }));
  expect(errors.at(-1)).toBe("Add a PNG, JPG, GIF, WebP, or SVG image.");
  expect(
    container.querySelector<HTMLButtonElement>('[aria-label="Insert image"]')!
      .disabled,
  ).toBe(false);
});

it("names unnamed clipboard screenshots and ignores non-image files", () => {
  const named = pastedImages(
    clipboard([
      new File(["x"], "image.png", { type: "image/png" }),
      new File(["x"], "notes.txt", { type: "text/plain" }),
    ]),
  );
  expect(named).toHaveLength(1);
  expect(named[0]!.name).toMatch(/^pasted-\d+\.png$/);
  expect(pastedImages(null)).toEqual([]);
});

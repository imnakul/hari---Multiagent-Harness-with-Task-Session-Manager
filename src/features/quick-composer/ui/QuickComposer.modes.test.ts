// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { QuickComposer } from "./QuickComposer";

vi.mock("../../../platform/tauri/platform", () => ({
  IS_MAC: false,
  IS_WIN: true,
  IS_LINUX: false,
  MOD: "Ctrl+",
  ALT: "Alt+",
  SHIFT: "Shift+",
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../../workspace/ui/WorkspacePicker", () => ({
  WorkspacePicker: () => null,
}));
vi.mock("../../source-control/ui/BranchPicker", () => ({
  BranchPicker: () => null,
}));
vi.mock("@tauri-apps/api/event", () => ({
  emit: vi.fn().mockResolvedValue(undefined),
  listen: vi.fn(async () => () => {}),
}));
vi.mock("./useQuickPickerMotion", () => ({ useQuickPickerMotion: () => {} }));
vi.mock("./QuickWorkspaceControls", () => ({
  QuickWorkspaceControls: () => null,
}));
vi.mock("./QuickProjectIcon", () => ({
  QuickProjectIcon: () => null,
  loadQuickProjectAppearance: () => ({}),
}));
vi.mock("./QuickModelSelector", () => ({ QuickModelSelector: () => null }));
vi.mock("./useQuickAttachments", () => ({
  useQuickAttachments: () => ({ files: [], clear: () => {} }),
}));
vi.mock("../model/quickComposer", async (actual) => ({
  ...(await actual<object>()),
  loadQuickProjects: () => ["/tmp/project"],
  initialQuickChoice: () => ({ harness: "codex", model: "test" }),
  resolveQuickModel: () => ({
    harness: "codex",
    id: "test",
    name: "Test model",
  }),
}));

let root: Root;
let container: HTMLDivElement;
let prompt: HTMLTextAreaElement;

function input(text: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )!.set!.call(prompt, text);
    prompt.setSelectionRange(text.length, text.length);
    prompt.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function key(key: string, options: KeyboardEventInit = {}) {
  await act(async () => {
    prompt.dispatchEvent(
      new KeyboardEvent("keydown", {
        key,
        bubbles: true,
        cancelable: true,
        ...options,
      }),
    );
  });
}

function button(label: string): HTMLButtonElement {
  const found = [...container.querySelectorAll("button")].find(
    (element) =>
      element.textContent?.trim() === label ||
      element.getAttribute("aria-label") === label,
  );
  if (!found) throw new Error(`No button ${label}`);
  return found;
}

async function click(element: HTMLElement) {
  await act(async () => {
    element.click();
  });
}

async function render(props: Record<string, unknown> = {}) {
  await act(async () =>
    root.render(createElement(QuickComposer, { onShown: () => {}, ...props })),
  );
  prompt = container.querySelector("textarea")!;
}

let stored: Map<string, string>;
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("requestAnimationFrame", (callback: () => void) => {
    callback();
    return 0;
  });
  stored = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
  });
  vi.mocked(invoke)
    .mockReset()
    .mockImplementation(async (command, args) => {
      if (command === "prompts_list")
        return [
          {
            id: "p1",
            title: "Review",
            body: "Review this change carefully",
            pinned: false,
            useCount: 0,
            createdAt: 1,
            updatedAt: 1,
          },
        ];
      return command === "tasks_upsert"
        ? {
            ...(args as { task: object }).task,
            createdAt: 1,
            updatedAt: 1,
          }
        : undefined;
    });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await render();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

it("saves a session as a Session Manager draft without opening it", async () => {
  input("Prepare the release notes");
  await click(button("Save to Draft"));
  expect(invoke).toHaveBeenCalledWith("quick_composer_submit", {
    request: expect.objectContaining({
      prompt: "Prepare the release notes",
      draft: true,
      reveal: false,
    }),
  });
});

it("switches to Task mode, remembers it, and saves a Personal task with its fields", async () => {
  await click(button("Task"));
  expect(stored.get("monocode.quickComposer.kind")).toBe("task");
  // Task mode has no model, attachment, or session-permission controls.
  expect(container.querySelector('[title^="Model"]')).toBeNull();
  expect(container.querySelector('[aria-label="Add attachment"]')).toBeNull();
  expect(container.querySelector('button[title="Permissions"]')).toBeNull();
  expect(container.textContent).toContain("Personal");
  input("Fix installer\nIt fails on Windows 11");
  await click(button("Blocked"));
  await click(button("Focus"));
  const tags = container.querySelector<HTMLInputElement>(
    'input[aria-label^="Tags"]',
  )!;
  act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(tags, "#windows, bug");
    tags.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await key("Enter");
  expect(invoke).toHaveBeenCalledWith("tasks_upsert", {
    task: expect.objectContaining({
      title: "Fix installer",
      body: "It fails on Windows 11",
      status: "blocked",
      tags: ["windows", "bug"],
      focusDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    }),
  });
  const saved = vi
    .mocked(invoke)
    .mock.calls.find(([command]) => command === "tasks_upsert")?.[1] as {
    task: { projectCwd?: string };
  };
  expect(saved.task.projectCwd).toBeUndefined();
  expect(invoke).not.toHaveBeenCalledWith(
    "quick_composer_submit",
    expect.anything(),
  );
  // Cleared for the next task; status stays.
  expect(prompt.value).toBe("");
  expect(button("Blocked").getAttribute("aria-checked")).toBe("true");
});

it("keeps Session-only permissions and a saved prompt together in a draft", async () => {
  await click(button("Task"));
  expect(container.querySelector('button[title="Permissions"]')).toBeNull();
  await click(button("Session"));

  const permissionsButton = container.querySelector<HTMLButtonElement>(
    'button[title="Permissions"]',
  );
  expect(permissionsButton).not.toBeNull();
  await click(permissionsButton!);

  const picker = container.querySelector<HTMLElement>(
    '[role="listbox"][aria-label="Permissions"]',
  );
  expect(picker).not.toBeNull();
  const autoAccept = [
    ...picker!.querySelectorAll<HTMLButtonElement>('[role="option"]'),
  ].find((option) => option.textContent?.includes("Auto-accept edits"));
  expect(autoAccept).toBeDefined();
  await click(autoAccept!);
  expect(
    container.querySelector('[role="listbox"][aria-label="Permissions"]'),
  ).toBeNull();

  input("Please !");
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(container.querySelector("[data-saved-prompt-menu]")).not.toBeNull();
  await key("Enter");
  expect(prompt.value).toBe("Please Review this change carefully");
  expect(container.querySelector("[data-saved-prompt-menu]")).toBeNull();
  await click(button("Save to Draft"));
  expect(invoke).toHaveBeenCalledWith("quick_composer_submit", {
    request: expect.objectContaining({
      prompt: "Please Review this change carefully",
      draft: true,
      runtimeMode: "auto-accept-edits",
    }),
  });
});

it("reopens in the last kind chosen", async () => {
  stored.set("monocode.quickComposer.kind", "task");
  await render({ key: "again" });
  expect(prompt.getAttribute("aria-label")).toBe("Task");
});

it("embedded hosts with a start handler get Save to Draft and Start, Ctrl+Enter opens", async () => {
  const save = vi.fn(async () => {});
  const start = vi.fn(async () => {});
  await render({
    key: "embedded",
    initialLaunch: {
      prompt: "Work on: Fix installer",
      cwd: "/tmp/project",
      harness: "codex",
      model: "test",
      reveal: false,
    },
    onSubmitLaunch: save,
    onStartLaunch: start,
    onDismiss: () => {},
  });
  // No Task | Session switch inside Session Manager or Task Manager.
  expect(container.querySelector('[role="tablist"][aria-label="Create"]')).toBeNull();
  await key("Enter", { ctrlKey: true });
  expect(start).toHaveBeenCalledWith(
    expect.objectContaining({ prompt: "Work on: Fix installer", reveal: true }),
    true,
  );
  expect(save).not.toHaveBeenCalled();
  input("Again");
  await click(button("Save to Draft"));
  expect(save).toHaveBeenCalledWith(
    expect.objectContaining({ prompt: "Again", draft: true, reveal: false }),
  );
});

it("embedded hosts rely on the modal's close button, the floating one keeps its own", async () => {
  const close = (): HTMLButtonElement =>
    container.querySelector<HTMLButtonElement>('button[aria-label="Close composer"]')!;
  expect(close().hidden).toBe(false);
  await render({
    key: "embedded-close",
    initialLaunch: { prompt: "", cwd: "/tmp/project", harness: "codex", model: "test", reveal: false },
    onSubmitLaunch: async () => {},
    onDismiss: () => {},
  });
  expect(close().hidden).toBe(true);
});

it("toolbar pickers use the chat composer's pill inside a scrolling toolbar", async () => {
  const model = container.querySelector<HTMLButtonElement>('button[title^="Model ("]')!;
  expect(model.textContent).toContain("Test model");
  expect(model.className).toContain("h-6.5");
  expect(model.className).toContain("bg-selection");
  expect(model.className).toContain("shrink-0");
  expect(model.closest(".composer-toolbar")).not.toBeNull();
  // Start and Save to Draft stay outside the scrolling area, always visible.
  expect(button("Start").closest(".composer-toolbar")).toBeNull();
});

it("typing ! in Session mode shows the saved prompt picker and Enter inserts it", async () => {
  input("Please !");
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(container.querySelector("[data-saved-prompt-menu]")).not.toBeNull();
  expect(invoke).toHaveBeenCalledWith("prompts_list");
  await key("Enter");
  expect(prompt.value).toBe("Please Review this change carefully");
  expect(container.querySelector("[data-saved-prompt-menu]")).toBeNull();
});

it("typing ! in Task mode does not open the saved prompt picker", async () => {
  await click(button("Task"));
  input("Fix !");
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(container.querySelector("[data-saved-prompt-menu]")).toBeNull();
  expect(invoke).not.toHaveBeenCalledWith("prompts_list");
});

// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { TasksView } from "./TasksView";
import {
  invalidateTasks,
  localDay,
  TASKS_CHANGED_EVENT,
  type Task,
  type TaskUpsert,
} from "../tasks";
import {
  BOARD_KEY,
  GROUPING_KEY,
  PEEK_WIDTH_KEY,
  TABLE_KEY,
  VIEW_KEY,
} from "../taskViewState";

const copy = vi.hoisted(() => vi.fn(async (_text: string) => {}));
vi.mock("../../../platform/tauri/clipboard", async (original) => ({
  ...(await original<typeof import("../../../platform/tauri/clipboard")>()),
  copyText: copy,
}));
vi.mock("@tauri-apps/api/core", async (original) => ({
  ...(await original<typeof import("@tauri-apps/api/core")>()),
  invoke: vi.fn(),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    isMaximized: async () => false,
    onResized: async () => () => {},
  }),
}));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ onDragDropEvent: async () => () => {} }),
}));

let root: Root, container: HTMLDivElement, rows: Map<string, Task>;
let upserts: TaskUpsert[];
const sourceOpen = vi.fn();
const openBeside = vi.fn();
const onClose = vi.fn();

function row(partial: Partial<Task> & { id: string }): Task {
  return {
    title: partial.id,
    body: "",
    status: "todo",
    tags: [],
    createdAt: 1,
    updatedAt: 1,
    focusDays: [],
    ...partial,
  };
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  invalidateTasks();
  sourceOpen.mockReset();
  upserts = [];
  openBeside.mockReset();
  onClose.mockReset();
  copy.mockReset().mockResolvedValue();
  rows = new Map([
    [
      "first",
      row({
        id: "first",
        title: "Fix installer",
        body: "# Installer\n\n| OS | State |\n| --- | --- |\n| Windows | Bug |",
        status: "blocked",
        tags: ["windows", "bug"],
        projectCwd: "/work/project",
        sourceSessionId: "session",
        sourceBlockId: "cline:42",
        updatedAt: 10,
      }),
    ],
    [
      "personal",
      row({
        id: "personal",
        title: "Personal reminder",
        body: "Remember this",
        tags: ["home"],
        updatedAt: 2,
      }),
    ],
    [
      "docs",
      row({
        id: "docs",
        title: "Ship docs",
        body: "Write the docs",
        status: "in_progress",
        tags: ["docs", "bug"],
        projectCwd: "/work/other",
        updatedAt: 5,
      }),
    ],
  ]);
  vi.mocked(invoke)
    .mockReset()
    .mockImplementation(async (command, args) => {
      if (command === "tasks_list")
        return [...rows.values()].map((entry) => ({ ...entry }));
      if (command === "tasks_get") return rows.get(args?.id as string) ?? null;
      if (command === "tasks_upsert") {
        const { archived, ...input } = args?.task as TaskUpsert;
        upserts.push(input);
        const old = rows.get(input.id);
        // Like the database: archiving stamps a time once, unarchiving clears it.
        const saved: Task = {
          ...input,
          title: input.title.trim(),
          createdAt: old?.createdAt ?? 20,
          updatedAt: (old?.updatedAt ?? 20) + 1,
          archivedAt: archived ? (old?.archivedAt ?? 30) : undefined,
        };
        rows.set(input.id, saved);
        return saved;
      }
      if (command === "tasks_delete") {
        rows.delete(args?.id as string);
        return;
      }
      throw new Error(`Unexpected command ${command}`);
    });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function render(
  recents = [
    { path: "/work/project", openedAt: 1 },
    { path: "/work/other", openedAt: 2 },
  ],
) {
  await act(async () =>
    root.render(
      createElement(TasksView, {
        cwd: "/work/project",
        recents,
        onClose,
        onOpenSource: sourceOpen,
        onOpenBeside: openBeside,
      }),
    ),
  );
}
const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
function input(label: string) {
  return container.querySelector<HTMLInputElement | HTMLTextAreaElement>(
    `[aria-label="${label}"]`,
  )!;
}
function button(text: string) {
  return [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (entry) => entry.textContent?.trim() === text,
  )!;
}
function byLabel<T extends HTMLElement = HTMLElement>(label: string) {
  return container.querySelector<T>(`[aria-label="${label}"]`)!;
}
async function click(element: Element | null | undefined) {
  await act(async () => (element as HTMLElement).click());
}
async function change(label: string, value: string) {
  const element = input(label);
  const prototype =
    element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(
      element,
      value,
    );
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function listRow(title: string) {
  return [
    ...container.querySelectorAll<HTMLElement>(
      '[aria-label="Tasks"][role="list"] button',
    ),
  ].find((entry) => entry.textContent?.includes(title))!;
}
function tableRow(title: string) {
  return [...container.querySelectorAll<HTMLElement>("tr[data-task-row]")].find(
    (entry) => entry.textContent?.includes(title),
  )!;
}
function card(title: string) {
  return [...container.querySelectorAll<HTMLElement>("[data-task-card]")].find(
    (entry) => entry.textContent?.includes(title),
  )!;
}
// The open pane; a pane sliding out after close is aria-hidden and inert.
const peek = () =>
  container.querySelector<HTMLElement>(
    '[aria-label="Task panel"]:not([aria-hidden="true"])',
  );
async function pickOption(trigger: string, option: string) {
  const opener = container.querySelector<HTMLElement>(
    `button[aria-label^="${trigger}:"]`,
  );
  if (opener?.getAttribute("aria-expanded") !== "true") await click(opener);
  const choice = [
    ...document.querySelectorAll<HTMLElement>('[role="option"]'),
  ].find(
    (entry) =>
      (
        entry.querySelector("[data-option-label]") ?? entry
      ).textContent?.trim() === option,
  );
  await click(choice);
  // Multi-select menus (Status, Project) stay open; close them like a user would.
  const after = container.querySelector<HTMLElement>(
    `button[aria-label^="${trigger}:"]`,
  );
  if (after?.getAttribute("aria-expanded") === "true") await click(after);
}
async function pickMenuItem(trigger: HTMLElement | undefined, label: string) {
  await click(trigger);
  const item = [
    ...document.querySelectorAll<HTMLElement>(
      '[role="menuitem"], [role="menuitemcheckbox"]',
    ),
  ].find(
    (entry) =>
      (
        entry.querySelector("[data-menu-label]") ?? entry
      ).textContent?.trim() === label,
  );
  await click(item);
}
async function escape(target: Element = document.body) {
  await act(async () => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );
  });
}
async function switchView(label: "List" | "Table" | "Board") {
  await click(
    [
      ...container.querySelectorAll<HTMLElement>(
        '[aria-label="Tasks view"] [role="tab"]',
      ),
    ].find((entry) => entry.textContent?.trim() === label),
  );
}
function listTitles() {
  return [
    ...container.querySelectorAll<HTMLElement>(
      [
        '[aria-label="Tasks"][role="list"] li button .font-semibold',
        '[aria-label="Completed tasks"][role="list"] li button .font-semibold',
        '[aria-label="In focus tasks"][role="list"] li button .font-semibold',
      ].join(", "),
    ),
  ].map((entry) => entry.textContent);
}
describe("Tasks list view", () => {
  it("defaults to a full-width List with no sidebar, newest first", async () => {
    await render();
    expect(container.querySelector("aside")).toBeNull();
    expect(
      byLabel("Tasks view").querySelector('[aria-selected="true"]')
        ?.textContent,
    ).toContain("List");
    expect(listTitles()).toEqual([
      "Fix installer",
      "Ship docs",
      "Personal reminder",
    ]);
    const first = listRow("Fix installer");
    expect(first.textContent).toContain("Blocked");
    expect(listRow("Personal reminder").textContent).toContain("Remember this");
    expect(first.textContent).toContain("#windows");
    expect(first.textContent).toContain("project");
    expect(listRow("Personal reminder").textContent).toContain("Personal");
    expect(peek()).toBeNull();
  });

  it("opens the peek pane when a row is clicked", async () => {
    await render();
    await click(listRow("Fix installer"));
    expect(peek()).not.toBeNull();
    expect(input("Task title").value).toBe("Fix installer");
    expect(listRow("Fix installer").getAttribute("aria-current")).toBe("true");
  });

  it("shows a spinner on first mount and cached rows on later mounts", async () => {
    let release: (value: Task[]) => void = () => {};
    const original = vi.mocked(invoke).getMockImplementation()!;
    vi.mocked(invoke).mockImplementation(async (command, args) => {
      if (command === "tasks_list")
        return new Promise<Task[]>((resolve) => {
          release = resolve;
        });
      return original(command, args);
    });
    await render();
    expect(byLabel("Loading tasks")).not.toBeNull();
    await act(async () => release([...rows.values()]));
    expect(listTitles()).toHaveLength(3);
    await act(async () => root.render(null));
    await render();
    // tasks_list is still pending, yet the cached rows are already on screen.
    expect(listTitles()).toHaveLength(3);
    expect(container.querySelector('[aria-label="Loading tasks"]')).toBeNull();
    await act(async () => release([...rows.values()]));
  });

  it("shows empty, filtered-empty and load-error states", async () => {
    rows.clear();
    await render();
    expect(container.textContent).toContain(
      "No tasks yet. Capture a selection from a transcript, or create one here.",
    );
    await act(async () => root.render(null));
    invalidateTasks();
    vi.mocked(invoke).mockImplementation(async () => {
      throw new Error("db locked");
    });
    await render();
    expect(container.textContent).toContain("Could not load tasks: db locked");
    expect(button("Retry")).toBeDefined();
  });

  it("keeps rows and shows a banner when a refresh fails", async () => {
    await render();
    const original = vi.mocked(invoke).getMockImplementation()!;
    vi.mocked(invoke).mockImplementation(async (command, args) => {
      if (command === "tasks_list") throw new Error("offline");
      return original(command, args);
    });
    await act(async () => window.dispatchEvent(new Event(TASKS_CHANGED_EVENT)));
    expect(container.textContent).toContain("Could not refresh tasks: offline");
    expect(listTitles()).toHaveLength(3);
  });
});

describe("toolbar layout", () => {
  it("puts New task first, filters next and the view switch last in one row", async () => {
    await render();
    const newTask = container.querySelector('[aria-label="New task"]')!;
    const search = container.querySelector('[aria-label="Filter tasks"]')!;
    const views = container.querySelector('[aria-label="Tasks view"]')!;
    const row = newTask.closest("div.h-10")!;
    expect(row.contains(search)).toBe(true);
    expect(row.contains(views)).toBe(true);
    expect(
      newTask.compareDocumentPosition(search) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      search.compareDocumentPosition(views) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    const header = container.querySelector("[data-tauri-drag-region]")!;
    expect(header.contains(newTask)).toBe(false);
    expect(header.contains(views)).toBe(false);
  });
});

describe("filters", () => {
  it("combines search, status, project and tags with all/any and resets", async () => {
    await render();
    expect(container.querySelector("select")).toBeNull();
    expect(container.textContent).not.toContain("Reset filters");
    await change("Filter tasks", "installer");
    expect(listTitles()).toEqual(["Fix installer"]);
    await change("Filter tasks", "");
    await pickOption("Status", "Blocked");
    expect(listTitles()).toEqual(["Fix installer"]);
    await pickOption("Status", "All statuses");
    await pickOption("Project", "other");
    expect(listTitles()).toEqual(["Ship docs"]);
    // Project is multi-select: adding Personal shows both.
    await pickOption("Project", "Personal");
    expect(listTitles().sort()).toEqual(["Personal reminder", "Ship docs"]);
    await pickOption("Project", "other");
    expect(listTitles()).toEqual(["Personal reminder"]);
    await pickOption("Project", "All projects");
    await pickOption("Tag", "#windows");
    await pickOption("Tag", "#docs");
    // both tags must match by default
    expect(container.textContent).toContain("No tasks match these filters");
    await click(button("Match any"));
    expect(listTitles().sort()).toEqual(["Fix installer", "Ship docs"]);
    await click(byLabel("Remove tag filter #docs"));
    expect(listTitles()).toEqual(["Fix installer"]);
    expect(container.querySelector('[aria-label="Tag matching"]')).toBeNull();
    await click(button("Reset"));
    expect(listTitles()).toHaveLength(3);
    expect(container.textContent).not.toContain("Reset filters");
  });

  it("adds a tag filter from a chip without selecting the task", async () => {
    await render();
    await click(byLabel("Filter by tag #home"));
    expect(listTitles()).toEqual(["Personal reminder"]);
    expect(byLabel("Remove tag filter #home")).not.toBeNull();
    expect(peek()).toBeNull();
  });
});

describe("selection and peek", () => {
  it("keeps a filtered-out selection, keeps it across views, and closes on delete", async () => {
    await render();
    await click(listRow("Fix installer"));
    await pickOption("Status", "Todo");
    expect(listTitles()).toEqual(["Personal reminder"]);
    expect(input("Task title").value).toBe("Fix installer");
    await pickOption("Status", "All statuses");
    await switchView("Board");
    expect(input("Task title").value).toBe("Fix installer");
    await switchView("Table");
    expect(input("Task title").value).toBe("Fix installer");
    await click(byLabel("Delete task"));
    expect(rows.has("first")).toBe(false);
    expect(peek()).toBeNull();
  });

  it("closes the peek when the Operator deletes the task, in every view", async () => {
    await render();
    const targets = [
      ["List", "first"],
      ["Table", "docs"],
      ["Board", "personal"],
    ] as const;
    for (const [view, id] of targets) {
      await switchView(view);
      const title = rows.get(id)!.title;
      await click(
        view === "List"
          ? listRow(title)
          : view === "Table"
            ? tableRow(title)
            : card(title).querySelector("button[data-task-id]"),
      );
      expect(peek()).not.toBeNull();
      rows.delete(id);
      await act(async () =>
        window.dispatchEvent(new Event(TASKS_CHANGED_EVENT)),
      );
      expect(peek()).toBeNull();
    }
  });

  it("shows Operator edits in every view and in the open peek", async () => {
    await render();
    await click(listRow("Fix installer"));
    rows.set("first", {
      ...rows.get("first")!,
      title: "Operator updated",
      status: "completed",
      body: "Operator body",
      updatedAt: 99,
    });
    await act(async () => window.dispatchEvent(new Event(TASKS_CHANGED_EVENT)));
    expect(input("Task title").value).toBe("Operator updated");
    expect(peek()!.textContent).toContain("Operator body");
    expect(listRow("Operator updated").textContent).toContain("Completed");
    await switchView("Table");
    expect(tableRow("Operator updated")).toBeDefined();
    await switchView("Board");
    expect(
      card("Operator updated").closest('[aria-label="Completed column"]'),
    ).not.toBeNull();
  });

  it("closes the peek with Escape, then the view, and ignores menu Escapes", async () => {
    await render();
    await click(listRow("Fix installer"));
    // A status SearchableSelect handles its own Escape.
    await click(container.querySelector('button[aria-label^="Status:"]'));
    await escape(container.querySelector('button[aria-label^="Status:"]')!);
    expect(onClose).not.toHaveBeenCalled();
    expect(peek()).not.toBeNull();
    // So does the project picker.
    await click(
      container.querySelector('[aria-label^="Move task to project"]'),
    );
    expect(
      document.querySelector('[aria-label="Project picker"]'),
    ).not.toBeNull();
    await escape(
      container.querySelector('[aria-label^="Move task to project"]')!,
    );
    expect(document.querySelector('[aria-label="Project picker"]')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect(peek()).not.toBeNull();
    await escape();
    expect(peek()).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    await escape();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("never shows a stale title or body while a save waits for the list refresh", async () => {
    await render();
    await click(listRow("Fix installer"));
    // Hold every list refresh after the save, so the open task prop stays stale.
    const original = vi.mocked(invoke).getMockImplementation()!;
    let releaseList: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      releaseList = resolve;
    });
    vi.mocked(invoke).mockImplementation(async (command, args) => {
      if (command === "tasks_list") await held;
      return original(command, args);
    });
    const field = input("Task title");
    await act(async () => field.focus());
    await change("Task title", "Fix installer now");
    const seen: string[] = [];
    const observer = new MutationObserver(() => seen.push(field.value));
    observer.observe(field, { attributes: true });
    const values = () => [...seen, field.value];
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 500));
    });
    // The save went through, but the list is still stale: the field keeps the typed text.
    expect(rows.get("first")?.title).toBe("Fix installer now");
    expect(field.value).toBe("Fix installer now");
    await act(async () => {
      releaseList();
      await tick();
    });
    observer.disconnect();
    expect(values().every((value) => value === "Fix installer now")).toBe(true);
    expect(field.value).toBe("Fix installer now");
  });

  it("flushes unsaved edits when the selection changes before the debounce", async () => {
    await render();
    await click(listRow("Fix installer"));
    await change("Task title", "Renamed installer");
    await click(listRow("Personal reminder"));
    await act(async () => {
      await tick();
    });
    expect(upserts.some((task) => task.title === "Renamed installer")).toBe(
      true,
    );
    expect(rows.get("first")?.title).toBe("Renamed installer");
  });

  it("changes status from the status menu immediately", async () => {
    await render();
    await click(listRow("Fix installer"));
    await pickMenuItem(
      peek()!.querySelector<HTMLElement>('button[aria-label^="Task status"]')!,
      "Verify",
    );
    expect(rows.get("first")?.status).toBe("review");
  });

  it("opens beside session from the peek header (the editor no longer repeats it)", async () => {
    await render();
    await click(listRow("Fix installer"));
    await click(
      peek()!.querySelector('button[aria-label="Open beside session"]'),
    );
    expect(openBeside).toHaveBeenCalledWith(
      expect.objectContaining({ id: "first" }),
    );
    expect(button("Open beside session")).toBeUndefined();
    await click(button("Open source session"));
    expect(sourceOpen).toHaveBeenCalledWith("session", "cline:42");
  });

  it("copies unsaved Markdown, flushes on unmount and deletes without resurrection", async () => {
    await render();
    await click(listRow("Fix installer"));
    await click(button("Source"));
    const markdown =
      "---\ntitle: Draft\n---\n# Unsaved\n\n| A |\n| --- |\n| row |";
    await change("Task Markdown", markdown);
    await click(byLabel("Copy Markdown"));
    expect(copy).toHaveBeenCalledWith(markdown);
    await act(async () => root.render(null));
    expect(rows.get("first")?.body).toBe(markdown);
    await render();
    await click(listRow("Fix installer"));
    await click(byLabel("Delete task"));
    expect(rows.has("first")).toBe(false);
    await act(async () => root.render(null));
    expect(rows.has("first")).toBe(false);
  });

  it("retains failed edits for retry and reports source failures", async () => {
    await render();
    await click(listRow("Fix installer"));
    await click(button("Source"));
    const original = vi.mocked(invoke).getMockImplementation()!;
    vi.mocked(invoke).mockImplementation(async (command, args) => {
      if (command === "tasks_upsert") throw new Error("Disk full");
      return original(command, args);
    });
    await change("Task Markdown", "Keep failed draft");
    await act(async () => {
      await tick(450);
    });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Could not save task: Disk full",
    );
    expect(input("Task Markdown").value).toBe("Keep failed draft");
    vi.mocked(invoke).mockImplementation(original);
    await click(button("Retry"));
    expect(rows.get("first")?.body).toBe("Keep failed draft");
    sourceOpen.mockRejectedValueOnce(new Error("Source removed"));
    await click(button("Open source session"));
    expect(container.textContent).toContain("Source removed");
  });

  it("edits tags and moves the task between projects", async () => {
    await render();
    await click(listRow("Fix installer"));
    await change("Add task tag", "Release,");
    await act(async () => {
      await tick(450);
    });
    expect(rows.get("first")?.tags).toContain("release");
    await click(
      container.querySelector('[aria-label^="Move task to project"]'),
    );
    await click(
      document.querySelector(
        '[aria-label="Project picker"] button[title="/work/other"]',
      ),
    );
    expect(rows.get("first")?.projectCwd).toBe("/work/other");
    expect(container.textContent).not.toContain("Move to Personal");
  });
});

describe("creating tasks", () => {
  it("files under Personal with +, a project via the chevron, and focuses the title", async () => {
    await render();
    await click(byLabel("New task"));
    const personal = [...rows.values()].find(
      (entry) => entry.title === "Untitled" && !entry.projectCwd,
    )!;
    expect(personal).toMatchObject({ status: "todo", tags: [] });
    expect(peek()).not.toBeNull();
    await act(async () => {
      await tick(20);
    });
    expect(document.activeElement).toBe(input("Task title"));
    await click(byLabel("Choose where the task is filed"));
    const project = [
      ...document.querySelectorAll<HTMLElement>('[role="option"]'),
    ].find((entry) => entry.textContent?.trim() === "project");
    await click(project);
    const created = [...rows.values()].find(
      (entry) => entry.title === "Untitled" && entry.projectCwd,
    )!;
    expect(created.projectCwd).toBe("/work/project");
  });

  it("flushes a focused trailing-space title once before creating the next task", async () => {
    await render();
    await click(listRow("Fix installer"));
    act(() => input("Task title").focus());
    await change("Task title", "Fix installer   ");
    const originalWrites = upserts.filter((item) => item.id === "first").length;
    const title = input("Task title");
    await act(async () => {
      title.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          ctrlKey: true,
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
      await tick(20);
    });
    expect(rows.get("first")?.title).toBe("Fix installer");
    expect(upserts.filter((item) => item.id === "first")).toHaveLength(
      originalWrites + 1,
    );
    expect([...rows.values()].filter((item) => item.title === "Untitled")).toHaveLength(1);
    expect(input("Task title").value).toBe("Untitled");
  });

  it("creates the next task on Ctrl+Enter only while Add more is on", async () => {
    await render();
    await click(listRow("Fix installer"));
    const ctrlEnter = async () => {
      await act(async () => {
        input("Task title").dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Enter",
            ctrlKey: true,
            bubbles: true,
            cancelable: true,
          }),
        );
        await tick(20);
      });
    };
    const untitled = () =>
      [...rows.values()].filter((item) => item.title === "Untitled").length;
    await ctrlEnter();
    expect(untitled()).toBe(0);
    await click(button("Add more"));
    expect(button("Add more").getAttribute("aria-pressed")).toBe("true");
    expect(localStorage.getItem("monocode.tasks.addMore")).toBe("1");
    await ctrlEnter();
    expect(untitled()).toBe(1);
    expect(input("Task title").value).toBe("Untitled");
    await ctrlEnter();
    expect(untitled()).toBe(2);
  });

  it("does not resubmit an exact title that autosaved before New task", async () => {
    await render();
    await click(listRow("Fix installer"));
    act(() => input("Task title").focus());
    await change("Task title", "Saved while focused");
    await act(async () => tick(450));
    await act(async () => {
      window.dispatchEvent(new Event(TASKS_CHANGED_EVENT));
      await tick(0);
    });
    const writesBeforeCreate = upserts.filter((item) => item.id === "first").length;

    await click(byLabel("New task"));

    expect(upserts.filter((item) => item.id === "first")).toHaveLength(
      writesBeforeCreate,
    );
    expect([...rows.values()].filter((item) => item.title === "Untitled"))
      .toHaveLength(1);
  });

  it("ignores repeated and composing New task shortcuts", async () => {
    await render();
    await click(listRow("Fix installer"));
    const title = input("Task title");
    for (const options of [
      { repeat: true },
      { isComposing: true },
    ]) {
      await act(async () => {
        title.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Enter",
            ctrlKey: true,
            shiftKey: true,
            bubbles: true,
            cancelable: true,
            ...options,
          }),
        );
      });
    }
    expect([...rows.values()].filter((item) => item.title === "Untitled"))
      .toHaveLength(0);
    expect(peek()).not.toBeNull();
  });

  it("saves a value again after refreshed task data changed away from it", async () => {
    await render();
    await click(listRow("Fix installer"));
    await change("Task title", "A");
    await act(async () => tick(450));
    expect(rows.get("first")?.title).toBe("A");

    const publishTaskChange = async () => {
      await act(async () => {
        window.dispatchEvent(new Event(TASKS_CHANGED_EVENT));
        await tick(0);
      });
    };
    await publishTaskChange(); // The editor observes the save it just made.
    rows.set("first", { ...rows.get("first")!, title: "B", updatedAt: 50 });
    await publishTaskChange(); // An external writer replaces that value.

    await change("Task title", "A");
    await act(async () => tick(450));
    expect(rows.get("first")?.title).toBe("A");
    expect(upserts.filter((item) => item.id === "first")).toHaveLength(2);
  });

  it("lists every project in the searchable create picker", async () => {
    const recents = Array.from({ length: 10 }, (_, index) => ({
      path: `/work/project-${index + 1}`,
      openedAt: 100 - index,
    }));
    await render(recents);
    await click(byLabel("Choose where the task is filed"));
    const list = document.querySelector<HTMLElement>(
      '[role="listbox"][aria-label="Choose where the task is filed"]',
    )!;
    // Same scrollable list as the Project filter, not a fixed-height menu.
    expect(list.className).toContain("overflow-y-auto");
    const choices = [...list.querySelectorAll('[role="option"]')];
    expect(choices).toHaveLength(13); // recents, task projects, and Personal
    expect(choices.at(-1)?.textContent).toBe("Personal");
    // The picker renders in a portal, outside the view container.
    const search = document.querySelector<HTMLInputElement>(
      '[aria-label="Search projects…"][role="combobox"]',
    )!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
        search,
        "project-10",
      );
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(list.querySelectorAll('[role="option"]')).toHaveLength(1);
    await act(async () => {
      search.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
    expect(
      [...rows.values()].some((entry) => entry.projectCwd === "/work/project-10"),
    ).toBe(true);
  });

  it("disables the create buttons while a create is pending", async () => {
    let release: () => void = () => {};
    const original = vi.mocked(invoke).getMockImplementation()!;
    vi.mocked(invoke).mockImplementation(async (command, args) => {
      if (command === "tasks_upsert") {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      }
      return original(command, args);
    });
    await render();
    await click(byLabel("New task"));
    expect(byLabel<HTMLButtonElement>("New task").disabled).toBe(true);
    expect(
      byLabel<HTMLButtonElement>("Choose where the task is filed").disabled,
    ).toBe(true);
    await act(async () => release());
    expect(byLabel<HTMLButtonElement>("New task").disabled).toBe(false);
  });
});

describe("view switching and persistence", () => {
  it("persists the chosen view, restores it, and supports arrow keys", async () => {
    await render();
    await switchView("Board");
    expect(localStorage.getItem(VIEW_KEY)).toBe("board");
    await act(async () => root.render(null));
    await render();
    expect(
      container.querySelector('[aria-label="Todo column"]'),
    ).not.toBeNull();
    const tab = container.querySelector<HTMLElement>(
      '[aria-label="Tasks view"] [aria-selected="true"]',
    )!;
    await act(async () => {
      tab.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }),
      );
    });
    expect(localStorage.getItem(VIEW_KEY)).toBe("table");
    expect(container.querySelector("table")).not.toBeNull();
  });
});

describe("table view", () => {
  async function openTable() {
    await render();
    await switchView("Table");
  }
  const headerLabels = () =>
    [...container.querySelectorAll("thead th")].map((entry) =>
      entry.textContent?.trim(),
    );

  it("groups by status, hides empty groups, collapses and persists", async () => {
    await openTable();
    const groups = [...container.querySelectorAll<HTMLElement>("tbody")].map(
      (entry) =>
        [...(entry.querySelector("button")?.querySelectorAll("span") ?? [])]
          .map((span) => span.textContent?.trim())
          .join(" "),
    );
    expect(groups).toEqual(["Todo 1", "Progress 1", "Blocked 1"]);
    expect(headerLabels()).toEqual([
      "Title",
      "Status",
      "Project",
      "Tags",
      "Updated",
    ]);
    const todo = [
      ...container.querySelectorAll<HTMLButtonElement>("button[aria-expanded]"),
    ].find((entry) => entry.textContent?.includes("Todo"))!;
    await click(todo);
    expect(todo.getAttribute("aria-expanded")).toBe("false");
    expect(container.textContent).not.toContain("Personal reminder");
    expect(JSON.parse(localStorage.getItem(TABLE_KEY)!).collapsed).toEqual([
      "status:todo",
    ]);
    await act(async () => root.render(null));
    await render();
    expect(container.textContent).not.toContain("Personal reminder");
  });

  it("sorts by header with aria-sort and an id tie-breaker", async () => {
    rows.set("a", row({ id: "a", title: "Same", updatedAt: 3 }));
    rows.set("b", row({ id: "b", title: "Same", updatedAt: 4 }));
    await openTable();
    const th = (label: string) =>
      [...container.querySelectorAll("thead th")].find((entry) =>
        entry.textContent?.includes(label),
      )!;
    expect(th("Updated").getAttribute("aria-sort")).toBe("descending");
    await click(th("Title").querySelector("button"));
    expect(th("Title").getAttribute("aria-sort")).toBe("ascending");
    expect(th("Updated").getAttribute("aria-sort")).toBeNull();
    const todoIds = [
      ...container.querySelectorAll<HTMLElement>("tr[data-task-row]"),
    ]
      .map((entry) => entry.dataset.taskRow)
      .filter((id) => id === "a" || id === "b" || id === "personal");
    expect(todoIds).toEqual(["personal", "a", "b"]);
    await click(th("Title").querySelector("button"));
    expect(th("Title").getAttribute("aria-sort")).toBe("descending");
  });

  it("resizes columns by keyboard within limits, resets on double click and persists", async () => {
    await openTable();
    const handle = byLabel("Resize Status column");
    const key = (name: string, type: "keydown" | "keyup") =>
      act(async () => {
        handle.dispatchEvent(
          new KeyboardEvent(type, {
            key: name,
            bubbles: true,
            cancelable: true,
          }),
        );
      });
    await key("ArrowRight", "keydown");
    await key("ArrowRight", "keyup");
    expect(JSON.parse(localStorage.getItem(TABLE_KEY)!).widths.status).toBe(
      156,
    );
    for (let i = 0; i < 6; i += 1) {
      await key("ArrowLeft", "keydown");
      await key("ArrowLeft", "keyup");
    }
    expect(JSON.parse(localStorage.getItem(TABLE_KEY)!).widths.status).toBe(
      110,
    );
    await act(async () => {
      handle.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });
    expect(JSON.parse(localStorage.getItem(TABLE_KEY)!).widths.status).toBe(
      140,
    );
    expect(container.querySelector("col")).not.toBeNull();
  });

  it("has no Columns control; saved hidden columns still apply", async () => {
    await openTable();
    expect(container.querySelector('[aria-label="Choose visible columns"]')).toBeNull();
    expect(container.textContent).not.toContain("Columns");
    expect(headerLabels()).not.toContain("Completed");
  });

  it("selects on row click but not on status-menu or tag clicks", async () => {
    await openTable();
    await click(
      container.querySelector(
        'tr[data-task-row="first"] button[aria-label^="Task status"]',
      ),
    );
    expect(peek()).toBeNull();
    await escape(document.querySelector('[role="menu"]')!);
    await click(
      container.querySelector(
        'tr[data-task-row="first"] [aria-label="Filter by tag #bug"]',
      ),
    );
    expect(peek()).toBeNull();
    await click(tableRow("Ship docs").querySelector("td:nth-child(3)"));
    expect(peek()).not.toBeNull();
    expect(tableRow("Ship docs").getAttribute("aria-selected")).toBe("true");
  });
});

describe("board view", () => {
  async function openBoard() {
    await render();
    await switchView("Board");
  }
  const columnLabels = () =>
    [
      ...container.querySelectorAll<HTMLElement>(
        "section[aria-label$=' column']",
      ),
    ].map((entry) => entry.getAttribute("aria-label"));

  it("shows the five statuses and follows the Status filter", async () => {
    await openBoard();
    expect(columnLabels()).toEqual([
      "Todo column",
      "Progress column",
      "Blocked column",
      "Verify column",
      "Completed column",
    ]);
    // The multi-select Status filter limits the board to the chosen columns.
    await pickOption("Status", "Todo");
    await pickOption("Status", "Completed");
    expect(columnLabels()).toEqual(["Todo column", "Completed column"]);
    await pickOption("Status", "All statuses");
    expect(columnLabels()).toContain("Verify column");
    expect(container.querySelector('[aria-label="Choose visible columns"]')).toBeNull();
  });

  it("fills the board without sideways scroll and has no column resize handles", async () => {
    await openBoard();
    const column = byLabel("Todo column");
    expect(column.className).toContain("flex-1");
    // Columns shrink to fit instead of holding a minimum that would scroll.
    expect(column.style.minWidth).toBe("0");
    expect(container.querySelector("[data-board-column]")!.parentElement!.className).toContain(
      "overflow-x-hidden",
    );
    expect(container.querySelector('[aria-label^="Resize "][aria-label$=" column"]')).toBeNull();
  });

  describe("drag and optimistic moves", () => {
    let over: Element | null = null;
    beforeEach(() => {
      over = null;
      document.elementFromPoint = () => over;
    });
    const pointer = (type: string, target: EventTarget, x: number, y: number) =>
      act(async () => {
        target.dispatchEvent(
          new MouseEvent(type, {
            bubbles: true,
            cancelable: true,
            clientX: x,
            clientY: y,
            button: 0,
          }),
        );
      });
    async function drag(title: string, to: string, release = true) {
      const source = card(title);
      await pointer("pointerdown", source, 10, 10);
      await pointer("pointermove", window, 30, 30);
      over = byLabel(`${to} column`);
      await pointer("pointermove", window, 40, 40);
      if (release) await pointer("pointerup", window, 40, 40);
    }

    it("treats a move under 4px as a click and opens the peek", async () => {
      await openBoard();
      const source = card("Fix installer");
      await pointer("pointerdown", source, 10, 10);
      await pointer("pointermove", window, 12, 12);
      await pointer("pointerup", window, 12, 12);
      await click(source.querySelector("button[data-task-id]"));
      expect(peek()).not.toBeNull();
      expect(rows.get("first")?.status).toBe("blocked");
    });

    it("moves a card optimistically and persists the status", async () => {
      await openBoard();
      await drag("Fix installer", "Verify");
      expect(
        card("Fix installer").closest('[aria-label="Verify column"]'),
      ).not.toBeNull();
      await act(async () => {
        await tick();
      });
      expect(rows.get("first")?.status).toBe("review");
      expect(peek()).toBeNull();
      expect(document.body.style.cursor).toBe("");
    });

    it("cancels with Escape and does nothing when dropped on the same column", async () => {
      await openBoard();
      await drag("Fix installer", "Verify", false);
      expect(byLabel("Verify column").className).toContain("border-accent/40");
      await escape();
      expect(byLabel("Verify column").className).not.toContain("border-accent/40");
      expect(onClose).not.toHaveBeenCalled();
      await drag("Fix installer", "Blocked");
      expect(upserts).toHaveLength(0);
      expect(
        card("Fix installer").closest('[aria-label="Blocked column"]'),
      ).not.toBeNull();
    });

    // Writes are serialized per task in a module-level queue, so every test
    // must settle the writes it deferred before the next one starts.
    const openGates: { resolve: () => void }[] = [];
    afterEach(async () => {
      for (const gate of openGates.splice(0)) gate.resolve();
      await act(async () => {
        await tick(5);
      });
    });
    function deferUpserts() {
      const original = vi.mocked(invoke).getMockImplementation()!;
      const gates: { resolve: () => void; reject: (error: Error) => void }[] =
        [];
      vi.mocked(invoke).mockImplementation(async (command, args) => {
        if (command === "tasks_upsert") {
          await new Promise<void>((resolve, reject) => {
            const gate = { resolve, reject };
            gates.push(gate);
            openGates.push(gate);
          });
        }
        return original(command, args);
      });
      return gates;
    }
    const inColumn = (title: string, column: string) =>
      card(title).closest(`[aria-label="${column} column"]`) !== null;

    it("keeps the latest move when an earlier write finishes first (A)", async () => {
      await openBoard();
      const gates = deferUpserts();
      await drag("Fix installer", "Verify");
      await drag("Fix installer", "Todo");
      expect(inColumn("Fix installer", "Todo")).toBe(true);
      await act(async () => {
        await tick();
      });
      await act(async () => gates[0].resolve());
      await act(async () => tick());
      expect(inColumn("Fix installer", "Todo")).toBe(true);
      await act(async () => gates[1]?.resolve());
      await act(async () => tick(5));
      expect(inColumn("Fix installer", "Todo")).toBe(true);
    });

    it("ignores an earlier failure while a later move is pending (B)", async () => {
      await openBoard();
      const gates = deferUpserts();
      await drag("Fix installer", "Verify");
      await drag("Fix installer", "Todo");
      await act(async () => tick());
      await act(async () => gates[0].reject(new Error("first failed")));
      await act(async () => tick());
      expect(inColumn("Fix installer", "Todo")).toBe(true);
      expect(container.textContent).not.toContain("first failed");
    });

    it("reverts and names the task when the latest move fails (C)", async () => {
      await openBoard();
      const gates = deferUpserts();
      await drag("Fix installer", "Verify");
      await act(async () => tick());
      rows.delete("first");
      await act(async () => gates[0].reject(new Error("Task was not found")));
      await act(async () => tick());
      expect(container.textContent).toContain(
        'Could not move "Fix installer": Task was not found',
      );
      await click(byLabel("Dismiss"));
      expect(container.textContent).not.toContain("Could not move");
    });

    it("moves through the card status menu for keyboard users", async () => {
      await openBoard();
      await pickMenuItem(
        card("Fix installer").querySelector<HTMLElement>(
          'button[aria-label^="Task status"]',
        )!,
        "Completed",
      );
      expect(inColumn("Fix installer", "Completed")).toBe(true);
      await act(async () => tick());
      expect(rows.get("first")?.status).toBe("completed");
    });
  });
});

describe("persisted peek width", () => {
  it("restores a stored peek width, clamped", async () => {
    localStorage.setItem(PEEK_WIDTH_KEY, "5000");
    await render();
    await click(listRow("Fix installer"));
    expect(peek()!.style.width).toBe(
      `${Math.min(720, Math.round(window.innerWidth * 0.6))}px`,
    );
  });
});

describe("grouping", () => {
  const groupHeaders = () =>
    [...container.querySelectorAll<HTMLButtonElement>("[data-task-group]")].map(
      (entry) =>
        [...entry.querySelectorAll("span")]
          .map((span) => span.textContent?.trim())
          .filter(Boolean)
          .join(" "),
    );

  it("groups the List by project with Personal last, collapses a group and persists the choice", async () => {
    await render();
    expect(groupHeaders()).toEqual([]);
    await pickOption("Group tasks", "Group by project");
    expect(groupHeaders()).toEqual(["other 1", "project 1", "Personal 1"]);
    const personal = container.querySelector<HTMLButtonElement>(
      '[data-task-group="project:personal"]',
    )!;
    await click(personal);
    expect(personal.getAttribute("aria-expanded")).toBe("false");
    expect(container.textContent).not.toContain("Personal reminder");
    expect(JSON.parse(localStorage.getItem(GROUPING_KEY)!).list).toBe(
      "project",
    );
    await act(async () => root.render(null));
    await render();
    expect(groupHeaders()).toEqual(["other 1", "project 1", "Personal 1"]);
  });

  it("groups the List by status in workflow order", async () => {
    await render();
    await pickOption("Group tasks", "Group by status");
    expect(groupHeaders()).toEqual(["Todo 1", "Progress 1", "Blocked 1"]);
  });

  it("lets the Table group by project or not at all, independently of the List", async () => {
    await render();
    await switchView("Table");
    await pickOption("Group tasks", "Group by project");
    expect(groupHeaders()).toEqual(["other 1", "project 1", "Personal 1"]);
    await pickOption("Group tasks", "No grouping");
    expect(groupHeaders()).toEqual([]);
    expect(container.querySelectorAll("tr[data-task-row]")).toHaveLength(3);
    await switchView("List");
    expect(groupHeaders()).toEqual([]);
    expect(JSON.parse(localStorage.getItem(GROUPING_KEY)!)).toEqual({
      list: "none",
      table: "none",
      board: "status",
    });
  });

  describe("board by project", () => {
    let over: Element | null = null;
    beforeEach(() => {
      over = null;
      document.elementFromPoint = () => over;
    });
    const pointer = (type: string, target: EventTarget, x: number, y: number) =>
      act(async () => {
        target.dispatchEvent(
          new MouseEvent(type, {
            bubbles: true,
            cancelable: true,
            clientX: x,
            clientY: y,
            button: 0,
          }),
        );
      });
    async function drag(title: string, to: string) {
      await pointer("pointerdown", card(title), 10, 10);
      await pointer("pointermove", window, 30, 30);
      over = byLabel(`${to} column`);
      await pointer("pointermove", window, 40, 40);
      await pointer("pointerup", window, 40, 40);
      await act(async () => {
        await tick();
      });
    }
    async function openProjectBoard() {
      await render();
      await switchView("Board");
      await pickOption("Group tasks", "Group by project");
    }
    const columnLabels = () =>
      [
        ...container.querySelectorAll<HTMLElement>(
          "section[aria-label$=' column']",
        ),
      ].map((entry) => entry.getAttribute("aria-label"));

    it("shows one column per project with Personal last", async () => {
      await openProjectBoard();
      expect(columnLabels()).toEqual([
        "other column",
        "project column",
        "Personal column",
      ]);
    });

    it("moves a card to another project by dragging and keeps its status", async () => {
      await openProjectBoard();
      await drag("Fix installer", "other");
      expect(
        card("Fix installer").closest('[aria-label="other column"]'),
      ).not.toBeNull();
      expect(rows.get("first")?.projectCwd).toBe("/work/other");
      expect(rows.get("first")?.status).toBe("blocked");
    });

    it("moves a card to Personal by dropping it on the Personal column", async () => {
      await openProjectBoard();
      await drag("Ship docs", "Personal");
      expect(rows.get("docs")?.projectCwd).toBeUndefined();
      expect(
        card("Ship docs").closest('[aria-label="Personal column"]'),
      ).not.toBeNull();
    });
  });
});

describe("counts", () => {
  const headerCount = () =>
    container.querySelector<HTMLElement>(
      '[data-tauri-drag-region] [role="status"]',
    );
  const optionCounts = async (trigger: string) => {
    await click(container.querySelector(`button[aria-label^="${trigger}:"]`));
    const counts = Object.fromEntries(
      [...document.querySelectorAll<HTMLElement>('[role="option"]')].map(
        (option) => {
          return [
            option.querySelector("[data-option-label]")?.textContent?.trim(),
            Number(option.querySelector(".tabular-nums")?.textContent),
          ];
        },
      ),
    );
    await click(container.querySelector(`button[aria-label^="${trigger}:"]`));
    return counts;
  };

  it("shows the total in the header, then shown-of-total while filtered", async () => {
    await render();
    expect(headerCount()?.textContent).toBe("3");
    expect(headerCount()?.getAttribute("aria-label")).toBe("3 tasks");
    await pickOption("Status", "Todo");
    expect(headerCount()?.textContent).toBe("1 of 3");
    expect(headerCount()?.getAttribute("aria-label")).toBe(
      "1 of 3 tasks shown",
    );
  });

  it("shows faceted counts beside every filter option", async () => {
    await render();
    expect(await optionCounts("Status")).toMatchObject({
      "All statuses": 3,
      Todo: 1,
      Progress: 1,
      Blocked: 1,
      Verify: 0,
    });
    await pickOption("Project", "Personal");
    // The status facet now counts Personal tasks only.
    expect(await optionCounts("Status")).toMatchObject({
      "All statuses": 1,
      Todo: 1,
      Blocked: 0,
    });
    // The project facet ignores its own filter.
    expect(await optionCounts("Project")).toMatchObject({
      "All projects": 3,
      Personal: 1,
    });
    expect(await optionCounts("Tag")).toMatchObject({ "#home": 1, "#bug": 0 });
  });
});

describe("focus, archive and the task menu", () => {
  const menuItem = (label: string) =>
    [
      ...document.querySelectorAll<HTMLElement>(
        '[role="menuitem"], [role="menuitemcheckbox"]',
      ),
    ].find(
      (entry) =>
        (entry.querySelector("[data-menu-label]") ?? entry).textContent?.trim() ===
        label,
    );
  async function rightClick(element: HTMLElement) {
    await act(async () => {
      element.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 20,
          clientY: 20,
        }),
      );
    });
  }

  it("Focus shows only tasks created today or pinned to today, with a count", async () => {
    rows.set("personal", { ...rows.get("personal")!, focusDate: localDay() });
    await render();
    const focus = container.querySelector<HTMLButtonElement>(
      'button[aria-label^="Focus:"]',
    )!;
    expect(focus.getAttribute("aria-label")).toBe(
      "Focus: 1 of 3 tasks are in today's focus",
    );
    expect(focus.getAttribute("aria-pressed")).toBe("false");
    // The week strip starts on All.
    expect(
      container.querySelector('[role="tablist"][aria-label="Task days"] [aria-selected="true"]')
        ?.textContent,
    ).toContain("All");
    await click(focus);
    expect(focus.getAttribute("aria-pressed")).toBe("true");
    expect(listTitles()).toEqual(["Personal reminder"]);
    expect(localStorage.getItem("monocode.tasks.focus")).toBe("true");
    await click(focus);
    expect(listTitles()).toHaveLength(3);
    expect(localStorage.getItem("monocode.tasks.focus")).toBe("false");
  });

  it("selecting another strip day shows Focus off and groups the list", async () => {
    const yesterday = localDay(Date.now() - 86_400_000);
    rows.set("personal", { ...rows.get("personal")!, focusDate: yesterday });
    await render();
    const tabs = () =>
      [...container.querySelectorAll<HTMLElement>('[aria-label="Task days"] [role="tab"]')].filter(
        (entry) => !/^All/.test(entry.getAttribute("aria-label") ?? ""),
      );
    // Yesterday is the middle-left tab (3 days before .. 3 days after today).
    await click(tabs()[2]);
    const focus = container.querySelector<HTMLButtonElement>(
      'button[aria-label^="Focus:"]',
    )!;
    expect(focus.getAttribute("aria-pressed")).toBe("false");
    expect(container.textContent).toContain("In focus");
    expect(listTitles()).toEqual(["Personal reminder"]);
    // Back to All from the strip.
    await click(
      container.querySelector<HTMLElement>('[aria-label="Task days"] [aria-label^="All"]'),
    );
    expect(listTitles()).toHaveLength(3);
  });

  it("shows the past and future empty states for strip days", async () => {
    await render();
    const strip = () =>
      container.querySelector<HTMLElement>('[aria-label="Task days"]')!;
    const dayTabs = () =>
      [...strip().querySelectorAll<HTMLElement>('[role="tab"]')].filter(
        (entry) => !/^All/.test(entry.getAttribute("aria-label") ?? ""),
      );
    // Yesterday: nothing recorded. Tomorrow: nothing planned.
    await click(dayTabs()[2]);
    expect(container.textContent).toContain("Nothing recorded for");
    await click(dayTabs()[4]);
    expect(container.textContent).toContain("Nothing planned for");
  });

  it("offers carry-over only with Today selected and sends today with it", async () => {
    rows.set("docs", { ...rows.get("docs")!, focusDate: "2020-01-01" });
    await render();
    expect(container.textContent).not.toContain("unfinished from earlier focus");
    await click(container.querySelector('button[aria-label^="Focus:"]'));
    expect(container.textContent).toContain("1 unfinished from earlier focus");
    await click(button("Carry over"));
    expect(rows.get("docs")?.focusDate).toBe(localDay());
    const carried = upserts.at(-1);
    expect(carried).toMatchObject({ focusDate: localDay(), today: localDay() });
    expect(listTitles()).toEqual(["Ship docs"]);
  });

  it("archives from the right-click menu, hides it, and shows it struck through", async () => {
    await render();
    await rightClick(listRow("Ship docs"));
    expect(menuItem("Open beside session")).toBeUndefined();
    await click(menuItem("Archive"));
    expect(rows.get("docs")?.archivedAt).toBeDefined();
    expect(rows.get("docs")?.status).toBe("in_progress");
    expect(listTitles()).not.toContain("Ship docs");
    await click(button("Archived"));
    const archived = listRow("Ship docs");
    expect(archived.dataset.archived).toBe("");
    expect(archived.querySelector(".line-through")).not.toBeNull();
    await rightClick(archived);
    await click(menuItem("Unarchive"));
    expect(rows.get("docs")?.archivedAt).toBeUndefined();
  });

  it("moves, focuses and works on a task from the menu", async () => {
    const workOn = vi.fn();
    await act(async () =>
      root.render(
        createElement(TasksView, {
          cwd: "/work/project",
          recents: [{ path: "/work/project", openedAt: 1 }],
          onClose,
          onOpenSource: sourceOpen,
          onOpenBeside: openBeside,
          onWorkOn: workOn,
        }),
      ),
    );
    await rightClick(listRow("Fix installer"));
    await click(menuItem("Focus on"));
    await click(menuItem("Today"));
    expect(rows.get("first")?.focusDate).toBe(localDay());
    expect(upserts.at(-1)).toMatchObject({
      focusDate: localDay(),
      today: localDay(),
    });
    await rightClick(listRow("Fix installer"));
    await click(menuItem("Start Work"));
    expect(workOn).toHaveBeenCalledWith(expect.objectContaining({ id: "first" }));
    await rightClick(listRow("Fix installer"));
    await click(menuItem("Copy"));
    expect(copy).toHaveBeenCalledWith(expect.stringContaining("# Fix installer"));
  });
});


describe("New task while the pane is open", () => {
  it("keeps the pane open on the new task, even with filters and Focus on", async () => {
    await render();
    await click(listRow("Fix installer"));
    expect(peek()).not.toBeNull();
    await pickOption("Status", "Verify");
    await click(container.querySelector('button[aria-label^="Focus:"]'));
    await click(byLabel("New task"));
    await act(async () => {
      await tick(20);
    });
    expect(peek()).not.toBeNull();
    const created = [...rows.values()].find((entry) => entry.title === "Untitled")!;
    expect(created).toBeDefined();
    expect(input("Task title").value).toBe("Untitled");
    expect(document.activeElement).toBe(input("Task title"));
    // Filters that would hide the new task were cleared.
    expect(listTitles()).toContain("Untitled");
  });
});

describe("toolbar layout and focus presentation", () => {
  it("centres Focus between the filters and the view controls and drops the Columns control", async () => {
    await render();
    const toolbar = byLabel("Filter tasks").parentElement!.parentElement!;
    const order = [...toolbar.querySelectorAll("button")].map(
      (entry) => entry.getAttribute("aria-label") ?? entry.textContent,
    );
    expect(order[0]).toBe("New task");
    expect(order[1]).toBe("Choose where the task is filed");
    const focus = order.findIndex((label) => /^Focus:/.test(label ?? ""));
    // After the filter pills, before Archived and the view switch.
    expect(focus).toBeGreaterThan(order.findIndex((l) => /Project/.test(l ?? "")));
    expect(focus).toBeLessThan(order.findIndex((l) => /Archived/.test(l ?? "")));
    const focusButton = toolbar.querySelector<HTMLElement>('button[aria-label^="Focus:"]')!;
    const slot = focusButton.closest<HTMLElement>(".flex-1.justify-center")!;
    expect(slot).not.toBeNull();
    // The week strip sits inline in the centre, three days on each side of
    // Focus (Focus takes today's place), with All at the end.
    const strip = slot.querySelector<HTMLElement>('[role="tablist"][aria-label="Task days"]')!;
    expect(strip.contains(focusButton)).toBe(true);
    const items = [...strip.querySelectorAll<HTMLElement>('[role="tab"], button[aria-label^="Focus:"]')];
    const at = items.indexOf(focusButton);
    expect(items.slice(0, at).filter((item) => item.getAttribute("role") === "tab")).toHaveLength(3);
    expect(items.slice(at + 1).filter((item) => /^All/.test(item.getAttribute("aria-label") ?? ""))).toHaveLength(1);
    expect(items.slice(at + 1).filter((item) => item.getAttribute("role") === "tab")).toHaveLength(4);
    // One glide for the days and Focus together.
    expect(strip.querySelector("[data-shared-hover-highlight]")).not.toBeNull();
    expect(
      toolbar.querySelector('button[aria-label^="Focus:"]')!.hasAttribute("data-shared-hover-item"),
    ).toBe(true);
    expect(toolbar.textContent).not.toContain("Columns");
    await switchView("Board");
    expect(toolbar.textContent).not.toContain("Columns");
  });

  it("pads the toolbar like the board so New task and the view switch line up with the columns", async () => {
    await render();
    const toolbar = byLabel("Filter tasks").parentElement!.parentElement!;
    expect(toolbar.className).toContain("px-3");
    expect(toolbar.className).not.toContain("px-2");
  });

  it("bursts only at the Focus button, not across the toolbar", async () => {
    await render();
    const focus = container.querySelector<HTMLButtonElement>(
      'button[aria-label^="Focus:"]',
    )!;
    focus.getBoundingClientRect = () =>
      ({ left: 120, top: 8, width: 64, height: 28 }) as DOMRect;
    await click(focus);
    const bursts = document.querySelectorAll<HTMLElement>(
      "[data-celebration-burst]",
    );
    expect(bursts).toHaveLength(1);
    expect(bursts[0].style.left).toBe("120px");
    expect(bursts[0].style.width).toBe("64px");
    expect(bursts[0].children).toHaveLength(1);
  });

  it("shows the focus day chip on rows and cards, but not for tasks in focus by creation", async () => {
    rows.set("docs", { ...rows.get("docs")!, focusDate: localDay() });
    rows.set("first", {
      ...rows.get("first")!,
      focusDate: "2020-01-02",
      focusDays: ["2020-01-01"],
    });
    await render();
    expect(listRow("Ship docs").querySelector("[data-focus-chip]")?.textContent).toBe(
      "Today",
    );
    expect(listRow("Fix installer").querySelector("[data-focus-chip]")?.textContent).toContain(
      "Since",
    );
    expect(listRow("Personal reminder").querySelector("[data-focus-chip]")).toBeNull();
    await switchView("Board");
    expect(card("Ship docs").querySelector("[data-focus-chip]")?.textContent).toBe("Today");
  });

  it("shows the status instead of the project when grouped by project", async () => {
    await render();
    expect(listRow("Fix installer").textContent).toContain("project");
    await pickOption("Group tasks", "Group by project");
    const row = container.querySelector<HTMLElement>(
      'button[data-task-id="first"]',
    )!;
    expect(row.textContent).toContain("Blocked");
    expect(row.textContent).not.toContain("/work/project");
    await switchView("Board");
    await pickOption("Group tasks", "Group by project");
    expect(card("Fix installer").textContent).toContain("Blocked");
    expect(card("Ship docs").textContent).toContain("Progress");
    await pickOption("Group tasks", "Group by status");
    expect(card("Fix installer").textContent).toContain("project");
  });
});

describe("task title autosave", () => {
  it("keeps a trailing space while typing and trims it on blur", async () => {
    await render();
    await click(listRow("Fix installer"));
    const title = input("Task title");
    act(() => title.focus());
    await change("Task title", "Fix the ");
    await act(async () => {
      await tick(450);
    });
    expect(rows.get("first")?.title).toBe("Fix the");
    expect(input("Task title").value).toBe("Fix the ");
    await act(async () => input("Task title").blur());
    expect(input("Task title").value).toBe("Fix the");
  });
});

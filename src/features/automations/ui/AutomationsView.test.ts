// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  listAutomations,
  createAutomationTrigger,
  newAutomationDraft,
  notifyAutomationsChanged,
  peekAutomations,
  type Automation,
} from "../model/automations";
import { AutomationsView } from "./AutomationsView";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", async (original) => ({
  ...(await original<typeof import("@tauri-apps/api/core")>()),
  invoke,
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: async () => () => {} }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    isMaximized: async () => false,
    onResized: async () => () => {},
  }),
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  notifyAutomationsChanged();
  invoke.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("shows the cached automation list immediately and refreshes it without a loading screen", async () => {
  const automation: Automation = {
    ...newAutomationDraft("/work/project", "codex", "model"),
    id: "test-automation",
    name: "Daily review",
    nextRunAt: 0,
    createdAt: 1,
    updatedAt: 1,
  };
  invoke.mockResolvedValue([automation]);
  await listAutomations();
  let finish!: (automations: Automation[]) => void;
  const refresh = new Promise<Automation[]>((resolve) => {
    finish = resolve;
  });
  invoke.mockReturnValue(refresh);
  await act(async () =>
    root.render(
      createElement(AutomationsView, {
        cwd: "/work/project",
        recents: [],
        onClose: vi.fn(),
        onLaunch: vi.fn(),
        onOpenSession: vi.fn(),
      }),
    ),
  );
  expect(
    container.querySelector('[aria-label="Open Daily review"]'),
  ).not.toBeNull();
  expect(container.querySelector(".animate-spin")).toBeNull();

  await act(async () => finish([{ ...automation, name: "Updated review" }]));
  expect(
    container.querySelector('[aria-label="Open Updated review"]'),
  ).not.toBeNull();
  expect(
    container.querySelector('[aria-label="Open Daily review"]'),
  ).toBeNull();
});

it("invalidates the cached list when an automation changes", async () => {
  invoke.mockResolvedValue([]);
  await listAutomations();
  expect(peekAutomations()).toEqual([]);
  notifyAutomationsChanged();
  expect(peekAutomations()).toBeNull();
});

async function openEditor(automation: Automation): Promise<void> {
  invoke.mockImplementation(async (command: string) => {
    if (command === "automations_list") return [automation];
    return [];
  });
  await act(async () => root.render(createElement(AutomationsView, {
    cwd: "/work/project", recents: [], onClose: vi.fn(), onLaunch: vi.fn(), onOpenSession: vi.fn(),
  })));
  await act(async () => container.querySelector<HTMLButtonElement>(`[aria-label="Open ${automation.name}"]`)!.click());
}

async function input(label: string, value: string): Promise<void> {
  const field = container.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setter.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

it("edits and persists a custom schedule and Operator while blocking invalid input", async () => {
  const automation: Automation = {
    ...newAutomationDraft("/work/project", "codex", "model"),
    id: "custom-schedule", name: "Custom schedule",
    prompt: "Check open tasks", runtimeMode: "supervised",
    scheduleKind: "custom", cron: "0 21 * * *",
    triggers: [createAutomationTrigger("time", "custom", { cron: "0 21 * * *" })],
    nextRunAt: Date.now() + 86_400_000, createdAt: 1, updatedAt: 1,
  };
  await openEditor(automation);
  expect(container.querySelector('[aria-label="Cron expression"]')).not.toBeNull();
  expect(container.querySelector('[aria-label="Cron hour"]')).not.toBeNull();
  expect(container.textContent).toContain("At 21:00; every day; every month.");
  expect(container.textContent).toContain("Next run");
  expect(container.textContent).not.toMatch(/GMT[^·]+ · Next run/);
  await input("Cron expression", "* */2 * * *");
  expect(container.textContent).toContain("Every minute during hours 00, 02, 04");
  await input("Cron minute", "0");
  expect(container.textContent).toContain("At minute 00 during hours 00, 02, 04");
  expect(container.textContent).not.toContain("Every minute during hours");
  await input("Cron expression", "* * 2 *");
  expect(container.textContent).toContain("Use five fields");
  expect(container.textContent).not.toContain("Uses this computer's local timezone.");
  expect(container.querySelector<HTMLButtonElement>('[type="submit"]')!.disabled).toBe(true);
  await input("Cron expression", "*/15 9-17 * * 1-5");
  await input("Cron hour", "21");
  expect(container.querySelector<HTMLInputElement>('[aria-label="Cron expression"]')!.value).toBe("*/15 21 * * 1-5");
  await act(async () => container.querySelector<HTMLButtonElement>('[role="switch"][aria-label="Operator mode"]')!.click());
  expect(container.querySelector('[aria-label="Operator mode"]')?.getAttribute("aria-checked")).toBe("true");
  invoke.mockImplementation(async (command: string, args?: { automation: Automation }) => {
    if (command === "automations_list") return [automation];
    if (command === "automations_upsert") return { ...args!.automation, createdAt: 1, updatedAt: 2 };
    return [];
  });
  await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(invoke).toHaveBeenCalledWith("automations_upsert", { automation: expect.objectContaining({
    cron: "*/15 21 * * 1-5", operatorMode: true,
    runtimeMode: "supervised", workspaceMode: "worktree", model: "model",
    triggers: [expect.objectContaining({ scheduleKind: "custom", cron: "*/15 21 * * 1-5" })],
  }) });
});

it("reuses the Advanced switch without changing a simple schedule's meaning", async () => {
  await openEditor({
    ...newAutomationDraft("/work/project", "codex", "model"),
    id: "simple", name: "Simple schedule", prompt: "Review",
    triggers: [createAutomationTrigger("time", "daily", { time: "21:00" })],
    nextRunAt: 1, createdAt: 1, updatedAt: 1,
  });
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Advanced custom schedule"]')!.click());
  expect(container.querySelector<HTMLInputElement>('[aria-label="Cron expression"]')!.value).toBe("0 21 * * *");
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Advanced custom schedule"]')!.click());
  expect(container.querySelector('[aria-label="Cron expression"]')).toBeNull();
  expect(container.textContent).toContain("Every day at");
});

it("adds Advanced custom from the Scheduled trigger selector", async () => {
  await openEditor({
    ...newAutomationDraft("/work/project", "codex", "model"),
    id: "empty", name: "No trigger", prompt: "Review",
    nextRunAt: 1, createdAt: 1, updatedAt: 1,
  });
  const button = (text: string): HTMLButtonElement => {
    const found = Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
      .find((entry) => entry.textContent?.trim() === text);
    if (!found) throw new Error(`Missing button ${text}`);
    return found;
  };
  await act(async () => button("Add Trigger").click());
  await act(async () => button("Scheduled").click());
  await act(async () => button("Advanced custom").click());
  expect(container.querySelector<HTMLInputElement>('[aria-label="Cron expression"]')!.value).toBe("0 21 * * *");
  expect(container.querySelector('[aria-label="Advanced custom schedule"]')!.getAttribute("aria-checked")).toBe("true");
});

it("resizes the automations list by dragging, remembers the width, and resets on double-click", async () => {
  invoke.mockResolvedValue([]);
  const props = {
    cwd: "/work/project",
    recents: [],
    onClose: vi.fn(),
    onLaunch: vi.fn(),
    onOpenSession: vi.fn(),
  };
  await act(async () => root.render(createElement(AutomationsView, props)));
  const handle = (): HTMLElement =>
    container.querySelector<HTMLElement>(
      '[role="separator"][aria-label="Resize automations list"]',
    )!;
  const list = (): HTMLElement => handle().parentElement!;
  expect(list().tagName).toBe("ASIDE");
  expect(list().style.width).toBe("280px");
  handle().setPointerCapture = vi.fn();
  handle().releasePointerCapture = vi.fn();
  const pointer = (type: string, clientX: number): PointerEvent =>
    new PointerEvent(type, { bubbles: true, button: 0, pointerId: 1, clientX });
  await act(async () => {
    handle().dispatchEvent(pointer("pointerdown", 100));
    window.dispatchEvent(pointer("pointermove", 160));
    window.dispatchEvent(pointer("pointerup", 160));
  });
  expect(list().style.width).toBe("340px");
  // Clamped to the 420px maximum.
  await act(async () => {
    handle().dispatchEvent(pointer("pointerdown", 0));
    window.dispatchEvent(pointer("pointermove", 900));
    window.dispatchEvent(pointer("pointerup", 900));
  });
  expect(list().style.width).toBe("420px");
  await act(async () => root.unmount());
  root = createRoot(container);
  await act(async () => root.render(createElement(AutomationsView, props)));
  expect(list().style.width).toBe("420px");
  await act(async () =>
    handle().dispatchEvent(new MouseEvent("dblclick", { bubbles: true })),
  );
  expect(list().style.width).toBe("280px");
});

it("lists only automations for the scoped project, plus project-less ones", async () => {
  const automation = (id: string, name: string, cwd: string): Automation => ({
    ...newAutomationDraft(cwd, "codex", "model"),
    id,
    name,
    nextRunAt: 0,
    createdAt: 1,
    updatedAt: 1,
  });
  invoke.mockImplementation(async (command: string) =>
    command.includes("run")
      ? []
      : [
          automation("here", "Here review", "/work/project"),
          automation("there", "There review", "/work/other"),
          automation("home", "Home review", "~"),
        ],
  );
  await act(async () =>
    root.render(
      createElement(AutomationsView, {
        cwd: "/work/project",
        scopeProject: "/work/project",
        recents: [],
        onClose: vi.fn(),
        onLaunch: vi.fn(),
        onOpenSession: vi.fn(),
      }),
    ),
  );
  const shown = (name: string) =>
    container.querySelector(`[aria-label="Open ${name}"]`) != null;
  expect(shown("Here review")).toBe(true);
  expect(shown("Home review")).toBe(true);
  expect(shown("There review")).toBe(false);
});

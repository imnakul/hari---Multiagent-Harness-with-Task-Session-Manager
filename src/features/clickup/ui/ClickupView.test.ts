// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LIST_INFO, MEMBER_ANA, makeTask } from "../model/clickupTestKit";

vi.mock("../../../app/shell/TitleBar", () => ({ OverlayNav: () => null }));
vi.mock("../../../app/shell/WindowControls", () => ({ WindowControls: () => null }));

const files = vi.hoisted(() => ({ open: vi.fn(), copy: vi.fn() }));
vi.mock("../../../platform/tauri/fs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../platform/tauri/fs")>()),
  openPathWithDefaultApp: files.open,
  copyFileToClipboard: files.copy,
}));

const api = vi.hoisted(() => ({
  isConnected: vi.fn(),
  me: vi.fn(),
  setToken: vi.fn(),
  disconnect: vi.fn(),
  list: vi.fn(),
  members: vi.fn(),
  tasks: vi.fn(),
  task: vi.fn(),
  taskDetails: vi.fn(),
  createTask: vi.fn(),
  updateTask: vi.fn(),
  postComment: vi.fn(),
  downloadAttachment: vi.fn(),
  saveAttachment: vi.fn(),
}));

vi.mock("../model/clickupApi", async (importOriginal) => {
  const original = await importOriginal<typeof import("../model/clickupApi")>();
  return { ...original, clickupApi: api };
});

import { ClickupError } from "../model/clickupApi";
import { CLICKUP_CONFIG_KEY } from "../model/clickupConfig";
import { clickupStore } from "../model/clickupStore";
import { ClickupView } from "./ClickupView";

let container: HTMLDivElement;
let root: Root;
const stored = new Map<string, string>();

type Props = ComponentProps<typeof ClickupView>;

function props(patch: Partial<Props> = {}): Props {
  return {
    tabbed: true,
    projects: ["/work/app"],
    currentProject: "/work/app",
    monos: [],
    samePath: (a, b) => a === b,
    onClose: vi.fn(),
    onStartSession: vi.fn(),
    onGiveToMono: vi.fn(),
    ...patch,
  };
}

async function render(view: Props): Promise<void> {
  await act(async () => {
    root.render(createElement(ClickupView, view));
  });
  await act(async () => {
    await Promise.resolve();
  });
}

function button(name: string): HTMLButtonElement {
  const found = [...container.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.trim() === name || candidate.getAttribute("aria-label") === name,
  );
  if (!found) throw new Error(`No button named ${name}`);
  return found;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  stored.clear();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
    removeItem: (key: string) => stored.delete(key),
    clear: () => stored.clear(),
  });
  Object.values(api).forEach((mock) => mock.mockReset());
  api.list.mockResolvedValue(LIST_INFO);
  api.members.mockResolvedValue([MEMBER_ANA]);
  api.me.mockResolvedValue(MEMBER_ANA);
  api.downloadAttachment.mockResolvedValue({ path: "C:/cache/a1/screen.png", name: "screen.png", size: 2048 });
  api.taskDetails.mockImplementation(async (id: string) => ({
    task: makeTask(id, {
      name: "Write docs",
      markdownDescription: "Repro on https://app.example.com/login. Logs: https://logs.example.com/x",
      customFields: [{ id: "u", name: "Related Links", type: "url", text: "https://app.example.com/login", color: null }],
    }),
    attachments: [{ id: "a1", title: "screen.png", url: "https://t.example/screen.png", extension: "png", size: 2048, date: null }],
    checklists: [{ id: "c1", name: "QA", items: [{ id: "i1", name: "Check prod", resolved: true }] }],
    subtasks: [],
    linkedTaskIds: [],
    dependencies: [{ id: "t2", kind: "waitingOn" }],
    creator: MEMBER_ANA,
    watchers: [],
    timeEstimate: null,
    timeSpent: null,
    points: null,
    parentId: null,
    comments: [{ id: "m1", text: "Seen again, see https://logs.example.com/y", user: MEMBER_ANA, date: null }],
    commentsFailed: false,
  }));
  // RevealHeight folds away on animationend, which happy-dom never fires; reduced motion removes at once.
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("reduce"), addEventListener: () => {}, removeEventListener: () => {} }));
  api.tasks.mockResolvedValue({ tasks: [makeTask("1", { name: "Write docs" })], lastPage: true });
  clickupStore.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function linkProject(): void {
  stored.set(
    CLICKUP_CONFIG_KEY,
    JSON.stringify({ projectPath: "/work/app", lists: [{ id: "9001", name: "Sprint" }] }),
  );
}

describe("ClickupView (L-381)", () => {
  it("asks for a token when ClickUp is not connected, and shows a bad token plainly (AC-C1)", async () => {
    api.isConnected.mockResolvedValue(false);
    api.setToken.mockRejectedValue(new ClickupError("auth"));
    await render(props());
    expect(container.textContent).toContain("Connect ClickUp");
    const input = container.querySelector<HTMLInputElement>("input[type=password]");
    expect(input).not.toBeNull();
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, "pk_bad");
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      button("Connect").click();
    });
    expect(container.textContent).toContain("ClickUp didn't accept this token.");
    expect(container.textContent).not.toContain("pk_bad");
  });

  it("shows loading rows, then the open tasks (AC-C2)", async () => {
    linkProject();
    api.isConnected.mockResolvedValue(true);
    await render(props());
    await act(async () => {
      await Promise.resolve();
    });
    expect(container.textContent).toContain("Write docs");
    expect(container.querySelector("[aria-label='Loading tasks']")).toBeNull();
  });

  it("shows the empty state when a list has no open tasks (AC-C2)", async () => {
    linkProject();
    api.isConnected.mockResolvedValue(true);
    api.tasks.mockResolvedValue({ tasks: [], lastPage: true });
    await render(props());
    await act(async () => {
      await Promise.resolve();
    });
    expect(container.textContent).toContain("No open tasks in Sprint.");
  });

  it("offers a retry when the list fails to load (AC-C10)", async () => {
    linkProject();
    api.isConnected.mockResolvedValue(true);
    api.tasks.mockRejectedValue(new ClickupError("network"));
    await render(props());
    await act(async () => {
      await Promise.resolve();
    });
    expect(container.textContent).toContain("Couldn't reach ClickUp.");
    expect(button("Try again")).toBeTruthy();
  });

  it("lists only the Monos that work on the project, and disables one never started (AC-C12)", async () => {
    linkProject();
    api.isConnected.mockResolvedValue(true);
    const onGiveToMono = vi.fn();
    await render(
      props({
        onGiveToMono,
        monos: [
          { id: "a", name: "MonoCrab", sessionId: "s-a", projects: ["/work/app"] },
          { id: "b", name: "MonoGhost", projects: ["/work/app"] },
          { id: "c", name: "MonoOther", sessionId: "s-c", projects: ["/elsewhere"] },
        ],
      }),
    );
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>("ul button")?.click();
    });
    await act(async () => {
      button("Start session").click();
    });
    const menu = document.body.textContent ?? "";
    expect(menu).toContain("MonoCrab");
    expect(menu).toContain("MonoGhost");
    expect(menu).toContain("Not started yet");
    expect(menu).not.toContain("MonoOther");
    await act(async () => {
      [...document.querySelectorAll<HTMLButtonElement>("[role=menuitem]")]
        .find((item) => item.textContent?.includes("MonoCrab"))
        ?.click();
    });
    // The task goes over with its details as text and its files downloaded for the composer.
    await vi.waitFor(() =>
      expect(onGiveToMono).toHaveBeenCalledWith("a", expect.stringContaining("Write docs"), ["C:/cache/a1/screen.png"]),
    );
    expect(onGiveToMono.mock.calls[0]?.[1]).toContain("Attached files: screen.png");
    expect(api.downloadAttachment).toHaveBeenCalledWith("1", "a1");
  });

  it("groups by status, folds a group, and switches to Table and Board with the choice kept", async () => {
    linkProject();
    api.isConnected.mockResolvedValue(true);
    api.tasks.mockResolvedValue({
      tasks: [
        makeTask("1", { name: "Write docs" }),
        makeTask("2", {
          name: "Fix login",
          status: { status: "in progress", type: "custom", color: "#bbb" },
          customFields: [{ id: "sev", name: "Severity", type: "drop_down", text: "S2", color: "#f80" }],
        }),
      ],
      lastPage: true,
    });
    await render(props());
    await act(async () => {
      await Promise.resolve();
    });
    const header = container.querySelector<HTMLButtonElement>('[data-clickup-group="status:in progress"]');
    expect(header?.textContent).toContain("in progress");
    await act(async () => {
      header?.click();
    });
    expect(container.textContent).not.toContain("Fix login");
    expect(container.textContent).toContain("Write docs");

    await act(async () => {
      button("Table").click();
    });
    const headers = [...container.querySelectorAll("th[scope=col]")].map((cell) => cell.textContent);
    expect(headers).toEqual(expect.arrayContaining(["Name", "Status", "Severity", "Task ID"]));
    expect(JSON.parse(stored.get("monocode.clickup.view") ?? "{}")).toMatchObject({
      view: "table",
      collapsed: ["status:in progress"],
    });
    // The whole group row folds in Table, not only the status button.
    await act(async () => {
      container.querySelector<HTMLElement>("th[scope=colgroup]")?.click();
    });
    expect(JSON.parse(stored.get("monocode.clickup.view") ?? "{}").collapsed).toEqual(["status:in progress", "status:to do"]);

    await act(async () => {
      button("Board").click();
    });
    const columns = [...container.querySelectorAll("[data-board-column]")].map((column) =>
      column.getAttribute("data-board-column"),
    );
    expect(columns).toEqual(["status:to do", "status:in progress"]);
    expect(container.textContent).toContain("Fix login");
    // The list switcher shows how many tasks each tab holds.
    expect(container.querySelector("[role=tab]")?.textContent).toBe("All2");
    // A divider sits between neighbours, none after the last column.
    expect(container.querySelector("[aria-label='Resize to do column']")).not.toBeNull();
    expect(container.querySelector("[aria-label='Resize in progress column']")).toBeNull();
  });

  it("sorts from a Table header and flips direction on a second click", async () => {
    linkProject();
    api.isConnected.mockResolvedValue(true);
    stored.set("monocode.clickup.view", JSON.stringify({ view: "table", groupBy: "none" }));
    api.tasks.mockResolvedValue({
      tasks: [makeTask("1", { name: "beta" }), makeTask("2", { name: "alpha" })],
      lastPage: true,
    });
    await render(props());
    await act(async () => {
      await Promise.resolve();
    });
    const ids = () =>
      [...container.querySelectorAll("tr[data-clickup-row]")].map((row) => row.getAttribute("data-clickup-row"));
    await act(async () => {
      button("Name").click();
    });
    expect(ids()).toEqual(["2", "1"]);
    await act(async () => {
      button("Name").click();
    });
    expect(ids()).toEqual(["1", "2"]);
    expect(JSON.parse(stored.get("monocode.clickup.view") ?? "{}").sort).toEqual({ field: "name", dir: "desc" });
  });

  it("filters to the connected user's tasks from the Assignee button, and remembers it", async () => {
    linkProject();
    api.isConnected.mockResolvedValue(true);
    api.tasks.mockResolvedValue({
      tasks: [makeTask("1", { name: "Mine", assignees: [MEMBER_ANA] }), makeTask("2", { name: "Someone else's" })],
      lastPage: true,
    });
    await render(props());
    await act(async () => {
      await Promise.resolve();
    });
    const assignee = container.querySelector<HTMLButtonElement>("button[aria-pressed][aria-label^='Assignee:']");
    expect(assignee?.textContent).toContain("Assignee: Ana");
    expect(assignee?.textContent).toContain("1/2");
    expect(assignee?.getAttribute("aria-pressed")).toBe("false");
    await act(async () => {
      assignee?.click();
    });
    expect(assignee?.getAttribute("aria-pressed")).toBe("true");
    expect(assignee?.className).toContain("bg-amber-400/15");
    expect(container.textContent).toContain("Mine");
    expect(container.textContent).not.toContain("Someone else's");
    expect(JSON.parse(stored.get("monocode.clickup.view") ?? "{}").mine).toBe(true);
  });

  it("shows the task's links, attachments, checklist, relations and comments in the panel", async () => {
    linkProject();
    api.isConnected.mockResolvedValue(true);
    await render(props());
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>("ul button")?.click();
    });
    await act(async () => {
      await Promise.resolve();
    });
    const panel = container.querySelector("aside[aria-label=Task]");
    const text = panel?.textContent ?? "";
    const links = panel?.querySelector("section[aria-label=Links]");
    expect(links?.querySelectorAll("li")).toHaveLength(3);
    expect(links?.textContent).toContain("Related Links");
    expect(text).toContain("screen.png");
    expect(text).toContain("PNG · 2 KB");
    expect(text).toContain("1/1 done");
    expect(text).toContain("Waiting on");
    expect(text).toContain("Seen again");
    expect(panel?.querySelector("button[aria-label='Close task']")?.textContent).toBe("");
  });

  it("opens and copies an attachment from its downloaded copy, and posts a comment as you", async () => {
    linkProject();
    api.isConnected.mockResolvedValue(true);
    files.open.mockResolvedValue(undefined);
    files.copy.mockResolvedValue(undefined);
    api.postComment.mockResolvedValue(undefined);
    await render(props());
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>("ul button")?.click();
    });
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>("button[title='Open screen.png']")?.click();
    });
    expect(api.downloadAttachment).toHaveBeenCalledWith("1", "a1");
    expect(files.open).toHaveBeenCalledWith("C:/cache/a1/screen.png");
    await act(async () => {
      container.querySelector<HTMLButtonElement>("button[aria-label='Copy screen.png']")?.click();
    });
    expect(files.copy).toHaveBeenCalledWith("C:/cache/a1/screen.png");
    expect(container.textContent).toContain("Copied");

    const detailsLoads = api.taskDetails.mock.calls.length;
    const box = container.querySelector<HTMLTextAreaElement>("textarea[aria-label='Write a comment']");
    expect(button("Comment").disabled).toBe(true);
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(box, "  Looks good  ");
      box?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      button("Comment").click();
    });
    expect(api.postComment).toHaveBeenCalledWith("1", "  Looks good  ");
    expect(box?.value).toBe("");
    expect(api.taskDetails.mock.calls.length).toBeGreaterThan(detailsLoads);
  });

  it("opens New task in the side panel instead of a dialog", async () => {
    linkProject();
    api.isConnected.mockResolvedValue(true);
    await render(props());
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      button("New task").click();
    });
    expect(container.querySelector("aside[aria-label='New task']")).not.toBeNull();
    expect(document.querySelector("[role=dialog]")).toBeNull();
    expect(button("Create task").disabled).toBe(true);
  });

  it("removes the token and returns to the connect form on Disconnect (AC-C11)", async () => {
    linkProject();
    api.isConnected.mockResolvedValue(true);
    api.disconnect.mockResolvedValue(undefined);
    await render(props());
    await act(async () => {
      button("ClickUp settings").click();
    });
    await act(async () => {
      button("Disconnect").click();
    });
    expect(api.disconnect).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("Connect ClickUp");
  });
});

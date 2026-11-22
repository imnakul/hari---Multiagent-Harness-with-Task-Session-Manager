// @vitest-environment happy-dom
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const github = vi.hoisted(() => ({
  status: vi.fn(),
  repo: vi.fn(),
  list: vi.fn(),
}));
vi.mock("../model/githubTasks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../model/githubTasks")>()),
  githubStatus: github.status,
  githubRepo: github.repo,
  listGithubWorkItems: github.list,
}));

import { InboxSidebarPane } from "./InboxSidebarPane";
import { clearSidebarInboxCache } from "../model/sidebarInboxItems";

const item = (kind: "pr" | "issue", number: number, updatedAt: string, patch = {}) => ({
  kind, number, title: `${kind} ${number}`, url: `https://x/${number}`, state: "open",
  updatedAt, labels: [], assignees: [], draft: false, repo: "o/n", ...patch,
});
const flush = () => act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); });

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const onOpenItem = vi.fn();
const onOpenInbox = vi.fn();

async function mount(props: { cwd?: string; remote?: boolean } = {}): Promise<void> {
  act(() =>
    root.render(createElement(InboxSidebarPane, { cwd: "/p", remote: false, onOpenItem, onOpenInbox, ...props })),
  );
  await flush();
}
const click = (find: (b: HTMLButtonElement) => boolean) =>
  act(() => {
    [...host.querySelectorAll("button")].find(find)?.click();
  });

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  clearSidebarInboxCache();
  Object.values(github).forEach((fn) => fn.mockReset());
  onOpenItem.mockReset();
  onOpenInbox.mockReset();
  github.status.mockResolvedValue({ connected: true, installed: true, authenticated: true });
  github.repo.mockResolvedValue("o/n");
  github.list.mockImplementation((_cwd: string, _repo: string, query: { kind: string }) =>
    Promise.resolve(
      query.kind === "pr"
        ? [item("pr", 1, "2026-01-01T00:00:00Z", { draft: true })]
        : [item("issue", 2, "2026-02-01T00:00:00Z")],
    ),
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("InboxSidebarPane", () => {
  it("asks for open PRs and issues of the repo and shows them newest first (AC-B6)", async () => {
    await mount();
    const query = { assignedToMe: false, state: "open", search: "" };
    expect(github.list).toHaveBeenCalledWith("/p", "o/n", { ...query, kind: "pr" });
    expect(github.list).toHaveBeenCalledWith("/p", "o/n", { ...query, kind: "issue" });
    const rows = [...host.querySelectorAll("li button")].map((b) => b.textContent ?? "");
    expect(rows[0]).toContain("issue 2");
    expect(rows[1]).toContain("pr 1");
    expect(rows[1]).toContain("Draft");
  });

  it("filters by kind (AC-B7)", async () => {
    await mount();
    click((b) => b.textContent === "Issues");
    expect(host.textContent).toContain("issue 2");
    expect(host.textContent).not.toContain("pr 1");
    click((b) => b.textContent === "Pull requests");
    expect(host.textContent).toContain("pr 1");
    expect(host.textContent).not.toContain("issue 2");
  });

  it("opens the full Inbox on the clicked item (AC-B10)", async () => {
    await mount();
    act(() => host.querySelector<HTMLButtonElement>("li button")?.click());
    expect(onOpenItem).toHaveBeenCalledWith({ kind: "issue", repo: "o/n", number: 2, url: "https://x/2" });
  });

  it("uses the cache for two minutes, and Refresh always asks (AC-B9)", async () => {
    await mount();
    expect(github.list).toHaveBeenCalledTimes(2);
    act(() => root.unmount());
    root = createRoot(host);
    await mount();
    expect(github.list).toHaveBeenCalledTimes(2);
    click((b) => b.getAttribute("aria-label") === "Refresh");
    await flush();
    expect(github.list).toHaveBeenCalledTimes(4);
  });

  it("ignores a slow response for the repo it left (AC-B8)", async () => {
    let releaseX: (value: unknown[]) => void = () => {};
    github.repo.mockImplementation((cwd: string) => Promise.resolve(cwd === "/x" ? "o/x" : "o/y"));
    github.list.mockImplementation((cwd: string, repo: string, query: { kind: string }) =>
      cwd === "/x"
        ? new Promise((resolve) => {
            releaseX = resolve;
          })
        : Promise.resolve(query.kind === "pr" ? [item("pr", 9, "2026-03-01T00:00:00Z", { repo })] : []),
    );
    await mount({ cwd: "/x" });
    await mount({ cwd: "/y" });
    releaseX([item("pr", 1, "2026-01-01T00:00:00Z", { repo: "o/x" })]);
    await flush();
    expect(host.textContent).toContain("pr 9");
    expect(host.textContent).not.toContain("pr 1");
  });

  it("shows the copy for each state (AC-B11)", async () => {
    github.status.mockResolvedValue({ connected: false, installed: true, authenticated: false });
    await mount();
    expect(host.textContent).toContain("Connect GitHub to see pull requests and issues.");
    click((b) => b.textContent === "Open Inbox");
    expect(onOpenInbox).toHaveBeenCalled();

    github.status.mockResolvedValue({ connected: true, installed: true, authenticated: true });
    github.repo.mockRejectedValue(new Error("no remote"));
    await mount({ cwd: "/q" });
    expect(host.textContent).toContain("This folder isn't a GitHub repository.");

    await mount({ remote: true });
    expect(host.textContent).toContain("GitHub isn't available for remote projects.");

    github.repo.mockResolvedValue("o/e");
    github.list.mockResolvedValue([]);
    await mount({ cwd: "/e" });
    expect(host.textContent).toContain("Nothing open in o/e.");

    github.repo.mockResolvedValue("o/f");
    github.list.mockRejectedValue(new Error("boom"));
    await mount({ cwd: "/f" });
    expect(host.querySelector("[role=alert]")?.textContent).toContain("Couldn't load GitHub items.");
    expect(host.textContent).toContain("Try again");
  });

  it("keeps the rows on screen while Refresh runs", async () => {
    await mount();
    let releaseStatus: (value: unknown) => void = () => {};
    github.status.mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseStatus = resolve;
        }),
    );
    click((b) => b.getAttribute("aria-label") === "Refresh");
    await flush();
    expect(host.textContent).toContain("issue 2");
    expect(host.querySelector("[aria-busy=true]")).toBeNull();
    const refresh = [...host.querySelectorAll("button")].find(
      (b) => b.getAttribute("aria-label") === "Refresh",
    );
    expect(refresh?.disabled).toBe(true);
    releaseStatus({ connected: true, installed: true, authenticated: true });
    await flush();
    expect(host.textContent).toContain("issue 2");
    expect(refresh?.disabled).toBe(false);
    expect(github.list).toHaveBeenCalledTimes(4);
  });

  it("keeps rows and notes a failed refresh", async () => {
    await mount();
    github.list.mockRejectedValue(new Error("boom"));
    click((b) => b.getAttribute("aria-label") === "Refresh");
    await flush();
    expect(host.textContent).toContain("issue 2");
    expect(host.textContent).toContain("Couldn't refresh.");
  });
});

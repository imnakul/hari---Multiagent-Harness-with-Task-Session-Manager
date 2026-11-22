// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fs = vi.hoisted(() => ({ gitBranches: vi.fn() }));
vi.mock("../../../platform/tauri/fs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../platform/tauri/fs")>()),
  gitBranches: fs.gitBranches,
}));
const choose = vi.hoisted(() => vi.fn());
vi.mock("../model/nestedRepos", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../model/nestedRepos")>()),
  chooseNestedRepo: choose,
}));

import { NestedReposChip } from "./NestedReposChip";

const repos = [
  { path: "/w/Teacher", name: "Teacher" },
  { path: "/w/student_dash", name: "student_dash" },
];
const flush = () => act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); });

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const onShowChanges = vi.fn();

function mount(enabled = true): void {
  act(() => root.render(createElement(NestedReposChip, { cwd: "/w", repos, enabled, onShowChanges })));
}
const trigger = () => document.querySelector<HTMLButtonElement>('[aria-label="Repositories: 2"]');
const row = (name: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((b) =>
    b.textContent?.startsWith(name),
  );

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  fs.gitBranches.mockReset();
  choose.mockReset();
  onShowChanges.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("NestedReposChip", () => {
  it("names the repo count and lists each repo's branch when opened", async () => {
    fs.gitBranches.mockImplementation((cwd: string) =>
      cwd === "/w/Teacher"
        ? Promise.resolve({ current: "preview", detached: false, branches: [] })
        : Promise.reject(new Error("boom")),
    );
    mount();
    expect(trigger()?.textContent).toContain("2 repos");
    act(() => trigger()?.click());
    expect(row("Teacher")?.textContent).toContain("…");
    await flush();
    expect(row("Teacher")?.textContent).toContain("preview");
    expect(row("student_dash")?.textContent).toContain("No branch");
  });

  it("picks the repo for Changes and opens Changes", async () => {
    fs.gitBranches.mockResolvedValue({ current: "main", detached: false, branches: [] });
    mount();
    act(() => trigger()?.click());
    await flush();
    act(() => row("student_dash")?.click());
    expect(choose).toHaveBeenCalledWith("/w", "/w/student_dash");
    expect(onShowChanges).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("drops a branch reply that arrives after the menu closed", async () => {
    let release: (value: unknown) => void = () => {};
    fs.gitBranches.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
    mount();
    act(() => trigger()?.click());
    act(() => trigger()?.click());
    release({ current: "late", detached: false, branches: [] });
    await flush();
    act(() => trigger()?.click());
    expect(row("student_dash")?.textContent).not.toContain("late");
  });

  it("is disabled while the composer is", () => {
    mount(false);
    expect(trigger()?.disabled).toBe(true);
  });
});

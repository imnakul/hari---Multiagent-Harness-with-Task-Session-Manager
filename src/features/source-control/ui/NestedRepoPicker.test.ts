// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NestedRepoPicker } from "./NestedRepoPicker";

const repos = [
  { path: "/work/landing-page", name: "landing-page" },
  { path: "/work/student_dash", name: "student_dash" },
  { path: "/work/Teacher", name: "Teacher" },
];
const change = vi.fn<(path: string) => void>();
const open = vi.fn<() => void>();
let root: Root;
let container: HTMLDivElement;

const render = async (value: string, colors?: ReadonlyMap<string, string>) => {
  await act(async () =>
    root.render(createElement(NestedRepoPicker, { repos, value, colors, onChange: change, onOpen: open })),
  );
};
const trigger = () => container.querySelector<HTMLButtonElement>('[aria-haspopup="listbox"]')!;
const options = () => [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')];

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  change.mockReset();
  open.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("names the chosen repository and lists every one with the chosen one marked", async () => {
  await render("/work/student_dash");
  expect(trigger().textContent).toBe("student_dash");
  expect(trigger().getAttribute("aria-label")).toBe("Repository: student_dash");

  await act(async () => trigger().click());
  expect(open).toHaveBeenCalledTimes(1);
  expect(options().map((option) => option.textContent)).toEqual(["landing-page", "student_dash", "Teacher"]);
  expect(options().map((option) => option.getAttribute("aria-selected"))).toEqual(["false", "true", "false"]);
});

it("picks a repository and closes", async () => {
  await render("/work/landing-page");
  await act(async () => trigger().click());
  await act(async () => options()[2]!.click());
  expect(change).toHaveBeenCalledWith("/work/Teacher");
  expect(options()).toHaveLength(0);
  expect(trigger().getAttribute("aria-expanded")).toBe("false");
});

it("shows each repository's colour dot only when colours are given", async () => {
  await render("/work/Teacher");
  expect(trigger().querySelector("span.rounded-full")).toBeNull();

  await render("/work/Teacher", new Map(repos.map((repo) => [repo.path, "rgb(255, 0, 0)"])));
  expect(trigger().querySelector<HTMLSpanElement>("span.rounded-full")?.style.backgroundColor).toBe("rgb(255, 0, 0)");
  await act(async () => trigger().click());
  expect(options().every((option) => option.querySelector("span.rounded-full"))).toBe(true);
});

it("falls back to the first repository when the saved one is gone", async () => {
  await render("/work/deleted");
  expect(trigger().textContent).toBe("landing-page");
});

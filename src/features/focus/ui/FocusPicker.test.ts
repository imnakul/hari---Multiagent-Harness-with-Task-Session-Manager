import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FocusSearchList,
  focusPickProjects,
  focusProjectMenuItems,
  type FocusPickItem,
} from "./FocusPicker";

const ITEMS: FocusPickItem[] = [
  {
    id: "a1",
    label: "Alpha one",
    group: "Done",
    detail: "alpha",
    project: { key: "c:/work/alpha", cwd: "C:/work/alpha" },
    model: "Opus 5.5",
  },
  {
    id: "b1",
    label: "Beta one",
    group: "Done",
    detail: "beta",
    project: { key: "c:/work/beta", cwd: "C:/work/beta" },
    model: "GPT-6",
  },
  {
    id: "a2",
    label: "Alpha two",
    group: "Done",
    detail: "alpha",
    project: { key: "c:/work/alpha", cwd: "C:/work/alpha" },
  },
];

function render(items: readonly FocusPickItem[], showModel = false): string {
  vi.stubGlobal("localStorage", {
    getItem: (key: string) =>
      key === "monocode.focusPickerShowModel.v1" && showModel ? "1" : null,
    setItem: () => {},
  });
  return renderToStaticMarkup(
    createElement(FocusSearchList, {
      items,
      label: "Chats",
      placeholder: "Search chats",
      emptyLabel: "No chats",
      onPick: () => {},
    }),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("Continue picker filters (L-145)", () => {
  it("lists each project once, in first-seen order", () => {
    expect(focusPickProjects(ITEMS).map((project) => project.key)).toEqual([
      "c:/work/alpha",
      "c:/work/beta",
    ]);
  });

  it("lists a folder saved plain and verbatim once, by its plain path (L-174)", () => {
    const projects = focusPickProjects([
      {
        id: "v1",
        label: "Verbatim",
        project: { key: "e:/site", cwd: "//?/E:/site" },
      },
      { id: "p1", label: "Plain", project: { key: "e:/site", cwd: "E:/site" } },
    ]);
    expect(projects.map((project) => project.cwd)).toEqual(["E:/site"]);
  });

  it("offers a project menu only when chats span projects (L-162, L-174)", () => {
    const html = render(ITEMS);
    expect(html).toContain('aria-haspopup="menu" aria-expanded="false" aria-label="Filter by project"');
    expect(html).toContain(">All projects<");
    // The trigger sits in the search row, before the Model toggle.
    expect(html.indexOf("Filter by project")).toBeLessThan(
      html.indexOf("Show each chat"),
    );
    expect(html).not.toContain("<select");
    expect(html).not.toContain("aria-pressed=\"true\"");
    expect(render(ITEMS.slice(0, 1))).not.toContain("Filter by project");
  });

  it("lists All projects, then each project, checking the current one (L-174)", () => {
    const projects = focusPickProjects(ITEMS);
    const all = focusProjectMenuItems(projects, null);
    expect(
      all.map((item) =>
        item.kind === "sep" ? "-" : `${item.label}:${item.checked ? "on" : "off"}`,
      ),
    ).toEqual(["All projects:on", "-", "alpha:off", "beta:off"]);
    const beta = focusProjectMenuItems(projects, "c:/work/beta");
    expect(
      beta.flatMap((item) =>
        item.kind === "item" && item.checked ? [item.id] : [],
      ),
    ).toEqual(["c:/work/beta"]);
  });

  it("names projects that share a folder name by their full path (L-162)", () => {
    const projects = focusPickProjects([
      ...ITEMS,
      {
        id: "c1",
        label: "Other alpha",
        project: { key: "d:/alpha", cwd: "D:/alpha" },
      },
    ]);
    expect(
      focusProjectMenuItems(projects, null).flatMap((item) =>
        item.kind === "item" ? [item.label] : [],
      ),
    ).toEqual(["All projects", "C:/work/alpha", "beta", "D:/alpha"]);
  });

  it("shows models only when the toggle is on", () => {
    const off = render(ITEMS);
    expect(off).toContain('title="Show each chat&#x27;s model"');
    expect(off).not.toContain(">Opus 5.5<");
    const on = render(ITEMS, true);
    expect(on).toContain(">Opus 5.5<");
    expect(on).toContain(">GPT-6<");
  });

  it("has no Model toggle when no chat has a model", () => {
    const html = render(ITEMS.map(({ model: _model, ...item }) => item));
    expect(html).not.toContain("Show each chat");
  });
});

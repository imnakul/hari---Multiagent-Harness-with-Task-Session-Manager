import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FocusSearchList,
  focusPickProjects,
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

  it("offers project chips only when chats span projects", () => {
    expect(render(ITEMS)).toContain('aria-label="Filter by project"');
    expect(render(ITEMS)).toContain('aria-pressed="true"');
    expect(render(ITEMS.slice(0, 1))).not.toContain("Filter by project");
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

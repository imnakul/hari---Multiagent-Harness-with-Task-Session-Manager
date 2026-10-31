import { describe, expect, it } from "vitest";
import { browserMenuItems, menuPoint, type BrowserContextTarget, type BrowserMenuItem } from "./browserMenu";

const base: BrowserContextTarget = {
  tab: 1,
  x: 0,
  y: 0,
  kind: "page",
  pageUrl: "https://example.com/",
  linkUrl: "",
  linkText: "",
  sourceUrl: "",
  selection: "",
};

const ids = (items: BrowserMenuItem[]) => items.map((item) => (item.kind === "sep" ? "-" : item.id));

describe("browserMenuItems", () => {
  it("shows page, tools, developer and page-address groups on a blank spot", () => {
    expect(ids(browserMenuItems(base))).toEqual([
      "page.back",
      "page.forward",
      "page.reload",
      "page.hardReload",
      "-",
      "tools.pick",
      "tools.shot",
      "tools.area",
      "tools.page",
      "-",
      "dev",
      "dev.inspect",
      "-",
      "page.copyAddress",
      "page.external",
      "page.print",
    ]);
  });

  it("keeps the menu about a link, image or selection", () => {
    const target = {
      ...base,
      kind: "image" as const,
      linkUrl: "https://example.com/a",
      sourceUrl: "https://example.com/a.png",
    };
    expect(ids(browserMenuItems(target))).toEqual([
      "link.newTab",
      "link.external",
      "link.copy",
      "link.chat",
      "-",
      "image.newTab",
      "image.copy",
      "image.chat",
      "-",
      "dev",
      "dev.inspect",
    ]);
    const selected = browserMenuItems({ ...base, kind: "selection", selection: "  some   picked text that runs on  " });
    expect(ids(selected).slice(0, 3)).toEqual(["selection.copy", "selection.search", "selection.chat"]);
    const search = selected[1];
    expect(search?.kind === "item" && search.label).toBe("Search the web for “some picked text that r…”");
  });

  it("turns console errors on only when there are some", () => {
    const developer = (errors: number) => {
      const found = browserMenuItems(base, { errors }).find((item) => item.kind === "item" && item.id === "dev");
      return found?.kind === "item" ? found.submenu?.find((item) => item.id === "dev.errors") : undefined;
    };
    expect(developer(0)).toMatchObject({ disabled: true, count: undefined });
    expect(developer(3)).toMatchObject({ disabled: false, count: 3 });
  });
});

describe("menuPoint", () => {
  it("turns physical page pixels into window CSS pixels", () => {
    expect(menuPoint({ x: 300, y: 150 }, { left: 40, top: 80 }, 1.5)).toEqual({ x: 240, y: 180 });
    expect(menuPoint({ x: 10, y: 10 }, { left: 0, top: 0 }, 0)).toEqual({ x: 10, y: 10 });
  });
});

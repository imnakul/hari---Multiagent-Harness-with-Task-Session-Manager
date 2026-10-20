import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ProjectTabs } from "./ProjectTabs";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `asset://${path}`,
  invoke: vi.fn(),
}));

const noop = () => {};

describe("ProjectTabs (L-130)", () => {
  it("renders nothing without tabs", () => {
    expect(
      renderToStaticMarkup(
        createElement(ProjectTabs, {
          paths: [],
          currentPath: "C:/work/alpha",
          isBusy: () => false,
          onSelect: noop,
          onClose: noop,
        }),
      ),
    ).toBe("");
  });

  it("renders a switch and a remove button per project, with the glide marker", () => {
    const html = renderToStaticMarkup(
      createElement(ProjectTabs, {
        paths: ["C:/work/alpha", "C:/work/beta"],
        currentPath: "C:/work/gamma",
        isBusy: () => false,
        onSelect: noop,
        onClose: noop,
      }),
    );
    expect(html).toContain('aria-label="Project tabs"');
    expect(html).toContain('aria-label="Switch to alpha"');
    expect(html).toContain('aria-label="Remove beta tab"');
    expect(html.match(/data-shared-hover-item/g)).toHaveLength(2);
    expect(html).toContain("data-shared-hover-highlight");
  });

  it("keeps the current project in its place, marked selected", () => {
    const html = renderToStaticMarkup(
      createElement(ProjectTabs, {
        paths: ["C:/work/alpha", "C:/work/beta"],
        currentPath: "c:\\work\\BETA",
        isBusy: () => false,
        onSelect: noop,
        onClose: noop,
      }),
    );
    expect(html).toContain('aria-label="Switch to alpha"');
    expect(html).toContain('aria-current="true"');
    expect(html.indexOf("alpha")).toBeLessThan(html.indexOf('aria-current="true"'));
    expect(html.match(/data-shared-hover-preserve/g)).toHaveLength(1);
  });
});

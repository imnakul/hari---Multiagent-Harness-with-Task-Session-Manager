import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ProjectSlots } from "./ProjectSlots";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `asset://${path}`,
  invoke: vi.fn(),
}));

const noop = () => {};

function render(paths: string[], currentPath: string, withAdd = true): string {
  return renderToStaticMarkup(
    createElement(ProjectSlots, {
      paths,
      currentPath,
      renderCurrent: () =>
        createElement("button", { "data-project-menu": "" }, "current menu"),
      renderAddPicker: withAdd ? () => null : undefined,
      isBusy: () => false,
      onSelect: noop,
      onClose: noop,
    }),
  );
}

describe("ProjectSlots (L-132)", () => {
  it("shows one slot as the usual project menu, with + and nothing to close", () => {
    const html = render(["C:/work/alpha"], "C:/work/alpha");
    expect(html).toContain("current menu");
    expect(html).toContain('aria-label="Add a project slot"');
    expect(html).not.toContain("Close ");
    expect(html).not.toContain("border-content/10");
  });

  it("shrinks other slots to a switch button, in their own place", () => {
    const html = render(
      ["C:/work/alpha", "C:/work/beta", "C:/work/gamma"],
      "c:\\work\\BETA",
    );
    expect(html).toContain('aria-label="Switch to alpha"');
    expect(html).toContain('aria-label="Switch to gamma"');
    expect(html).not.toContain('aria-label="Switch to beta"');
    expect(html).toContain('<span class="min-w-0 truncate">gamma</span>');
    expect(html.indexOf("Switch to alpha")).toBeLessThan(
      html.indexOf("current menu"),
    );
    expect(html.indexOf("current menu")).toBeLessThan(
      html.indexOf("Switch to gamma"),
    );
    expect(html.match(/slot" title="Close slot"/g)).toHaveLength(3);
  });

  it("puts several slots in a segmented track with a shared hover glide", () => {
    const html = render(["C:/work/alpha", "C:/work/beta"], "C:/work/alpha");
    expect(html).toContain("rounded-md border border-content/10 p-0.5");
    expect(html).toContain("data-shared-hover-highlight");
    expect(html).toContain("data-shared-hover-item");
    expect(html).toContain("min-w-14 max-w-44");
    // The + stays outside the track.
    expect(html.indexOf("</div></div><button")).toBeGreaterThan(0);
  });

  it("hides + once four slots are full", () => {
    const html = render(["C:/a", "C:/b", "C:/c", "C:/d"], "C:/a");
    expect(html).not.toContain("Add a project slot");
  });
});

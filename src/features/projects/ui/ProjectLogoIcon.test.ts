import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ProjectLogoIcon } from "./ProjectLogoIcon";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `asset://${path}`,
}));

describe("ProjectLogoIcon", () => {
  // Fork (L-127): wide or tall logos were cropped by object-cover.
  it("fits the whole logo inside its square", () => {
    const html = renderToStaticMarkup(
      createElement(ProjectLogoIcon, { path: "C:/logos/wide.png" }),
    );
    expect(html).toContain("object-contain");
    expect(html).not.toContain("object-cover");
  });

  it("keeps the icon and image classes apart", () => {
    const html = renderToStaticMarkup(
      createElement(ProjectLogoIcon, {
        path: "C:/logos/wide.png",
        className: "size-4",
        imageClassName: "size-3.5",
      }),
    );
    expect(html).toContain("size-4 size-3.5");
  });
});

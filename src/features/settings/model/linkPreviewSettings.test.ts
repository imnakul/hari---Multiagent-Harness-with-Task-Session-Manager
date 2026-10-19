// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import {
  LINK_PREVIEW_MODE_KEY,
  loadLinkPreviewMode,
  saveLinkPreviewMode,
} from "./linkPreviewSettings";

describe("link preview mode", () => {
  afterEach(() => {
    localStorage.clear();
  });

  it("previews on hover by default", () => {
    expect(loadLinkPreviewMode()).toBe("hover");
  });

  it("keeps a saved mode", () => {
    saveLinkPreviewMode("always");
    expect(localStorage.getItem(LINK_PREVIEW_MODE_KEY)).toBe("always");
    expect(loadLinkPreviewMode()).toBe("always");
    saveLinkPreviewMode("off");
    expect(loadLinkPreviewMode()).toBe("off");
  });

  it("falls back to hover for an unknown stored value", () => {
    localStorage.setItem(LINK_PREVIEW_MODE_KEY, "sometimes");
    expect(loadLinkPreviewMode()).toBe("hover");
  });

  it("tells subscribers in this window about a change", () => {
    let changes = 0;
    const onChange = () => {
      changes += 1;
    };
    window.addEventListener("monocode:linkpreviewmodechange", onChange);
    saveLinkPreviewMode("always");
    window.removeEventListener("monocode:linkpreviewmodechange", onChange);
    expect(changes).toBe(1);
  });
});

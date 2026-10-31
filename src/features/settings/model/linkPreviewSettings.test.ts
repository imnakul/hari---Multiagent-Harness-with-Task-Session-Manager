// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import {
  LINK_CARD_STYLE_KEY,
  LINK_PREVIEW_MODE_KEY,
  loadLinkCardStyle,
  loadLinkPreviewMode,
  saveLinkCardStyle,
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

describe("link card style", () => {
  afterEach(() => {
    localStorage.clear();
  });

  it("is compact by default", () => {
    expect(loadLinkCardStyle()).toBe("compact");
  });

  it("keeps a saved style", () => {
    saveLinkCardStyle("large-side");
    expect(localStorage.getItem(LINK_CARD_STYLE_KEY)).toBe("large-side");
    expect(loadLinkCardStyle()).toBe("large-side");
    saveLinkCardStyle("wide");
    expect(loadLinkCardStyle()).toBe("wide");
  });

  it("falls back to compact for an unknown stored value", () => {
    localStorage.setItem(LINK_CARD_STYLE_KEY, "huge");
    expect(loadLinkCardStyle()).toBe("compact");
  });

  it("tells subscribers in this window about a change", () => {
    let changes = 0;
    const onChange = () => {
      changes += 1;
    };
    window.addEventListener("monocode:linkcardstylechange", onChange);
    saveLinkCardStyle("large");
    window.removeEventListener("monocode:linkcardstylechange", onChange);
    expect(changes).toBe(1);
  });
});

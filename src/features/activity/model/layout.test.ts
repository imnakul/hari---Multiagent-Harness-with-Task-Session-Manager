// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { ACTIVITY_COLLAPSED_KEY, loadCollapsed, saveCollapsed } from "./layout";

describe("folded sections", () => {
  beforeEach(() => localStorage.clear());

  it("starts with every section open", () => {
    expect(loadCollapsed()).toEqual({ projects: false, apps: false, sites: false, phone: false });
  });

  it("remembers a folded section and leaves the others", () => {
    saveCollapsed("apps", true);
    saveCollapsed("phone", true);
    saveCollapsed("phone", false);
    expect(loadCollapsed()).toEqual({ projects: false, apps: true, sites: false, phone: false });
  });

  it("falls back to open on unreadable storage", () => {
    localStorage.setItem(ACTIVITY_COLLAPSED_KEY, "{bad");
    expect(loadCollapsed().apps).toBe(false);
    localStorage.setItem(ACTIVITY_COLLAPSED_KEY, JSON.stringify({ apps: "yes" }));
    expect(loadCollapsed().apps).toBe(false);
  });
});

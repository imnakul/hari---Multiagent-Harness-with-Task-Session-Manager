// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadSidebarInboxTab, saveSidebarInboxTab, subscribeSidebarInboxTab } from "./sidebarInboxTab";
import { loadProjectSidebarTab, saveProjectSidebarTab } from "../../settings/model/projectSidebarTab";

afterEach(() => localStorage.clear());

describe("sidebar Inbox tab switch (L-380)", () => {
  it("is off by default and remembers its value, telling subscribers (AC-B1)", () => {
    const listener = vi.fn();
    const stop = subscribeSidebarInboxTab(listener);
    expect(loadSidebarInboxTab()).toBe(false);
    saveSidebarInboxTab(true);
    expect(loadSidebarInboxTab()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
    saveSidebarInboxTab(false);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("remembers Inbox as a project's tab (AC-B5)", () => {
    saveProjectSidebarTab("/p", "inbox");
    expect(loadProjectSidebarTab("/p")).toBe("inbox");
  });

  it("never picks Inbox as the default tab", () => {
    expect(loadProjectSidebarTab("/fresh")).not.toBe("inbox");
  });
});

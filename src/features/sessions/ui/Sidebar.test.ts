import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import { Sidebar } from "../../../app/shell/Sidebar";
import type { SessionSummary } from "../data/sessionStore";
import { SHARED_HOVER_CONTINUITY_ATTR } from "./SharedHoverHighlight";

const mockStorage = new Map<string, string>();
const localStorageMock = {
  getItem: (k: string) => mockStorage.get(k) ?? null,
  setItem: (k: string, v: string) => {
    mockStorage.set(k, String(v));
  },
  removeItem: (k: string) => {
    mockStorage.delete(k);
  },
  clear: () => {
    mockStorage.clear();
  },
  key: (i: number) => [...mockStorage.keys()][i] ?? null,
  get length() {
    return mockStorage.size;
  },
};

Object.defineProperty(globalThis, "localStorage", {
  value: localStorageMock,
  configurable: true,
});

if (typeof window === "undefined") {
  Object.defineProperty(globalThis, "window", {
    value: {
      innerWidth: 1024,
      innerHeight: 768,
      addEventListener: () => {},
      removeEventListener: () => {},
    },
    configurable: true,
  });
}

describe("Sidebar session list shared-hover continuity", () => {
  beforeEach(() => {
    mockStorage.clear();
  });
  const makeSession = (
    id: string,
    title: string,
    pinned = false,
  ): SessionSummary => ({
    id,
    title,
    pinned,
    archived: false,
    createdAt: 1000,
    updatedAt: 2000,
    harness: "claude",
  });

  it("places adjacent session cards into continuity groups while keeping dividers outside", () => {
    // 2 pinned sessions, then a divider, then 2 unpinned sessions
    const sessions = [
      makeSession("s1", "Pinned 1", true),
      makeSession("s2", "Pinned 2", true),
      makeSession("s3", "Unpinned 1", false),
      makeSession("s4", "Unpinned 2", false),
    ];

    const markup = renderToStaticMarkup(
      createElement(Sidebar, {
        cwd: "/test/project",
        open: true,
        sessions,
        busySessionIds: new Set(),
        approvalSessionIds: new Set(),
        activeSessionId: "s1",
        status: "ready",
        pending: false,
        tab: "sessions",
        onTabChange: () => {},
      }),
    );

    // The outer <ul> should not have data-shared-hover-continuity
    // Instead, there should be exactly two continuity groups: one for pinned [s1, s2] and one for unpinned [s3, s4]
    const continuityMatches =
      markup.match(new RegExp(SHARED_HOVER_CONTINUITY_ATTR, "g")) || [];
    expect(continuityMatches.length).toBe(2);

    // Verify pinned group contains s1 and s2
    expect(markup).toMatch(
      new RegExp(
        `${SHARED_HOVER_CONTINUITY_ATTR}[^>]*>[\\s\\S]*?Pinned 1[\\s\\S]*?Pinned 2`,
      ),
    );

    // Verify unpinned group contains s3 and s4
    expect(markup).toMatch(
      new RegExp(
        `${SHARED_HOVER_CONTINUITY_ATTR}[^>]*>[\\s\\S]*?Unpinned 1[\\s\\S]*?Unpinned 2`,
      ),
    );

    // Verify the pinned group container is placed outside the unpinned continuity list
    expect(markup).toContain('data-pinned-sessions=""');
    // (the extra </div> is the slide wrapper round the pinned list, L-374)
    expect(markup).toContain(
      '</ul></div></div></li><li class="list-none"><ul data-shared-hover-continuity="true"',
    );
  });

  it("applies continuity to sessions within an expanded folder while excluding the folder header", () => {
    const sessions = [
      makeSession("f1", "Folder Session 1", false),
      makeSession("f2", "Folder Session 2", false),
      makeSession("u1", "Ungrouped Session 1", false),
    ];

    // Mock session folders to put f1 and f2 in an expanded folder
    const mockFolder = {
      id: "folder-1",
      name: "My Folder",
      sessionIds: ["f1", "f2"],
      collapsed: false,
    };

    localStorage.setItem(
      "monocode.sessionFolders",
      JSON.stringify({
        "/test/project": [mockFolder],
      }),
    );

    const markup = renderToStaticMarkup(
      createElement(Sidebar, {
        cwd: "/test/project",
        open: true,
        sessions,
        busySessionIds: new Set(),
        approvalSessionIds: new Set(),
        activeSessionId: "f1",
        status: "ready",
        pending: false,
        tab: "sessions",
        onTabChange: () => {},
      }),
    );

    localStorage.removeItem("monocode.sessionFolders");

    // Both the folder sessions and ungrouped sessions should be wrapped in continuity
    expect(markup).toContain(SHARED_HOVER_CONTINUITY_ATTR);

    // Folder session list has continuity attribute and contains both folder sessions
    expect(markup).toMatch(
      new RegExp(
        `${SHARED_HOVER_CONTINUITY_ATTR}[^>]*class="flex flex-col gap-px p-1"[^>]*>[\\s\\S]*?Folder Session 1[\\s\\S]*?Folder Session 2`,
      ),
    );

    // Folder row header itself is outside any continuity container
    expect(markup).toContain("My Folder");
    expect(markup).not.toMatch(
      new RegExp(
        `<ul[^>]*${SHARED_HOVER_CONTINUITY_ATTR}[^>]*>(?:(?!<\\/ul>)[\\s\\S])*?My Folder`,
      ),
    );
  });
});

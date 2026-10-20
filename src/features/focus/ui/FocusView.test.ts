import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { newDefaultSession } from "../../sessions/model/session";
import { FocusView } from "./FocusView";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `asset://${path}`,
  invoke: vi.fn(),
}));

function session(id: string, cwd: string, title: string) {
  return { ...newDefaultSession(cwd), id, title };
}

const SESSIONS = [
  session("a1", "C:/work/alpha", "Alpha one"),
  session("b1", "C:/work/beta", "Beta one"),
  session("a2", "C:/work/alpha", "Alpha two"),
];

function render(
  groupByProject: boolean,
  focusedId = "b1",
  extra: { dock?: ReactNode; paneFocused?: boolean } = {},
): string {
  const store = new Map([["monocode.focusGroupByProject.v1", groupByProject ? "1" : "0"]]);
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
  });
  const noop = () => {};
  return renderToStaticMarkup(
    createElement(FocusView, {
      grid: { columns: [["a1"], ["b1"], ["a2"]], overflow: [] },
      sessions: SESSIONS,
      boardCards: [],
      recents: [],
      focusedId,
      renderPane: (s) => createElement("p", { "data-pane-body": s.id }),
      onGridChange: noop,
      onFocusPane: noop,
      onClosePane: noop,
      onColumnCapChange: noop,
      onExit: noop,
      onNewChat: noop,
      onStartNew: noop,
      onOpenChat: noop,
      ...extra,
    }),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("FocusView group by project (L-128)", () => {
  it("shows every chat and no tab rows when not grouped", () => {
    const html = render(false);
    expect(html).not.toContain('role="tablist"');
    expect(html.match(/data-pane-body=/g)).toHaveLength(3);
    expect(html).toContain('aria-pressed="false" title="Group chats by project"');
  });

  it("adds a project row and a chat row, and shows only the focused chat's project", () => {
    const html = render(true, "a2");
    expect(html.match(/role="tablist"/g)).toHaveLength(2);
    expect(html).toContain('aria-label="Projects in Focus"');
    expect(html).toContain('title="alpha, 2 chats"');
    expect(html).toContain('title="beta, 1 chat"');
    // Chat row lists only alpha's chats, with the focused one selected.
    expect(html).toContain('aria-selected="true" aria-controls');
    expect(html).toContain('title="Alpha one"');
    expect(html).not.toContain('title="Beta one"');
    expect(html).toContain('data-pane-body="a1"');
    expect(html).toContain('data-pane-body="a2"');
    expect(html).not.toContain('data-pane-body="b1"');
    expect(html).toContain('role="tabpanel"');
    expect(html).toContain('aria-pressed="true" title="Group chats by project"');
  });
});

describe("FocusView terminal dock and active outline (L-136, L-137)", () => {
  it("renders App's dock beside the panes, in the same grid", () => {
    const html = render(false, "b1", {
      dock: createElement("div", { "data-dock-shown": "" }, "dock"),
    });
    // The dock and the pane region are siblings, so App lays them out.
    expect(html).toMatch(/<div class="grid[^"]*"><div data-dock-shown="">dock<\/div><main/);
    expect(html).toContain('style="grid-area:main"');
  });

  it("outlines only the focused pane, and none while the dock has the keyboard", () => {
    const focused = render(false, "b1");
    expect(focused.match(/data-active-pane-ring=""/g)).toHaveLength(1);
    const ringAt = focused.indexOf('data-active-pane-ring=""');
    expect(focused.lastIndexOf('data-focus-pane="b1"', ringAt)).toBeGreaterThan(
      focused.lastIndexOf('data-focus-pane="a1"', ringAt),
    );
    expect(render(false, "b1", { paneFocused: false })).not.toContain(
      'data-active-pane-ring=""',
    );
  });
});

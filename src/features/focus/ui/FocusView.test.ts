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
  extra: { dock?: ReactNode; sessions?: typeof SESSIONS } = {},
  layout?: string,
): string {
  const store = new Map([
    ["monocode.focusGroupByProject.v1", groupByProject ? "1" : "0"],
  ]);
  if (layout) store.set("monocode.focusLayout.v1", layout);
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
    expect(html).toContain(
      'aria-pressed="false" title="Group chats by project"',
    );
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
    expect(html).toContain(
      'aria-pressed="true" title="Group chats by project"',
    );
  });
});

describe("FocusView project status (L-147)", () => {
  it("shimmers a working chat and its project, and dots a project that asks", () => {
    const sessions = [
      { ...SESSIONS[0], busy: true },
      { ...SESSIONS[1], pendingQuestion: { requestId: 1, questions: [] } },
      SESSIONS[2],
    ];
    const html = render(true, "a1", { sessions });
    expect(html).toContain('title="alpha, 2 chats, working"');
    expect(html).toContain('title="beta, 1 chat, needs attention"');
    expect(html).toContain('data-focus-project-dot="attention"');
    expect(html).not.toContain('data-focus-project-dot="done"');
    // The project name and the working chat's title both shimmer.
    expect(html.match(/shimmer-text[^>]*>(alpha|Alpha one)</g)).toHaveLength(2);
  });
});

describe("FocusView terminal dock and active outline (L-136, L-137)", () => {
  it("opens App's dock inside the focused pane only", () => {
    const dock = createElement("div", { "data-dock-shown": "" }, "dock");
    const html = render(false, "b1", { dock });
    expect(html.match(/data-dock-shown=/g)).toHaveLength(1);
    const dockAt = html.indexOf("data-dock-shown");
    expect(html.lastIndexOf("<section", dockAt)).toBe(
      html.lastIndexOf('<section data-focus-pane="b1"', dockAt),
    );
    // The dock and the pane body are siblings in one grid, so App lays them out.
    expect(html).toMatch(
      /<div class="min-h-0 min-w-0 flex-1 grid"><div data-dock-shown="">dock<\/div><div class="[^"]*" style="grid-area:main"><p data-pane-body="b1">/,
    );
  });

  it("falls back to the pane region when the focused chat is hidden", () => {
    const dock = createElement("div", { "data-dock-shown": "" }, "dock");
    // A focused chat outside the shown grid, as in "+N more".
    const html = render(false, "zz", { dock });
    expect(html).toMatch(
      /<div class="min-h-0 min-w-0 flex-1 grid"><div data-dock-shown="">dock<\/div><main/,
    );
  });

  it("outlines only the focused pane", () => {
    const focused = render(false, "b1");
    // L-144: the outline is the pane card's accent edge and glow.
    expect(focused.match(/focus-pane-active/g)).toHaveLength(1);
    const active = focused.match(/<section[^>]*focus-pane-active[^>]*>/)?.[0];
    expect(active).toContain('data-focus-pane="b1"');
  });

  it("puts one gliding ring over the focused pane's box (L-151)", () => {
    const html = render(false, "b1");
    const rings = html.match(/<div[^>]*data-focus-ring[^>]*>/g) ?? [];
    expect(rings).toHaveLength(1);
    expect(rings[0]).toContain("focus-ring-glide");
    expect(rings[0]).toContain("pointer-events-none");
    const pane = html.match(/<section[^>]*data-focus-pane="b1"[^>]*>/)?.[0];
    const box = (tag: string | undefined) => tag?.match(/style="([^"]*)"/)?.[1];
    expect(box(rings[0])).toBe(box(pane));
  });

  it("has no ring when the focused chat is hidden (L-151)", () => {
    expect(render(false, "zz")).not.toContain("data-focus-ring");
  });

  it("takes sidebar session drops on its pane region (L-153)", () => {
    const html = render(false, "b1");
    expect(html).toMatch(/<main[^>]*data-focus-drop-area/);
    expect(html).not.toContain("data-focus-session-drop");
  });
});

describe("FocusView pane sizes (L-143)", () => {
  it("shares the width equally, with an edge between each column", () => {
    const html = render(false);
    expect(html.match(/role="separator"/g)).toHaveLength(2);
    expect(html).toContain("width:calc(33.33");
  });

  it("sizes columns from the stored layout, keyed by their first chat", () => {
    const html = render(
      false,
      "b1",
      {},
      JSON.stringify({ widths: { a1: 2 }, splits: {} }),
    );
    expect(html).toContain("width:calc(50% - 6px)");
    expect(html).toContain("width:calc(25% - 6px)");
  });
});

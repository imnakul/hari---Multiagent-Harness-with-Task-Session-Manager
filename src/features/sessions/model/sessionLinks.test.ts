// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SessionSummary } from "../data/sessionStore";
import {
  nestLinkedSessions,
  saveSessionLink,
  sessionLinksSnapshot,
  subscribeSessionLinks,
  type SessionLink,
} from "./sessionLinks";

function row(id: string, extra: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id,
    cwd: "/repo",
    harness: "claude",
    model: "sonnet",
    title: id,
    createdAt: 1,
    updatedAt: 1,
    ...extra,
  } as SessionSummary; // Test rows fill only the fields nesting reads.
}

const ids = (rows: { id: string }[]) => rows.map((r) => r.id);

beforeEach(() => {
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
});
afterEach(() => vi.unstubAllGlobals());

it("nests forks and second opinions under a listed parent, in order", () => {
  const links: Record<string, SessionLink> = {
    fork: { parentId: "main", relation: "fork" },
    review: { parentId: "main", relation: "secondOpinion" },
    nested: { parentId: "fork", relation: "fork" },
  };
  const tree = nestLinkedSessions(
    [row("main"), row("fork"), row("other"), row("review"), row("nested")],
    [],
    links,
  );
  expect(ids(tree.top)).toEqual(["main", "other"]);
  expect(tree.children.get("main")!.map((c) => [c.session.id, c.relation])).toEqual([
    ["fork", "fork"],
    ["review", "secondOpinion"],
  ]);
  expect(ids(tree.children.get("fork")!.map((c) => c.session))).toEqual(["nested"]);
});

it("keeps a child on top when its parent is filtered out or links loop", () => {
  const tree = nestLinkedSessions(
    [row("fork"), row("a"), row("b")],
    [],
    {
      fork: { parentId: "gone", relation: "fork" },
      a: { parentId: "b", relation: "fork" },
      b: { parentId: "a", relation: "fork" },
    },
  );
  expect(ids(tree.top)).toEqual(["fork", "a"]);
  expect(ids(tree.children.get("a")!.map((c) => c.session))).toEqual(["b"]);
});

it("adds saved sidechats only under a listed parent, from their own row", () => {
  const side = row("side", {
    sidechat: { sourceSessionId: "main", sourceTitle: "main" },
  });
  const orphan = row("orphan", {
    sidechat: { sourceSessionId: "gone", sourceTitle: "gone" },
  });
  // A fork of the orphan sidechat must not disappear with it.
  const tree = nestLinkedSessions([row("main"), row("forkOfOrphan")], [side, orphan], {
    forkOfOrphan: { parentId: "orphan", relation: "fork" },
  });
  expect(ids(tree.top)).toEqual(["main", "forkOfOrphan"]);
  expect(tree.children.get("main")!.map((c) => [c.session.id, c.relation])).toEqual([
    ["side", "sidechat"],
  ]);
  expect(tree.children.has("orphan")).toBe(false);
});

it("nests a sidechat of a sidechat under its shown parent (L-165)", () => {
  const sidechat = (id: string, source: string) =>
    row(id, { sidechat: { sourceSessionId: source, sourceTitle: source } });
  // Listed newest first, so the deepest chat comes before its parent.
  const tree = nestLinkedSessions(
    [row("main")],
    [sidechat("third", "second"), sidechat("second", "main"), sidechat("lost", "gone")],
    {},
  );
  expect(ids(tree.top)).toEqual(["main"]);
  expect(ids(tree.children.get("main")!.map((c) => c.session))).toEqual(["second"]);
  expect(ids(tree.children.get("second")!.map((c) => c.session))).toEqual(["third"]);
  expect(tree.children.has("gone")).toBe(false);
});

it("saves links, notifies subscribers and ignores malformed entries", () => {
  const onChange = vi.fn();
  const stop = subscribeSessionLinks(onChange);
  saveSessionLink("child", { parentId: "main", relation: "fork" });
  saveSessionLink("self", { parentId: "self", relation: "fork" });
  stop();
  expect(onChange).toHaveBeenCalledTimes(1);
  expect(sessionLinksSnapshot()).toEqual({
    child: { parentId: "main", relation: "fork" },
  });
  expect(sessionLinksSnapshot()).toBe(sessionLinksSnapshot());
  localStorage.setItem(
    "monocode.sessionLinks.v1",
    JSON.stringify({ ok: { parentId: "p", relation: "sidechat" }, bad: { parentId: 3 } }),
  );
  expect(sessionLinksSnapshot()).toEqual({
    ok: { parentId: "p", relation: "sidechat" },
  });
});

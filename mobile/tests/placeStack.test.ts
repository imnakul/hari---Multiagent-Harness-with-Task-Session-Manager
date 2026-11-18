import { beforeEach, describe, expect, it, vi } from "vitest";

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("expo-router", () => ({ router }));
const kv = vi.hoisted(() => new Map<string, string>());
vi.mock("expo-sqlite/kv-store", () => ({
  default: {
    getItemSync: (key: string) => kv.get(key) ?? null,
    setItemSync: (key: string, value: string) => kv.set(key, value),
    removeItemSync: (key: string) => kv.delete(key),
  },
}));

import { onProjectPick } from "@/features/workspace/projectPick";
import { clearToPlace, showPlace, showProject, showSession } from "@/features/workspace/placeStack";
import { forgetPlaceMemory, readPlaceMemory } from "@/features/workspace/placeMemory";

type R = { name: string; params?: Record<string, unknown>; state?: unknown };
function navOf(routes: R[]) {
  const dispatch = vi.fn();
  return {
    dispatch,
    getRootState: () => ({ key: "outer", routes: [{ name: "__root", state: { key: "app", routes } }] }),
  };
}

function nav(names: string[]) {
  const dispatch = vi.fn();
  return {
    dispatch,
    getRootState: () => ({
      key: "outer",
      routes: [{ name: "__root", state: { key: "app", routes: names.map((name) => ({ name })) } }],
    }),
  };
}

describe("placeStack", () => {
  beforeEach(() => {
    router.push.mockClear();
    router.replace.mockClear();
  });

  it("takes every session layer off the place underneath", () => {
    const n = nav(["project/[projectId]/index", "project/[projectId]/session/[sessionId]", "project/[projectId]/session/[sessionId]"]);
    clearToPlace(n);
    expect(n.dispatch).toHaveBeenCalledWith({ type: "POP", payload: { count: 2 }, target: "app" });
  });

  it("does nothing with only the place open", () => {
    const n = nav(["mono/[monoId]"]);
    clearToPlace(n);
    expect(n.dispatch).not.toHaveBeenCalled();
  });

  it("picks the project in place when its screen is there", () => {
    const picked: string[] = [];
    const off = onProjectPick((id) => picked.push(id));
    const n = nav(["project/[projectId]/index", "project/[projectId]/session/[sessionId]"]);
    showSession(n, "p2", "s9");
    off();
    expect(n.dispatch).toHaveBeenCalledTimes(1);
    expect(picked).toEqual(["p2"]);
    expect(router.replace).not.toHaveBeenCalled();
    expect(router.push).toHaveBeenCalledWith({
      pathname: "/project/[projectId]/session/[sessionId]",
      params: { projectId: "p2", sessionId: "s9" },
    });
  });

  it("replaces a Mono with the project", () => {
    showProject(nav(["mono/[monoId]"]), "p1");
    expect(router.replace).toHaveBeenCalledWith({ pathname: "/project/[projectId]", params: { projectId: "p1" } });
  });
});

describe("place memory (L-347)", () => {
  beforeEach(() => {
    router.push.mockClear();
    router.replace.mockClear();
    forgetPlaceMemory("pc");
  });

  it("remembers a project's open session on leaving and reopens it", () => {
    const leaving = navOf([
      { name: "project/[projectId]/index", params: { projectId: "a" } },
      { name: "project/[projectId]/session/[sessionId]", params: { projectId: "a", sessionId: "s1" } },
    ]);
    showPlace(leaving, { kind: "tasks" }, "pc");
    expect(readPlaceMemory("pc").sessions).toEqual({ a: "s1" });
    expect(router.replace).toHaveBeenCalledWith("/tasks");

    router.push.mockClear();
    showPlace(navOf([{ name: "tasks" }]), { kind: "project", id: "a" }, "pc");
    expect(router.push).toHaveBeenCalledWith({
      pathname: "/project/[projectId]/session/[sessionId]",
      params: { projectId: "a", sessionId: "s1" },
    });
  });

  it("forgets the session of a project left on its list", () => {
    showPlace(
      navOf([
        { name: "project/[projectId]/index", params: { projectId: "a" } },
        { name: "project/[projectId]/session/[sessionId]", params: { projectId: "a", sessionId: "s1" } },
      ]),
      { kind: "notes" },
      "pc",
    );
    showPlace(navOf([{ name: "project/[projectId]/index", params: { projectId: "a" } }]), { kind: "notes" }, "pc");
    expect(readPlaceMemory("pc").sessions).toEqual({});
  });

  it("rebuilds the computer hub in the folder it was left in", () => {
    showPlace(
      navOf([
        {
          name: "computer",
          state: { key: "c", routes: [{ name: "index", params: { tab: "control" } }, { name: "files", params: { path: "D:\Work" } }] },
        },
      ]),
      { kind: "notes" },
      "pc",
    );
    router.replace.mockClear();
    router.push.mockClear();
    showPlace(navOf([{ name: "notes" }]), { kind: "computer" }, "pc");
    expect(router.replace).toHaveBeenCalledWith({ pathname: "/computer", params: { tab: "control" } });
    expect(router.push).toHaveBeenCalledWith({ pathname: "/computer/files", params: { path: "D:\Work" } });
  });

  it("reopens the note that was open", () => {
    showPlace(
      navOf([{ name: "notes", state: { key: "n", routes: [{ name: "index" }, { name: "[noteId]", params: { noteId: "n1" } }] } }]),
      { kind: "tasks" },
      "pc",
    );
    router.push.mockClear();
    showPlace(navOf([{ name: "tasks" }]), { kind: "notes" }, "pc");
    expect(router.push).toHaveBeenCalledWith({ pathname: "/notes/[noteId]", params: { noteId: "n1" } });
  });

  it("keeps each desktop's memory apart and forgets it on unpairing", () => {
    showPlace(
      navOf([
        { name: "project/[projectId]/index", params: { projectId: "a" } },
        { name: "project/[projectId]/session/[sessionId]", params: { projectId: "a", sessionId: "s1" } },
      ]),
      { kind: "tasks" },
      "pc",
    );
    expect(readPlaceMemory("other").sessions).toEqual({});
    forgetPlaceMemory("pc");
    expect(readPlaceMemory("pc").sessions).toEqual({});
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("expo-router", () => ({ router }));

import { onProjectPick } from "@/features/workspace/projectPick";
import { clearToPlace, showProject, showSession } from "@/features/workspace/placeStack";

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

import { describe, expect, it } from "vitest";
import { isSessionWorking, workingProjectPaths } from "./workingSessions";

describe("workingProjectPaths", () => {
  it("counts a turn the app did not send, so the project name shimmers", () => {
    expect(
      workingProjectPaths([
        { cwd: "/a", busy: true },
        { cwd: "/b", externalTurnId: "interactive:1" },
        { cwd: "/c" },
        { cwd: "", busy: true },
      ]),
    ).toEqual(["/a", "/b"]);
  });

  it("treats a session as working while busy or in an external turn", () => {
    expect(isSessionWorking({})).toBe(false);
    expect(isSessionWorking({ busy: true })).toBe(true);
    expect(isSessionWorking({ externalTurnId: "phone:1" })).toBe(true);
  });
});

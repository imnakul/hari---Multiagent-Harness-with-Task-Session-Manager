import { describe, expect, it } from "vitest";
import { chosenNestedRepo } from "./nestedRepos";

const repos = [
  { path: "E:/Work/rigorup/landing-page", name: "landing-page" },
  { path: "E:/Work/rigorup/Teacher", name: "Teacher" },
];

describe("chosenNestedRepo", () => {
  it("uses the repo picked for the folder, whatever the path's case", () => {
    expect(chosenNestedRepo(repos, "e:/work/rigorup/teacher")?.name).toBe("Teacher");
  });

  it("falls back to the first repo when none was picked or the pick is gone", () => {
    expect(chosenNestedRepo(repos, undefined)?.name).toBe("landing-page");
    expect(chosenNestedRepo(repos, "E:/Work/rigorup/deleted")?.name).toBe("landing-page");
  });

  it("is undefined without repos", () => {
    expect(chosenNestedRepo([], "E:/Work/rigorup/Teacher")).toBeUndefined();
  });
});

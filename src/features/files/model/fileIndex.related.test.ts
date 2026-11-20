import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectFile } from "../../../platform/tauri/fs";
import { listProjectFiles, statFiles } from "../../../platform/tauri/fs";
import { invalidateProjectFiles, resolveOpenablePath } from "./fileIndex";

const parent = "E:/Dev/rigorup-active";
const teacher = `${parent}/Teacher`;
const file = (root: string, relative: string): ProjectFile => ({
  name: relative.split("/").pop()!,
  path: `${root}/${relative}`,
  relative,
});
const listings: Record<string, ProjectFile[]> = {
  [teacher]: [file(teacher, "src/App.tsx")],
  [parent]: [file(parent, "docs/teacher/review/MANUAL_CHECKS.md")],
};

vi.mock("../../../platform/tauri/fs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../platform/tauri/fs")>()),
  listProjectFiles: vi.fn(),
  statFiles: vi.fn(),
}));
vi.mock("../../projects/model/recents", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../projects/model/recents")>()),
  knownProjectPaths: () => [teacher, parent],
  looksLikeProject: () => true,
}));

const list = vi.mocked(listProjectFiles);
const stat = vi.mocked(statFiles);

describe("a file named outside the chat's project (L-369)", () => {
  beforeEach(() => {
    invalidateProjectFiles();
    list.mockReset();
    list.mockImplementation(async (root) => listings[root] ?? []);
    stat.mockReset();
    stat.mockImplementation(async (paths) => paths.map((path) => ({ path, mtimeMs: null })));
  });

  it("opens it from the folder that holds the project", async () => {
    await expect(resolveOpenablePath(teacher, "MANUAL_CHECKS.md")).resolves.toBe(
      `${parent}/docs/teacher/review/MANUAL_CHECKS.md`,
    );
  });

  it("keeps a path that exists where it points", async () => {
    stat.mockImplementation(async (paths) => paths.map((path) => ({ path, mtimeMs: 1 })));
    await expect(resolveOpenablePath(teacher, "MANUAL_CHECKS.md")).resolves.toBe(
      `${teacher}/MANUAL_CHECKS.md`,
    );
  });

  it("never swaps an absolute path elsewhere for another file", async () => {
    await expect(resolveOpenablePath(teacher, "E:/Other/MANUAL_CHECKS.md")).resolves.toBe(
      "E:/Other/MANUAL_CHECKS.md",
    );
    expect(list).not.toHaveBeenCalledWith(parent);
  });

  it("falls back to the joined path when nothing is found", async () => {
    await expect(resolveOpenablePath(teacher, "NOWHERE.md")).resolves.toBe(`${teacher}/NOWHERE.md`);
  });
});

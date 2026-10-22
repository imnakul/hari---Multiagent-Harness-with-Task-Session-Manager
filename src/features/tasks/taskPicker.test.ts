import { describe, expect, it } from "vitest";
import { pickerTasks, rankPickerTasks, taskPickerText } from "./taskPicker";
import type { Task } from "./tasks";

const PROJECT = "E:\\work\\app";

function task(id: string, changes: Partial<Task> = {}): Task {
  return {
    id,
    title: id,
    body: "",
    status: "todo",
    tags: [],
    focusDays: [],
    createdAt: 1,
    updatedAt: 1,
    ...changes,
  };
}

const TASKS: Task[] = [
  task("personal-old", { title: "Renew passport", updatedAt: 1 }),
  task("project-old", {
    title: "Login form",
    projectCwd: PROJECT,
    updatedAt: 2,
  }),
  task("project-new", {
    title: "Fix logout",
    projectCwd: PROJECT,
    body: "Session cookie stays",
    updatedAt: 5,
  }),
  task("personal-new", { title: "Buy logs", tags: ["home"], updatedAt: 4 }),
  task("other-project", {
    title: "Logo",
    projectCwd: "E:\\work\\site",
    updatedAt: 9,
  }),
  task("in-progress", {
    title: "Log viewer",
    projectCwd: PROJECT,
    status: "in_progress",
  }),
  task("archived", { title: "Log rotate", projectCwd: PROJECT, archivedAt: 3 }),
];

describe("pickerTasks (L-180)", () => {
  it("lists Todo tasks of this project first, then Personal, newest first in each", () => {
    expect(
      pickerTasks(TASKS, PROJECT).map((row) => [row.task.id, row.group]),
    ).toEqual([
      ["project-new", "project"],
      ["project-old", "project"],
      ["personal-new", "personal"],
      ["personal-old", "personal"],
    ]);
  });

  it("matches the project path the way Tasks does (case and slashes)", () => {
    expect(
      pickerTasks(TASKS, "e:/work/app").map((row) => row.task.id),
    ).toContain("project-new");
  });

  it("shows only Personal tasks without a project", () => {
    expect(pickerTasks(TASKS, null).map((row) => row.task.id)).toEqual([
      "personal-new",
      "personal-old",
    ]);
  });
});

describe("rankPickerTasks (L-180)", () => {
  it("keeps the groups and ranks title prefix over substring and body", () => {
    expect(
      rankPickerTasks(TASKS, "log", PROJECT).map((row) => row.task.id),
    ).toEqual(["project-old", "project-new", "personal-new"]);
  });

  it("matches description and tags", () => {
    expect(
      rankPickerTasks(TASKS, "cookie", PROJECT).map((row) => row.task.id),
    ).toEqual(["project-new"]);
    expect(
      rankPickerTasks(TASKS, "home", PROJECT).map((row) => row.task.id),
    ).toEqual(["personal-new"]);
  });

  it("returns nothing for a query no task matches, and honours the limit", () => {
    expect(rankPickerTasks(TASKS, "123", PROJECT)).toEqual([]);
    expect(rankPickerTasks(TASKS, "", PROJECT, 2)).toHaveLength(2);
  });
});

describe("taskPickerText (L-180)", () => {
  it("inserts the title, tags and description, not only the heading", () => {
    expect(
      taskPickerText({
        title: "Fix logout",
        tags: ["auth"],
        body: "Session cookie stays\n",
      }),
    ).toBe("Task: Fix logout\n\nTags: #auth\n\nSession cookie stays\n\n");
  });
});

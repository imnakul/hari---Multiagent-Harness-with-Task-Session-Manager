import { describe, expect, it, vi } from "vitest";

import { parseMarkdown } from "@/features/sessions/markdownParser";
import {
  carryOverTasks,
  excerptOf,
  groupTasks,
  hostOf,
  inFocusOn,
  linkPreview,
  localDay,
  newId,
  parseTags,
  projectLabel,
  titleFrom,
  updateTask,
  webLinks,
  type Command,
  type TaskItem,
} from "@/features/tools/tools";
import type { Project } from "@/features/workspace/types";

const projects = [
  { name: "Mono", path: "E:\\Code\\mono" },
  { name: "Alpha", path: "E:\\Code\\alpha" },
] as Project[];

const task = (id: string, change: Partial<TaskItem> = {}): TaskItem => ({
  id,
  title: id,
  excerpt: "",
  status: "todo",
  tags: [],
  updatedAt: 0,
  archived: false,
  ...change,
});

describe("groupTasks", () => {
  it("groups by project, by name, with no-project last and archived hidden", () => {
    const groups = groupTasks(
      [
        task("loose"),
        task("m1", { projectCwd: "e:/code/mono/" }),
        task("a1", { projectCwd: "E:\\Code\\alpha" }),
        task("gone", { projectCwd: "E:\\Code\\alpha", archived: true }),
        task("other", { projectCwd: "D:\\work\\beta" }),
      ],
      projects,
    );
    expect(groups.map((group) => group.label)).toEqual(["Alpha", "beta", "Mono", "No project"]);
    expect(groups[0].tasks.map((each) => each.id)).toEqual(["a1"]);
  });

  it("puts open tasks first, newest first, then done ones", () => {
    const [group] = groupTasks(
      [
        task("done", { status: "completed", updatedAt: 9 }),
        task("old", { updatedAt: 1 }),
        task("new", { updatedAt: 5, status: "blocked" }),
      ],
      projects,
    );
    expect(group.tasks.map((each) => each.id)).toEqual(["new", "old", "done"]);
  });

  it("groups by status in the desktop's order, leaving out empty ones", () => {
    const groups = groupTasks(
      [
        task("v", { status: "review" }),
        task("t1", { updatedAt: 1 }),
        task("t2", { updatedAt: 3 }),
        task("hidden", { status: "blocked", archived: true }),
      ],
      projects,
      "status",
    );
    expect(groups.map((group) => group.label)).toEqual(["Todo", "Verify"]);
    expect(groups[0].tasks.map((each) => each.id)).toEqual(["t2", "t1"]);
  });
});

describe("inFocusOn", () => {
  const day = "2026-11-11";
  const today = new Date(2026, 10, 11, 9).getTime();
  const yesterday = new Date(2026, 10, 10, 9).getTime();

  it("counts tasks pinned to the day or recorded there", () => {
    expect(inFocusOn(task("p", { createdAt: yesterday, focusDate: day }), day)).toBe(true);
    expect(inFocusOn(task("r", { createdAt: yesterday, focusDays: [day] }), day)).toBe(true);
  });

  it("counts tasks created that day unless planned for later", () => {
    expect(inFocusOn(task("c", { createdAt: today }), day)).toBe(true);
    expect(inFocusOn(task("l", { createdAt: today, focusDate: "2026-11-13" }), day)).toBe(false);
    expect(inFocusOn(task("o", { createdAt: yesterday }), day)).toBe(false);
    expect(inFocusOn(task("u"), day)).toBe(false);
  });

  it("reads the local day", () => {
    expect(localDay(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
  });
});

describe("carryOverTasks", () => {
  const day = "2026-11-11";

  it("lists unfinished tasks pinned to an earlier day and not in today's Focus", () => {
    const carried = carryOverTasks(
      [
        task("old", { focusDate: "2026-11-09" }),
        task("done", { focusDate: "2026-11-09", status: "completed" }),
        task("gone", { focusDate: "2026-11-09", archived: true }),
        task("kept", { focusDate: "2026-11-09", focusDays: [day] }),
        task("today", { focusDate: day }),
        task("later", { focusDate: "2026-11-13" }),
        task("loose"),
      ],
      day,
    );
    expect(carried.map((each) => each.id)).toEqual(["old"]);
  });
});

describe("updateTask", () => {
  it("sends a Focus change with the phone's day", async () => {
    const command = vi.fn(async () => ({ task: task("t") }));
    await updateTask(command as unknown as Command, "t", { focusDate: null, today: "2026-11-11" });
    expect(command).toHaveBeenCalledWith("tasks.update", {
      id: "t",
      focusDate: null,
      today: "2026-11-11",
    });
  });
});

describe("projectLabel", () => {
  it("names a known project, else the folder", () => {
    expect(projectLabel("E:/Code/Mono", projects)).toBe("Mono");
    expect(projectLabel("C:\\x\\notes\\", projects)).toBe("notes");
    expect(projectLabel(null, projects)).toBeNull();
  });
});

describe("parseTags", () => {
  it("splits on commas and spaces, drops #, lowercases, keeps each once", () => {
    expect(parseTags("#Bug, ui  later,bug ##UI")).toEqual(["bug", "ui", "later"]);
    expect(parseTags("  ")).toEqual([]);
  });

  it("keeps at most 20 tags of 48 letters", () => {
    const many = Array.from({ length: 30 }, (_, index) => `t${index}`).join(" ");
    expect(parseTags(many)).toHaveLength(20);
    expect(parseTags("x".repeat(60))[0]).toHaveLength(48);
  });
});

describe("titleFrom", () => {
  it("takes the first heading or line, skipping code and rules", () => {
    expect(titleFrom("```ts\nconst a = 1\n```\n---\n## **Plan** for `today`\nmore")).toBe(
      "Plan for today",
    );
    expect(titleFrom("\n\n")).toBe("Untitled");
  });
});

describe("excerptOf", () => {
  it("drops the repeated title and joins the rest", () => {
    expect(excerptOf({ title: "Plan", excerpt: "# Plan\n\nfirst line\n```\nsecond" })).toBe(
      "first line second",
    );
  });
});

describe("newId", () => {
  it("makes a uuid-shaped id of letters, digits and dashes", () => {
    expect(newId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(newId()).not.toBe(newId());
  });
});

describe("webLinks", () => {
  it("lists each web link in a paragraph once, in order", () => {
    const [block] = parseMarkdown(
      "See [docs](https://docs.expo.dev/a) and **[b](http://b.dev)**, again [docs](https://docs.expo.dev/a), [file](file:///x).",
    );
    expect(webLinks(block)).toEqual(["https://docs.expo.dev/a", "http://b.dev"]);
  });

  it("ignores code blocks", () => {
    const [block] = parseMarkdown("```\nhttps://a.dev\n```");
    expect(webLinks(block)).toEqual([]);
  });
});

describe("hostOf", () => {
  it("shows the site without www", () => {
    expect(hostOf("https://www.github.com/a?b")).toBe("github.com");
    expect(hostOf("not a url")).toBe("not a url");
  });
});

describe("linkPreview", () => {
  it("asks the desktop once per link and image choice", async () => {
    const command = vi.fn(async () => ({ url: "https://a.dev", title: "A" }));
    const run = command as unknown as Command;
    await linkPreview(run, "https://a.dev/once", false);
    await linkPreview(run, "https://a.dev/once", false);
    expect(command).toHaveBeenCalledTimes(1);
  });
});

import { describe, expect, it, vi } from "vitest";

import { parseMarkdown } from "@/features/sessions/markdownParser";
import {
  excerptOf,
  groupTasks,
  hostOf,
  linkPreview,
  newId,
  parseTags,
  projectLabel,
  titleFrom,
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

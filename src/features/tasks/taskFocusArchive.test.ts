import { describe, expect, it } from "vitest";
import {
  completedOn,
  filterTasks,
  inFocusOn,
  isInFocus,
  localDay,
  normalizeStoredTask,
  taskMarkdown,
  taskWorkPrompt,
  type Task,
} from "./tasks";
import {
  moveGroupKey,
  orderGroups,
  reorderColumn,
  sortForBoard,
} from "./taskViewState";
import { taskMenuAction, taskMenuItems } from "./ui/taskContextMenu";

const DAY = new Date(2026, 9, 3, 12).getTime();
const TODAY = localDay(DAY);
const YESTERDAY = localDay(DAY - 86_400_000);

function task(id: string, changes: Partial<Task> = {}): Task {
  return {
    id,
    title: id,
    body: "",
    status: "todo",
    tags: [],
    createdAt: DAY - 3 * 86_400_000,
    updatedAt: 1,
    focusDays: [],
    ...changes,
  };
}

describe("Focus", () => {
  it("counts tasks created today or pinned to today", () => {
    expect(TODAY).toBe("2026-10-03");
    expect(isInFocus(task("new", { createdAt: DAY }), TODAY)).toBe(true);
    expect(isInFocus(task("pinned", { focusDate: TODAY }), TODAY)).toBe(true);
    expect(isInFocus(task("old"), TODAY)).toBe(false);
    expect(isInFocus(task("yesterday", { focusDate: YESTERDAY }), TODAY)).toBe(
      false,
    );
  });

  it("keeps inFocusOn as the Focus predicate and records history days", () => {
    expect(inFocusOn(task("h", { focusDays: [YESTERDAY] }), YESTERDAY)).toBe(
      true,
    );
    expect(completedOn(task("c", { completedAt: DAY }), TODAY)).toBe(true);
    expect(completedOn(task("c"), TODAY)).toBe(false);
  });

  it("filters by day, hides archived by default and combines several projects", () => {
    const rows = [
      task("today", { createdAt: DAY, projectCwd: "/work/a" }),
      task("pinned", { focusDate: TODAY }),
      task("archived", { createdAt: DAY, archivedAt: 5 }),
      task("other", { projectCwd: "/work/b" }),
    ];
    // The day view ignores the archived filter: the archived task created
    // today still shows for today.
    expect(filterTasks(rows, { day: TODAY }).map((t) => t.id).sort()).toEqual([
      "archived",
      "pinned",
      "today",
    ]);
    expect(filterTasks(rows).map((t) => t.id)).not.toContain("archived");
    expect(filterTasks(rows, { archived: true }).map((t) => t.id)).toEqual([
      "archived",
    ]);
    expect(filterTasks(rows, { archived: "all" })).toHaveLength(4);
    expect(
      filterTasks(rows, { projectCwds: ["/work/a", null] })
        .map((t) => t.id)
        .sort(),
    ).toEqual(["pinned", "today"]);
  });
});

describe("retired statuses", () => {
  it("shows Draft as Todo and Deferred as an archived Todo, and flags them for rewrite", () => {
    const draft = normalizeStoredTask({ ...task("d"), status: "draft" });
    expect(draft).toMatchObject({ legacy: true, task: { status: "todo" } });
    expect(draft.task.archivedAt).toBeUndefined();
    const deferred = normalizeStoredTask({
      ...task("x", { updatedAt: 9 }),
      status: "deferred",
    });
    expect(deferred).toMatchObject({
      legacy: true,
      task: { status: "todo", archivedAt: 9 },
    });
    expect(normalizeStoredTask(task("ok")).legacy).toBe(false);
    const { focusDays, ...missing } = task("m");
    expect(normalizeStoredTask(missing as Task).task.focusDays).toEqual([]);
    expect(
      normalizeStoredTask({ ...task("u"), focusDays: undefined as unknown as string[] })
        .task.focusDays,
    ).toEqual([]);
  });
});

describe("copy and work-on text", () => {
  it("copies only the title and description (L-390)", () => {
    const text = taskMarkdown(
      task("Fix login", {
        title: "Fix login",
        body: "Steps to reproduce",
        status: "in_progress",
        tags: ["auth", "web"],
        projectCwd: "/work/app",
        createdAt: DAY,
        focusDate: TODAY,
      }),
    );
    expect(text).toBe(["# Fix login", "", "Steps to reproduce", ""].join("\n"));
  });

  it("prefills Work on with the title, tags and description", () => {
    expect(
      taskWorkPrompt({ title: "Fix login", body: "Steps", tags: ["auth"] }),
    ).toBe("Task: Fix login\n\nTags: #auth\n\nSteps\n\n");
    expect(taskWorkPrompt({ title: "Tidy", body: "", tags: [] })).toBe(
      "Task: Tidy\n\n",
    );
  });
});

describe("board ordering", () => {
  it("orders columns by the saved order and moves a column before another", () => {
    const groups = [{ key: "a" }, { key: "b" }, { key: "c" }];
    expect(orderGroups(groups, ["c", "a"]).map((g) => g.key)).toEqual([
      "c",
      "a",
      "b",
    ]);
    expect(moveGroupKey(["a", "b", "c"], "c", "a")).toEqual(["c", "a", "b"]);
    expect(moveGroupKey(["a", "b", "c"], "a", null)).toEqual(["b", "c", "a"]);
  });

  it("puts hand-placed cards first and renumbers a column after a drop", () => {
    const column = sortForBoard([
      task("new", { updatedAt: 5 }),
      task("placed", { sortOrder: 0 }),
      task("older", { updatedAt: 1 }),
    ]);
    expect(column.map((t) => t.id)).toEqual(["placed", "new", "older"]);
    const updates = reorderColumn(column, "older", 0);
    expect(updates).toEqual([
      { id: "older", sortOrder: 0 },
      { id: "placed", sortOrder: 1 },
      { id: "new", sortOrder: 2 },
    ]);
  });
});

describe("task right-click menu", () => {
  it("offers work, a Focus on submenu, move, copy, archive and delete, and decodes picks", () => {
    const items = taskMenuItems(task("a"), TODAY, true);
    const labels = items.map((item) => (item.kind === "item" ? item.label : "—"));
    expect(labels).toEqual([
      "Start Work",
      "Focus on",
      "Status",
      "Copy",
      "—",
      "Archive",
      "Delete task",
    ]);
    expect(labels).not.toContain("Open beside session");
    const focus = items.find(
      (item) => item.kind === "item" && item.id === "focus-on",
    );
    expect(focus?.kind === "item" ? focus.icon : null).toBeTruthy();
    const days = focus?.kind === "item" ? (focus.submenu ?? []) : [];
    expect(days.map((item) => item.label)).toEqual([
      "Today",
      expect.stringMatching(/^Tomorrow · /),
      expect.any(String),
      expect.any(String),
    ]);
    // No ✓ when unpinned, and no Remove item.
    expect(days.every((item) => item.checked !== true)).toBe(true);
    expect(days.some((item) => item.id === "unfocus")).toBe(false);
    const pinned = taskMenuItems(
      task("b", { archivedAt: 1, focusDate: TODAY }),
      TODAY,
      false,
    );
    const pinnedLabels = pinned.map((item) =>
      item.kind === "item" ? item.label : "—",
    );
    expect(pinnedLabels).toContain("Unarchive");
    expect(pinnedLabels).not.toContain("Start Work");
    const pinnedFocus = pinned.find(
      (item) => item.kind === "item" && item.id === "focus-on",
    );
    const pinnedDays =
      pinnedFocus?.kind === "item" ? (pinnedFocus.submenu ?? []) : [];
    expect(
      pinnedDays.find((item) => item.id === `focusOn:${TODAY}`)?.checked,
    ).toBe(true);
    expect(
      pinnedDays.some((item) => item.label === "Remove from focus"),
    ).toBe(true);
    // Every top-level actionable item has an icon; status rows keep theirs.
    for (const item of items) {
      if (item.kind !== "item") continue;
      expect(item.icon, item.label).toBeTruthy();
    }
    const status = items.find((item) => item.kind === "item" && item.id === "move");
    expect(status?.kind === "item" ? status.submenu : []).toHaveLength(5);
    expect(taskMenuAction("move:review")).toEqual({
      kind: "move",
      status: "review",
    });
    expect(taskMenuAction(`focusOn:${TODAY}`)).toEqual({
      kind: "focus",
      on: true,
      day: TODAY,
    });
    expect(taskMenuAction("unfocus")).toEqual({ kind: "focus", on: false });
    expect(taskMenuAction("focusOn:bad")).toBeNull();
    expect(taskMenuAction("unarchive")).toEqual({ kind: "archive", on: false });
    expect(taskMenuAction("bogus")).toBeNull();
  });
});

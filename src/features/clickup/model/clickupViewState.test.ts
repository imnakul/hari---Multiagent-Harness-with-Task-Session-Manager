import { describe, expect, it } from "vitest";
import { LIST_INFO, MEMBER_ANA, MEMBER_BEN, makeTask } from "./clickupTestKit";
import {
  DEFAULT_CLICKUP_VIEW_STATE,
  filterByStatus,
  firstName,
  customFieldColumns,
  groupClickupTasks,
  mergeStatuses,
  parseClickupViewState,
  readableTextOn,
  sortClickupTasks,
} from "./clickupViewState";

const open = { status: "to do", type: "open", color: "#aaa" };
const doing = { status: "in progress", type: "custom", color: "#bbb" };
const done = { status: "complete", type: "closed", color: "#ccc" };
const lists = [{ id: "9001", name: "Sprint" }];

describe("ClickUp view state (L-381)", () => {
  it("reads stored settings field by field and drops unknown values", () => {
    expect(parseClickupViewState(null)).toEqual(DEFAULT_CLICKUP_VIEW_STATE);
    expect(
      parseClickupViewState({ view: "board", groupBy: "nope", sort: { field: "priority", dir: "desc" }, collapsed: ["a", 3] }),
    ).toEqual({ view: "board", groupBy: "status", sort: { field: "priority", dir: "desc" }, collapsed: ["a"], mine: false, boardColumnWeights: {}, statuses: [], panelWidth: 380 });
    expect(parseClickupViewState({ statuses: [" To Do ", 4] }).statuses).toEqual(["to do"]);
    // The task panel width is clamped to its bounds; junk falls back to the default.
    expect(parseClickupViewState({ panelWidth: 5000 }).panelWidth).toBe(1000);
    expect(parseClickupViewState({ panelWidth: "wide" }).panelWidth).toBe(380);
    expect(
      parseClickupViewState({ boardColumnWeights: { a: 1.5, b: 99, c: -1, d: "wide" } }).boardColumnWeights,
    ).toEqual({ a: 1.5, b: 10 });
  });

  it("orders statuses per list by orderindex, first name wins, task-only statuses last", () => {
    const other = [
      { status: "In Progress", type: "custom", color: "#000", orderindex: 0 },
      { status: "qa", type: "custom", color: "#111", orderindex: 1 },
    ];
    const merged = mergeStatuses(
      [[...LIST_INFO.statuses].reverse(), other],
      [makeTask("1", { status: { status: "odd", type: "custom", color: "#222" } })],
    );
    expect(merged.map((status) => status.status)).toEqual(["to do", "in progress", "complete", "qa", "odd"]);
  });

  it("groups by status in status order, skipping empty groups unless asked (board)", () => {
    const tasks = [makeTask("1", { status: doing }), makeTask("2", { status: open })];
    const statuses = mergeStatuses([LIST_INFO.statuses]);
    expect(
      groupClickupTasks(tasks, "status", { statuses, lists }).map((group) => [group.label, group.tasks.map((task) => task.id)]),
    ).toEqual([
      ["to do", ["2"]],
      ["in progress", ["1"]],
    ]);
    expect(
      groupClickupTasks(tasks, "status", { statuses, lists, includeEmpty: true, hideClosed: true }).map((group) => group.label),
    ).toEqual(["to do", "in progress"]);
    expect(groupClickupTasks(tasks, "status", { statuses, lists, includeEmpty: true }).map((group) => group.label)).toContain(
      "complete",
    );
  });

  it("shows a task under each assignee, unassigned last; priority and none groups", () => {
    const tasks = [makeTask("1", { assignees: [MEMBER_BEN, MEMBER_ANA] }), makeTask("2", { priority: 1 })];
    const byAssignee = groupClickupTasks(tasks, "assignee", { statuses: [], lists });
    expect(byAssignee.map((group) => [group.label, group.tasks.map((task) => task.id)])).toEqual([
      ["Ana", ["1"]],
      ["Ben", ["1"]],
      ["Unassigned", ["2"]],
    ]);
    expect(groupClickupTasks(tasks, "priority", { statuses: [], lists }).map((group) => group.label)).toEqual([
      "Urgent",
      "No priority",
    ]);
    expect(groupClickupTasks(tasks, "none", { statuses: [], lists })).toHaveLength(1);
  });

  it("sorts by a field with empty values last in either direction, ties newest first", () => {
    const tasks = [
      makeTask("a", { dueDate: null, dateUpdated: 5 }),
      makeTask("b", { dueDate: 200 }),
      makeTask("c", { dueDate: 100 }),
      makeTask("d", { dueDate: null, dateUpdated: 9 }),
    ];
    expect(sortClickupTasks(tasks, { field: "dueDate", dir: "asc" }).map((task) => task.id)).toEqual(["c", "b", "d", "a"]);
    expect(sortClickupTasks(tasks, { field: "dueDate", dir: "desc" }).map((task) => task.id)).toEqual(["b", "c", "d", "a"]);
    const named = [makeTask("x", { name: "beta" }), makeTask("y", { name: "Alpha" })];
    expect(sortClickupTasks(named, { field: "name", dir: "asc" }).map((task) => task.id)).toEqual(["y", "x"]);
    const statuses = mergeStatuses([LIST_INFO.statuses]);
    const byStatus = [makeTask("p", { status: done }), makeTask("q", { status: open })];
    expect(sortClickupTasks(byStatus, { field: "status", dir: "asc" }, statuses).map((task) => task.id)).toEqual(["q", "p"]);
  });

  it("lists custom field columns that have a value, in first-seen order", () => {
    const field = (id: string, name: string) => ({ id, name, type: "drop_down", text: "S3", color: "#fd0" });
    const tasks = [
      makeTask("1", { customFields: [field("sev", "Severity")] }),
      makeTask("2", { customFields: [field("type", "Report Type"), field("sev", "Severity")] }),
    ];
    expect(customFieldColumns(tasks).map((column) => column.name)).toEqual(["Severity", "Report Type"]);
  });

  it("filters by picked statuses, ignoring picks that are no longer available", () => {
    const tasks = [makeTask("1", { status: open }), makeTask("2", { status: doing })];
    expect(filterByStatus(tasks, ["to do"], ["to do", "in progress"]).map((task) => task.id)).toEqual(["1"]);
    expect(filterByStatus(tasks, [], ["to do"]).map((task) => task.id)).toEqual(["1", "2"]);
    // A pick that no longer exists (Show done off, list unlinked) never empties the page.
    expect(filterByStatus(tasks, ["complete"], ["to do", "in progress"]).map((task) => task.id)).toEqual(["1", "2"]);
  });

  it("takes the first word of a username for the Assignee button", () => {
    // Regression: the split once used the letter "s", turning "Nakul Srivastava" into "Nakul Sriva".
    expect(firstName("Nakul Srivastava")).toBe("Nakul");
    expect(firstName("  sam  ")).toBe("sam");
    expect(firstName("")).toBe("");
  });

  it("picks the more readable text colour for a fill", () => {
    expect(readableTextOn("#ffcc00")).toBe("#1a1a1a");
    expect(readableTextOn("#d3d3d3")).toBe("#1a1a1a");
    expect(readableTextOn("#7b2ff7")).toBe("#fff");
    expect(readableTextOn("not a colour")).toBe("#fff");
  });
});

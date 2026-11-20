import { describe, expect, it } from "vitest";
import {
  moveSubtask,
  normalizeSubtasks,
  parseSubtasksInput,
  subtaskProgress,
  toggleSubtask,
  type Subtask,
} from "./subtasks";

const list: Subtask[] = [
  { id: "a", title: "Header", status: "todo" },
  { id: "b", title: "Footer", status: "completed" },
  { id: "c", title: "Docs", status: "in_progress" },
];

describe("subtasks (L-373)", () => {
  it("counts done steps", () => {
    expect(subtaskProgress(list)).toEqual({ done: 1, total: 3 });
    expect(subtaskProgress(undefined)).toEqual({ done: 0, total: 0 });
  });

  it("ticks to completed and unticks to todo", () => {
    expect(toggleSubtask(list, "a")[0].status).toBe("completed");
    expect(toggleSubtask(list, "b")[1].status).toBe("todo");
  });

  it("moves one place and stays put at the ends", () => {
    expect(moveSubtask(list, "b", -1).map((step) => step.id)).toEqual(["b", "a", "c"]);
    expect(moveSubtask(list, "a", -1).map((step) => step.id)).toEqual(["a", "b", "c"]);
    expect(moveSubtask(list, "c", 1).map((step) => step.id)).toEqual(["a", "b", "c"]);
  });

  it("drops malformed stored steps and shows unknown statuses as todo", () => {
    expect(
      normalizeSubtasks([
        { id: "x", title: " Keep ", status: "later" },
        { id: "y", title: "  " },
        { title: "no id" },
        "text",
      ]),
    ).toEqual([{ id: "x", title: "Keep", status: "todo" }]);
    expect(normalizeSubtasks(null)).toEqual([]);
  });

  it("takes titles and objects from an agent, keeping known steps", () => {
    const parsed = parseSubtasksInput(["New", { id: "a", status: "completed" }, { title: "Other", status: "blocked" }], list);
    expect(parsed[0]).toMatchObject({ title: "New", status: "todo" });
    expect(parsed[1]).toEqual({ id: "a", title: "Header", status: "completed" });
    expect(parsed[2]).toMatchObject({ title: "Other", status: "blocked" });
    expect(parsed[2].id).not.toBe("a");
  });

  it("refuses bad agent input with a readable reason", () => {
    expect(() => parseSubtasksInput("Header")).toThrow("subtasks must be an array");
    expect(() => parseSubtasksInput([""])).toThrow("subtasks[0] is empty");
    expect(() => parseSubtasksInput([{ id: "zzz" }], list)).toThrow("subtasks[0].id was not found");
    expect(() => parseSubtasksInput([{ status: "todo" }])).toThrow("subtasks[0].title is required");
    expect(() => parseSubtasksInput(Array.from({ length: 101 }, (_, index) => `s${index}`))).toThrow("at most 100");
  });
});

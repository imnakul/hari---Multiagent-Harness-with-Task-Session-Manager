import { describe, expect, it } from "vitest";
import { LIST_INFO, MEMBER_ANA, MEMBER_BEN, makeTask } from "./clickupTestKit";
import {
  MAX_PROMPT_DESCRIPTION,
  dueBeforeStart,
  dueLabel,
  doneStatus,
  draftFromTask,
  fromLocalMidnight,
  mergeTasks,
  reopenStatus,
  sessionPromptForTask,
  taskPatch,
  toLocalMidnight,
} from "./clickupTasks";

describe("clickupTasks (L-381)", () => {
  it("rejects dates that are not real calendar days (AC-C7)", () => {
    expect(toLocalMidnight("2026-02-30")).toBeNull();
    expect(toLocalMidnight("soon")).toBeNull();
    const ms = toLocalMidnight("2026-03-05");
    expect(ms).not.toBeNull();
    expect(fromLocalMidnight(ms)).toBe("2026-03-05");
  });

  it("flags a due date before the start date only when both are set (AC-C7)", () => {
    expect(dueBeforeStart({ startDate: 200, dueDate: 100 })).toBe(true);
    expect(dueBeforeStart({ startDate: 100, dueDate: 100 })).toBe(false);
    expect(dueBeforeStart({ startDate: null, dueDate: 100 })).toBe(false);
  });

  it("sends only the changed fields, and assignees as add/rem (AC-C3)", () => {
    const original = draftFromTask(makeTask("1", { assignees: [MEMBER_ANA] }));
    expect(taskPatch(original, { ...original })).toEqual({});
    const patch = taskPatch(original, { ...original, name: "New", assigneeIds: [MEMBER_BEN.id], dueDate: 5000 });
    expect(patch).toEqual({
      name: "New",
      assignees: { add: [2], rem: [1] },
      due_date: 5000,
      due_date_time: false,
    });
  });

  it("picks the first closed status to finish and the first open one to reopen (AC-C9)", () => {
    expect(doneStatus(LIST_INFO)).toBe("complete");
    expect(reopenStatus(LIST_INFO)).toBe("to do");
    expect(doneStatus({ statuses: [{ status: "x", type: "open", color: "", orderindex: 0 }] })).toBeNull();
  });

  it("keeps the copy updated last when merging (AC-C5)", () => {
    const merged = mergeTasks(
      [makeTask("1", { name: "local", dateUpdated: 2000 })],
      [makeTask("1", { name: "stale", dateUpdated: 1000 }), makeTask("2")],
    );
    expect(merged.find((task) => task.id === "1")?.name).toBe("local");
    expect(merged).toHaveLength(2);
  });

  it("marks overdue due dates", () => {
    const now = new Date(2026, 5, 10, 12).getTime();
    expect(dueLabel(null, now)).toBeNull();
    expect(dueLabel(new Date(2026, 5, 1).getTime(), now)?.overdue).toBe(true);
    expect(dueLabel(new Date(2026, 5, 20).getTime(), now)?.overdue).toBe(false);
  });

  it("trims long descriptions in the session prompt (AC-C12)", () => {
    const prompt = sessionPromptForTask(
      makeTask("1", { markdownDescription: "x".repeat(MAX_PROMPT_DESCRIPTION * 2) }),
    );
    expect(prompt).toContain("https://app.clickup.com/t/1");
    expect(prompt.length).toBeLessThan(MAX_PROMPT_DESCRIPTION + 500);
  });

  it("puts the task's details and files in the session prompt", () => {
    const prompt = sessionPromptForTask(
      makeTask("1", {
        name: "Fix login",
        priority: 2,
        assignees: [MEMBER_ANA],
        dueDate: new Date(2026, 2, 5).getTime(),
        tags: ["auth"],
        customFields: [
          { id: "f", name: "Env", type: "drop_down", text: "prod", color: null },
          { id: "g", name: "Empty", type: "short_text", text: " ", color: null },
        ],
        markdownDescription: "Steps here",
      }),
      { listName: "Sprint", attachedFiles: ["a.png"], missingFiles: ["big.mov"] },
    );
    expect(prompt).toContain("Priority: High · List: Sprint");
    expect(prompt).toContain(`Assignees: ${MEMBER_ANA.username}`);
    expect(prompt).toContain("Due: 2026-03-05");
    expect(prompt).toContain("Tags: auth");
    expect(prompt).toContain("Env: prod");
    expect(prompt).not.toContain("Empty:");
    expect(prompt).toContain("Attached files: a.png");
    expect(prompt).toContain("Not attached (open in ClickUp): big.mov");
    expect(prompt.endsWith("Steps here")).toBe(true);
  });
});

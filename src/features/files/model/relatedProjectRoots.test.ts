import { describe, expect, it } from "vitest";
import { relatedProjectRoots } from "./relatedProjectRoots";

const parent = "E:/Dev/rigorup-active";
const teacher = `${parent}/Teacher`;
const student = `${parent}/student_dash`;
const other = "E:/Dev/personal";

describe("relatedProjectRoots (L-369)", () => {
  it("looks in the project holding cwd first, then in its group", () => {
    const assignments = { [parent.toLowerCase()]: "g1", [student.toLowerCase()]: "g1" };
    expect(relatedProjectRoots(teacher, [other, student, parent, teacher], assignments)).toEqual([
      parent,
      student,
    ]);
  });

  it("finds group mates from cwd's own group, and a worktree inside a project", () => {
    const assignments = { [teacher.toLowerCase()]: "g1", [student.toLowerCase()]: "g1" };
    expect(relatedProjectRoots(teacher, [teacher, student, other], assignments)).toEqual([student]);
    expect(relatedProjectRoots(`${teacher}/.worktrees/pr3`, [teacher, student], assignments)).toEqual([
      teacher,
      student,
    ]);
  });

  it("ignores unrelated projects, ones inside cwd, and the home folder", () => {
    expect(relatedProjectRoots(parent, [other, teacher, parent], {})).toEqual([]);
    expect(relatedProjectRoots("~", [other], {})).toEqual([]);
  });
});

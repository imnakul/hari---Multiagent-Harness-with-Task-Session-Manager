import { describe, expect, it, vi } from "vitest";

import { runningGroups, runningRows } from "@/features/tabs/runningRows";
import type { Mono, Project, SessionSummary } from "@/features/workspace/types";

// Hoisted above the imports by Vitest.
vi.mock("expo-constants", () => ({ default: { expoConfig: null } }));

const session = (id: string, extra: Partial<SessionSummary>): SessionSummary =>
  ({ id, projectId: "p1", title: id, updatedAt: 0, ...extra }) as SessionSummary;
const mono = (id: string, extra: Partial<Mono>): Mono =>
  ({ id, name: id, status: "idle", lastActiveAt: 0, ...extra }) as Mono;
const projects = new Map<string, Project>([["p1", { id: "p1", name: "Alpha" } as Project]]);

describe("runningRows (AC-20, 21)", () => {
  it("lists needs-you first, then the most recent, and not idle sessions", () => {
    const rows = runningRows(
      [
        session("S1", { busy: true, updatedAt: 10 }),
        session("S2", { waiting: "approval", updatedAt: 9 }),
        session("S3", {}),
      ],
      [mono("M1", { status: "working", lastActiveAt: 9.5 })],
      projects,
    );
    expect(rows.map((row) => row.key)).toEqual(["session:S2", "session:S1", "mono:M1"]);
    expect(rows[0]).toMatchObject({ name: "Alpha", needsYou: true });
  });
  it("puts a Mono that needs you with the waiting sessions", () => {
    const rows = runningRows(
      [session("S1", { busy: true, updatedAt: 10 })],
      [mono("M1", { status: "needs-you", lastActiveAt: 1 })],
      projects,
    );
    expect(rows.map((row) => row.key)).toEqual(["mono:M1", "session:S1"]);
  });
  it("leaves Mono sessions to the Mono row, and is empty when nothing runs", () => {
    expect(runningRows([session("S4", { busy: true, monoId: "M1" })], [mono("M1", {})], projects)).toEqual([]);
  });
});

describe("runningGroups", () => {
  const twoProjects = new Map<string, Project>([
    ["p1", { id: "p1", name: "Alpha" } as Project],
    ["p2", { id: "p2", name: "Beta" } as Project],
  ]);
  it("groups sessions under their project and Monos together, waiting groups first", () => {
    const rows = runningRows(
      [
        session("A1", { busy: true, updatedAt: 10 }),
        session("B1", { projectId: "p2", waiting: "question", updatedAt: 1 }),
        session("A2", { busy: true, updatedAt: 5 }),
      ],
      [mono("M1", { status: "working", lastActiveAt: 7 })],
      twoProjects,
    );
    const groups = runningGroups(rows, twoProjects);
    expect(groups.map((group) => [group.title, group.rows.map((row) => row.key), group.needsYou])).toEqual([
      ["Beta", ["session:B1"], 1],
      ["Alpha", ["session:A1", "session:A2"], 0],
      ["Monos", ["mono:M1"], 0],
    ]);
    expect(groups[0]?.project?.id).toBe("p2");
  });
  it("is empty when nothing runs", () => {
    expect(runningGroups([], twoProjects)).toEqual([]);
  });
});

import { expect, it } from "vitest";
import {
  activitySummary,
  processTotals,
  type ActivityTrackerUsage,
  type AppProcess,
} from "./processMonitorModel";

const app: AppProcess = {
  pid: 1,
  cpu: 1,
  memory: 100,
  gpu: null,
  processes: 1,
  unreadable: 0,
  children: [],
};

function usage(overrides: Partial<ActivityTrackerUsage> = {}): ActivityTrackerUsage {
  return {
    phase: "idle",
    enabled: true,
    today: { calls: 0, notes: 0, failures: 0 },
    process: null,
    ...overrides,
  };
}

it("summarizes the Activity tracker in one line", () => {
  expect(activitySummary(usage())).toBe("Idle · 0 notes today · 0 agy calls");
  expect(
    activitySummary(
      usage({ phase: "writing", today: { calls: 1, notes: 1, failures: 2 } }),
    ),
  ).toBe("Writing a note with agy · 1 note today · 1 agy call · 2 failed");
  expect(activitySummary(usage({ enabled: false, phase: "off" }))).toBe(
    "AI notes off · prompts still logged locally",
  );
});

it("adds a running agy process to the bottom-bar totals", () => {
  const agy: AppProcess = { ...app, pid: 9, cpu: 4, memory: 50 };
  expect(processTotals(app, [], null, agy)).toMatchObject({ cpu: 5, memory: 150 });
  expect(processTotals(app, [], null, null)).toMatchObject({ cpu: 1, memory: 100 });
});

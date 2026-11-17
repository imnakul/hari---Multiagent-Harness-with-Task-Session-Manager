import { describe, expect, it, vi } from "vitest";
import {
  applyTriggers,
  automationSubmissionPrompt,
  automationScheduleLabel,
  automationTriggers,
  createAutomationTrigger,
  draftFromAutomation,
  draftFromTemplate,
  formatAutomationRunAt,
  formatAutomationRunDuration,
  fromRemovedHarness,
  gmtOffsetLabel,
  newAutomationDraft,
  nextAutomationRunAt,
  nextRunPreview,
  nextTriggersRunAt,
  overdueTriggerOccurrences,
  type Automation,
} from "./automations";

const at = (value: string) => new Date(value).getTime();

describe("automation schedules", () => {
  it("moves hourly schedules to the next occurrence", () => {
    expect(
      nextAutomationRunAt(
        { scheduleKind: "hourly", minute: 15, time: "09:00", dayOfWeek: 1 },
        at("2026-09-19T10:20:00"),
      ),
    ).toBe(at("2026-09-19T11:15:00"));
  });

  it("preserves custom cron through save fields and hydration, alongside simple/event triggers", () => {
    const custom = createAutomationTrigger("time", "custom", { cron: "0 21 2 * *" });
    const synced = applyTriggers(newAutomationDraft("/repo", "codex", "model"), [custom, createAutomationTrigger("github", "issue_opened")]);
    const restored = draftFromAutomation({ ...synced, id: "custom-id", nextRunAt: 1, createdAt: 1, updatedAt: 1, operatorMode: true });
    expect(restored.cron).toBe("0 21 2 * *");
    expect(restored.operatorMode).toBe(true);
    expect(restored.triggers).toEqual(synced.triggers);
    expect(nextTriggersRunAt(restored.triggers, at("2026-10-04T21:00:00"))).toBe(at("2026-11-02T21:00:00"));
    expect(automationScheduleLabel(restored)).toBe("Custom: 0 21 2 * *");
  });

  it("bounds custom catch-up and deduplicates coinciding simple/custom runs", () => {
    const custom = createAutomationTrigger("time", "custom", { cron: "*/15 * * * *" });
    const hourly = createAutomationTrigger("time", "hourly", { minute: 0 });
    const first = at("2026-10-04T20:00:00");
    const runs = overdueTriggerOccurrences([custom, hourly], first, at("2026-10-04T21:00:00"));
    expect(runs.map((run) => run.scheduledFor)).toEqual([0, 15, 30, 45, 60].map((minute) => first + minute * 60_000));
    expect(overdueTriggerOccurrences([custom], first, first + 86_400_000, 3)).toHaveLength(3);
  });

  it("activates Operator for all launch prompts without duplicating an explicit command", () => {
    expect(automationSubmissionPrompt({ operatorMode: true }, "Check open tasks")).toBe("/operator Check open tasks");
    expect(automationSubmissionPrompt({ operatorMode: true }, "Issue opened\nCheck open tasks")).toBe("/operator Issue opened\nCheck open tasks");
    expect(automationSubmissionPrompt({ operatorMode: true }, "/operator Check open tasks")).toBe("/operator Check open tasks");
    expect(automationSubmissionPrompt({ operatorMode: true }, "/mono Check tasks")).toBe("/mono Check tasks");
    expect(automationSubmissionPrompt({ operatorMode: false }, "Check open tasks")).toBe("Check open tasks");
    expect(newAutomationDraft("/repo", "codex", "model").operatorMode).toBe(false);
  });

  it("skips weekends for weekday schedules", () => {
    expect(
      nextAutomationRunAt(
        { scheduleKind: "weekdays", minute: 0, time: "09:00", dayOfWeek: 1 },
        at("2026-09-18T10:00:00"),
      ),
    ).toBe(at("2026-09-21T09:00:00"));
  });

  it("keeps a later occurrence on the same day", () => {
    expect(
      nextAutomationRunAt(
        { scheduleKind: "daily", minute: 0, time: "18:00", dayOfWeek: 1 },
        at("2026-09-19T10:00:00"),
      ),
    ).toBe(at("2026-09-19T18:00:00"));
  });

  it("describes weekly schedules", () => {
    expect(
      automationScheduleLabel({
        scheduleKind: "weekly",
        minute: 0,
        time: "09:00",
        dayOfWeek: 1,
      } as Automation),
    ).toMatch(/^Monday at /);
  });

  it("starts without triggers and hydrates a legacy provider trigger", () => {
    const initial = newAutomationDraft("/repo", "codex", "model");
    expect(initial.triggers).toEqual([]);
    expect(initial.triggerKind).toBe("time");
    expect(initial.modelSettings).toEqual({});
    expect(initial.sessionFolderId).toBe("");

    const restored = draftFromAutomation({
      ...initial,
      id: "automation-id",
      triggerKind: "gitlab",
      triggerEvent: "merge_request_opened",
      triggers: undefined,
      nextRunAt: at("2026-09-21T09:00:00"),
      createdAt: at("2026-09-19T09:00:00"),
      updatedAt: at("2026-09-19T10:00:00"),
    });
    expect(restored.triggerKind).toBe("gitlab");
    expect(restored.triggerEvent).toBe("merge_request_opened");
    expect(restored.triggers).toHaveLength(1);
    expect(restored.triggers[0]?.kind).toBe("gitlab");
    expect(restored.triggers[0]?.event).toBe("merge_request_opened");
  });

  it("defaults missing model settings to an empty map", () => {
    const initial = newAutomationDraft("/repo", "codex", "model");
    const restored = draftFromAutomation({
      ...initial,
      id: "automation-id",
      modelSettings: undefined,
      nextRunAt: at("2026-09-21T09:00:00"),
      createdAt: at("2026-09-19T09:00:00"),
      updatedAt: at("2026-09-19T10:00:00"),
    });
    expect(restored.modelSettings).toEqual({});
  });

  it("keeps an explicit empty trigger list empty", () => {
    const initial = newAutomationDraft("/repo", "codex", "model");
    const restored = draftFromAutomation({
      ...initial,
      id: "automation-id",
      triggers: [],
      nextRunAt: at("2026-09-21T09:00:00"),
      createdAt: at("2026-09-19T09:00:00"),
      updatedAt: at("2026-09-19T10:00:00"),
    });
    expect(restored.triggers).toEqual([]);
  });

  it("syncs legacy fields from the earliest time trigger", () => {
    const draft = newAutomationDraft("/repo", "codex", "model");
    const github = createAutomationTrigger("github", "draft_opened");
    const weekly = createAutomationTrigger("time", "weekly", {
      time: "09:00",
      dayOfWeek: 1,
    });
    const next = applyTriggers(draft, [github, weekly]);
    expect(next.triggerKind).toBe("time");
    expect(next.triggerEvent).toBe("weekly");
    expect(next.scheduleKind).toBe("weekly");
    expect(next.triggers).toHaveLength(2);
  });

  it("picks the earliest next run across time triggers", () => {
    const daily = createAutomationTrigger("time", "daily", { time: "18:00" });
    const weekly = createAutomationTrigger("time", "weekly", {
      time: "09:00",
      dayOfWeek: 1,
    });
    expect(nextTriggersRunAt([weekly, daily], at("2026-09-19T10:00:00"))).toBe(
      at("2026-09-19T18:00:00"),
    );
  });

  it("preserves each overdue occurrence after a delayed poll", () => {
    const morning = createAutomationTrigger("time", "daily", { time: "09:00" });
    const later = createAutomationTrigger("time", "daily", { time: "10:00" });
    const firstRunAt = at("2026-09-19T09:00:00");

    expect(
      overdueTriggerOccurrences(
        [morning, later],
        firstRunAt,
        at("2026-09-19T10:30:00"),
      ).map((occurrence) => occurrence.scheduledFor),
    ).toEqual([firstRunAt, at("2026-09-19T10:00:00")]);
  });

  it("labels the timezone offset and next run", () => {
    expect(gmtOffsetLabel(new Date("2026-09-19T12:00:00"))).toMatch(
      /^GMT[+-]\d/,
    );
    expect(nextRunPreview(at("2026-09-21T09:00:00"))).toMatch(/^Next run /);
  });

  it.each(["Asia/Kolkata", "Asia/Calcutta"])("labels India next-run times once as IST (%s)", (timezone) => {
    vi.stubEnv("TZ", timezone);
    try {
      const preview = nextRunPreview(at("2026-10-06T16:00:00+05:30"));
      expect(preview).toMatch(/, 16:00 IST$/);
      expect(preview).not.toContain("GMT");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("keeps the local timezone for computers outside India", () => {
    vi.stubEnv("TZ", "UTC");
    try {
      expect(nextRunPreview(at("2026-10-06T16:00:00Z"))).toMatch(/, 16:00 UTC$/);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("hydrates missing trigger arrays from legacy fields", () => {
    expect(
      automationTriggers({
        id: "automation-id",
        triggerKind: "github",
        triggerEvent: "push_to_branch",
        scheduleKind: "weekdays",
        minute: 0,
        time: "09:00",
        dayOfWeek: 1,
      }).map((trigger) => `${trigger.kind}:${trigger.event}`),
    ).toEqual(["github:push_to_branch"]);
  });

  it("prefills a draft from a template trigger", () => {
    const draft = draftFromTemplate("/repo", "codex", "model", {
      name: "Find critical bugs",
      prompt: "Review recent commits.",
      trigger: {
        kind: "time",
        event: "weekdays",
        scheduleKind: "weekdays",
        time: "09:00",
      },
    });
    expect(draft.name).toBe("Find critical bugs");
    expect(draft.prompt).toBe("Review recent commits.");
    expect(draft.triggers).toHaveLength(1);
    expect(draft.triggerKind).toBe("time");
    expect(draft.triggerEvent).toBe("weekdays");
    expect(draft.scheduleKind).toBe("weekdays");
    expect(draft.time).toBe("09:00");
  });
});

describe("automation run display", () => {
  it("formats the triggered timestamp as day month, 24h time", () => {
    const stamp = new Date(2026, 8, 19, 13, 36).getTime();
    const month = new Date(stamp).toLocaleDateString(undefined, {
      month: "short",
    });
    expect(formatAutomationRunAt(stamp)).toBe(`19 ${month}, 13:36`);
  });

  it("summarizes run duration the way the history list does", () => {
    const createdAt = at("2026-09-19T13:00:00");
    expect(
      formatAutomationRunDuration({
        status: "pending",
        createdAt,
      }),
    ).toBe("—");
    expect(
      formatAutomationRunDuration({
        status: "failed",
        createdAt,
        startedAt: createdAt,
        completedAt: createdAt + 20_000,
      }),
    ).toBe("< 1m");
    expect(
      formatAutomationRunDuration({
        status: "succeeded",
        createdAt,
        startedAt: createdAt,
        completedAt: createdAt + 5 * 60_000,
      }),
    ).toBe("5m");
    expect(
      formatAutomationRunDuration(
        {
          status: "running",
          createdAt,
          startedAt: createdAt,
        },
        createdAt + 90_000,
      ),
    ).toBe("1m");
  });
});

describe("removed harness (L-331)", () => {
  it("moves Antigravity ACP automations to Antigravity CLI with the same model", () => {
    const old = {
      harness: "antigravity",
      model: "antigravity:gemini-3.8-flash-high",
    } as unknown as Automation;
    expect(fromRemovedHarness(old)).toMatchObject({
      harness: "antigravity-cli",
      model: "antigravity-cli:gemini-3.8-flash-high",
    });
  });

  it("leaves other automations as they are", () => {
    const current = {
      harness: "codex",
      model: "codex:gpt-5",
    } as unknown as Automation;
    expect(fromRemovedHarness(current)).toBe(current);
  });
});

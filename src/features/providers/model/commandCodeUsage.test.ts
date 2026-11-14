import { describe, expect, it } from "vitest";
import { parseCommandCodeUsage } from "./rateLimits";

describe("Command Code usage (L-296)", () => {
  it("reads the 5-hour and weekly limits and the month's share", () => {
    const usage = parseCommandCodeUsage({
      credits: {
        credits: { monthlyCredits: 20, purchasedCredits: 0, freeCredits: 0 },
        windowLimits: {
          fiveHour: { used: 3, cap: 12, resetAt: "2026-11-15T10:00:00Z" },
          weekly: { used: 30, cap: 60, resetAt: "2026-11-20T00:00:00Z" },
        },
      },
      subscription: {
        data: { status: "active", planId: "individual-pro_v1", currentPeriodEnd: "2026-12-01T00:00:00Z" },
      },
      summary: { totalCost: 60 },
    });
    expect(usage.provider).toBe("command-code");
    expect(usage.session?.usedPercent).toBe(25);
    expect(usage.session?.resetsAt).toBe(Date.parse("2026-11-15T10:00:00Z"));
    expect(usage.weekly?.usedPercent).toBe(50);
    // Pro v1 is 80 credits a month; 20 left means 75% used.
    expect(usage.monthly?.usedPercent).toBe(75);
    expect(usage.monthly?.resetsAt).toBe(Date.parse("2026-12-01T00:00:00Z"));
  });

  it("works out the month from spend when there's no active plan", () => {
    const usage = parseCommandCodeUsage({
      credits: { credits: { monthlyCredits: 0, purchasedCredits: 5, freeCredits: 5 } },
      summary: { totalCost: 10 },
    });
    expect(usage.session).toBeNull();
    expect(usage.weekly).toBeNull();
    expect(usage.monthly?.usedPercent).toBe(50);
  });

  it("has nothing to show without credits or limits", () => {
    const usage = parseCommandCodeUsage({ credits: {} });
    expect(usage.session ?? usage.weekly ?? usage.monthly).toBeNull();
  });
});

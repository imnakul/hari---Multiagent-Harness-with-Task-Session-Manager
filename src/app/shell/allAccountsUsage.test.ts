import { describe, expect, it, vi } from "vitest";
import type {
  ProviderAccount,
  ProviderAccountProvider,
} from "../../features/providers/model/providerAccounts";
import {
  idleRateLimits,
  RATE_LIMIT_MIN_REFETCH_MS,
  type ProviderRateLimits,
} from "../../features/providers/model/rateLimits";
import {
  buildAccountChipEntries,
  isFreshRateLimit,
  loadAccountsInSequence,
  shortestWindow,
  splitVisibleEntries,
  type AccountChipEntry,
} from "./allAccountsUsage";

function account(
  provider: ProviderAccountProvider,
  id: string,
  label: string,
): ProviderAccount {
  return { id, provider, label };
}

const ACCOUNTS: Record<ProviderAccountProvider, ProviderAccount[]> = {
  claude: [
    account("claude", "default", "Default account"),
    account("claude", "account-a", "Work"),
  ],
  codex: [account("codex", "default", "Default account")],
  devin: [account("devin", "default", "Default account")],
};
const accountsFor = (provider: ProviderAccountProvider): ProviderAccount[] =>
  ACCOUNTS[provider];

describe("buildAccountChipEntries", () => {
  it("lists every account of the enabled providers in provider order", () => {
    const entries = buildAccountChipEntries(
      ["devin", "codex", "claude"],
      accountsFor,
    );
    expect(entries.map((entry) => entry.key)).toEqual([
      "claude:default",
      "claude:account-a",
      "codex:default",
      "devin:default",
    ]);
  });

  it("skips providers that are not enabled", () => {
    const entries = buildAccountChipEntries(["codex"], accountsFor);
    expect(entries.map((entry) => entry.key)).toEqual(["codex:default"]);
  });

  it("returns nothing when no provider is enabled", () => {
    expect(buildAccountChipEntries([], accountsFor)).toEqual([]);
  });

  it("tells same-provider accounts with the same label apart", () => {
    const entries = buildAccountChipEntries(["claude"], () => [
      account("claude", "default", "Work"),
      account("claude", "account-a", "Work"),
      account("claude", "account-b", "Work"),
    ]);
    expect(entries.map((entry) => entry.label)).toEqual([
      "Work",
      "Work (2)",
      "Work (3)",
    ]);
  });

  it("moves pinned accounts first and keeps the rest in order", () => {
    const entries = buildAccountChipEntries(
      ["claude", "codex", "devin"],
      accountsFor,
      ["codex:default", "claude:account-a"],
    );
    expect(entries.map((entry) => entry.key)).toEqual([
      "codex:default",
      "claude:account-a",
      "claude:default",
      "devin:default",
    ]);
  });
});

describe("splitVisibleEntries", () => {
  const items = ["a", "b", "c", "d", "e"];

  it("shows everything when the width fits all chips", () => {
    expect(splitVisibleEntries(items, 1400)).toEqual({
      visible: items,
      overflow: [],
    });
  });

  it("collapses the rest into overflow in a narrow bar", () => {
    const { visible, overflow } = splitVisibleEntries(items, 600);
    expect(visible).toEqual(["a", "b"]);
    expect(overflow).toEqual(["c", "d", "e"]);
  });

  it("always keeps one chip visible, even at a tiny width", () => {
    const { visible, overflow } = splitVisibleEntries(items, 40);
    expect(visible).toEqual(["a"]);
    expect(overflow).toEqual(["b", "c", "d", "e"]);
  });

  it("uses a safe default before the bar has been measured", () => {
    const { visible, overflow } = splitVisibleEntries(items, null);
    expect(visible).toEqual(["a", "b", "c"]);
    expect(overflow).toEqual(["d", "e"]);
  });

  it("has no overflow for an empty list", () => {
    expect(splitVisibleEntries([], 300)).toEqual({ visible: [], overflow: [] });
  });
});

describe("shortestWindow", () => {
  const base = idleRateLimits("claude");

  it("prefers the 5-hour window over weekly and monthly", () => {
    const limits: ProviderRateLimits = {
      ...base,
      weekly: { usedPercent: 10, windowMinutes: 10_080, resetsAt: null },
      session: { usedPercent: 40, windowMinutes: 300, resetsAt: null },
      monthly: { usedPercent: 5, windowMinutes: 43_200, resetsAt: null },
    };
    expect(shortestWindow(limits)?.windowMinutes).toBe(300);
  });

  it("falls back to the shortest window that exists", () => {
    const limits: ProviderRateLimits = {
      ...base,
      weekly: { usedPercent: 10, windowMinutes: 10_080, resetsAt: null },
      monthly: { usedPercent: 5, windowMinutes: 43_200, resetsAt: null },
    };
    expect(shortestWindow(limits)?.windowMinutes).toBe(10_080);
  });

  it("is null without any window", () => {
    expect(shortestWindow(base)).toBeNull();
  });
});

describe("isFreshRateLimit", () => {
  const now = 1_000_000_000;
  const ok = (age: number): ProviderRateLimits => ({
    ...idleRateLimits("codex"),
    status: "ok",
    updatedAt: now - age,
  });

  it("treats a recent good reading as fresh", () => {
    expect(isFreshRateLimit(ok(1_000), now)).toBe(true);
  });

  it("treats a reading past the minimum refetch interval as stale", () => {
    expect(isFreshRateLimit(ok(RATE_LIMIT_MIN_REFETCH_MS + 1), now)).toBe(
      false,
    );
  });

  it("always retries failed, unavailable and missing readings", () => {
    expect(isFreshRateLimit({ ...ok(0), status: "error" }, now)).toBe(false);
    expect(isFreshRateLimit({ ...ok(0), status: "unavailable" }, now)).toBe(
      false,
    );
    expect(isFreshRateLimit(undefined, now)).toBe(false);
  });
});

describe("loadAccountsInSequence", () => {
  const entries = buildAccountChipEntries(
    ["claude", "codex", "devin"],
    accountsFor,
  );
  const noSleep = async (): Promise<void> => undefined;

  it("loads one account at a time, in order, pausing between them", async () => {
    const events: string[] = [];
    const sleep = vi.fn(async (ms: number) => {
      events.push(`sleep:${ms}`);
    });
    await loadAccountsInSequence(
      entries,
      async (entry) => {
        events.push(`load:${entry.key}`);
      },
      () => false,
      250,
      sleep,
    );
    expect(events).toEqual([
      "load:claude:default",
      "sleep:250",
      "load:claude:account-a",
      "sleep:250",
      "load:codex:default",
      "sleep:250",
      "load:devin:default",
    ]);
  });

  it("never starts a load while the previous one is still running", async () => {
    let running = 0;
    let peak = 0;
    await loadAccountsInSequence(
      entries,
      async () => {
        running += 1;
        peak = Math.max(peak, running);
        await Promise.resolve();
        running -= 1;
      },
      () => false,
      0,
      noSleep,
    );
    expect(peak).toBe(1);
  });

  it("stops when cancelled", async () => {
    const loaded: string[] = [];
    let cancelled = false;
    await loadAccountsInSequence(
      entries,
      async (entry) => {
        loaded.push(entry.key);
        cancelled = true;
      },
      () => cancelled,
      0,
      noSleep,
    );
    expect(loaded).toEqual(["claude:default"]);
  });

  it("keeps going when one account fails", async () => {
    const loaded: AccountChipEntry["key"][] = [];
    await loadAccountsInSequence(
      entries,
      async (entry) => {
        loaded.push(entry.key);
        if (entry.key === "claude:default") throw new Error("boom");
      },
      () => false,
      0,
      noSleep,
    );
    expect(loaded).toHaveLength(entries.length);
  });

  it("does nothing for an empty queue", async () => {
    const load = vi.fn(async () => undefined);
    await loadAccountsInSequence([], load, () => false, 0, noSleep);
    expect(load).not.toHaveBeenCalled();
  });
});

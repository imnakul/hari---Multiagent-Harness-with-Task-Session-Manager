// @vitest-environment happy-dom
// Keep this as .ts because the project test glob intentionally excludes .test.tsx.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rateLimitsFetch = vi.hoisted(() => ({
  consumeCodexRateLimitResetCredit: vi.fn(),
  fetchClaudeRateLimits: vi.fn(),
  fetchCodexRateLimits: vi.fn(),
  fetchDevinRateLimits: vi.fn(),
  fetchOpencodeGoRateLimits: vi.fn(),
  cachedDevinIdentity: vi.fn(() => null),
}));

vi.mock(
  "../../features/providers/model/rateLimitsFetch",
  () => rateLimitsFetch,
);
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => null),
}));

import type {
  ProviderRateLimits,
  RateLimitProvider,
} from "../../features/providers/model/rateLimits";
import { RATE_LIMIT_POLL_MS } from "../../features/providers/model/rateLimits";
import { saveProviderAccount } from "../../features/providers/model/providerAccounts";
import { clearCachedRateLimits } from "../../features/providers/model/rateLimitsCache";
import {
  saveAllAccountsUsage,
  saveRemainingQuota,
} from "../../features/settings/model/settings";
import { ACCOUNT_LOAD_GAP_MS } from "./allAccountsUsage";
import { UsageFooter } from "./UsageFooter";

let container: HTMLDivElement;
let root: Root;

function okLimits(
  provider: RateLimitProvider,
  used: number,
): ProviderRateLimits {
  return {
    provider,
    session: { usedPercent: used, windowMinutes: 300, resetsAt: null },
    weekly: { usedPercent: 90, windowMinutes: 10_080, resetsAt: null },
    monthly: null,
    resetCredits: null,
    updatedAt: Date.now(),
    error: null,
    status: "ok",
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  localStorage.clear();
  rateLimitsFetch.fetchClaudeRateLimits
    .mockReset()
    .mockImplementation(async () => okLimits("claude", 10));
  rateLimitsFetch.fetchCodexRateLimits
    .mockReset()
    .mockImplementation(async () => okLimits("codex", 20));
  rateLimitsFetch.fetchDevinRateLimits
    .mockReset()
    .mockImplementation(async () => okLimits("devin", 30));
  clearCachedRateLimits();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
  localStorage.clear();
});

function chips(): HTMLButtonElement[] {
  return [
    ...document.querySelectorAll<HTMLButtonElement>(
      'button[aria-label$="usage details"]:not([aria-label*="more account"])',
    ),
  ];
}

describe("UsageFooter all accounts usage", () => {
  it("automatically refreshes the selected account without reading unused accounts", async () => {
    saveProviderAccount({
      id: "account-work",
      provider: "claude",
      label: "Work",
    });
    await act(async () =>
      root.render(createElement(UsageFooter, { providers: ["claude"] })),
    );
    expect(
      rateLimitsFetch.fetchClaudeRateLimits.mock.calls.map(([id]) => id),
    ).toEqual(["default"]);
    rateLimitsFetch.fetchClaudeRateLimits.mockImplementation(async () =>
      okLimits("claude", 67),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(RATE_LIMIT_POLL_MS);
    });
    expect(
      rateLimitsFetch.fetchClaudeRateLimits.mock.calls.map(([id]) => id),
    ).toEqual(["default", "default"]);
    expect(chips()[0].textContent).toContain("67%");
    expect(rateLimitsFetch.fetchCodexRateLimits).not.toHaveBeenCalled();
  });
  it("automatically refreshes all accounts, including those behind the +N chip", async () => {
    saveAllAccountsUsage(true);
    saveProviderAccount({
      id: "account-work",
      provider: "claude",
      label: "Work",
    });
    await act(async () =>
      root.render(createElement(UsageFooter, { providers: [] })),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ACCOUNT_LOAD_GAP_MS * 4);
    });
    expect(rateLimitsFetch.fetchClaudeRateLimits).toHaveBeenCalledTimes(2);
    expect(rateLimitsFetch.fetchDevinRateLimits).toHaveBeenCalledTimes(1);
    rateLimitsFetch.fetchClaudeRateLimits.mockImplementation(async () =>
      okLimits("claude", 55),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(RATE_LIMIT_POLL_MS);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ACCOUNT_LOAD_GAP_MS * 4);
    });
    expect(rateLimitsFetch.fetchClaudeRateLimits).toHaveBeenCalledTimes(4);
    expect(rateLimitsFetch.fetchCodexRateLimits).toHaveBeenCalledTimes(2);
    expect(rateLimitsFetch.fetchDevinRateLimits).toHaveBeenCalledTimes(2);
    expect(chips()[0].textContent).toContain("55%");
  });
  it("shows only the selected account until the setting is switched on", async () => {
    saveProviderAccount({
      id: "account-work",
      provider: "claude",
      label: "Work",
    });
    await act(async () =>
      root.render(
        createElement(UsageFooter, {
          providers: ["claude"],
          session: { harness: "claude" },
        }),
      ),
    );

    expect(chips().map((chip) => chip.getAttribute("aria-label"))).toEqual([
      "Claude Code usage details",
    ]);
    expect(rateLimitsFetch.fetchClaudeRateLimits).toHaveBeenCalledTimes(1);
    expect(rateLimitsFetch.fetchCodexRateLimits).not.toHaveBeenCalled();
  });

  it("switches live to one labelled chip per account, loading them one by one", async () => {
    saveProviderAccount({
      id: "account-work",
      provider: "claude",
      label: "Work",
    });
    await act(async () =>
      root.render(
        createElement(UsageFooter, {
          providers: ["claude"],
          session: { harness: "claude" },
        }),
      ),
    );

    await act(async () => saveAllAccountsUsage(true));
    // The default claude account is already cached; the others queue up.
    expect(rateLimitsFetch.fetchClaudeRateLimits).toHaveBeenCalledTimes(2);
    expect(rateLimitsFetch.fetchCodexRateLimits).not.toHaveBeenCalled();
    expect(rateLimitsFetch.fetchDevinRateLimits).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(ACCOUNT_LOAD_GAP_MS);
    });
    expect(rateLimitsFetch.fetchCodexRateLimits).toHaveBeenCalledTimes(1);
    expect(rateLimitsFetch.fetchDevinRateLimits).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(ACCOUNT_LOAD_GAP_MS);
    });
    expect(rateLimitsFetch.fetchDevinRateLimits).toHaveBeenCalledTimes(1);

    // Four accounts, three chips by default, the fourth behind "+1".
    const labels = chips().map((chip) => chip.getAttribute("aria-label"));
    expect(labels).toEqual([
      "Claude Code Default account usage details",
      "Claude Code Work usage details",
      "Codex Default account usage details",
    ]);
    const more = document.querySelector<HTMLButtonElement>(
      'button[aria-label="1 more account, usage details"]',
    );
    expect(more?.textContent).toBe("+1");
    expect(chips()[0]?.textContent).toContain("10% used 5h");
    expect(chips()[0]?.textContent).not.toContain("wk");
  });

  it("opens the +N popover with the collapsed accounts", async () => {
    saveAllAccountsUsage(true);
    saveProviderAccount({
      id: "account-work",
      provider: "claude",
      label: "Work",
    });
    await act(async () =>
      root.render(createElement(UsageFooter, { providers: [] })),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ACCOUNT_LOAD_GAP_MS * 4);
    });

    const more = document.querySelector<HTMLButtonElement>(
      'button[aria-label="1 more account, usage details"]',
    );
    expect(more).not.toBeNull();
    expect(more?.getAttribute("aria-expanded")).toBe("false");
    await act(async () => more?.click());

    expect(more?.getAttribute("aria-expanded")).toBe("true");
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain("Devin");
    expect(dialog?.textContent).toContain("Default account");
  });

  it("honours the remaining quota setting in the account chips", async () => {
    saveAllAccountsUsage(true);
    saveRemainingQuota(true);
    await act(async () =>
      root.render(createElement(UsageFooter, { providers: [] })),
    );

    expect(chips()[0]?.textContent).toContain("90% left");
  });

  it("returns to the single-account bar when switched off again", async () => {
    saveAllAccountsUsage(true);
    await act(async () =>
      root.render(
        createElement(UsageFooter, {
          providers: ["codex"],
          session: { harness: "codex" },
        }),
      ),
    );
    expect(chips().length).toBeGreaterThan(1);

    await act(async () => saveAllAccountsUsage(false));
    expect(chips().map((chip) => chip.getAttribute("aria-label"))).toEqual([
      "Codex usage details",
    ]);
  });
});

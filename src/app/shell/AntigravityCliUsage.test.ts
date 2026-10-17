// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { UsageFooter } from "./UsageFooter";
import {
  clearCachedRateLimits,
  setCachedRateLimits,
} from "../../features/providers/model/rateLimitsCache";
import {
  idleRateLimits,
  RATE_LIMIT_POLL_MS,
  type ProviderRateLimits,
} from "../../features/providers/model/rateLimits";
import { saveAllAccountsUsage } from "../../features/settings/model/settings";
import { savePickerProviderVisible } from "../../features/sessions/model/models";
import {
  markHarnessAvailabilityProbed,
  resetHarnessAvailabilityState,
  setHarnessAvailability,
} from "../../integrations/harness/core/availabilityState";

const fetchUsage = vi.hoisted(() => vi.fn());
vi.mock(
  "../../features/providers/model/antigravityCliUsage",
  async (original) => ({
    ...(await original<
      typeof import("../../features/providers/model/antigravityCliUsage")
    >()),
    fetchAntigravityCliRateLimits: fetchUsage,
  }),
);
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
let container: HTMLDivElement;
let root: Root;
const limits: ProviderRateLimits = {
  ...idleRateLimits("antigravity-cli"),
  status: "ok",
  updatedAt: Date.now(),
  creditBalance: 0,
  modelGroups: [
    {
      name: "Gemini",
      session: { usedPercent: 6, windowMinutes: 300, resetsAt: null },
      weekly: { usedPercent: 17, windowMinutes: 10080, resetsAt: null },
    },
    {
      name: "Claude & GPT",
      session: { usedPercent: 0, windowMinutes: 300, resetsAt: null },
      weekly: { usedPercent: 0, windowMinutes: 10080, resetsAt: null },
    },
  ],
};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  resetHarnessAvailabilityState();
  clearCachedRateLimits();
  fetchUsage.mockReset().mockResolvedValue(limits);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  clearCachedRateLimits();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
  resetHarnessAvailabilityState();
  localStorage.clear();
});

function cliChip(): HTMLButtonElement | null {
  return container.querySelector(
    '[aria-label="Antigravity CLI usage details"]',
  );
}

it("adds the installed saved-account chip in all-accounts mode without an active CLI chat", async () => {
  markHarnessAvailabilityProbed();
  saveAllAccountsUsage(true);
  await act(async () =>
    root.render(createElement(UsageFooter, { providers: [] })),
  );
  expect(cliChip()).toBeNull();
  expect(fetchUsage).not.toHaveBeenCalled();

  // Also covers a deferred installation probe completing after the footer mounts.
  await act(async () => setHarnessAvailability({ "antigravity-cli": true }));
  expect(fetchUsage).toHaveBeenCalledTimes(1);
  expect(cliChip()?.textContent).toContain("Model quotas");
  await act(async () => cliChip()?.click());
  expect(document.body.textContent).toContain("Remaining credits: 0");
  expect(
    document.querySelector('[aria-label="Gemini model quotas"]'),
  ).not.toBeNull();
  expect(
    document.querySelector('[aria-label="Claude & GPT model quotas"]'),
  ).not.toBeNull();
  await act(async () => saveAllAccountsUsage(false));
  expect(cliChip()).toBeNull();
});

it("honours hidden and unavailable CLI providers in all-accounts mode", async () => {
  markHarnessAvailabilityProbed();
  setHarnessAvailability({ "antigravity-cli": true });
  savePickerProviderVisible("antigravity-cli", false);
  saveAllAccountsUsage(true);
  await act(async () =>
    root.render(createElement(UsageFooter, { providers: [] })),
  );
  expect(cliChip()).toBeNull();
  expect(fetchUsage).not.toHaveBeenCalled();
  await act(async () => savePickerProviderVisible("antigravity-cli", true));
  expect(cliChip()).not.toBeNull();
  expect(fetchUsage).toHaveBeenCalledTimes(1);
  await act(async () => setHarnessAvailability({ "antigravity-cli": false }));
  expect(cliChip()).toBeNull();
});

it("shows a single chip in an active CLI chat and preserves selected-only behaviour", async () => {
  markHarnessAvailabilityProbed();
  setHarnessAvailability({ "antigravity-cli": true });
  saveAllAccountsUsage(true);
  await act(async () =>
    root.render(
      createElement(UsageFooter, {
        providers: ["antigravity-cli"],
        session: {
          harness: "antigravity-cli",
          model: "antigravity-cli:gemini-3.8-flash-high",
        },
      }),
    ),
  );
  expect(
    container.querySelectorAll('[aria-label="Antigravity CLI usage details"]'),
  ).toHaveLength(1);
  expect(cliChip()?.textContent).toContain("17% used");
  await act(async () => saveAllAccountsUsage(false));
  expect(cliChip()).not.toBeNull();
  expect(fetchUsage).toHaveBeenCalledTimes(1);
});

it("does not use another provider's model to select the CLI account's family quota", async () => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe(): void {}
      disconnect(): void {}
    },
  );
  markHarnessAvailabilityProbed();
  setHarnessAvailability({ claude: true, "antigravity-cli": true });
  setCachedRateLimits("claude", "default", {
    ...idleRateLimits("claude"),
    status: "ok",
    updatedAt: Date.now(),
    session: { usedPercent: 23, windowMinutes: 300, resetsAt: null },
  });
  saveAllAccountsUsage(true);
  await act(async () =>
    root.render(
      createElement(UsageFooter, {
        providers: ["claude"],
        session: { harness: "claude", model: "claude-opus-5-5" },
      }),
    ),
  );
  expect(cliChip()?.textContent).toContain("Model quotas");
  expect(cliChip()?.textContent).not.toContain("0% used");
  expect(
    container.querySelector(
      '[aria-label="Claude Code Default account usage details"]',
    )?.textContent,
  ).toContain("23% used");
});

it("refreshes all-accounts CLI usage automatically and with the refresh button", async () => {
  vi.useFakeTimers();
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  fetchUsage.mockImplementation(async () => ({
    ...limits,
    updatedAt: Date.now(),
  }));
  markHarnessAvailabilityProbed();
  setHarnessAvailability({ "antigravity-cli": true });
  saveAllAccountsUsage(true);
  await act(async () =>
    root.render(createElement(UsageFooter, { providers: [] })),
  );
  expect(fetchUsage).toHaveBeenCalledTimes(1);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(RATE_LIMIT_POLL_MS);
  });
  expect(fetchUsage).toHaveBeenCalledTimes(2);
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>('[aria-label="Refresh usage"]')
      ?.click(),
  );
  expect(fetchUsage).toHaveBeenCalledTimes(3);
  await act(async () => saveAllAccountsUsage(false));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(RATE_LIMIT_POLL_MS);
  });
  expect(fetchUsage).toHaveBeenCalledTimes(3);
});

it("shows the selected model family's quota, all family details and zero credits in the existing footer", async () => {
  await act(async () =>
    root.render(
      createElement(UsageFooter, {
        providers: ["antigravity-cli"],
        session: {
          harness: "antigravity-cli",
          model: "antigravity-cli:gemini-3.8-flash-high",
        },
      }),
    ),
  );
  expect(fetchUsage).toHaveBeenCalledTimes(1);
  expect(container.textContent).toContain("17% used");
  const trigger = container.querySelector<HTMLButtonElement>(
    '[aria-label="Antigravity CLI usage details"]',
  )!;
  await act(async () => trigger.click());
  expect(document.body.textContent).toContain("Remaining credits: 0");
  expect(
    document.querySelector('[aria-label="Gemini model quotas"]'),
  ).not.toBeNull();
  expect(
    document.querySelector('[aria-label="Claude & GPT model quotas"]'),
  ).not.toBeNull();
  fetchUsage.mockRejectedValue(new Error("quota report format changed"));
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>('[aria-label="Refresh usage"]')!
      .click(),
  );
  expect(document.body.textContent).toContain(
    "Showing the last available snapshot",
  );
  expect(document.body.textContent).toContain("quota report format changed");
});

it("does not borrow a model family's quota for the configured default and does not fetch for ACP", async () => {
  await act(async () =>
    root.render(
      createElement(UsageFooter, {
        providers: ["antigravity-cli"],
        session: {
          harness: "antigravity-cli",
          model: "antigravity-cli:default",
        },
      }),
    ),
  );
  expect(container.textContent).toContain("Model quotas");
  expect(container.textContent).not.toContain("17% used");
  await act(async () =>
    root.render(
      createElement(UsageFooter, {
        providers: [],
        session: { harness: "antigravity" },
      }),
    ),
  );
  expect(
    container.querySelector('[aria-label="Antigravity CLI usage details"]'),
  ).toBeNull();
  expect(fetchUsage).toHaveBeenCalledTimes(1);
});

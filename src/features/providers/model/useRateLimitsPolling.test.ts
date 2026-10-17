// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  RATE_LIMIT_ACCOUNT_STAGGER_MS,
  RATE_LIMIT_MIN_REFETCH_MS,
  RATE_LIMIT_POLL_MS,
  type ProviderRateLimits,
} from "./rateLimits";

const fetches = vi.hoisted(() => ({ claude: vi.fn() }));
vi.mock("./rateLimitsFetch", () => ({ fetchClaudeRateLimits: fetches.claude }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
import {
  clearCachedRateLimits,
  getCachedRateLimits,
  loadRateLimits,
  refreshStaleRateLimits,
  setCachedRateLimits,
} from "./rateLimitsCache";
import {
  useRateLimitsPolling,
  type RateLimitPollingTarget,
} from "./useRateLimitsPolling";

const one: RateLimitPollingTarget[] = [
  { provider: "claude", accountId: "default" },
];
const two: RateLimitPollingTarget[] = [
  ...one,
  { provider: "claude", accountId: "work" },
];
let root: Root;
let container: HTMLDivElement;

function reading(used = 10): ProviderRateLimits {
  return {
    provider: "claude",
    session: { usedPercent: used, windowMinutes: 300, resetsAt: null },
    weekly: null,
    monthly: null,
    resetCredits: null,
    updatedAt: Date.now(),
    status: "ok",
    error: null,
  };
}
function seed(targets = one, age = 0): void {
  for (const target of targets)
    setCachedRateLimits(target.provider, target.accountId, {
      ...reading(),
      updatedAt: Date.now() - age,
    });
}
function Probe({ targets }: { targets: RateLimitPollingTarget[] }): null {
  useRateLimitsPolling(targets);
  return null;
}
async function show(targets = one): Promise<void> {
  await act(async () => root.render(createElement(Probe, { targets })));
}
async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}
async function focus(): Promise<void> {
  await act(async () => {
    window.dispatchEvent(new Event("focus"));
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.parse("2026-10-17T16:00:00Z"));
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  clearCachedRateLimits();
  fetches.claude.mockReset().mockImplementation(async () => reading(60));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  clearCachedRateLimits();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("foreground usage polling", () => {
  it("keeps cold loads with their existing owner and automatically refreshes after 15 minutes", async () => {
    await show();
    expect(fetches.claude).not.toHaveBeenCalled();
    await act(async () => {
      await loadRateLimits("claude");
    });
    await advance(RATE_LIMIT_POLL_MS - 1);
    expect(fetches.claude).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(fetches.claude).toHaveBeenCalledTimes(2);
    expect(getCachedRateLimits("claude").session?.usedPercent).toBe(60);
  });
  it("checks foreground activation at the five-minute boundary without focus/visibility bursts", async () => {
    seed();
    await show();
    await advance(RATE_LIMIT_MIN_REFETCH_MS - 1);
    await focus();
    expect(fetches.claude).not.toHaveBeenCalled();
    await advance(1);
    await focus();
    await focus();
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(fetches.claude).toHaveBeenCalledTimes(1);
  });
  it("skips hidden and unfocused windows, then refreshes when the app regains focus", async () => {
    seed();
    await show();
    vi.mocked(document.hasFocus).mockReturnValue(false);
    await act(async () => {
      window.dispatchEvent(new Event("blur"));
    });
    await advance(RATE_LIMIT_POLL_MS);
    expect(fetches.claude).not.toHaveBeenCalled();
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    await focus();
    await advance(RATE_LIMIT_POLL_MS);
    expect(fetches.claude).not.toHaveBeenCalled();
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(fetches.claude).not.toHaveBeenCalled();
    vi.mocked(document.hasFocus).mockReturnValue(true);
    await focus();
    expect(fetches.claude).toHaveBeenCalledTimes(1);
  });
  it("spaces cached-account refreshes instead of issuing a burst", async () => {
    seed(two, RATE_LIMIT_MIN_REFETCH_MS);
    await show(two);
    expect(fetches.claude.mock.calls.map(([id]) => id)).toEqual(["default"]);
    await advance(RATE_LIMIT_ACCOUNT_STAGGER_MS - 1);
    expect(fetches.claude).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(fetches.claude.mock.calls.map(([id]) => id)).toEqual([
      "default",
      "work",
    ]);
  });
  it("deduplicates simultaneous mounted views and joins an in-flight manual refresh", async () => {
    seed();
    let complete: (value: ProviderRateLimits) => void = () => undefined;
    fetches.claude.mockImplementationOnce(
      () =>
        new Promise<ProviderRateLimits>((resolve) => {
          complete = resolve;
        }),
    );
    const manual = loadRateLimits("claude", "default", true);
    expect(refreshStaleRateLimits("claude")).toBe(manual);
    await act(async () =>
      root.render(
        createElement(
          "div",
          null,
          createElement(Probe, { targets: one }),
          createElement(Probe, { targets: one }),
        ),
      ),
    );
    await advance(RATE_LIMIT_POLL_MS);
    await focus();
    expect(fetches.claude).toHaveBeenCalledTimes(1);
    await act(async () => {
      complete(reading(40));
      await manual;
    });
    await focus();
    expect(fetches.claude).toHaveBeenCalledTimes(1);
  });
  it("throttles failures on focus and recovers later", async () => {
    seed(one, RATE_LIMIT_MIN_REFETCH_MS);
    fetches.claude.mockImplementationOnce(async () => ({
      ...reading(),
      status: "error",
      error: "Temporarily unavailable",
    }));
    await show();
    await focus();
    await focus();
    expect(fetches.claude).toHaveBeenCalledTimes(1);
    await advance(RATE_LIMIT_MIN_REFETCH_MS);
    await focus();
    expect(fetches.claude).toHaveBeenCalledTimes(2);
    expect(getCachedRateLimits("claude").status).toBe("ok");
  });
  it("cancels an obsolete scope while its first request is still pending", async () => {
    seed(two, RATE_LIMIT_MIN_REFETCH_MS);
    let complete: (value: ProviderRateLimits) => void = () => undefined;
    fetches.claude.mockImplementationOnce(
      () =>
        new Promise<ProviderRateLimits>((resolve) => {
          complete = resolve;
        }),
    );
    await show(two);
    await show([]);
    await act(async () => {
      complete(reading());
    });
    await advance(RATE_LIMIT_POLL_MS);
    await focus();
    expect(fetches.claude.mock.calls.map(([id]) => id)).toEqual(["default"]);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("cancels a staggered queue when unmounted and removes its event listeners", async () => {
    seed(two, RATE_LIMIT_MIN_REFETCH_MS);
    await show(two);
    act(() => root.unmount());
    root = createRoot(container);
    await advance(RATE_LIMIT_POLL_MS);
    await focus();
    expect(fetches.claude).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});

import { useEffect } from "react";
import {
  RATE_LIMIT_ACCOUNT_STAGGER_MS,
  RATE_LIMIT_POLL_MS,
  type RateLimitProvider,
} from "./rateLimits";
import {
  getCachedRateLimits,
  rateLimitRefreshDue,
  refreshStaleRateLimits,
} from "./rateLimitsCache";

export type RateLimitPollingTarget = {
  provider: RateLimitProvider;
  accountId: string;
};

/** Callers memoize their scope. All surfaces share the same per-account cache. */
export function useRateLimitsPolling(
  targets: readonly RateLimitPollingTarget[],
): void {
  useEffect(() => {
    if (!targets.length) return;
    let disposed = false;
    let running = false;
    let focused = document.hasFocus();
    let cancelPause: (() => void) | undefined;
    const active = (): boolean =>
      !disposed && focused && document.visibilityState === "visible";
    const pause = (): Promise<void> =>
      new Promise((resolve) => {
        const timer = window.setTimeout(() => {
          cancelPause = undefined;
          resolve();
        }, RATE_LIMIT_ACCOUNT_STAGGER_MS);
        cancelPause = (): void => {
          window.clearTimeout(timer);
          cancelPause = undefined;
          resolve();
        };
      });
    const poll = async (): Promise<void> => {
      if (!active() || running) return;
      const due = targets.filter(({ provider, accountId }) =>
        rateLimitRefreshDue(getCachedRateLimits(provider, accountId)),
      );
      if (!due.length) return;
      running = true;
      try {
        for (const [index, target] of due.entries()) {
          if (!active()) return;
          if (index > 0) await pause();
          if (!active()) return;
          // Recheck freshness here: another mounted view/manual refresh may
          // already have completed this account while it waited in the queue.
          await refreshStaleRateLimits(target.provider, target.accountId);
        }
      } finally {
        running = false;
      }
    };
    const focus = (): void => {
      focused = true;
      void poll();
    };
    const blur = (): void => {
      focused = false;
      cancelPause?.();
    };
    const visibility = (): void => {
      focused = document.hasFocus();
      if (!active()) cancelPause?.();
      else void poll();
    };
    void poll();
    const timer = window.setInterval(() => {
      void poll();
    }, RATE_LIMIT_POLL_MS);
    window.addEventListener("focus", focus);
    window.addEventListener("blur", blur);
    document.addEventListener("visibilitychange", visibility);
    return (): void => {
      disposed = true;
      window.clearInterval(timer);
      cancelPause?.();
      window.removeEventListener("focus", focus);
      window.removeEventListener("blur", blur);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [targets]);
}

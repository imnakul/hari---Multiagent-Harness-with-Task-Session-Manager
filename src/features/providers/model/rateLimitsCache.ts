import { fetchAntigravityCliRateLimits } from "./antigravityCliUsage";
import { useSyncExternalStore } from "react";
import { observeQuota } from "../../debug-inspector/model/trace";
import {
  errorRateLimits,
  fetchingRateLimits,
  idleRateLimits,
  RATE_LIMIT_MIN_REFETCH_MS,
  type ProviderRateLimits,
  type RateLimitProvider,
} from "./rateLimits";
import {
  fetchClaudeRateLimits,
  fetchCodexRateLimits,
  fetchDevinRateLimits,
  fetchOpencodeGoRateLimits,
} from "./rateLimitsFetch";

const snapshots = new Map<string, ProviderRateLimits>();
const pending = new Map<string, Promise<ProviderRateLimits>>();
const queuedRefreshes = new Map<string, Promise<ProviderRateLimits>>();
const listeners = new Set<() => void>();
let allSnapshots: Record<string, ProviderRateLimits> = {};

function keyFor(provider: RateLimitProvider, accountId: string): string {
  return `${provider}:${accountId}`;
}

function publish(key: string, value: ProviderRateLimits): void {
  observeQuota(value.provider, key.slice(value.provider.length + 1), value);
  snapshots.set(key, value);
  allSnapshots = { ...allSnapshots, [key]: value };
  for (const listener of listeners) listener();
}

export function subscribeRateLimits(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getAllRateLimits(): Record<string, ProviderRateLimits> {
  return allSnapshots;
}

export function getCachedRateLimits(
  provider: RateLimitProvider,
  accountId = "default",
): ProviderRateLimits {
  return snapshots.get(keyFor(provider, accountId)) ?? idle[provider];
}

const idle: Record<RateLimitProvider, ProviderRateLimits> = {
  claude: idleRateLimits("claude"),
  codex: idleRateLimits("codex"),
  opencode: idleRateLimits("opencode"),
  "antigravity-cli": idleRateLimits("antigravity-cli"),
  devin: idleRateLimits("devin"),
};

export function useCachedRateLimits(
  provider: RateLimitProvider,
  accountId = "default",
): ProviderRateLimits {
  return useSyncExternalStore(
    subscribeRateLimits,
    () => getCachedRateLimits(provider, accountId),
    () => getCachedRateLimits(provider, accountId),
  );
}

export function setCachedRateLimits(
  provider: RateLimitProvider,
  accountId: string,
  value: ProviderRateLimits,
): void {
  publish(keyFor(provider, accountId), value);
}

/** Reuse snapshots unless a caller explicitly requests a new read. */
export function loadRateLimits(
  provider: RateLimitProvider,
  accountId = "default",
  force = false,
): Promise<ProviderRateLimits> {
  const key = keyFor(provider, accountId);
  const running = pending.get(key);
  if (running) {
    if (!force) return running;
    const queued = queuedRefreshes.get(key);
    if (queued) return queued;
    const next = running.then(() => loadRateLimits(provider, accountId, true));
    queuedRefreshes.set(key, next);
    void next.finally(() => {
      if (queuedRefreshes.get(key) === next) queuedRefreshes.delete(key);
    });
    return next;
  }
  const cached = snapshots.get(key);
  if (cached && !force) return Promise.resolve(cached);

  publish(key, fetchingRateLimits(provider, cached));
  const run = (async () => {
    try {
      const result =
        provider === "claude"
          ? await fetchClaudeRateLimits(accountId)
          : provider === "codex"
            ? await fetchCodexRateLimits(accountId)
            : provider === "antigravity-cli"
              ? await fetchAntigravityCliRateLimits()
            : provider === "devin"
              ? await fetchDevinRateLimits()
              : await fetchOpencodeGoRateLimits();
      publish(key, result);
      return result;
    } catch (error) {
      const result = errorRateLimits(
        provider,
        error instanceof Error ? error.message : String(error),
        getCachedRateLimits(provider, accountId),
      );
      publish(key, result);
      return result;
    } finally {
      pending.delete(key);
    }
  })();
  pending.set(key, run);
  return run;
}

/** Cold loads stay with their existing owner; throttle failed readings too. */
export function rateLimitRefreshDue(
  limits: ProviderRateLimits,
  now = Date.now(),
): boolean {
  return (
    limits.status !== "idle" &&
    limits.status !== "fetching" &&
    now - limits.updatedAt >= RATE_LIMIT_MIN_REFETCH_MS
  );
}

/** Automatic refresh joins current work; it never queues a second forced read. */
export function refreshStaleRateLimits(
  provider: RateLimitProvider,
  accountId = "default",
): Promise<ProviderRateLimits> {
  const key = keyFor(provider, accountId);
  const running = pending.get(key);
  if (running) return running;
  const cached = snapshots.get(key);
  if (cached && !rateLimitRefreshDue(cached)) return Promise.resolve(cached);
  return loadRateLimits(provider, accountId, true);
}

/** Also used when an account is removed and by tests that need a clean cache. */
export function clearCachedRateLimits(
  provider?: RateLimitProvider,
  accountId?: string,
): void {
  if (provider && accountId) {
    const key = keyFor(provider, accountId);
    snapshots.delete(key);
    const { [key]: _removed, ...rest } = allSnapshots;
    allSnapshots = rest;
  } else {
    snapshots.clear();
    allSnapshots = {};
  }
  for (const listener of listeners) listener();
}

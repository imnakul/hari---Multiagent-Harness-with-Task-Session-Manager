import {
  hasHarnessEvidence,
  isHarnessAvailable,
  probeHarnessAvailability,
} from "../../../integrations/harness/core/availability";
import { refreshHarnessCatalogs } from "../../../integrations/harness/core/registry";
import {
  hasLiveCatalog,
  loadHiddenPickerProviders,
} from "../../sessions/model/models";
import { HARNESSES, type HarnessId } from "../../sessions/model/session";

/**
 * Shared "are my providers ready" state. One store drives the title-bar
 * indicator and the Providers settings page, so they always agree and two
 * checks never run at once.
 *
 * Lazy-startup policy: this is the only provider work that may run at launch,
 * and only 2 s after mount and only when the user hasn't turned it off. It
 * never touches hidden providers, and never touches saved sessions.
 */
export type ProviderCheckSnapshot = {
  phase: "idle" | "checking" | "ready" | "error";
  /** Set once any run has finished; kept while a later run is in flight. */
  completedAt?: number;
  failed: readonly HarnessId[];
};

/** Delay after mount before the startup check runs (lazy-startup policy). */
export const PROVIDER_CHECK_STARTUP_DELAY_MS = 2000;

const IDLE: ProviderCheckSnapshot = { phase: "idle", failed: [] };
let snapshot: ProviderCheckSnapshot = IDLE;
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function publish(next: ProviderCheckSnapshot): void {
  snapshot = next;
  for (const listener of listeners) listener();
}

export function subscribeProviderCheck(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
  };
}

/** The same object until the state changes, as `useSyncExternalStore` needs. */
export function getProviderCheckSnapshot(): ProviderCheckSnapshot {
  return snapshot;
}

/** Test hook: forget every completed or running check. */
export function resetProviderCheck(): void {
  inflight = null;
  publish(IDLE);
}

async function execute(force: boolean): Promise<void> {
  publish({
    phase: "checking",
    failed: [],
    ...(snapshot.completedAt === undefined
      ? {}
      : { completedAt: snapshot.completedAt }),
  });
  const hidden = new Set(loadHiddenPickerProviders());
  const ids = HARNESSES.filter(
    (id) =>
      !hidden.has(id) &&
      (force ||
        (!hasLiveCatalog(id) &&
          (isHarnessAvailable(id) || !hasHarnessEvidence(id)))),
  );
  const tasks: Promise<unknown>[] = [
    probeHarnessAvailability({ force }),
    refreshHarnessCatalogs(ids, force ? { force: true } : undefined),
  ];
  const results = await Promise.allSettled(tasks);
  const rejected = results.map((result) => result.status === "rejected");
  // A CLI that simply isn't installed is not a failure: its row says so on the
  // Providers page. Only a check that threw counts, and it can't be attributed
  // to one provider.
  const failed: HarnessId[] = [];
  if (rejected[0] || rejected[1]) failed.push(...ids);
  publish({
    phase: failed.length > 0 ? "error" : "ready",
    completedAt: Date.now(),
    failed,
  });
}

/**
 * Runs the light provider check. A run already in flight is shared; with
 * `force` the caller waits for it and then starts a fresh run, so two checks
 * never overlap. `force` re-reads loaded catalogs.
 */
export async function runProviderCheck(
  options: { force?: boolean } = {},
): Promise<void> {
  const { force = false } = options;
  if (inflight) {
    if (!force) return inflight;
    while (inflight) await inflight.catch(() => undefined);
  }
  const run = execute(force)
    .catch(() => {
      // Never leave the indicator stuck on "checking" if setup itself threw.
      publish({ phase: "error", completedAt: Date.now(), failed: [] });
    })
    .finally(() => {
      if (inflight === run) inflight = null;
    });
  inflight = run;
  return run;
}

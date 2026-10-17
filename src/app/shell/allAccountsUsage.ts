import {
  PROVIDER_ACCOUNT_PROVIDERS,
  type ProviderAccount,
  type ProviderAccountProvider,
} from "../../features/providers/model/providerAccounts";
import {
  RATE_LIMIT_MIN_REFETCH_MS,
  RATE_LIMIT_ACCOUNT_STAGGER_MS,
  type ProviderRateLimits,
  type RateLimitWindow,
} from "../../features/providers/model/rateLimits";

/** One footer chip in "All accounts usage" mode. */
export type AccountChipEntry = {
  /** `provider:accountId`, the same key the shared rate-limit cache uses. */
  key: string;
  provider: ProviderAccountProvider;
  account: ProviderAccount;
  /** Unique within its provider, so two accounts can be told apart. */
  label: string;
};

/** Pause between consecutive account loads so many accounts never burst. */
export const ACCOUNT_LOAD_GAP_MS = RATE_LIMIT_ACCOUNT_STAGGER_MS;

/** Rough rendered width of one account chip (icon, label, bar, 5h figure). */
const CHIP_WIDTH_PX = 180;
/** Room kept for the refresh button and the footer's own gaps. */
const FIXED_RESERVE_PX = 36;
/** Room kept for the "+N" chip when some accounts are collapsed. */
const OVERFLOW_CHIP_PX = 44;
/** Used before the footer has been measured. */
const DEFAULT_VISIBLE_CHIPS = 3;

/**
 * Chips for every account of the given providers, in provider order, with
 * `pinnedKeys` (the accounts in use right now) first so a collapsed bar never
 * hides the account the user is working with.
 */
export function buildAccountChipEntries(
  providers: readonly ProviderAccountProvider[],
  accountsFor: (provider: ProviderAccountProvider) => ProviderAccount[],
  pinnedKeys: readonly string[] = [],
): AccountChipEntry[] {
  const entries = PROVIDER_ACCOUNT_PROVIDERS.filter((provider) =>
    providers.includes(provider),
  ).flatMap((provider) => {
    const accounts = accountsFor(provider);
    const seen = new Map<string, number>();
    return accounts.map((account): AccountChipEntry => {
      const count = (seen.get(account.label) ?? 0) + 1;
      seen.set(account.label, count);
      return {
        key: `${provider}:${account.id}`,
        provider,
        account,
        label: count === 1 ? account.label : `${account.label} (${count})`,
      };
    });
  });
  const rank = (entry: AccountChipEntry): number => {
    const index = pinnedKeys.indexOf(entry.key);
    return index === -1 ? pinnedKeys.length : index;
  };
  // Array.prototype.sort is stable, so unpinned entries keep provider order.
  return entries.sort((left, right) => rank(left) - rank(right));
}

/** How many chips fit in `widthPx`; null before the first measurement. */
export function splitVisibleEntries<T>(
  entries: readonly T[],
  widthPx: number | null,
): { visible: T[]; overflow: T[] } {
  if (widthPx == null) {
    return {
      visible: entries.slice(0, DEFAULT_VISIBLE_CHIPS),
      overflow: entries.slice(DEFAULT_VISIBLE_CHIPS),
    };
  }
  const fitsAll = Math.floor((widthPx - FIXED_RESERVE_PX) / CHIP_WIDTH_PX);
  if (entries.length <= fitsAll) {
    return { visible: [...entries], overflow: [] };
  }
  const capacity = Math.max(
    1,
    Math.floor((widthPx - FIXED_RESERVE_PX - OVERFLOW_CHIP_PX) / CHIP_WIDTH_PX),
  );
  return {
    visible: entries.slice(0, capacity),
    overflow: entries.slice(capacity),
  };
}

/** The 5-hour (or otherwise shortest) window, the one shown inline. */
export function shortestWindow(
  limits: ProviderRateLimits,
): RateLimitWindow | null {
  const windows = [limits.session, limits.weekly, limits.monthly].filter(
    (window) => window != null,
  );
  return windows.reduce<RateLimitWindow | null>(
    (best, window) =>
      !best || window.windowMinutes < best.windowMinutes ? window : best,
    null,
  );
}

/**
 * Whether a refresh should skip this snapshot: a good reading younger than
 * the shared minimum refetch interval. Failed or empty readings always retry.
 */
export function isFreshRateLimit(
  limits: ProviderRateLimits | undefined,
  now: number,
): boolean {
  return (
    limits?.status === "ok" &&
    now - limits.updatedAt < RATE_LIMIT_MIN_REFETCH_MS
  );
}

/**
 * Loads accounts one at a time with a pause between them. Stops quietly when
 * `isCancelled` turns true, so a toggle flip or unmount ends the queue.
 */
export async function loadAccountsInSequence(
  targets: readonly AccountChipEntry[],
  load: (entry: AccountChipEntry) => Promise<unknown>,
  isCancelled: () => boolean,
  gapMs: number = ACCOUNT_LOAD_GAP_MS,
  sleep: (ms: number) => Promise<void> = (ms) =>
    new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<void> {
  for (const [index, entry] of targets.entries()) {
    if (isCancelled()) return;
    if (index > 0) await sleep(gapMs);
    if (isCancelled()) return;
    try {
      await load(entry);
    } catch {
      // loadRateLimits records failures in the cache; keep the queue going.
    }
  }
}

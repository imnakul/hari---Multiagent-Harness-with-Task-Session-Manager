import { accountStatus } from "../../providers/model/accountUsage";
import { providerAccounts } from "../../providers/model/providerAccounts";
import {
  clampUsedPercent,
  errorRateLimits,
  formatResetDuration,
  formatUsagePercent,
  formatWindowLabel,
  type ProviderRateLimits,
  type RateLimitProvider,
} from "../../providers/model/rateLimits";
import {
  getCachedRateLimits,
  loadRateLimits,
  rateLimitRefreshDue,
  setCachedRateLimits,
} from "../../providers/model/rateLimitsCache";
import { loadShowRemainingUsage } from "../../settings/model/displayPrefs";
import { runtimeProviderBinaryPath } from "../../providers/model/providerBinaryPaths";
import { getCustomBinary } from "../../../integrations/harness/core/customBinary";

/** The footer's presentation, without credentials or provider-specific payloads. */
export function mobileUsageSnapshot(
  limits: ProviderRateLimits,
  now: number,
  showRemaining: boolean,
) {
  const windows = [
    { title: "5h", window: limits.session },
    { title: "Weekly", window: limits.weekly },
    { title: "Monthly", window: limits.monthly },
  ];
  return {
    status: accountStatus(limits, now),
    updatedAt: limits.updatedAt,
    stale: limits.status === "error" || limits.status === "fetching",
    meters: windows.flatMap(({ title, window }) => {
      if (!window) return [];
      const used = clampUsedPercent(window.usedPercent);
      const percent = showRemaining ? 100 - used : used;
      return [
        {
          title,
          usedPercent: used,
          percent,
          label: `${formatUsagePercent(percent)} ${showRemaining ? "left" : "used"}`,
          reset:
            window.resetsAt == null
              ? formatWindowLabel(window.windowMinutes)
              : window.resetsAt <= now
                ? "reset due"
                : `Resets in ${formatResetDuration(window.resetsAt - now)}`,
        },
      ];
    }),
  };
}

/**
 * Fork (Hari, L-308): whether the phone should get a new reading instead of
 * the saved one: a limit's window has ended since it was read (its numbers
 * are from the old window, and there's no time left to show), or the reading
 * is older than the footer's own refresh gap.
 */
export function usageOutdated(limits: ProviderRateLimits | undefined, now: number): boolean {
  if (!limits) return false;
  const ended = [limits.session, limits.weekly, limits.monthly].some(
    (window) => window?.resetsAt != null && window.resetsAt <= now,
  );
  return ended || rateLimitRefreshDue(limits, now);
}

/** Reuses the desktop footer's cache unless asked to, or it's outdated (L-308). */
function loadFresh(provider: RateLimitProvider, accountId: string, refresh: boolean) {
  return loadRateLimits(
    provider,
    accountId,
    refresh || usageOutdated(getCachedRateLimits(provider, accountId), Date.now()),
  );
}

/** Uses the same cache as the desktop footer; only an explicit refresh probes again. */
export async function mobileAccountUsage(provider: unknown, refresh = false) {
  if (provider !== "claude" && provider !== "codex")
    throw new Error(
      "Usage is only available for Claude Code and Codex accounts",
    );
  const accounts = providerAccounts(provider);
  const snapshots = await Promise.all(
    accounts.map(async (account) => {
      const previous = getCachedRateLimits(provider, account.id);
      const limits = await loadFresh(provider, account.id, refresh);
      const snapshot =
        limits.status === "error" &&
        !limits.session &&
        !limits.weekly &&
        !limits.monthly
          ? errorRateLimits(
              provider,
              limits.error ?? "Usage unavailable",
              previous,
            )
          : limits;
      if (
        snapshot !== limits &&
        (snapshot.session || snapshot.weekly || snapshot.monthly)
      )
        setCachedRateLimits(provider, account.id, snapshot);
      return [account.id, snapshot] as const;
    }),
  );
  const now = Date.now();
  const showRemaining = loadShowRemainingUsage();
  return {
    accounts: Object.fromEntries(
      snapshots.map(([id, limits]) => [
        id,
        mobileUsageSnapshot(limits, now, showRemaining),
      ]),
    ),
  };
}

/** Fork (Hari, L-296): providers with one login per computer, shown once signed in. */
const SINGLE_LOGIN: { provider: RateLimitProvider; label: string }[] = [
  { provider: "command-code", label: "Command Code" },
  { provider: "opencode", label: "OpenCode Go" },
  { provider: "devin", label: "Devin" },
];

/**
 * Fork (Hari, L-296): every provider and account with usage, for the phone's
 * Settings → Usage. Claude Code and Codex list each account; the others
 * appear once they are signed in on this computer.
 */
export async function mobileAllUsage(refresh = false) {
  const providers: {
    provider: string;
    label: string;
    accounts: { id: string; label: string; usage: ReturnType<typeof mobileUsageSnapshot> }[];
  }[] = [];
  const now = () => Date.now();
  const showRemaining = loadShowRemainingUsage();
  for (const [provider, label] of [
    ["claude", "Claude Code"],
    ["codex", "Codex"],
  ] as const) {
    const accounts = providerAccounts(provider);
    if (!accounts.length) continue;
    const { accounts: usage } = await mobileAccountUsage(provider, refresh);
    providers.push({
      provider,
      label,
      accounts: accounts.flatMap((account) =>
        usage[account.id] ? [{ id: account.id, label: account.label, usage: usage[account.id] }] : [],
      ),
    });
  }
  const singles = await Promise.all(
    SINGLE_LOGIN.map(async ({ provider, label }) => {
      const limits = await loadFresh(provider, "default", refresh).catch(() => null);
      return { provider, label, limits };
    }),
  );
  for (const { provider, label, limits } of singles) {
    if (!limits || limits.status === "unavailable") continue;
    providers.push({
      provider,
      label,
      accounts: [{ id: "default", label, usage: mobileUsageSnapshot(limits, now(), showRemaining) }],
    });
  }
  // Antigravity CLI: one row per model family (Gemini, Claude & GPT), read
  // under the same account key as the bottom bar so the two share a cache.
  const agKey =
    runtimeProviderBinaryPath("antigravity-cli") ?? getCustomBinary("antigravity-cli") ?? "default";
  const ag = await loadFresh("antigravity-cli", agKey, refresh).catch(() => null);
  if (ag && ag.status !== "unavailable") {
    const groups = ag.modelGroups ?? [];
    const label = "Antigravity";
    providers.push({
      provider: "antigravity-cli",
      label,
      accounts: groups.length
        ? groups.map((group) => ({
            id: group.name,
            label: group.name,
            usage: mobileUsageSnapshot(
              { ...ag, session: group.session ?? null, weekly: group.weekly ?? null },
              now(),
              showRemaining,
            ),
          }))
        : [{ id: "default", label, usage: mobileUsageSnapshot(ag, now(), showRemaining) }],
    });
  }
  return { providers };
}

# Review — All accounts usage in the bottom bar

Created: 2026-10-13 17:07 IST. Tier: Medium (one UI surface, one setting, no fetch changes).
Working branch: `feature/all-accounts-usage-monocode`, created from `79cb6f4d`. Not pushed.

Follow-up 2026-10-17: this feature is merged on the 0.10.0 branch. [L-92 automatic
usage refresh](account-usage-auto-refresh.md) adds the shared 15-minute foreground
poll and five-minute stale-on-focus refresh. The original no-polling scope below
describes the initial implementation.

Follow-up 2026-10-17: the all-accounts footer also includes the installed,
non-hidden Antigravity CLI's saved account, even with no CLI chat selected.
It retains its existing separate chip (no invented managed profiles), native
model-group quota details and credits, binary-scoped cache, manual refresh and
L-92 automatic polling. Before installation is known it does not run reports.
Only an active Antigravity CLI model selects an inline family quota; a different
provider's model never selects that account's family. ACP credentials are separate.

## Goal

Show usage for every configured provider account in the bottom bar at once, behind an
Experimentation toggle "All accounts usage" (default off). Today the footer shows one chip per
provider for the selected account only.

## Behaviour

- Off: the bar is unchanged.
- On: one chip per account of every enabled provider (claude, codex, devin), in provider order,
  with the selected claude and codex accounts first. Each chip is labelled with the account
  label; duplicate labels become `Work (2)`. The shortest limit (5h first) is inline; the rest
  stay in the chip popover and tooltip. "Remaining quota" applies to the chip text.
- Applies live (no restart). Switching off restores the single-account chips.
- Width: the strip measures its space; chips that do not fit collapse into a `+N` chip whose
  popover lists provider, account, status and meters. At least one chip stays visible.
- States per account: loading (`···`), ok, error, signed out / not connected, unavailable.
  No accounts: `No provider accounts to show` (status text) when the bar has nothing else.
- Opencode, antigravity-cli and the Pi session bar are unchanged.

## Data path (unchanged)

Reuses `rateLimitsCache` (`loadRateLimits`, `getAllRateLimits`, `subscribeRateLimits`) and the
existing 15 min poll / 5 min min-refetch constants. No new fetch path, no new credential reads;
chips pass `accounts=[]` so no identity lookups are added.

- Initial load: accounts without a snapshot load one at a time with a 750 ms gap
  (`loadAccountsInSequence`), never in one burst. Cache dedupes in-flight requests.
- Manual refresh: forced sequential load of accounts whose reading is not fresh (< 5 min, ok).
- Claude/codex had no timer polling before; none is added.

## Files

- `src/features/settings/model/settings.ts`, `ui/SettingsView.tsx`: setting `monocode.allAccountsUsage`.
- `src/app/shell/allAccountsUsage.ts`: pure list, split, freshness and sequencing logic.
- `src/app/shell/AccountUsageStrip.tsx`: strip and `+N` popover.
- `src/app/shell/UsageProviderChip.tsx`: `accountLabel`, `inlineWindow`.
- `src/app/shell/UsageFooter.tsx`: account mode wiring.
- Tests: `allAccountsUsage.test.ts`, `UsageFooterAllAccounts.test.ts`, `UsageProviderChip.test.ts`,
  `settings.test.ts`, `Experimentation.test.ts`.

## Risks

- Collapse capacity is an estimate (180 px per chip), not a per-chip measurement.
- Accounts behind `+N` cannot be reconnected from that popover; open the chip after widening.
- Before the availability probe finishes, all three providers count as enabled, so turning the
  setting on may request devin usage once.
- MiniBar direction uses the separate pre-existing `showRemainingUsage` pref.

## Out of scope

Changing how usage is fetched, cached or refreshed; bar redesign beyond the new chips.

## Verification

Automated: `tsc --noEmit` and full `vitest run` passed (608 files / 6764 tests). The repo has no
eslint config, so lint was not run.

## Manual desktop checklist (not run by the agent)

1. Settings → Experimentation: "All accounts usage" is off; footer matches before.
2. Turn on: chips for every account appear without restart; labels distinguish same-provider accounts.
3. Each chip shows the 5h limit inline; popover shows the weekly/monthly limits.
4. Toggle "Remaining quota": chip text flips between used and left.
5. Narrow the window: extra accounts fold into `+N`; terminal controls stay in place.
6. Tab to a chip and to `+N`; Enter opens, Escape closes and returns focus.
7. Signed-out and offline accounts show a clear state; refresh button does not burst requests.
8. Turn off: single-account bar returns.

# Review — Automatic account usage refresh (L-92)

Branch: `nakul/windows-support-upstream-0.10.0`
Base: `e1e699359bb40cc362882ecc093e2526930d4bee`
Tier: Medium.

## Goal and comparison

Stop requiring manual refresh for displayed provider account usage. Orca's main
usage service defaults to a 15-minute poll, refreshes on foreground activation
when a successful reading is at least five minutes old, and skips periodic
polls while hidden/minimized/unfocused. Its inactive account previews also have
an on-open fetch with a separate 60-second debounce; that is not a 60-second
global poll. Compared against Orca fork main `1855ba49ba1c8c4eb314ba02dbc920acb1094b31`,
matching its current remote main. Source: `src/main/rate-limits/service/service-types.ts`,
`service-polling.ts`, `service-configuration.ts`, `service-inactive-accounts.ts`.
Orca can also ingest Claude quota windows from its CLI statusLine, with a
30-second dedupe of identical readings (`service-fetch-policy.ts`). That live
feed can update sooner than the HTTP poll. This task adds periodic/focus refresh;
it does not install or replace the user's CLI statusLine.

MonoCode already defines 15-minute and five-minute constants, but its shared
cache reads each account once unless explicitly forced. Only the separate Pi
and Antigravity CLI paths had polling. Reuse existing quota reads, not chat or
model requests, and preserve account identity, manual refresh and initial loads.

## Plan

- Shared foreground polling hook for selected footer accounts, all-account
  chips (including overflow), Settings Accounts and open account pickers.
- Poll every 15 minutes; returning/focusing checks readings older than five
  minutes. Skip hidden/unfocused windows and stop queued work after unmount,
  account changes or backgrounding. Keep initial cold loads in existing paths.
- Sequential automatic refresh with 750ms spacing; share cache/in-flight reads
  across views. Automatic refresh joins a pending request instead of scheduling
  the extra forced request reserved for an explicit manual click.
- Throttle errors/unavailable readings too, avoiding focus-event retry storms.
  This copies Orca's normal cadence, not its full provider-specific retry policy.
- No new setting, dependency, native protocol, installer or version bump.

## Checks

- Fake-clock hook/cache tests: 15-minute cadence, five-minute focus debounce,
  hidden/unfocused skip, account staggering, pending/manual coalescing, errors,
  target switching, cleanup and shared consumers.
- Footer tests exercise selected/all accounts and shared Settings/picker cache.
- Strict TypeScript, full web suite and production build before publication.
- Human desktop check: leave usage visible for 15 minutes, return after five
  minutes away, and check both selected/all-account modes plus Settings Accounts.

## Progress

- [x] Compare source and identify the missing Claude/Codex timer.
- [x] Implement shared polling and tests.
- [x] Complete local gates and records.
- [ ] Separate human desktop verification after publication.

## Verification and publication

85 focused polling/cache/footer/account tests pass. Full web: 6,932 passed /
628 files (two native CLI opt-in skips); strict TypeScript and production web
build pass. Rust and native protocols are unchanged. The old account-hook test
used a September timestamp against the real current clock, so remount correctly
triggered the new stale refresh; those hook fixtures now use a fixed clock.

Publish on the existing authorized branch and verify its remote SHA. No
installer/version changes. Human follow-up is the foreground/restore checklist
above; do not drive the Tauri window from the implementation session.

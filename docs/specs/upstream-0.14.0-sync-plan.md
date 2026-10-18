# Review — Upstream main / 0.14.0 synchronization

Created: 2026-10-18 UTC. Tier: Large (upstream merge).
Branch: `nakul/windows-support-upstream-0.14.0`.
Base: latest fetched `origin/nakul/windows-support-upstream-0.10.0`,
`b344c56b2e355cd2e3fa55f41b537701cb029533`.
Pinned incoming main: `hardbeat920/monocode` at
`a90c558d7b1c7955a641a970c1ce10f5ba7df828` (package version 0.14.0,
including unreleased changes after the tag).
Common ancestor: `7d099eb8e1d3a544a9221cda66de251f25e6c4a0`.

## Idea

On a new branch above the latest 0.10.0 fork, integrate all upstream main
changes while preserving the local feature register and the other agent's
latest changes. The original branch and installed builds remain untouched.
The user requests consultation before ambiguous conflict decisions; the working
agreement additionally requires a file-by-file conflict handoff before resolution.

## Research

- Origin is the user's fork (`imnakul/monocode-clone`, redirected on GitHub to
  `imnakul/hari---Multiagent-Harness-with-Task-Session-Manager`), not upstream.
  Fetch upstream by URL; never push there.
- Latest fork base is 16 commits beyond the initial checkout `123e8adf` and
  includes L-93–L-104, including cross-account continuation and its rebind fix.
- Main adds 208 commits / 429 changed paths since the common ancestor; 111
  paths also changed locally. Full inventories and conflict proposals are in
  [the intake record](../notes/archive/upstream-merge-2026-10-18-014.md).
- `LOCAL-FEATURES.md` is the authoritative fork preservation register (104
  IDs); `FEATURES.md` is the T3 comparison tracker. L-90 was intentionally
  removed by L-94 and must stay removed.
- Upstream includes released 0.11–0.14 features plus optional New layout,
  transcript/performance changes, resource pressure monitoring, and native
  Claude/Codex account transfer. These overlap local process monitoring,
  account continuation, footer, composer, appearance and process lifecycles.
- Keep the user's native-API process-stat decision: no sysinfo dependency.
  Upstream's Windows single-instance plugin is a separate incoming feature.
- Git reports conflicts only after an actual merge attempt; an automatic
  textual merge is not evidence that either feature's behavior is preserved.

## Plan

1. Create the integration branch from the latest remote fork head and pin main.
2. Record incoming paths, overlaps, local feature audit and intended gates.
3. Attempt a noncommitting merge; inspect every conflict without resolving it.
4. Present incoming versus local behavior, consequences and a proposal per
   conflicted file. Obtain the user's decisions under the working agreement.
5. Implement approved combinations, repair integrations, and add meaningful
   regressions for local behavior crossing changed upstream wiring.
6. Check all register IDs, including behavior in both upstream layouts; record
   source review, automated coverage and human-only checks separately.
7. Run full gates and builds, then hand off native desktop checks. Publish
   only to this new fork branch when authorized; no installer is requested.

Approved preservation policy (user confirmed all six choices in chat on 2026-10-18): retain local
Queue/Stop, provider/ACP/CLI, native Interactive safety and resume, task/session
managers, usage, notifications, Windows containment and appearance behavior;
add upstream features around them. Do not use whole-file ours/theirs choices.
Use upstream's optional layout default; keep classic behavior and wire fork
features into the new layout. Reconcile overlapping account/resource features
without duplicate buttons, competing owners or changed Interactive idle rules.

## Todos

- [x] Inspect rules, intake runbook and local feature index.
- [x] Fetch latest fork and upstream; create requested new branch.
- [x] Pin commits and record incoming scope and overlaps.
- [x] Attempt merge and inventory actual conflicts (54 files / 178 hunks).
- [x] Obtain conflict decisions and record them before resolving (all six approved).
- [x] Resolve approved conflicts and repair imports/contracts.
- [x] Audit L-01–L-104, keeping L-90 removed.
- [x] Run `npm run check` (full web, TypeScript, Rust format, Clippy and tests).
- [x] Run `cargo check`, production build, host build/tests and fork checks.
- [x] Attribute any failing gates to baseline or merge; never silently weaken tests.
- [x] Update feature register, changelog and this spec with final evidence.
- [x] Hand over human Windows/provider/desktop checklist.
- [x] Commit the verified integration branch locally.
- [ ] Publish the new fork branch only when explicitly instructed.

## Issues and fixes

- The merge reported 54 conflicted files / 178 hunks. Per-file proposals are
  recorded in the intake report; the user approved the preservation policy,
  monitoring opt-in, exact-history account continuation, idle exemptions, Mono
  overview and version/dependency plan before resolution. The preview
  merge was aborted before approval. After approval the merge was restarted;
  all conflicts are resolved and the complete automated integration bar passes. This branch starts
  at the latest remote fork; the original local branch remains at `123e8adf`.
- Baseline at unchanged fork source `b344c56b`: the initial dependency directory
  lacked locked `@xterm/addon-webgl` 0.19.0. The first full web run passed 620 files /
  6,824 tests, with 13 files blocked by that missing package (one native opt-in
  file / two tests skipped). `npm ci` restored the lockfile dependencies without
  tracked changes. All 13 affected files / 156 tests then passed, and strict
  TypeScript passed. These are baseline checks across runs, not a completed
  integration gate. Final merged gate results are recorded below; native desktop
  checks are separate.

## Learnings

- Integrate current remote 0.10.0, not the stale local checkout, to preserve
  features added by the other agent after the prior usage-refresh fix.
- Combine resource UI ownership and idle eligibility explicitly; clean text merges
  alone missed local layout/footer and image path contracts.
- Docker process-group tests require an init/reaper to exercise shutdown without
  unreaped orphan zombies being mistaken for running work.
- The requested main snapshot includes changes newer than the 0.14.0 tag;
  package version alone does not identify the integration target.

## Done

Source integration is complete and the reviewed merge is committed locally on the
new branch. Original local 0.10.0 remains at `123e8adf`; this merge starts from latest
remote fork `b344c56b` and has pinned main `a90c558d` as its second parent.
All 104 feature IDs remain registered (L-90 stays removed); all 373 fork-added
source/test paths are present. The approved policies and 54 file-by-file decisions
are in the intake record, along with failure attribution and repairs.

Automated bar passed (full `npm run check` components, split across host/container
because Cargo is available in the native validation container):

- `npx vitest run --maxWorkers=2`: 668 files / **7,427 passed**, one native opt-in
  file / two cases skipped; no failures. Strict `npx tsc --noEmit` passes.
- `cargo fmt --check`, `cargo check`, and
  `cargo clippy --workspace --all-targets -- -D warnings`: pass.
- `cargo test` in a Docker `--init` container: **813 passed**, two opt-in ignored;
  binary/doc tests pass. Linux native gates do not establish Windows runtime behavior.
- `npm run build`: pass; existing CSS-highlight/minifier and large-chunk warnings
  remain. `npm run host:build`: pass. Full host suite: **117 passed**, five opt-in skipped.
- `node --test scripts/release-channel.test.cjs`: **8 passed**.
- Staged and working-tree `git diff --check`: pass; no unmerged index entries.

Logs: `/tmp/monocode-014-final-web-gate.log`, `monocode-014-final-tsc.log`,
`monocode-014-final-rust-static.log`, `monocode-014-native-init-tests.log`,
`monocode-014-production-build-final.log`, `monocode-014-host-build-2.log`,
`monocode-014-host-tests-2.log`, `monocode-014-final-release-tests.log` (all under `/tmp/`).

Status is **Review** for the separate human Windows/provider checklist in the
[intake record](../notes/archive/upstream-merge-2026-10-18-014.md#human-windowsprovider-checks-separate-from-automated-gates).
No installer was built. No upstream writes or publication occurred; the new fork
branch can be pushed after an explicit instruction, as required by the working agreement.

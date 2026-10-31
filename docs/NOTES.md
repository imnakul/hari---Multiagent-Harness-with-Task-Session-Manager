# Upstream intake runbook — Main → `nakul/windows-support`

This is the exact process used to take new releases from the MonoCode main repo
(`hardbeat920/monocode`, remote `origin`) into our fork line (`nakul/windows-support`,
push target `personal` = `imnakul/monocode-clone`) without losing our local features.
Hand this file to any agent together with `docs/WORKING-AGREEMENT.md` and it can run
the whole flow autonomously — except the decision points listed under **When to STOP
and ask**, which are always human calls.

Companion records (read before starting, update when finishing):
- `docs/WORKING-AGREEMENT.md` — the rulebook (gates, Windows rules, honesty habits).
- `docs/upstream-merge-<date>.md` — one file per merge round: every conflict decision.
- `docs/changelog/LOCAL-CHANGELOG.md` — one entry per feature/build (template inside).
- `docs/WINDOWS-CHANGES.md` — dated tracking log, verdicts, known issues.

---

## 0. What must never break (keep these in mind at every step)

Our intentional divergences from Main. A merge that "fixes" these has failed,
even if every test is green — tests cover most, not all:

1. **Composer send action = ours.** While an agent is busy: Queue/Steer-aware send
   label, **Stop stays visible**. Main swaps Stop for a plain "Send".
   Locked by `Composer.test.ts` ("ComposerAction > keeps Stop visible…").
2. **Menu bar = ours, always visible.** Main hides it behind an Alt tap.
3. **Antigravity = ours.** `integrations/harness/core/antigravity*` +
   `src-tauri/src/antigravity_acp.rs`; PATH/PATHEXT discovery in
   `harness.rs::resolve_antigravity_acp`; title "Antigravity ACP"; default model
   `antigravity:default`. Main's `providers/antigravity/*` + `AntigravityBinary`/
   `antigravity_args` are **deleted** — never restore them.
4. **Cline = our 11th harness** (Main has 10). ModelPicker pixel sizes follow the
   tab count (11 tabs → 440/442).
5. **Queue/Steer queue** — `QueueDurabilityScheduler`, `queuePersistFingerprint`,
   `settleQueuedSteerCancellations`, queue survival across restart. On session
   removal the queue scheduler is evicted and terminals whose panes disappear are
   forgotten + killed (`disappearedTerminalIds`). Locked by `queueDurability.test.ts`
   (incl. `removeSession`), `terminalPanes.test.ts`, `sessionRemoval.test.ts`.
6. **Lazy terminal startup + cleanup** — nothing spawns until the user asks;
   `forgetTerminal` + `killPty` on every close path. Locked by `TerminalView.test.ts`,
   `terminalSurfaceParity.test.ts`, `appLifecycle.test.ts`.
7. **Wallpaper & menus settings** (ours, re-homed under a "Wallpaper & menus" group;
   wallpaper-opacity row always renders, disabled until chosen, so search finds it).
8. **Hover pill system** — `SharedHoverHighlight` + `data-shared-hover-*` contract;
   the glass wash belongs on the **stable frame** (`shared/ui/Popover.tsx`), the
   moving content layer stays transparent and unblurred. Locked by
   `Popover.hover.test.ts`, `SharedHoverHighlight.test.ts`, `InboxView.test.ts`,
   `NotesView.hover.test.ts`.
9. **Token/cost metering** — `usage` + `turn.metrics` share one pipeline
   (`tokenCosting.ts` / `tokenAccounting.ts`); ContextMeter + detailed-context +
   remaining-quota settings (locale-safe formatting).
10. **Windows platform rules** — everything behind `#[cfg(windows)]`, no spawned
    consoles, job objects + tree-kill, PATH/PATHEXT/registry discovery, backend is
    authoritative for health.
11. **Tauri commands take `Window`, not `WebviewWindow`** (L-218). Browser pages are
    extra webviews in the main window, which then stops counting as a
    `WebviewWindow`: such commands fail and `get_webview_window` / `webview_windows()`
    skip it. Upstream's `WebviewWindow` arguments and lookups must be converted
    (`get_window` / `windows()`). Locked by `src/platform/tauri/windowArgs.test.ts`;
    rule in `AGENTS.md` ("Tauri windows").

One-line definition (use verbatim): **upstream-compatible by construction** —
platform-gated, regression-free on all targets, independently testable, documented.

---

## 1. Phase 0 — Intake inventory (read-only)

```powershell
git fetch origin --tags --dry-run          # see what exists first
git ls-remote --tags https://github.com/hardbeat920/monocode.git   # list tags
gh api repos/hardbeat920/monocode/compare/v<CURRENT>...v<NEXT>     # commits + files
gh api repos/hardbeat920/monocode/contents/CHANGELOG.md?ref=v<NEXT> # user-facing notes
```

- `v<CURRENT>` = the tag last merged into our line (check `docs/upstream-merge-*.md`).
- Also check `main` HEAD vs the newest tag (`compare/v<NEXT>...main`) — there are
  often 1–2 post-tag fixes worth taking in the same round. **Ask** whether to include
  them; default = take the tag only.
- Build the conflict forecast: which of their changed files also carry our
  divergences (Composer, App.tsx render, SessionPane, AgentTranscript, Sidebar,
  SettingsView, index.css, models/session, harness core). List them in the report.

## 2. Phase 1 — Plan the rounds

- **Staged rounds win.** One or two tags per round (round 1 = 0.1.45–0.1.51,
  round 2 = 0.1.52–0.1.54). Rename-heavy releases (like the `src/` reorganize) get
  their own round; never merge 100+ same-path conflicts in one sitting.
- Record the plan + every decision in `docs/upstream-merge-<date>.md` **before**
  resolving anything. Table format:
  - Product calls (Nakul decides): menu order, which visual wins, feature replacements.
  - Theme/mechanical picks (agent decides, states the assumption): version label
    scheme, dependency unions, icon sets.
  - File-by-file table: `| file | decision (ours / theirs / both / weave) | why |`.
- Every "both/weave" entry must name what was merged — future debugging depends on it.

## 3. Phase 2 — Merge mechanics

```powershell
git fetch origin --tags
git merge v<NEXT>            # conflicts expected; do NOT commit yet
git status --porcelain       # buckets: UU=content, AU/UA=one-sided, RM/MM/AM=renames+edits
```

Rename noise is normal with reorgs (97 `RM` + 592 `R` in round 2). Work the buckets:

1. **Placement files (renames without content conflict)** — verify the file landed
   where the new tree wants it; its *internals* often still import old paths (Phase 4 fixes).
2. **`UU` content conflicts** — resolve per hunk. Helper scripts live in
   `%TEMP%\opencode\` (`resolve-conflicts.mjs` + `r2-spec.json` style specs with
   per-hunk strategies `ours` / `theirs` / `both` / `both-rev`). They throw on hunk
   misalignment — safe. Mid-structure seams (a side ending mid-function) → read the
   **shared tail** before picking a side.
3. **Both-sides splices** are the #1 source of weirdness: doubled commas in Rust
   struct literals (`queued_messages,,`), unclosed braces at EOF, duplicated map keys
   (`antigravity` twice), glued INSERT column lists. After every "both" pick, search
   the file for `,,`, duplicate object keys, and count `git diff --check` noise.
4. Never leave a conflict marker set: `git diff --name-only --diff-filter=U` empty
   before Phase 4.

**When to STOP and ask (never auto-decide):** any product call from §0 (ours vs theirs),
any deletion of our behavior, anything touching providers/payments/auth contracts,
destructive ops. Present it as: incoming-vs-ours + consequences + suggestion, in
simple non-code language, file by file. Mechanical/import/typography picks: proceed
and state the assumption in the report.

## 4. Phase 3 — Repair loop (the merge is 30% resolve, 70% repair)

Order of work, repeat until clean:

1. **`npx tsc --noEmit`** — it is the repair loop's driver. Every red file gets one
   of: missing import, wrong path, unbalanced splice, dropped declaration. Fix in
   batches (scripted find/replace specs beat 103 hand edits — see `repair.mjs` +
   per-file JSON specs in `%TEMP%\opencode\`).
2. **Path rewrites for moved trees** — source imports AND **`vi.mock("…")` strings**
   (invisible to tsc; only Vitest reveals them). Basename-resolve every `TS2307`
   module to its new home; watch test files at wrong depths (`format.test.ts` must
   live beside `shared/lib/format.ts`).
3. **The union bugs** (checklist, all seen in round 2):
   - Rust: INSERT column count == VALUES placeholders == `params![]` length (23/23/23).
   - Rust: mapper `row.get(N)` indices must match the SELECT list exactly; when
     columns are unioned (`is_draft`, `automation_id`), extend **every** SELECT that
     feeds the mapper and update schema-version asserts (`assert_eq!(version, …)`).
   - Rust: duplicate `#[tauri::command]` registrations in `lib.rs` — keep one.
   - Rust: new or changed upstream commands taking `WebviewWindow`, or new
     `get_webview_window` / `webview_windows()` lookups → convert to `Window` /
     `get_window` / `windows()` (§0 item 11; `windowArgs.test.ts` fails until done).
   - TS: duplicate keys in `Record<…>` maps and arrays (`HARNESSES`, `HARNESS_TITLE`),
     `export function` defined twice (`resolveAntigravityBinary`), `useCallback`
     missing its `}, []);` before the next block.
4. **Full gates** (Phase 5) → fix → repeat. Expect 2–4 iterations.

## 5. Phase 4 — Preservation audit for our features

After compiles are green, grep-verify each §0 feature still exists where it should
(the merge can satisfy tests while quietly removing a wiring line):

```powershell
# examples: Queue/Steer, lazy terminals, hover pill, wallpaper, ACP antigravity
git diff v<CURRENT>..<TAG> -- src/app/App.tsx | Select-String 'queueSchedulerRef|forgetTerminal|killPty'
Select-String -Path src\shared\ui\Popover.tsx -Pattern 'SharedHoverHighlight'
Select-String -Path src\features\sessions\ui\Composer.test.ts -Pattern 'Stop visible'
```

Then walk the named review areas from the merge scope: cold start & lazy terminals,
session removal & queue cleanup, provider/model discovery, Antigravity ACP, session
data & schema migration, plus every NEW upstream feature (Automations, editor modes…).
Add or adjust **meaningful regression tests** for anything the merge touched in our
features. Never weaken a test to make it pass; when an expectation must change (e.g.
ModelPicker sizes for our 11th tab), record it in `docs/changelog/LOCAL-CHANGELOG.md` as an
intentional update.

## 6. Phase 5 — Gates (nothing lands without these)

```powershell
npx tsc --noEmit                 # 0 errors
npx vitest run                   # FULL suite, 0 failures
npm run check:rust               # fmt --check + clippy -D warnings + cargo test
npm run build                    # tsc && vite build
git diff --cached --check        # staged diff whitespace-clean
```

**Snapshot truth check (the round-2 lesson):** the code you tested must be the code
prepared for the commit. Before reporting green:

```powershell
git status --porcelain | Where-Object { $_[1] -ne ' ' }   # only KNOWN unstaged WIP left
```

If intended repairs are unstaged, the gates validated something else. Stage them,
re-run. Another session's unstaged WIP (e.g. `systemBreakdown` Codex work) stays
unstaged and gets named in the report.

**Environment gotchas:** C: filling to 0 bytes produces ENOSPC that masquerades as
flaky tests and interrupted runs (check free space first);
`Out-File` writes UTF-16 — use `git diff --output=` for byte-accurate patches;
PowerShell `Replace()` is literal — normalize `` `r`n `` → `` `n `` first.

## 7. Phase 6 — Version, build, manual test handoff

- Version label `<base>-localN-<feature>` (NSIS-only — MSI rejects text suffixes),
  e.g. `0.1.54-local2-upstream-import`. Counter `N` disambiguates rebuilds.
  Bump all six spots: `package.json`, `package-lock.json` (×2), `Cargo.toml`,
  `Cargo.lock`, `src-tauri/tauri.conf.json`.
- Build with the repo script: `npm run build:windows`
  (`tauri build --bundles nsis --no-sign` + `scripts/archive-installer.mjs`
  copies to `E:\Developing\Installable versions\`). Keep every installer.
- **Ask for manual testing here** — after gates + build are green, before push:
  hand over a short list (cold start with saved terminals, Queue/Steer + Stop,
  session removal with queue + terminals, provider discovery + Recheck,
  Antigravity sign-in, open an old DB once, new upstream features). Never open
  GUI/Playwright yourself unless explicitly asked.

## 8. Phase 7 — Land it

- Commit message convention: `merge(upstream): sync main through <ver> (round N)`.
  Commit only when told (or per profile auto-commit), push only to `personal` and
  only when told. Never touch `origin` (hardbeat920) — fork only.
- Update the three records in the same pass: `docs/changelog/LOCAL-CHANGELOG.md` (per-build entry
  with What/Why, divergences, implementation highlights, verification numbers,
  caveats, tradeoffs, learnings), `docs/WINDOWS-CHANGES.md` (dated log + known issues),
  `upstream-merge-<date>.md` (conflict decisions + deferred items).
- Close out per WORKING-AGREEMENT: after the installed build is confirmed, push the
  feature branch to `personal`, then reclaim disk (`git worktree remove`, `cargo clean`
  only if desperate).

## 9. Feature work alongside merges (two tracks at once)

New features (e.g. the CLI update notice) follow the feature lifecycle:
`docs/<feature>-plan.md` first (worktree path, branch, base commit, sections per the
agreement), then implement + tests, gates green, STOP and hand over for dev-mode
testing. Land the merge round first if both touch the same files — rebase the feature
after, don't mix conflict resolution with new code in one commit.

## 10. Quick reference — do / don't

| Do | Don't |
|---|---|
| Inventory read-only first (ls-remote / gh api) | Merge before the decision record exists |
| Resolve per hunk with recorded strategies | Auto-decide a product call |
| Grep-verify each local feature after | Trust green tests alone for preservation |
| Stage repairs, then re-run gates | Report green while intended fixes sit unstaged |
| One regression test per merge-touched feature | Weaken/delete a test to pass |
| Ask for the manual test list before push | Open the GUI/Playwright yourself |
| Keep `origin` read-only | Push to upstream, or mix two features in one commit |

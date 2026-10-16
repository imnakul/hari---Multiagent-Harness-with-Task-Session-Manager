# Windows changes — tracking log

Windows-specific learnings: how we did things and what we did, so anyone can retrace steps
while debugging. Tracked on the Windows branches (fork material, never sent upstream).

**How to use:** find the topic in the index, then search for the heading text
(`grep -n "<heading text>" docs/WINDOWS-CHANGES.md`) and read only that section.
**How to add:** put a new section directly under this index (newest first) and add its row at
the top of the table. Do not rewrite older sections.

## Index

| Date | Section heading (search this) | Area |
|---|---|---|
| 16 Oct 2026 | Claude Interactive launches the native executable in ConPTY | Claude, terminal, accounts |
| 7 Oct 2026 | MCP test fixtures use discovery paths and repository boundaries | Windows tests, MCP |
| 6 Oct 2026 | Native session identity preserves Windows project paths | provider resume, drive/UNC paths |
| 3 Oct 2026 | MCP config toggles preserve Windows line endings | MCP, config, CRLF |
| 2 Oct 2026 | Windows 0.6.0 installer | installer, versioning, known test failures |
| 1 Oct 2026 | 0.1.55-local5-provider-fixes | providers |
| 28 Sept 2026 | Lead checkout chooser removed | orchestration |
| 26 Sept 2026 | Orchestration native-dev handoff continuation | orchestration |
| 25 Sept 2026 | Local handoff files and lead control | orchestration |
| 25 Sept 2026 | Hari current orchestration integration | orchestration |
| 25 Sept 2026 | Corrected same-version wallpaper installer | wallpaper, installer |
| 25 Sept 2026 | Wallpaper effect choices | wallpaper |
| 25 Sept 2026 | Installed local3 Halftone failure | wallpaper, installed-vs-dev |
| 24 Sept 2026 | Compact rail shared hover + wallpaper Halftone | hover, wallpaper |
| 24 Sept 2026 | 0.1.55-local3-rail-wallpaper release | installer |
| 23 Sept 2026 | Providers initial discovery indicator | providers |
| 23 Sept 2026 | 0.1.51-local1-upstream-import | upstream merge |
| 15 Sept 2026 | Lazy terminal + harness startup | terminal, startup |
| 12 Sept 2026 | 0.1.35-local5-queue-durability | queue, SQLite migration |
| 11 Sept 2026 | 0.1.35-local4-token-usage | tokens, CRLF editor, diff, keyboard, hover |
| 8 Sept 2026 | ignored local files in chat mentions | mentions |
| 8 Sept 2026 | local3-reveal-tabs | Explorer reveal, tab fade |
| 7 Sept 2026 | Antigravity ACP: architecture, installed-build fix, and recovery runbook | Antigravity, PyInstaller, disk |
| 6 Sept 2026 | Pre-existing Windows CRLF test failures | tests (not ours, leave alone) |
| 6 Sept 2026 | Skills feature | skills |
| 6 Sept 2026 | Defender verdict: false positive | antivirus |
| 6 Sept 2026 | Local version scheme | versioning |
| 6 Sept 2026 | Other changes in local1 | misc |
| 23 Sept 2026 | 0.1.54-local1-upstream-import | upstream merge |
| 23 Sept 2026 | round-2 merge: staging repaired | upstream merge |
| 23 Sept 2026 | popover hover pill: wash/marker stacking fixed | hover |
| 23 Sept 2026 | Providers catalogs hid the newest models | providers, models |
| 23 Sept 2026 | wire probe verdict | providers, Claude models |
| 23 Sept 2026 | gate reverted: MINIMUM_CLAUDE_OPUS_5_5_VERSION | providers, Claude |
| 24 Sept 2026 | 0.1.54-local2-upstream-import built | upstream merge, installer |
| 24 Sept 2026 | KNOWN ISSUE: multiple Windows Explorer windows | Explorer, Antigravity |
| 24 Sept 2026 | round 3 landed in tree | upstream merge, CLI notices |

---

## 16 Oct 2026 — Claude Interactive launches the native executable in ConPTY

Interactive mode uses the existing supervised ConPTY spawn path with executable,
argv and scoped environment overrides. It requires the native `claude.exe` and
rejects `.cmd`/`.bat` shims with a Settings instruction; the structured launcher
continues to support shims. No shell command string is constructed. Named profiles
set both Claude config/secure-storage directories and remove inherited auth token
overrides. The conversation and terminal share one process, and transport changes
wait for process-tree termination. Linux source/automated checks passed; actual
Windows ConPTY/account/settings verification remains the separate checklist in
`docs/specs/claude-interactive-plan.md`.

## 7 Oct 2026 - MCP test fixtures use discovery paths and repository boundaries

The Windows installer gates were blocked by test fixture mistakes, not failing production compilation. A PathBuf joined with `.codex/config.toml` retains the slash inside that component on Windows; MCP discovery joins `.codex` and `config.toml` separately and emits backslashes. Its exact config-path validation therefore rejected the test request before the read-only guard. Match the path emitted by discovery; retain the production validation.

A discovery fixture without `.git` also walked above its temporary project into actual host configuration. Create the repository boundary in fixtures so assertions depend only on test-owned files. Both failures now pass in the full Rust suite. Attachment tests must await FileReader/persistence outcomes rather than a fixed short sleep; lazy editor imports must settle before polling DOM assertions.

Evidence: `docs/notes/windows-0.8.0-local1-upstream-sync-importsession-build/README.md` (green full gates and verified installer).

## 6 Oct 2026 — Native session identity preserves Windows project paths

Provider metadata may retain backslashes while MonoCode persists project paths
with forward slashes. Native lookup, live-session matching, binding reuse and
strict resume/save checks now compare project identity using the same drive/UNC
slash, case and trailing-separator rules. Launch/display paths are preserved.
Unix paths remain case-sensitive and literal backslashes are not rewritten.
Tests cover restored views, drive roots, network shares and distinct
provider/account/folder identities. Signed-in Windows round trips remain in
`docs/specs/native-add-session-plan.md`.

## 3 Oct 2026 — MCP config toggles preserve Windows line endings

`toml_edit` normalizes CRLF to LF when serializing a document, even when only
one boolean changes. MCP switches therefore replace an existing Codex flag by
its parsed source span; adding a missing flag restores the original CRLF file
style. OpenCode/Claude JSONC changes use byte spans and keep surrounding bytes,
including comments, URLs, escaped strings and CRLF. Regression tests cover
existing and missing TOML flags and exact JSONC preservation on Linux; live
Windows/provider checks remain in `docs/specs/mcp-controls-plan.md`.

## 2 Oct 2026 21:21 IST — Windows 0.6.0 installer

**What:** Built the current `nakul/windows-support` tree at `18ab934` with version exactly `0.6.0`.
Nakul selected it after comparison with fresh upstream main `6bd432c` (0.7.0, 17 commits absent here).
The normal local suffix was removed by explicit request; no newer upstream changes were merged.
Only package.json, package-lock.json, Cargo.toml, Cargo.lock and src-tauri/tauri.conf.json changed.
npm/Cargo regenerated lock metadata. No commit, push, signing or installation.

**Installer:** `E:\Developing\Installable versions\MonoCode_0.6.0_x64-setup.exe`, 11,446,927 bytes,
SHA-256 `D882E9B35CABD9C2D19EB3509311EE677770B51B1DB0DF4FC36B50179DFF50E2`, NotSigned.
Archive matches the original NSIS output; executable FileVersion/ProductVersion both 0.6.0.

**Checks:** TypeScript, Rust formatting/check/Clippy, host build, production frontend and NSIS build pass.
Host tests: aggregate 93 passed / 7 skipped after rerunning permission failures outside the sandbox.
Web: 5,080 passed / 2 existing Mac shortcut expectation failures on Windows.
Rust: 574 passed / 1 existing MCP test fixture failure / 5 ignored. The fixture has no .git boundary,
so discovery reaches real parent config and finds extra entries. No tests changed or weakened.
Lint remains unavailable. Build emits the existing CSS highlight and chunk-size warnings.

**Verdict:** Installer produced at Nakul's request; full test gate remains red for the documented
unrelated failures, and installed desktop verification remains a separate follow-up. No desktop UI
automation. Logs, manual checks and exact commands: [build record](notes/windows-060-build/README.md).

**Learnings:** Fresh Git manifests were 0.7.0 while the web-rendered main/package.json was still 0.6.0.
Use the fetched commit for version comparison. Tauri rewrites src-tauri/Cargo.toml line endings; the
content-identical rewrite was hash-verified against HEAD and restored. Archive copying is now a
separate step, not part of the current upstream build:windows script. C: 12.91 GB / E: 13.20 GB remained
after building, before the small archive copy; no cleanup or storage redirection performed.

## 1 Oct 2026 18:20 IST — 0.1.55-local5-provider-fixes: provider batch closed and pushed

**What:** Six provider features and their follow-up fixes are on `nakul/windows-support` and on the fork. Session approvals ("Allow for session" for Claude and Codex), AI helper model settings, live Claude model and permission changes, Codex MCP forms, accurate context breakdown, and Native Branch for Claude, Codex and OpenCode.

**Commits:** `a65bd4e` (checkpoint) → `bf41013`, `84fbe89`, `9dfeaa0`, `3a47202`, `11981c0`, `f1a4712` (features) → `3f5834b` (approval buttons back to text width) → `b937b11` (local4 version) → `b905b8c`, `0a27328`, `4423fd8`, `35b1f2b` (follow-up fixes A–F) → `d691035` (one test line) → `c2c8bf6` (local5 version).

**How:** Each feature had its own spec in `docs/specs/`. Workers (Sol, Luna and one more agent) implemented on this branch directly, with no worktrees; Claude reviewed each commit. The follow-up fixes were handed over as one spec plus a three-line prompt, not a prompts file.

**Installers:** local4 `MonoCode_0.1.55-local4-provider-batch_x64-setup.exe` (SHA-256 C6401E49…D5E5) failed check SA-1. local5 `E:\Developing\Installable versions\MonoCode_0.1.55-local5-provider-fixes_x64-setup.exe`, 10,591,804 bytes, SHA-256 363B255A40640B03426E7518DF0B8018081F5C2EA3552FAB399801338F0ADB77, unsigned.

**Checks:** TypeScript passes. Full web suite 342 files / 3,944 tests (the worker's run at `35b1f2b`; one test line was added after it and its file passes). Production web build and unsigned NSIS build pass with the usual CSS highlight and chunk-size warnings. Rust checks weren't rerun; no Rust source changed since local3. ESLint still has no config.

**Verdict:** Nakul reported local5 fine on 1 Oct 2026 (his word, not an automated UI check; the individual checks in `docs/notes/local4-manual-checks.md` weren't itemized). All seven specs are Done.

**Push:** fast-forward, no force, only to `personal/nakul/windows-support` (https://github.com/imnakul/monocode-clone.git): `9397898..c2c8bf6`, 15 commits. Remote SHA verified equal to local HEAD `c2c8bf6c2127521b55f3a16e4a1ae58e25014eb6`. Upstream wasn't touched.

**Learnings**
- Real Codex 0.159.0 sends an MCP approval with no `_meta.tool_name` and no `threadId`. The tool name is only in the `item/started` `mcpToolCall` notification that arrives just before it, and in the message text. Our tests had used a made-up payload with `tool_name`, so they passed while the installed app showed no "Allow for session". Capture a real provider payload before writing the test.
- Upstream has no session grants at all. Its commit `879ae4b` makes Full Access accept every MCP confirmation and removes `isCodexComputerUseAccessConfirmation`; it will conflict with our approval branch in `codex.ts` at the next sync. Plan: keep our grant path, take upstream's wider Full Access rule, keep `!live.planning`.
- A review is stronger when each fix is removed by hand and its test is seen to fail. That found one untested guard (an approval request that carries a child-thread id) and two loose assertions.
- A flaky Composer test waited a fixed 20 ms for the real `FileReader`. Fixed waits fail under a loaded full run; use a test double and assert the visible result.
- Git Bash on this PC prints UTC for `TZ=Asia/Kolkata date`. Use PowerShell `Get-Date`.
- The tracked `docs/jira.md` is deleted on this branch (moved to the ignored `docs/notes/jira.md` in `a65bd4e`). Upstream still has it, so expect a modify/delete question at the sync if upstream changed it.

**Still open:** Codex MCP forms were never tried against a real form-sending server. Whether Claude honours `--session-id` with `--fork-session` was never observed directly (the code handles both). "Always allow" for Codex is not built. Next: upstream sync, 128 commits behind `origin/main` after a fetch on 1 Oct 2026 18:20 IST.

## 28 Sept 2026 14:14 IST — Lead checkout chooser removed

At Nakul's request, the uncommitted chooser introduced on 26 September was removed without resetting the larger orchestration worktree. Orchestrate now opens a planning proposal and starts the planning turn in the session's existing checkout. No pre-planning question or automatic lead branch/worktree operation remains. The chooser-only model and tests were deleted; the confirmation card no longer requires a saved checkout selection. Saved cards with old chooser statuses restore as retryable invalid proposals. Worker isolation, exact local-file handoff, lead Stop/Cancel, Resume and send, and Efficient/Live supervision remain.

Focused orchestration/Composer tests passed 67/67; TypeScript, `cargo fmt --check`, `cargo check`, and the production web build passed. Two full web test runs each had a different intermittent Composer attachment failure (`Composer.paste.test.ts`, then `Composer.test.ts`); both passed individually, so the full gate is not recorded as green. ESLint still cannot start without the repo's flat config. Native Tauri verification is for Nakul; no installer, commit, push, or live Git checkout change was made.

## 26 Sept 2026 01:00 IST - Orchestration native-dev handoff continuation

The working branch stayed `nakul/windows-support` at HEAD `9397898c923491a9ee1e9cd77c4bcc917634c888`. Hari stayed parked: stash `966680850080b052aaf4dcd13d12a8c5062831f3` is still present, and the external Hari backup's 16 manifested paths match that stash after Git line-ending normalization. The full combined-tree backup verifies 1,371 source files with zero mismatches. The three protected file hashes remain Cargo.toml `894b5d3441d93d8df11f311ae37fcad767c2a254c9bdc5b1c0a5bfa7da6cfce6`, systemBreakdown.ts `54b9dfa03305ca37e99b95035910a8c339106ed47c8583e2e1d8dc9ec3072a1f`, and systemBreakdown.test.ts `7363fc14eda1002a995d3193a8ee116778d3c8d4e6260d6a7f1068613345a708`.

Resume and send now awaits the run-resume result through the same asynchronous result contract used by Composer. The controlled Composer/App-shared test exercises pending resume, success, rejection, repeat submit, model switch and cancellation while retaining the typed text and attachment on failure; it is not a mounted native App end-to-end test.

Handoff retains the approved baseline bytes in app data, can recover a baseline when the lead copy conflicts, reports truncation per side, and reads the entire allowed file in hash-checked 32 KiB pages (file maximum 8 MiB). Rust tests cover restart/retry, partial integration retry, review-time changes, the maximum file size, conflict review and private-content exclusion from errors. The control guidance tells the lead to page through each side and re-run get after a hash mismatch.

Efficient mode now counts quiet waits at the control boundary and returns the explicit end-turn guidance after two empty waits; event arrival resets the period and does not stop the run. A full web run first exposed that an awaited budget save happened before registering the wake listener; this was moved so a question/result cannot be missed during that gap. The orchestration wake and deterministic quiet-worker suites both pass. No live short lead run was possible, so whether a model obeys the end-turn response without looping remains unobserved.

The checkout choice is a synthetic question rendered by the existing Composer question UI. The original request and selection persist with the proposal; the branch/worktree action starts only after the answer, dirty sources block branch/worktree creation, selection is revalidated before confirmation, and the confirmation identifies the lead/integration checkout while preserving isolated worker checkouts. Temporary Git repository tests cover branch/worktree creation, dirty blockers and custom paths; no branch or worktree was created in this live repository.

Maximum-call-stack investigation traced App planning/proposal completion through the Antigravity ACP prompt and JSON serialization boundary. A fake ACP regression matrix covers chat/planning x text/image x fresh/reused sessions (28 ACP tests total), including a generated 64x48 PNG. It did not reproduce the reported runtime error; no live Gemini session or sanitized stack was available, so cause is unresolved and no speculative fix was made.

Final checks: web 329 files / 3,716 tests plus TypeScript; Rust fmt and Clippy (`-D warnings`) pass; Rust 429 passed / 4 ignored with one Cargo job; production web build passes with existing CSS pseudo-element, mixed import and large chunk warnings; diff check passes. Changed-file ESLint was attempted and still cannot load because the repo has no `eslint.config.*`. Native smoke was unavailable: the computer-use surface reported no apps or windows, and no runnable Tauri dev executable was available (the Rust test harness is not the app). No commit, push or installer was produced.

## 25 Sept 2026 - Local handoff files and lead control

Root cause of "Stop killed my orchestration": the composer Stop for an orchestration lead went `SessionPane.onStop` → `App.onStop` → `orchestrator.stopForSession` → `stopRun`, which cancels tasks and calls `control_disable`; the next lead turn (after Sol → Luna) had no control environment ("No MonoCode connection"). The grant belongs to the lead session, not the model. A lead's Stop now calls `Orchestrator.stopLeadResponse` (generation bump + stop that one process); only the confirmed **Cancel orchestration** button calls `stopRun`.

Ignored-file handoff: `git_diff_files_for` uses `ls-files -o --exclude-standard`, so ignored specs were never seeded; a shell-written ignored file also lacks a checkpoint pre-edit state. New `src-tauri/src/handoff.rs` moves only declared exact files, comparing SHA-256 against a baseline taken in the lead checkout before dispatch, without touching `.gitignore`, the index, or undeclared ignored files. The unexpected-ignored-file scan runs only for tasks that declared handoff files, and reports names only. The Efficient/Live policy replaces "use bounded wait calls while supervising" in the lead prompt.

Gates: tsc ✅, Vitest 3703/3704 (only the unrelated Hari rail test in `SidebarRename.test.ts` fails), cargo fmt/clippy/test (426 + 4 ignored) ✅, production web build ✅, `git diff --check` ✅. No commit, push, or installer. The Hari WIP and protected Cargo/systemBreakdown files were isolated with a path-limited stash and byte backups, then restored byte-for-byte before editing (`E:\Developing\OpenSource\mono-clone-backups\hari-20260925`; stash `hari-isolation-20260925-orch-spec` = `966680850080b052aaf4dcd13d12a8c5062831f3`, left in place).

## 25 Sept 2026 - Hari current orchestration integration

Implemented the active scope from `docs/specs/hari-current-orchestration-integration.md` on `nakul/windows-support`. Hari now selects a lead within the current project, keeps a first goal transient until submit acceptance, and projects real orchestration tasks into a read-only board. Chat reuses the current SessionPane and explicit Confirm & start flow; board cards open the existing worker details. Existing workspace panes stay mounted behind Hari, and async lead selection is project-scoped.

No backend schema, Tauri API, dependency, Hive engine, scheduler, build, installer, or release was added. TypeScript and `git diff --check` passed; focused Vitest passed 62 tests. ESLint could not start because this checkout has no `eslint.config.*`. Native Tauri dev-mode verification remains the next handoff check; protected Cargo/systemBreakdown working edits retained their original hashes.

## 25 Sept 2026 - Corrected same-version wallpaper installer

The user reports that None, Dither, ASCII, Halftone, and Scanlines work in Tauri dev mode. At the user's explicit request, the correction was released without changing app version 0.1.55-local3-rail-wallpaper. Commit 9397898c923491a9ee1e9cd77c4bcc917634c888 contains the CSP fix and five-option wallpaper control; no version file changed. Isolated release gates passed: web 326 files / 3,649 tests and TypeScript, Rust fmt/Clippy/415 passed with 4 ignored, production web build, and unsigned NSIS build. Existing CSS highlight, mixed-import, and large-chunk warnings remain; ESLint remains blocked by missing flat config.

Corrected installer: E:\Developing\Installable versions\MonoCode_0.1.55-local3-rail-wallpaper_x64-setup.exe; 10,577,371 bytes; SHA-256 B768793BFD7B5EA7C3F0F67D2451D1CC1B2F0A7F942B23C9BBA6E9B104E1A30E. Original failed installer is preserved at E:\Developing\Installable versions\failed\MonoCode_0.1.55-local3-rail-wallpaper_x64-setup.exe; SHA-256 5E59FDF78B0B17AB46549BAB63F4209F387B83FF5B84ABB6ACAD98CE86A99663. Identify the corrected build by hash and source commit because About reports the same version for both. The two systemBreakdown files and src-tauri/Cargo.toml retained their original SHA-256 hashes after isolation/restoration. Nakul confirmed the corrected installer works when installed (user-confirmed, not an automated UI check). A fast-forward push completed without force, only to `personal/nakul/windows-support` at https://github.com/imnakul/monocode-clone.git: 217 commits were sent from remote base 6f1d2f7851be7ea644e11f4daf2b2b9da29b7770. Verified remote SHA equals local HEAD 9397898c923491a9ee1e9cd77c4bcc917634c888.

## 25 Sept 2026 - Wallpaper effect choices

The Windows wallpaper now offers None, Dither, ASCII, Halftone, and Scanlines in the same segmented control style as chat backgrounds. The two effect preferences and their rendered URLs remain independent. A stored true under the old wallpaperHalftone key loads as Halftone until a new wallpaper effect is selected; new choices save under wallpaperEffect and clear the legacy key. The shared worker already implements all five, so no algorithm or dependency was added. Render failures keep the original wallpaper visible with a generic effect error, and rapid choices keep the latest result.

Focused tests passed (54); full web passed (326 files / 3,650 tests and TypeScript); Rust fmt/Clippy/tests passed (415 / 4 ignored, one Cargo job); production web build passed. The user reports the earlier CSP-corrected Halftone works in dev mode. Other wallpaper modes still need dev visual checks before a new local4 installer. Local3 stays archived as failed. No commit or push for this extension yet.

## 25 Sept 2026 - Installed local3 Halftone failure

The installed 0.1.55-local3-rail-wallpaper app displayed the original wallpaper and the Halftone error for two images, including after restart. Picker Cancel, theme change, and preference persistence passed; rail hover and Remove were untested in that installed session. Local3 is a failed candidate and must not be pushed.

Wallpaper creates a blob: URL from native image bytes. The shared effects client fetches that URL, but packaged connect-src did not allow blob:. The dev policy allowed the localhost origin, masking this difference. Added blob: only to production and dev connect-src, plus a regression test of both policies. The test failed before the fix and passed after it. Focused tests passed (19); full web passed (326 files / 3,644 tests and TypeScript); Rust fmt/Clippy/tests passed (415 / 4 ignored, one Cargo job); production web build passed. The correction still needs dev-app and new local4 installed verification. Keep local3 archived and do not push before the corrected installed build passes.

## 24 Sept 2026 — Compact rail shared hover + wallpaper Halftone (versioned NSIS built; installed verdict pending)

The collapsed project rail now uses the shared sliding hover marker across its
compact shortcuts, project picker, workspace tabs, and Settings. Continuity
covers the gaps within each shortcut group, while the flexible space before
Settings remains outside those groups. Active and open items retain their fill.

Windows Appearance now has a separate **Halftone wallpaper** switch. It reuses
the existing Halftone worker with separate preference, source/render URL
ownership, and app-wallpaper CSS. A pending render does not replace or revoke
the visible wallpaper until a successful replacement is painted. Failed image
reads leave the current wallpaper intact; failed Halftone renders show the
original image and a Settings error, including failures caused by theme changes.
Managed-file persist and clear calls are serialized. Latest Change/Remove and
on/off choices own the result after every async step. Chat background remains
independent.

**Wallpaper ownership race fix:** The displayed wallpaper, saved path, Settings state, retained managed file, and live object URL now advance together only after the managed copy, image read, and required render succeed. Opening or canceling a picker leaves pending work eligible. Failed choices preserve the last successful wallpaper; a later successful choice or Remove fences older work. Managed images stage under unique paths, and superseded files are removed after overlapping operations settle. Controlled-promise regressions cover cancellation, persistence/read/render failures, Remove and newer-choice races, restart restoration, URL lifetime, and managed-file operation order.

**Ownership follow-up verification (24 Sept 2026):** Focused wallpaper/settings/filesystem tests passed (31). Full `npm run check:web` was flaky in existing Composer tests: one full run passed (326 files / 3,643 tests), the first run failed two Composer cases, and the final repeat failed one (`Composer.test.ts`, attachment ownership; latest 325/326 files, 3,642/3,643 tests). Standalone `npx tsc --noEmit` passed after the final source change. `npm run check:rust` passed formatting, Clippy, and 415 tests (4 ignored) with `CARGO_BUILD_JOBS=1`; the default parallel attempt hit LLVM out-of-memory / `STATUS_STACK_BUFFER_OVERRUN`. `npm run build` passed with existing CSS highlight pseudo-element, mixed-import, and large-chunk warnings. `git diff --check` passed. Changed-file ESLint is blocked because the repository has no `eslint.config.*` (ESLint 10 cannot find a flat config).

**Direct integration:** Both feature diffs were transferred one at a time to
`E:\Developing\OpenSource\mono-clone` on `nakul/windows-support`. The tracked
files were content-compared with the implementation worktrees, both new tests
were verified in the main checkout, and only then were these temporary
worktrees removed:

- `E:\Developing\OpenSource\mono-clone-compact-rail-hover`
- `E:\Developing\OpenSource\mono-clone-wallpaper-halftone`

Feature source is committed as 4a57b56; release version is committed as 5948d47. The existing
`src-tauri/Cargo.toml` and both `systemBreakdown` edits were hash-verified
unchanged.

**Regression coverage:** the compact rail checks one shared marker, registered
action targets, selected-state preservation, and continuity regions. Wallpaper
tests cover the displayed-URL/stale-render/read-failure race, latest rapid
Halftone toggle, overlapping image choices, Remove during a pending persist,
managed-file operation ordering, theme-triggered failure feedback, and chat
background independence.

**Automated verification:** `npm run check:web` passed (326 files / 3,636 tests
and TypeScript); `npm run check:rust` passed (formatting, clippy, 413 tests
passed / 4 ignored); `npm run build` passed. Focused compact-rail tests passed
(45); focused wallpaper/settings/filesystem tests passed (53); `git diff
--check` passed. The production build reported CSS highlight pseudo-element,
mixed static/dynamic import, and large-chunk warnings. Changed-file ESLint is
blocked because the repository has no `eslint.config.*`; ESLint 10 reports
that it cannot find a flat config.

**Manual Tauri verification:** The user reports that requested dev-mode pointers and earlier checks passed. The archived installer still needs an installed-build verdict.

- Move the pointer between neighboring compact shortcuts across their visible
gaps; confirm the highlight stays continuous. Check selected/open actions and
project picker behavior, keyboard focus, and menus. Confirm continuity does not
span the flexible spacer before Settings.
- Choose and remove wallpapers, turn Halftone on/off quickly, and change the
theme while Halftone is on. Confirm the latest choice wins, the image stays
visible during switching, errors show the original image plus Settings
feedback, and chat background remains unchanged.
- Restart after selecting the wallpaper/effect and confirm both persisted
settings restore correctly.

The installer was built and archived. No browser or Tauri UI was opened by this agent. Full checklist:
`docs/specs/archive/compact-rail-wallpaper-halftone.md`.

## 24 Sept 2026 22:58 IST -- 0.1.55-local3-rail-wallpaper release

Feature commit: 4a57b5685cdeba325f7e7a1df5cbea74554f7980. Release-version commit: 5948d47c15a95e17540561402129048500cba0cd.

Release gates passed on the isolated versioned source: npm run check:web (326 files / 3,642 tests; TypeScript passed), CARGO_BUILD_JOBS=1 npm run check:rust (formatting and Clippy passed; 415 passed / 4 ignored), npm run build, and npm run build:windows -- --no-sign. Existing build warnings remain for CSS highlight pseudo-elements, the mixed static/dynamic filesystem import, and large chunks. Changed-file ESLint was not attempted because no root eslint.config.* exists.

Installer: E:\Developing\Installable versions\MonoCode_0.1.55-local3-rail-wallpaper_x64-setup.exe (10,582,617 bytes). SHA-256: 5E59FDF78B0B17AB46549BAB63F4209F387B83FF5B84ABB6ACAD98CE86A99663. The source and archive hashes match. App and installer metadata report 0.1.55-local3-rail-wallpaper; Authenticode reports NotSigned.

Protected WIP hashes after restore: systemBreakdown.ts 54B9DFA03305CA37E99B95035910A8C339106ED47C8583E2E1D8DC9EC3072A1F; systemBreakdown.test.ts 7363FC14EDA1002A995D3193A8EE116778D3C8D4E6260D6A7F1068613345A708; src-tauri/Cargo.toml 894B5D3441D93D8DF11F311AE37FCAD767C2A254C9BDC5B1C0A5BFA7DA6CFCE6. Stash application converted line endings, so the original byte backups were restored and verified before dropping only the release-isolation stash.

The user reports the requested dev-mode pointers and earlier manual checks passed; this agent did not open Tauri UI. The new installer has not been installed or tested. No remote fetch or push occurred. Wait for the installed-build confirmation, then verify the personal remote URL and fast-forward state before pushing.

## 23 Sept 2026 — Providers initial discovery indicator (unreleased)

Opening Providers still starts its existing availability scan and eligible model catalog requests, but now shows "Checking providers…" in the header and disables every Recheck until both paths settle. A top-level request failure becomes a visible retry hint. No startup work or manual Recheck scope changed. Focused tests, TypeScript, production build, Rust checks, and the rest of the web suite pass; three unrelated `ContextMeter` tests assume Western number grouping on this `en-IN` machine. Manual UI verification remains for Nakul. Plan: `docs/specs/archive/providers-loading-plan.md`; spec: `docs/specs/providers-initial-loading.md`.

**Live process sample, 16:54:26 IST:** dev `monocode.exe` PID 30212 had 20 direct/nested descendants using 1,609.1 MB working set: 1 app (68.0 MB), 1 OpenCode (842.9 MB), 6 Node (568.3 MB), 7 cmd (80.6 MB), 4 conhost (37.2 MB), 1 tabularis (12.1 MB). No PowerShell/pwsh in that tree. The dev root started at 16:48:00; OpenCode and its cmd/Node children began at 16:50:03–16:50:15, over two minutes later. Installed MonoCode PID 31344 had 13 descendants / 3,768.6 MB, of which 8 WebView2 processes accounted for 3,557.3 MB; its Antigravity stack remained present. This is process-tree working set, not unique physical RAM. WebView2 may reuse a browser parent across instances, so its parentage is insufficient for a clean dev-vs-installed UI memory comparison. No processes were terminated.

## 23 Sept 2026 — 0.1.51-local1-upstream-import: Main 0.1.45–0.1.51 merged (round 1)

**In simple terms:** everything Main shipped over the last ten days is now in our
build — parallel worktrees, the agent orchestrator, saved drafts, named
accounts, Hermes, settings search, the Windows tray, and dozens of fixes —
merged on top of our Windows/queue/token work. 55 files needed choices; the
record is `docs/notes/archive/upstream-merge-2026-09-23.md`. Three product calls by Nakul:
mute menu takes Main's, the composer keeps our Queue/Steer send button
(intentional, logged in LOCAL-CHANGELOG), settings rows take Main's order with
all our rows kept.

**Gates:** tsc 0 errors · vitest 3,082/3,082 · Rust 345/345 (fmt + clippy clean).
**Round 2 outstanding:** v0.1.51→v0.1.54 (the `src/` reorganize + Antigravity
reconciliation). In-app testing of the merged UI pending.



**Built artifact (checkpoint build before the upstream import work; not yet
installed or in-app tested):**

- Version: `0.1.44-local8-lazy-terminal` (NSIS-only, `--no-sign`).
- Installer: `E:\Developing\Installable versions\MonoCode_0.1.44-local8-lazy-terminal_x64-setup.exe`
  (9,685,825 bytes / 9.24 MB).
- UTC: `2026-09-23T03:54:43Z`; SHA-256:
  `E15B7998D76456D1CDD050B7CD7ECC4AEFC64F6D2FB9F1357F369DA26E077BB4`;
  Authenticode `NotSigned`.
- Gates re-run at build time: web 206 files / 2,323 tests green; Rust
  fmt + clippy (`-D warnings`) + 267 tests green (4 ignored); ESLint still
  blocked by the missing `eslint.config.*` (pre-existing).
- Commit and push not performed — pending Nakul's word. The 15 Sept in-app
  checks below remain outstanding.

## 15 Sept 2026 — Lazy terminal + harness startup (work on `nakul/windows-support`, built 23 Sept as 0.1.44-local8-lazy-terminal)

**In simple terms:** opening MonoCode used to start a shell for every saved
terminal (12 PowerShell processes on the reporter's machine) and wake up
provider runtimes just because old chats existed. Now a cold launch starts
zero shells and zero provider runtimes. A terminal starts when you create
one, open its panel, pick its tab, or press Start/Restart/Retry — and only
that terminal. Providers start when you open the picker/provider row, press
Recheck, or actually run something.

**Confirmed cause:** every restored dock/pane mounts `TerminalView`, whose
mount effect unconditionally called `spawnPty()` (one ConPTY shell per
entry); `App.tsx` boot also ran `probeHarnessAvailability()` (including the
~30 s Antigravity ACP handshake) plus `refreshHarnessCatalogs()` for saved
sessions' harnesses, then rewrote saved models against the fallback catalog.
A second normalization hid in `sessionFromStub()` via `newSession()`.

**Lifecycle policy (final):**

- Saved terminal records are metadata. Boot = dormant everywhere, including
  a panel restored open and visible (shows folder title, "Nothing is
  running", Start Terminal button).
- Explicit start only: new terminal, panel show/open, dormant tab/file
  select, Start/Restart/Retry. One id per action — no fan-out. Focus,
  restore, project switch, blur, and unrelated renders never start.
- Started terminals stay mounted hidden; hide/switch/blur never kills.
  Close paths (`forgetTerminal` + `killPty`) cover dock, pane, tab, session
  removal, and project forget/archive. Quit reaps via existing
  `reapWindowRuntime` (verified by test).
- Providers: no boot probe/catalog/normalization. Discovery on picker open,
  provider-row visit, Recheck, or real execution. Antigravity catalog success
  (or healthy-but-signed-out) notes availability — handshake and
  shared-runtime acquisition never run together. Statuses: not-checked vs
  missing stay distinct; Recheck and errors preserved; queue semantics
  untouched.
- Legacy `e%3A/...` project twins merge to one dock at the snapshot parse
  boundary; literal `%` filenames untouched.

**Tradeoff:** keep-mounted + deferred spawn (cheap dormant placeholders)
instead of separating runtime ownership from views — smallest change that
keeps builds/dev servers alive across tab switches. Full ownership split
deferred. Multi-window same-id start is last-wins; no transfer staging
exists today, so transfers restore dormant.

**Validation:** `tsc` clean; vitest 205 files / 2,318 tests green (42 new);
`cargo fmt --check`, `cargo check`, `cargo clippy -D warnings` clean;
`cargo test` 267 passed / 0 failed / 4 ignored; `git diff --check` clean.
ESLint still blocked repo-wide (no `eslint.config.*`, pre-existing — exact
message: "ESLint couldn't find an eslint.config.* file.", v10.10.0). No
browser/GUI test performed (per instructions). Installer built 23 Sept as
`0.1.44-local8-lazy-terminal` (see the entry above) at Nakul's request as a
pre-import checkpoint; commit and push not performed. SocratiCode MCP was
not registered in this session — mapping done with native search, verified
against source/tests/diff.

**Remaining in-app checks for Nakul:** (1) cold launch with saved
terminals shows dormant cards and spawns no shells (Task Manager check);
(2) Start/select/show starts exactly one shell; (3) hide + project switch
keeps a running `sleep`/dev server alive and output intact on return;
(4) close/kill still confirms on running processes; (5) Providers page shows
"Not checked yet" then honest status after visit/Recheck, saved Antigravity
model preserved; (6) quit leaves no stray `pwsh`/ACP processes. Plan:
`docs/specs/archive/lazy-terminal-harness-plan.md`.

### Addendum 7 Oct 2026 — delayed, opt-out light provider check

The policy above still holds for everything except one task. Two seconds after
the app mounts, a light provider check now runs once in the background
(`runProviderCheck` in `src/features/providers/model/providerCheck.ts`, started by
`useStartupProviderCheck`). It probes availability and loads catalogs for
visible providers only. It never runs the Antigravity handshake (only a manual
Refresh all does), never touches hidden providers, and never normalises saved
sessions' models. Settings → General → "Check providers when MonoCode opens"
turns it off; then Settings → Providers runs it on first open instead. The
title bar shows its progress, and Settings → Providers reuses the result
rather than re-checking on every visit. Nothing starts before the 2 s delay.

## 12 Sept 2026 — 0.1.35-local5-queue-durability: Queue durability, SQLite migration 12, non-native steer cancellation, and lifecycle holds

**What:** Fast-forward integration and closeout of `0.1.35-local5-queue-durability`. Replaces ephemeral in-memory queued messages with durable SQLite persistence across restarts and crashes, introduces a dedicated `QueueDurabilityScheduler` with bounded write latency and in-flight coalescing, protects against streaming starvation, resolves failure-to-held auto-dispatch races, orchestrates non-native Steer cancellation with a 15-second settlement barrier, and locks editing actions during transient steering.

### 1. SQLite schema migration 12 and robust queue persistence
- **Root cause:** Queued follow-ups previously resided solely in React state (`Session.queuedMessages`). Exiting MonoCode, reloading windows, or encountering a crash destroyed all queued work. In addition, malformed queue state could prevent session loading.
- **Fix:** Added migration 12 to `src-tauri/src/session_store.rs`, introducing `queued_messages_json TEXT` and `queue_status TEXT` to the `sessions` table.
- **Compact storage:** Empty queues write `NULL` to both columns rather than `[]`, preventing DB clutter and keeping the covering index lean.
- **Safe degradation:** In `get_session`, `queued_messages_json` is deserialized safely via `.ok()`. Corrupted or malformed queue JSON degrades to `None` without crashing session loading, preserving the user's conversation transcript blocks and model settings intact.
- **Sanitization & validation:** `persistableQueuedMessages` in `src/lib/sessionStore.ts` strips ephemeral `previewUrl` blob URLs while retaining filesystem paths or inline base64 payloads. `restoreQueuedMessages` strictly validates rows on load (requiring non-empty text, valid attachments, note cards, or handoff cards) and drops orphan statuses when no valid rows remain. Transient states (`resuming`, `steering`) normalize to `paused` on save.

### 2. QueueDurabilityScheduler, streaming decoupling, and retry
- **Scheduler:** Extracted `QueueDurabilityScheduler` in `src/lib/queueDurability.ts` as the single owner for queue-triggered durability writes.
- **Bounded latency:** Schedules debounced writes (400ms) immediately upon queue mutation, regardless of whether the session is currently busy or actively streaming tokens. Streaming token updates never postpone or starve queue write deadlines.
- **Concurrency barrier:** Enforces at most one scheduler write in flight per session. Mutations occurring while a write is in flight are coalesced and committed in a single follow-up write.
- **Autonomous retry:** Write failures retain dirty state and retry autonomously with exponential backoff.
- **Reconciliation:** Normal transcript and user-turn persistence paths safely notify `QueueDurabilityScheduler.setPersistedKey()`, canceling redundant pending writes or scheduling follow-ups for newer unpersisted snapshots.
- **Strict Mode safety:** Handles React Strict Mode double-invocation gracefully via `getOrCreateScheduler()`, ensuring dev remounts do not leave the scheduler disposed or drop queue persistence.

### 3. Failure-to-Held lifecycle and auto-dispatch race prevention
- **Race condition:** Previously, when a provider turn failed, `flushHarnessEvents()` cleared `busy: false` while `await flushSessionCheckpoint()` ran before setting `queueStatus: "held"`. During this window, the auto-dispatch effect saw `busy: false` with `queueStatus: "active"` and fired the next queued follow-up into the broken turn.
- **Fix:** Synchronously determine turn failure (`session.error`, catch rejection, or failure-text detection) via `orchestrateTurnCompletion` in `src/lib/messageQueue.ts`.
- **Immediate hold:** Sets `queueStatus: "held"` and `busy: false` synchronously in both React state and `sessionsRef.current` BEFORE any await, Promise, or event-loop yield.
- **Clean recovery:** On `onResumeQueue`, status `held` transitions cleanly to `active`, allowing auto-dispatch to submit the head as a fresh turn.

### 4. Non-native Steer cancellation barrier and UI locks
- **Cancellation barrier:** When clicking Steer on a queued row for harnesses lacking native steering (such as Antigravity) or for Plan intent: reorders the message to head, invalidates stale events with an incremented `turnGen`, requests harness cancellation, and enters transient `steering` state (`busy: true`, `queueStatus: "steering"`).
- **Settlement:** Awaits cancellation bounded by a 15-second grace period via `settleQueuedSteerCancellations`. On full acknowledgment, transitions to `active` to trigger auto-dispatch. On timeout or error, sets `queueStatus: "held"` with `session.error`.
- **UI locking:** During `steering`, status banner renders `role="status"` and `aria-live="polite"`. All Edit, Delete, Steer, and Composer save actions are strictly locked. Entering `steering` immediately clears local edit drafts and notifies parent handlers to prevent stale editor reappearance.

### Verified installed artifact
- **Version:** `0.1.35-local5-queue-durability`
- **Installer path:** `E:\Developing\Installable versions\MonoCode_0.1.35-local5-queue-durability_x64-setup.exe`
- **Size:** `9,403,036` bytes
- **UTC Timestamp:** `2026-09-11T16:25:47.4606364Z` (Local: `2026-09-11T21:55:47.4606364+05:30`)
- **SHA-256:** `5F4BE05AEEE193C346304EAF4867E6256BF854757A1BEC6C718FA0CAED0541DF`
- **Authenticode:** `NotSigned`
- **Installed-runtime verdict:** Installed candidate verified working by Nakul; no installed-runtime issues were reported. Local5 is approved for integration and final closeout.

### Automated verification results
- `npm run check:web`: Clean (Vitest 152 test files passed, 1,658 tests passed; `tsc --noEmit` 0 errors).
- `npm run check:rust`: Clean (`cargo fmt --check`, `cargo clippy --workspace --all-targets -- -D warnings`, `cargo test` 225 passed, 4 ignored, 0 failed).
- `npx eslint . --fix`: Reported exit code 1 due to missing `eslint.config.*` (pre-existing repo tooling limitation; zero source files modified).
- `git diff --check`: Clean (0 whitespace/conflict errors).

## 11 Sept 2026 — 0.1.35-local4-token-usage: Token, Windows editor, diff, and interaction hardening


**What:** Direct-integration branch (`nakul/windows-support`) closeout for `0.1.35-local4-token-usage`. Hardened six key areas on Windows: newline normalization & safe staging, Source Control navigation & deleted file diffs, Experimentation settings (Detailed Context & Remaining Quota), telemetry lifecycle & costing, Composer Queue/Steer keyboard behaviors, and shared-hover continuity across list gaps.

### 1. Windows newline normalization and safe staging
- **Root cause:** Windows git checkouts and filesystems use CRLF (`\r\n`), while web editors (CodeMirror), unified diff algorithms, and parser utilities expect internal LF (`\n`). Without explicit normalization, string operations and diffing produce malformed CRCRLF blank lines (`\r\r\n`), phantom status modifications where `git status` reports modified while `git diff` is empty, or double-encoding during staging.
- **Fix:** In `src-tauri/src/fs.rs`, implemented path-aware Git clean-filter emulation when staging file contents (`git_stage_contents`). Canonicalized editor documents to LF internally (`editorDoc.ts`, `editorGit.ts`, `format.ts`), while preserving existing CRLF convention on disk save when detected.
- **Installed verdict:** Verified working in installed runtime; blank line doubling and phantom modifications eliminated.

### 2. Context & Quota Experimentation behavior
- **Behavior:** Added new Settings → **Experimentation** section (`SettingsView.tsx`, `SettingsRail.tsx`, `settings.ts`).
  - `Detailed context` (default **OFF**): When OFF, `ContextMeter.tsx` renders a clean, compact two-line summary (`Tokens used / limit` + percentage). When ON, renders full segmented progress bar (System & Tools, Memory files, Skills, Messages, Compaction buffer, Free space), expandable inspector cards, and live financial costing breakdown.
  - `Remaining quota` (default **OFF**): When OFF, displays consumed quota percentage. When ON, displays quota remaining left (e.g. `42% left`) across both `ContextMeter.tsx` and `UsageFooter.tsx` status bar chips.
  - Both settings are persisted in `localStorage` and reactive via custom window events (`monocode:detailed-context-change`, `monocode:remaining-quota-change`).

### 3. Telemetry and steering ownership corrections
- **Behavior:** In `src/lib/harness/apply.ts`, `tokenAccounting.ts`, and `SessionPane.tsx`, retained latest-turn usage after turn completion (`latestTurnProcessedUsage`) and computed cumulative session usage (`sessionProcessedUsage`).
- **Turn ownership:** Prevented user steering messages from resetting or usurping turn ownership or duration metrics from the primary turn owner. Avoided active-turn double counting across completed blocks.

### 4. Source Control full-row navigation and deleted-file handling
- **Full-row click:** Widened click hitboxes in `GitChangesPanel.tsx` and `SourceControl.tsx` so clicking anywhere on the row selects and opens the file.
- **Deleted files:** Clicking a deleted file in Source Control previously failed because the file was missing from disk. Now opens a read-only Git diff view (`newGitDiffTab`) showing HEAD contents vs empty working copy (`GitFileDiffView.tsx`, `WorkingTreeDiff.tsx`, `App.tsx`).
- **Windows path portability:** Reconciled forward vs backslash path comparisons and case insensitivity in `diffPathMatching.ts` and `filePaneSelection.ts`.

### 5. Composer Queue/Steer keyboard behavior
- **Keyboard routing:** Implemented pure decision boundary in `composerAction.ts` (`resolveComposerKeyAction`, `resolveEffectiveSuggestionAction`):
  - `Shift+Enter`: Always inserts a newline (including with modifier combinations).
  - `Enter` (while agent is busy): Dispatches configured Follow-Up behavior (Queue or Steer).
  - `Ctrl+Enter` / `Cmd+Enter` (while agent is busy): Dispatches alternate behavior.
  - Suggestion menus (mentions `@` and slash `/`): Tab/Enter picks active item; Enter falls through to execution when query is unmatched; bare `/` remains open.
  - IME composition (`isComposing`) is strictly ignored to prevent premature submission during Asian language input.
  - Send button tooltip and aria-label update dynamically to describe active behavior.

### 6. Shared-hover continuity evolution and affected surfaces
- **Continuity:** Floating highlight pill now seamlessly traverses list gaps using `data-shared-hover-continuity` containers and `data-shared-hover-item` targets.
- **Affected surfaces:** Sidebar session list, Inbox filters menu, Chats panel, Sidechats, and NotesView.
- **Boundaries:** Continuity stops cleanly at section dividers, folder boundaries, and headers. Active items preserve persistent selection backgrounds.
- **NotesView polish:** Synchronous cache initialization via `peekNotes()` eliminates initial open flicker.

### Verified installed artifact
- **Version:** `0.1.35-local4-token-usage`
- **Installer path:** `E:\Developing\Installable versions\MonoCode_0.1.35-local4-token-usage_x64-setup.exe`
- **Size:** `9,392,024` bytes
- **UTC Timestamp:** `2026-09-11 07:23:02 UTC`
- **SHA-256:** `574A196841539C9F410145A2A40226408FD536B2579885140A8A6FD3A33F0068`
- **Authenticode:** `NotSigned`
- **Installed-runtime verdict:** Verified working by Nakul on Windows.

### Automated verification results
- `npm run check:web`: Clean (Vitest 150/150 files passed, 1,595/1,595 tests passed; `tsc --noEmit` 0 errors).
- `npm run check:rust`: Clean (`cargo fmt --check`, `cargo clippy`, `cargo test` 221 passed, 0 failed).
- `npx eslint . --fix`: Exit code 1 due to missing `eslint.config.*` (pre-existing repo tooling limitation; zero source files modified).
- `git diff --check`: Clean (0 whitespace/conflict errors).

### Known deferred work
- Gitignored-file mention discovery in `@` search.
- VS Code-style preview tabs and replace-versus-pin behavior.
- Animated movement of persistent active selection backgrounds.
- Future file context menus in Explorer.
- Upstream sync/rebase.

## 8 Sept 2026 - ignored local files in chat mentions

**What:** composer `@` search can now find useful files that are ignored by
Git, including `docs/changelog/LOCAL-CHANGELOG.md`. Quick Open remains Git-aware and
unchanged. Ignored entries carry a small `Ignored` badge and an accessible
"ignored by Git" label.

**Why the changelog opened the wrong file:** the file-link resolver compared
raw filename endings without requiring segment boundaries, and did not check
disk existence before falling back to heuristics. `docs/changelog/LOCAL-CHANGELOG.md`
and `docs/CHANGELOG.md` therefore collided with root `CHANGELOG.md`. Resolution
now uses `statFiles` filesystem metadata to verify exact existence first
(returning the real path immediately if it exists on disk), and requires a real
slash boundary before attempting suffix fallbacks.

**How mentions work now:** a new mention-only backend listing starts with the
existing tracked/non-ignored index, then merges files from a bounded disk walk.
The walk keeps the existing exclusions for `.git`, `node_modules`, `target`,
build output, caches, virtual environments, and vendor directories. Additional
disk-walk candidates are checked against sensitive name heuristics (excluding
`.env`, private keys, etc., as a convenience suggestion filter, not a security
boundary). Exact Git ignore status is confirmed via `git check-ignore --stdin -z`;
if Git is absent, fails, or the folder is non-Git, the badge is safely omitted.
In the composer, the `useComposerFiles` hook manages the lifecycle: opening
the picker upgrades to the mention index, and closing the picker or typing
text retains that index so selected ignored mentions remain recognized. Switching
`cwd` immediately resets files and drops stale late responses.

**TDD evidence:**
1. Collision regression tests (`docs/CHANGELOG.md` and `docs/changelog/LOCAL-CHANGELOG.md` vs root `CHANGELOG.md`) failed red, then passed green.
2. Lifecycle hook tests (`useComposerFiles.test.ts`) verified picker open -> select ignored -> close -> type more text retains index, and cwd switch drops late responses.
3. Backend tests verified `git check-ignore` tagging, non-Git folder badge omission, and `MAX_PROJECT_FILES` limit handling with visible fixture assertions.

**Verification:** `npx tsc --noEmit` exit 0; full Vitest 133 files / 1,415 tests passed;
`cargo fmt --check` exit 0; `cargo check` exit 0; `cargo test mention_files` 3 passed.
`npx eslint . --fix` exits 1 before linting because the repository has no `eslint.config.*`
(tooling blocker; no eslint configs created). Runtime behavior is ready for Nakul's dev-mode review.

Plan: `docs/specs/archive/gitignored-file-mentions-plan.md`.

## 8 Sept 2026 — local3-reveal-tabs: Explorer false-error fix + tab fade

**What:** two small fixes on `nakul/windows-support`, built as
`0.1.35-local3-reveal-tabs` (NSIS-only).
**In simple terms:** (1) "Show in folder" no longer lies — Explorer opens
and no error pops up. (2) The tab row keeps its ‹ › scroll buttons, and
tabs now fade out at the edge hiding more tabs instead of cutting off hard.

**How:** Windows `reveal_path` (`src-tauri/src/fs.rs`) dispatches Explorer
with `spawn()` + `CREATE_NO_WINDOW` (same hide-console rule as the rest of
the backend, single `.arg`, no shell string). Success = dispatched; only a
spawn failure errors. macOS/Linux branches untouched. Tab strip
(`src/chrome/TitleBar.tsx`): original chevron buttons restored verbatim;
new `tabStripFadeMask` adds a per-side CSS mask (mask + -webkit prefix as
literal Tailwind classes so the scanner emits them). A mask — not an
overlay — so glass/wallpaper backgrounds stay correct and no hitbox is
added. Interim non-clickable glyph cues were tried and removed (buttons
supersede them).

**Tests:** 3 new Rust tests (file Ok, dir Ok — Windows-gated; missing-path
Err, all platforms). `tabStripOverflow` tests kept, relabeled (they drive
buttons + fade now). Gates: tsc clean, vitest 130/1383 green, cargo
fmt/check clean, `cargo test reveal_path` 3/3. Repo-wide `npm run check`
still red on pre-existing issues only (ESLint flat-config, clippy warnings
in `pty.rs`/`fs.rs`/`harness.rs`, 11 CRLF failures) — attributed, untouched.

**Upstream read:** both slices are merge-clean by design (platform-gated /
pure-CSS, tested, documented). Natural upstream shape is TWO tiny PRs:
(1) reveal-spawn fix (+ tests), (2) tab fade (+ screenshot). Neither is
sent — fork only, no upstream contact. Before sending: run full
`npm run check` note + attach before/after screenshots per the PR template.

**Build caveat (user accepted):** the installer contains the whole dirty
tree, including the other session's unfinished Chat WIP — not a clean
D+E-only build. A/B/C worktrees (cut from clean `437cd34`) lack D+E;
merge this line into them after landing. Plans:
`docs/specs/archive/explorer-reveal-fix-plan.md`, `docs/notes/archive/tab-arrows-cleanup-plan.md`.

## 7 Sept 2026 — Antigravity ACP: architecture, installed-build fix, and recovery runbook

### What MonoCode uses

- The old headless `agy.exe` / JSON-scraping path was replaced by Google's official ACP
  runtime: `agy_acp_server.exe` with sibling `localharness_external.exe`.
- Both runtime files must stay in the same directory. The Windows package we verified is
  runtime `1.1.1`.
- Chat/catalog/resume use one long-lived shared ACP runtime owned by
  `antigravityRuntimeHost.ts`. The Rust availability probe remains a separate short-lived
  process, and Google sign-in uses a dedicated process; successful sign-in retires the shared
  runtime so the next one picks up the new token.
- Native ACP session ids are stored with the `agy-acp:v1:` prefix. Startup notifications are
  buffered until the local session attaches. Approval ids are mapped into MonoCode's local
  approval ids. ACP `fs` callbacks remain disabled intentionally.
- Cancellation is per-turn using turn epochs. A cancelled old startup may not dispose a
  shared session if a newer retry is waiting on that same startup. The regression test
  `preserves retry streaming and approvals when Stop interrupts session creation` protects
  this boundary.

### Installed build worked differently from dev — root cause and fix

Symptom: Antigravity worked in the Vite/dev build but the installed Tauri build said the ACP
runtime was missing/incomplete.

Root cause: the dev WebView had a manually chosen runtime path saved in frontend
`localStorage`. The installed Tauri WebView has a different origin/storage, so it did not see
that saved value. The runtime was also absent from Process/User/Machine `PATH`.

Fix in `src-tauri/src/harness.rs`: Windows discovery now also checks common extracted
Downloads locations:

```
~/Downloads/agy_acp_server.exe
~/Downloads/agy-acp-server*/agy_acp_server.exe
```

Explicit custom selection and `PATH` discovery still take precedence. This makes an installed
build independent of dev-origin `localStorage` while preserving the existing override flow.

Verified installed build after the fix:

```
Version: 0.1.35-local2-antigravity-acp
Installer: target/release/bundle/nsis/MonoCode_0.1.35-local2-antigravity-acp_x64-setup.exe
Size: 9,324,699 bytes
SHA256: C7C784EC8DE58CCE1A2070FCF17F9E7C0BFB4B4B2F2DA0F96FF0D224F028FF7D
```

User tested that installer and confirmed Antigravity ACP works.

Final verification before pushing/cleanup:

- Web/Vitest: 129 files, 1,353 tests passed; TypeScript clean.
- Antigravity Rust tests: 14/14 passed.
- Full Rust suite: 205 passed, 11 failed, 4 ignored. The 11 failures are the same CRLF-only
  Windows assertions documented below in `checkpoint.rs` / `fs.rs`; no Antigravity test failed.
- `cargo clippy --workspace --all-targets -- -D warnings` is still blocked by pre-existing
  Windows warnings/dead-code in older `pty.rs`, `fs.rs`, and non-Antigravity `harness.rs`
  paths. Do not "fix" those as part of ACP maintenance unless that Windows cleanup is scoped
  separately.

### PyInstaller behavior and disk pressure

`agy_acp_server.exe` is a PyInstaller onefile executable. Each cold launch extracts roughly
500 MB into temp before the real server runs; on Windows this can take 5–15+ seconds. Earlier
spawn-per-action behavior caused overlapping extraction and a real incident with about 7 GB
of abandoned `_MEI*` directories.

MonoCode redirects `TMP` / `TEMP` for Antigravity to:

```
~/.monocode/providers/antigravity/tmp
```

The cleanup sweep checks whether files are deletable before removing an extraction so it does
not tear down a live PyInstaller runtime. Keep at least ~10 GB free on the system drive while
testing ACP.

### If Antigravity ACP breaks later

1. Confirm `agy_acp_server.exe` and `localharness_external.exe` are together.
2. Prefer a stable runtime directory or `PATH`. Downloads is supported by the fallback above,
   but a stable location is less fragile.
3. Open Settings → Antigravity ACP and click **Recheck**.
4. If it still says runtime missing, either choose the executable manually, add its directory
   to `PATH`, or ensure the extracted folder matches `Downloads\agy-acp-server*`.
5. If sign-in/chat hangs after a crash, kill stray `agy_acp_server` processes/process trees,
   remove abandoned `_MEI*` directories under `~/.monocode/providers/antigravity/tmp`, restart
   MonoCode, then Recheck.
6. Do not immediately re-authenticate just because the sign-in card looks stale. The persisted
   token is normally at:

   ```
   ~/.monocode/providers/antigravity/antigravity-acp/acp_token.json
   ```

7. If the selected binary changes, the shared runtime should retire and restart automatically.
8. If Stop/retry races reappear, inspect `turnEpochs`, shared-startup ownership, and the
   `preserves retry streaming and approvals...` regression test before changing runtime
   lifecycle. Do not return to spawn-per-session as a quick workaround; that recreates the
   PyInstaller extraction congestion.

### Things to remember when changing this feature

- Availability/Recheck and sign-in still spawn separate runtime processes; normal chat uses
  the long-lived shared runtime.
- A 15-second cancellation grace is intentional; a runtime that ignores native cancel is
  retired after that bound.
- Usage-meter parsing is best-effort from runtime stderr `usageUpdate` frames. A Google log
  format change should degrade to no usage meter, not break chat.
- `fs` ACP callbacks are deliberately disabled because path-containment/security behavior is
  not implemented to the standard required for native file callbacks.
- Runtime package/version changes should be checked against the official ACP registry manifest;
  if Google changes the Windows archive/version, update the setup-panel download reference and
  revalidate the handshake/probe fields.

## 6 Sept 2026 — Pre-existing Windows CRLF test failures (not ours, leave alone)

**In simple terms:** Windows ends text lines with two invisible characters
(`\r\n`), Mac/Linux use one (`\n`). Same words, different line-ending bytes.

**What fails:** 11 Rust tests in `checkpoint.rs` (undo/review) and `fs.rs`
(git stash/discard/commit helpers) compare file text letter-by-letter, but
their expected strings were written Mac-style. On Windows every comparison
trips on the extra invisible character. Example failure:

- left: `"head-b\r\n"` (what Windows produced — correct content)
- right: `"head-b\n"` (what the test expected)

**Why it's not our bug:** those files are touched by neither our stack nor
the skills WIP, and an earlier commit already recorded "13 pre-existing CRLF
failures" on Windows. Upstream devs are on Mac/Linux, so they never see red.

**Why we leave them:** fixing means editing 11 unrelated tests/fixtures to
be line-ending-aware — churn that belongs upstream and would only confuse
review of our Windows PRs. Full suite otherwise: 191 passed, 4 ignored.

**Related micro-fix we DID make (ours to own):** `skills.rs` test
`discovers_installed_claude_plugin_skills` asserted a path with hardcoded
`/` separators — always fails on Windows (`\`). Discovery logic was
correct; normalized separators in the assertion only. Skills suite: 14/14.

## 6 Sept 2026 — Skills feature (what it is, what we kept)

**What it is:** a new Settings → Skills page (other session's work, still
uncommitted on `nakul/windows-support`): lists agent skills from project,
personal, and harness folders, with filter, rescan, starter-SKILL.md
creation, per-skill enable/disable, copy-path, and reveal-in-Explorer.
Backend: skill discovery + `list_skills` command; new `opener` permission
for reveal-in-folder.

**What we REMOVED and why:** the page also had an "Import…" panel that ran
an arbitrary user-typed install command (`run_skill_import` → `cmd /C`).
Installed 0.1.37 (with runner) got flagged by Defender as
`Trojan:Win32/Bearfoos.A!ml` at install; 0.1.35 (without it) never did.
Removed: backend command + shell-spawn helpers, Tauri registration,
`runSkillImport` bridge, Import button + command panel. Rest of Skills kept
verbatim. `terminate()` stays `pub(crate)` — `pty.rs` uses it.

**Verification after removal:** tsc clean, vitest 1324/1324, skills Rust
14/14, cargo fmt/check clean. No other references to the runner remain.

## 6 Sept 2026 — Defender verdict: false positive, proven by A/B

- 0.1.35 (no skills): installed, used daily, never flagged.
- 0.1.37 (skills WITH command runner): flagged at install, file quarantined.
- 0.1.35-local1 (skills WITHOUT runner): installed clean, both features work.
- `!ml` = Microsoft's ML guess, not a known signature. Unsigned fresh
  binary + process-spawning app + shell-command runner tripped it.
- Fix on machine: restore from quarantine, exclude install + `target/`
  folders, reinstall. Long-term fix needs a paid code-signing cert
  (upstream's call for official releases).

## 6 Sept 2026 — Local version scheme (do not bump like upstream)

Plain `0.1.35/36/37` bumps risk colliding with future upstream releases.
Local builds now use `<base>-localN`: base tracks our line (currently
`0.1.35`; upstream itself is still `0.1.34`), N increments per build.
**Constraint found:** MSI bundler rejects non-numeric prerelease, so local
builds are NSIS-only (`--bundles nsis`). MSIs only from plain versions.

## 6 Sept 2026 — Other changes in local1 (all on `nakul/windows-support`)

- Session-migration bulk toggle: header Resume|Replay|Custom; replay-target
  picker shows only when something replays; per-row toggles in Custom only.
- Composer `+` menu rows (Upload file / Plan mode) joined the sliding hover
  (`data-shared-hover-item`); the migration toggles were tried with the
  slider, then returned to plain segmented style per review.
- Hover marker snaps to whole pixels (fractional positions blurred edges).
- `Segmented` gained optional width override + opt-in `hoverSlide` (off by
  default; nothing else changed).
- Upstream merged in (48 commits, 0.1.30 → 0.1.34: tabs, composer, diff,
  plan-mode, image viewer); 6 conflict files resolved file-by-file, all
  "merge both". Full log: `docs/notes/archive/upstream-merge-2026-09-05.md`.

## 23 Sept 2026 - 0.1.54-local1-upstream-import: Main 0.1.52-0.1.54 merged (round 2)

**In simple terms:** the second and last upstream drop is merged. The codebase now matches Main's new folder layout (`src/app`, `src/features`, `src/integrations`, `src/platform`, `src/shared`), and Automations, the Antigravity ACP provider, editor language modes (C/C++/Java/PHP/SQL/XML/YAML plus legacy modes) and their dependencies are in. Our Windows work survived: Queue/Steer, token/cost metering, wallpaper, lazy terminal startup, Cline, and the always-visible menu bar. Antigravity is OUR implementation (ACP server `agy_acp_server.par`, title "Antigravity ACP"); Main's variant was deleted. The session schema is v18 - our queue/draft columns plus their `automation_id` - and the upsert/SELECT mappers were unioned to match. Around 130 files needed import-path rewrites after the reorganize (tests and `vi.mock` targets included, which is what broke - and then fixed - the lazy-terminal and antigravity suites). All gates green: tsc 0, 304 vitest files, 393 Rust tests, production build. Two `ModelPicker.test` expectations were updated for our 11th harness tab and our "Antigravity ACP" label. Decision record: `docs/notes/archive/upstream-merge-2026-09-23.md`.

## 23 Sept 2026 - round-2 merge: staging repaired, pre-commit verification pass

The round-2 upstream merge had been tested against the working tree while the prepared commit was stale (103 files held unstaged repairs; `format.test.ts` sat untracked at its new home). All intended repairs are staged now: `session_store.rs` mapper/INSERT/SELECT unions, `App.tsx` session-removal wiring (queue-scheduler eviction + terminal forget/kill, the terminal diff now behind a pure `disappearedTerminalIds` helper with tests), post-reorganize import-path rewrites (source, tests, `vi.mock` targets), and the duplicate `harness_resolve_antigravity` registration removed from `lib.rs`. The documented ContextMeter `100,000` vs `1,00,000` failures were assertion-side locale sensitivity (hardcoded US grouping against the component's runtime-locale `toLocaleString()`); the expectations now use the same call, so they are deterministic on any machine and the user-facing number format is untouched. The parallel session's Codex extension filtering in `systemBreakdown` remains unstaged, as they recorded. Gates: tsc 0, vitest 305 files green, build clean, cargo 394 passed, staged whitespace check clean.

**Future cross-platform cleanup (recorded, not done):** `src-tauri/src/harness.rs` ~4317 `antigravity_launch_args_match_the_platform_registry` is a Unix-only test that still calls Main's removed `antigravity_args()`. It compiles out on Windows so this build is unaffected, but Linux/macOS `cargo test` will fail to compile until that test is rewritten against our ACP resolver or deleted.

## 23 Sept 2026 - popover hover pill: wash/marker stacking fixed

Automations trigger submenu (Add Trigger > Scheduled > Hourly/Daily/...) showed no hovered-row highlight. Cause: `.popover-surface` (glass wash + backdrop-filter) sat on the animating content layer ABOVE the `SharedHoverHighlight` pill; the blur erased the pill and `[data-shared-hover-active]` zeroes the row's own hover background. Fix: the wash moved to the stable frame in `src/shared/ui/Popover.tsx`, content layer stays transparent/unblurred (as the frame/content comments already required). Regression test: `src/shared/ui/Popover.hover.test.ts`. Full web suite 306 files / 3,529 tests green. Applies to every popover menu (SelectMenu, ModelPicker flyouts, tab-group + mute submenus).

## 23 Sept 2026 - Providers catalogs hid the newest models (default-slot parse) + double heading

Claude's newest models were missing from Settings > Providers on this machine while Claude Code v2.1.267 itself advertises Opus 5.5 as default. Cause chain: `list_models` parsing dropped `value: "default"` rows (the default slot carries the newest model as `resolvedModel`, named by no alias row); the version fallback hid Opus 5.5 behind a `2.1.280` gate; the probe's 15s budget hit the known Windows cold-start wall (same class as the earlier Codex 0-models bug) and failures were silent; and Recheck was a no-op once any catalog landed. Codex paging only understood `nextCursor`/`data`, so a `next_cursor` build truncated at page one. All fixed with regression tests (default-slot keeps Opus 5.5 when uncovered; covered default+alias still de-dupes; gate boundary 2.1.267; force Recheck re-probes; both Codex envelope spellings). ProvidersPage also stopped re-printing the section heading the settings shell already draws. Full web suite 306 files / 3,533 tests green (default temp env).

Note on the earlier test "flakes": root cause was C: reaching 0 bytes free (ENOSPC) - vitest writes hit the full disk mid-run. The Composer tests' original sleeps are restored; they are green. Temp redirection was used only while C: was full and has been removed.

## 23 Sept 2026 - wire probe verdict: the CLI itself does not serve Opus 5.5 in list_models

Ran the app's own `list_models` control handshake against `C:\Users\gclna\.local\bin\claude.exe` (v2.1.267), twice: isolated (as the catalog probe does) and non-isolated with `--setting-sources=user,project,local`. Both return the same 11 rows and **zero mentions of 5.5** anywhere in the payload. The `Default (recommended)` row resolves to `claude-sonnet-4-6` ("Use the default model (currently Sonnet 4.6)") - consistent with the interactive session header "Sonnet 4.6 with medium effort � API Usage Billing". The "Opus 5.5 is now your default model" banner is a product announcement in the terminal, not picker data. Our Providers list mirrors the wire exactly (10 rows after de-duping the covered default slot). Verdict: upstream catalog data on this account, not app staleness. Earlier fixes (default-slot resolution, 2.1.267 gate, 30s budget, force Recheck) remain correct hardening for when the CLI does serve a new default. Follow-up: confirm with `/model` in the CLI whether "Opus 5.5" appears as a row there; if it does, the interactive menu sources differ from `list_models` and needs a different probe.

Also: the Providers heading/status layout is now the SkillsPage pattern - the settings shell skips its generic header for providers, ProvidersPage owns its header, and the "Checking providers�" status sits in the PageHeader action slot on the heading line.

## 23 Sept 2026 - gate reverted: MINIMUM_CLAUDE_OPUS_5_5_VERSION back to 2.1.280

With the CLIs updated, Opus 5.5 appears - confirming the earlier wire verdict (the app mirrored the CLI catalog faithfully; the CLIs were stale). The one model-issue change built on a wrong inference is reverted: the `2.1.280 -> 2.1.267` gate lowering was based on reading v2.1.267's banner as proof of support, but the wire probe showed that CLI never served 5.5 in `list_models` at all. Upstream's 2.1.280 is "first CLI version that serves it" and is back as the boundary (test restored with it). Kept (independent hardening, not 5.5-specific): 30s Claude discovery budget + warn logging, unparseable `--version` keeps the built-in list, force-Recheck, Codex dual-spelling paging (`codexModelPage`), and the default-slot resolution (still prevents losing a newest model when only the `default` row names it). Focused tests 43/43, tsc 0.

## 24 Sept 2026 - 0.1.54-local2-upstream-import built (NSIS), round-2 merge landed

Version bumped `0.1.54-local1-upstream-import` -> `0.1.54-local2-upstream-import` across package.json, package-lock.json (x2), Cargo.toml, Cargo.lock, src-tauri/tauri.conf.json (counter disambiguates rebuilds). `npm run build:windows` (NSIS-only, `--no-sign`, archive script) produced `MonoCode_0.1.54-local2-upstream-import_x64-setup.exe` (10.01 MB) and copied it to `E:\Developing\Installable versions\`. Pre-commit gates: web suite 306 files / 3,533 tests green, `check:rust` clean (394 passed / 4 ignored), tsc clean via the build. Merge lands as `merge(upstream): sync main through 0.1.54 (round 2)`.

## 24 Sept 2026 - KNOWN ISSUE: multiple Windows Explorer windows + "Antigravity ACP running automatically"

Symptom (Nakul, during changes/builds/runs): several Windows Explorer windows open in the system; Antigravity ACP appears to start on its own.

**Root cause found (Explorer part):** `src-tauri/src/fs.rs::reveal_path` dispatches `Command::new("explorer")` (the /select reveal) on Windows - and its own unit tests `reveal_path_dispatches_existing_file_without_false_error` / `..._directory_...` **really invoke it**, so every `cargo test` / `npm run check:rust` run opens 2 Explorer windows on this machine. We ran check:rust many times today -> windows kept appearing. Fix options (not yet applied): extract the dispatch behind a test seam so the tests assert on the spawned args without launching Explorer, or `#[ignore]` those two tests by default with a feature flag to run them.

**Antigravity part:** `acquireAntigravityRuntime()` legitimately auto-starts the ACP runtime during provider catalog discovery (Providers page open / model picker open calls `refreshHarnessCatalogs`) - that is by design (our lazy policy = no spawn at boot, spawn on explicit interaction). If it starts with NO provider UI open, that would be a leak to investigate; needs an observation of which action precedes it.

Open item for the next round: fix the reveal_path test seam, and confirm the Antigravity trigger context.

## 24 Sept 2026 - round 3 landed in tree: v0.1.55 + CLI update notices + reveal test fix

v0.1.55 merged (13 conflicts, all resolved; decisions in docs/notes/archive/upstream-merge-2026-09-24.md). Light CLI update notice shipped: toaster with the npm update command + Copy button, fired from Providers discovery/Recheck, once per provider per session (npm channels only). `cargo test` no longer opens Explorer windows (reveal_path dispatch now tested via a hidden `cmd /c exit 1` child - `a8e43b8`). Gates: web 324 files / 3,625 tests, Rust 413, build clean. Ready for commit + manual test on word.

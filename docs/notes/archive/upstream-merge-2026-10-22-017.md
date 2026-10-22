# Upstream intake — 2026-10-22 / main after 0.16.0 (round 17)

Status: merged with no conflicts, preservation reviewed, automated gates run (see Gates). Merge staged, not committed; commit, push and the human desktop/phone checks are separate.

## Pinned scope

- Branch: `nakul/windows-support-upstream-0.16.0` at `c9857af0` (0.16.0-local9).
- Upstream: `origin/main` = `74b8139c` (21 Oct, "Fix CI dependency isolation for mobile protocol tests"). No new release tag; `v0.16.0` is still the latest.
- Incoming: 14 commits after `v0.16.0`, 43 paths (+3,204 / −218), almost all under `mobile/`.
- No upstream writes; pushes go to nakul-fork only.

## What upstream brings

Android fixes for the phone app (header, segmented switch, workspace menu, composer, notifications, settings), incremental transcript streaming over the phone link (`crates/mobile-link` `ffi`/`transcript`/`transport`, `src-tauri/src/mobile_access.rs`, `useMobileWorkspace`, `mobileWatch` with `tests/mobile/watchFrames.test.ts`), Android permission hardening in `mobile/app.json`, and a CI fix. It also adds an unrelated mock-up, `output/visualizations/search-tool-ui.html`.

## Conflict decisions

| File | Ours | Theirs | Decision |
|---|---|---|---|
| — | — | — | No textual conflicts. No fork commit since `v0.16.0` touches a merged path except the round-16 merge itself. |
| `mobile/app.json` (working tree only) | Uncommitted local WIP: Android `permissions` (RECORD_AUDIO, MODIFY_AUDIO_SETTINGS, FOREGROUND_SERVICE, FOREGROUND_SERVICE_MEDIA_PLAYBACK) and `package` `com.hardbeat920.monocodemobile` | `blockedPermissions` for the same audio/foreground-service permissions, a camera prompt for QR pairing, `enableBackgroundPlayback: false` | Not part of the commit (this file is never committed from the fork). User decision (22 Oct): keep upstream's version, so its `blockedPermissions` win. Only the local `package` id `com.hardbeat920.monocodemobile` was re-added in the working tree. The old WIP stays in `git stash` as "local mobile/app.json before round 17". |

## Post-merge repairs

- None needed for merged code.
- `cargo fmt` drift in fork files `src-tauri/src/interactive_delivery.rs` (L-133 tests) and `src-tauri/src/mcp.rs` fixed by running `cargo fmt` (formatting only), so `cargo fmt --check` passes again.

## Preservation audit (NOTES §0)

- The merge touches no desktop UI file: Composer (Stop button), ModelPicker, TitleBar/menu bar, Sidebar, providers (Antigravity ACP, Cline), queue/steer, terminals, wallpaper settings, hover pill and token metering are unchanged.
- Desktop-side files it changes are upstream's own mobile link code (`mobile_access.rs`, `useMobileWorkspace.ts`, `mobileWatch.ts`); no LOCAL-FEATURES row lives in them.
- No fork file deleted.

## Gates

- `vitest run` + `tsc --noEmit` (`npm run check:web`): 7,680 pass, 2 skipped; tsc clean.
- `npm run build`: pass.
- `cargo fmt --check`: pass (after the fmt repair above).
- `cargo clippy -D warnings`: the same 7 pre-existing lints as round 16 (`harness.rs` ×3, `claude_interactive.rs` ×3, upstream `mobile_router.rs:69`); none in merged code.
- `cargo test --workspace`: 837 pass, 2 fail, 5 ignored in the app crate; `mobile-link` 22 pass. The 2 failures are the macOS-only PATH tests recorded in round 16 (`local_git_never_resolves_login_shell_path`, `read_only_git_cmd_path_adds_fixed_dirs_to_inherited_path`). Run includes L-178/L-179 (see CHANGELOG-04).
- `git diff --cached --check`: clean.

## Manual checks (human, desktop)

1. App starts; Settings → Mobile still shows the pairing QR.
2. With a paired phone: a running chat streams to the phone as it is written, not only at the end of a turn.

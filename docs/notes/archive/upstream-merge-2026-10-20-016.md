# Upstream intake — 2026-10-20 / 0.16.0

Status: conflicts resolved, preservation reviewed, automated gates run (see Gates). Merge staged, not committed; commit, push and the human Windows/phone checks are separate.

## Pinned scope

- New branch: `nakul/windows-support-upstream-0.16.0`, cut from `nakul/windows-support-upstream-0.14.0` at `0358109e` (L-125).
- Upstream: tag `v0.16.0` = `7508feae` (no later commits on upstream main at intake time).
- Common ancestor: `a90c558d` (the 0.14.0 intake point).
- Incoming: 11 commits / 255 paths (~51k lines, mostly the new `mobile/` Expo app and `crates/mobile-link`).
- The 0.14.0 branch is untouched. No upstream writes; pushes go to nakul-fork only.

## What upstream brings

Phone companion (pairing from Settings → Mobile, QUIC link in `crates/mobile-link`, desktop router in `src-tauri/src/mobile_*.rs`, `useMobileWorkspace` in App), sidebar project swipe, context-menu polish, cold-loaded surfaces, Windows IPv4 phone fix, CI changes.

## Conflict decisions

| File | Ours | Theirs | Decision |
|---|---|---|---|
| `Cargo.toml`, `package.json`, `src-tauri/tauri.conf.json` | 0.14.0-local10 | 0.16.0 | Use 0.16.0 in source, as in the 0.14.0 intake. The local release suffix is set at the next installer build. |
| `src-tauri/Cargo.toml` | `toml_edit`; `tokio` with `sync` | `tokio` with `sync, time` moved up, plus mobile crates | Keep `toml_edit`; drop our duplicate `tokio` line (upstream's is a superset). |
| `Cargo.lock`, `package-lock.json` | — | — | Start from ours, regenerate with `cargo metadata` / `npm install`. Adds `qrcode`, `@types/qrcode`, QUIC crates. |
| `src/app/App.tsx` submit guard | Sidechat preflight refusal | App-request busy refusal skips `followsUp` | Keep both checks. |
| `src/app/App.tsx` queue append | `appendQueuedMessage` (usage-limit hold, sidechat, queue durability L-05/L-120) | Inline append using the app-request ID | Keep ours; use `options.appRequestId ?? randomUUID()` as the queued ID, so a retried phone message finds itself queued. |
| `src/app/App.tsx` hooks | Todo manager / Task "Work on…" | `useMobileWorkspace` phone commands | Keep both. |
| `src/app/shell/Sidebar.tsx` root | `data-debug-surface` | `ref={setSidebarRef}` (swipe) | Keep both attributes. |
| `src/app/shell/Sidebar.tsx` tail | Provider-panel branch close | Inset inbox menu | Keep both; menu after our branch close. |
| `AgentTranscript.firstPaint.test.ts` | 5s `waitFor` timeout | Deterministic `warmHistory()` | Take theirs; it fixes the same CI flake properly. |

## Post-merge repairs

- `src/features/mobile/model/mobileAttachments.test.ts`: upstream expects a phone photo to have no saved path. The fork saves a copy of every pasted vision image so its thumbnail reloads after restart (`attachmentFromBlob`). The test now asserts that copy is written; inline data is still checked.

## Preservation audit (NOTES §0)

- No fork file deleted; no provider directory touched (Antigravity ACP, Cline unchanged).
- ModelPicker, Composer, TitleBar not touched by the merge (sizes, Stop button, menu bar unchanged).
- Focus button (L-123) still in ProjectRail, Sidebar, TitleBar headers.
- `stopPty` / lazy terminals (L-125) unchanged; hover pill present.
- Queue durability kept through `appendQueuedMessage`.

## Gates

- `npx tsc --noEmit`: pass.
- `npx vitest run`: 7,563 pass, 2 skipped.
- `cargo fmt --check`: fails only on `src-tauri/src/mcp.rs`, a fork file the merge does not touch (pre-existing; left alone).
- `cargo clippy -D warnings`: fails on pre-existing lints in fork files (`harness.rs`, `claude_interactive.rs`) and one in upstream `mobile_router.rs:69`; none in conflict-resolved code.
- `cargo test --workspace`: 816 pass, 2 fail (`fs::tests::read_only_git_cmd_path_adds_fixed_dirs_to_inherited_path`, `local_git_never_resolves_login_shell_path`). Both came in with the 0.14.0 intake and expect macOS Homebrew dirs in git PATH, so they fail on Windows before and after this merge.
- rustc crashed twice (`STATUS_STACK_BUFFER_OVERRUN`) compiling the app crate; a third run with `CARGO_INCREMENTAL=0` compiled. Intermittent; drive C: had 5.2 GB free.
- `npm run build`: pass.
- `git diff --cached --check`: clean.

## Manual checks (human, desktop)

1. App starts; version shows 0.16.0.
2. Settings → Mobile shows the pairing QR (needs a phone build to pair).
3. Sidebar swipe between projects; Focus button still top left.
4. Queue a message while a turn runs; it survives a restart.
5. Stop a terminal from the process monitor; the tab offers Restart.

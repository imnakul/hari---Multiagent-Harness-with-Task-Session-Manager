# Windows build 0.10.0-local2-upstream-sync

- Built: 2026-10-17 20:55 IST, branch `nakul/windows-support-upstream-0.10.0`, HEAD `6c6a20d7` (plus the version bump in the same commit as this record).
- Version: `0.10.0-local1-upstream-sync` → `0.10.0-local2-upstream-sync` (package.json, package-lock root, Cargo.toml workspace, Cargo.lock, tauri.conf.json all match).
- Contents since the pushed tip: L-85 all accounts usage, L-86 Automations list resize, L-87 code wrap toggle, L-88 linked chats tree, L-89 images in Notes/Tasks, L-75 searchable New task picker, L-90 Add more, L-91 notification center.
- Dirty source at build: none intended (`src-tauri/Cargo.toml` line endings only, restored; `opencode.json` and `.opencode.json.lock` untracked and unrelated).

## Installer
- `E:\Developing\Installable versions\MonoCode_0.10.0-local2-upstream-sync_x64-setup.exe`
- 12,387,402 bytes, SHA-256 `E3287791CDC4087D55EEF50997EB7D7E8481987054F67020D41286FBE113759B` (source and archive equal)
- FileVersion/ProductVersion `0.10.0-local2-upstream-sync`; Authenticode NotSigned (ordinary local build).

## Checks (logs in this folder)
| Check | Exit | Result |
|---|---|---|
| `npx tsc --noEmit` | 0 | clean |
| `npx vitest run` | 0 | 6,901 passed, 2 skipped |
| `cargo fmt --check` | 1 | `session_store.rs` fixed in `6c6a20d7`; `debug_inspector.rs` and `debug_inspector/tests.rs` drift is from `6307cf45` (pre-existing, not touched) |
| `cargo clippy --workspace --all-targets -- -D warnings` | 101 | 3 pre-existing lints: `harness.rs:3581` (421afa74), `claude_interactive.rs:572` (c31abbeb), `debug_inspector/tests.rs:161` (6307cf45). None in files this batch changed |
| `cargo test` | 0 | 756 passed, 5 ignored |
| `npm run build:windows -- --no-sign` | 0 | NSIS bundle produced |
| lint | — | not run (no ESLint config) |

## Manual checklist (desktop)
- Install over the previous version; About/version shows `0.10.0-local2-upstream-sync`; app launches.
- Notification bell: dot, panel, expand, Open chat, dismiss, Dismiss all, automation entries after time away, persists after restart.
- New task arrow: searchable, scrollable list; Add more + Ctrl+Enter.
- Code wrap toggle, nested linked chats, image paste/drop/insert in Notes and Tasks.
- All accounts usage bar and resizable Automations list.

# Remove Antigravity ACP (L-244)

Status: Review — implemented 2026-11-11 07:49 IST; desktop check manual.

## Goal

The user no longer uses Antigravity through Google's ACP runtime (`agy_acp_server`). Its shared runtime started a large tree of MCP servers (about 950 MB) and kept a hidden provider, setup panel and settings around. The user chose to remove it completely, including the `antigravity` harness id ("we don't have any old chat using antigravity ACP").

## Acceptance criteria

- No Antigravity ACP code is left:
  - Frontend: adapter, runtime host, catalog, helper, setup, auth line and their tests; the Providers setup panel.
  - Desktop: `antigravity_acp.rs`, the `agy_acp_server` spawn path and env, the ACP MCP config reader, the auth-URL handler in `main.rs`.
- The `antigravity` harness id is gone from harness, picker, availability, MCP, settings, mobile and protocol lists.
- **Kept:** Antigravity CLI (`antigravity-cli`, `agy`), its MCP config and custom agents, the Activity notes worker (`run_agy`), the `antigravity` **skills** source (`~/.gemini/antigravity/skills`), and `providers/antigravity/antigravityProtocol.ts` (Devin imports it).
- Imported Antigravity conversations (`~/.gemini/antigravity-cli/`) now resume in Antigravity CLI instead of ACP.
- Saved settings that still name `antigravity` load without errors; the value is ignored.
- Typecheck, lint on changed files, vitest and `cargo test` pass.

## Out of scope

- Restoring upstream's own Antigravity provider (L-03 deleted it; it stays deleted).
- Killing an already running `agy_acp_server` process tree (the user ends it from the process monitor).

## Desktop check (manual)

1. Providers lists Antigravity CLI and no Antigravity ACP entry or setup panel.
2. The model picker, Continue, Second opinion and AI helpers offer no Antigravity ACP models.
3. Settings → MCP shows Antigravity CLI servers only.
4. After restart, no `agy_acp_server` process starts.

## Result

- Removed: `src-tauri/src/antigravity_acp.rs`, the ACP paths in `harness.rs` (resolver, probe, launch env, override, tests), the ACP MCP config in `mcp.rs` and `mcp/controls.rs`, the auth-URL handler in `main.rs`; `src/integrations/harness/core/antigravity*.ts` and `AntigravitySetupPanel`; the remote host's ACP support (`host/antigravity.ts`, `host/antigravity-browser.mjs`, `providers.ts`, `server.ts`, `process.ts`, `child-backend.ts`, build and package copies).
- Moved: `antigravity_helper_directory` (the CLI AI helper's empty working folder) to `antigravity_cli.rs`, with its test.
- Imported Antigravity conversations map to `antigravity-cli`.
- Checks: root tsc and vitest (8037 passed); host tsc and vitest (103 passed); mobile tsc and expo lint; `cargo test --lib` (891 passed; 2 macOS-only `fs` tests fail on Windows as before); clippy adds no warnings. The repo has no root ESLint config.
- A remote host running an older build can still list Antigravity ACP; this desktop ignores it because the id is gone.

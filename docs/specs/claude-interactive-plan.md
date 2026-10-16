# Review — Claude Code Interactive

Branch: `nakul/windows-support-upstream-0.10.0`
Base: `6307cf459e6d7e1cb4b66ab4d5b4d6d3853c978a`

## Idea

Offer Claude Code — Structured (existing default) and Claude Code — Interactive
in the composer. Interactive runs the normal CLI in a PTY and retains the
existing chat UI. Claude owns native context; no summary transfer.

## Research

- MonoCode already has Unix PTYs / Windows ConPTY and structured Claude events.
- Orca `main` uses terminal composer ownership, transcript observation and hooks.
  Its terminal draft scanner explicitly distinguishes typed input from placeholders.
- The user's recorded Orca runs show `cli` routing and approximately 1.4% of the
  five-hour quota per API-priced dollar, versus 4–6% in recorded headless runs.
  This is empirical evidence for those runs, not a live measurement of this code.
- Interactive hooks must be local, authenticated, scoped to one process and
  temporary. Never edit the user's global hook configuration.

## Plan

1. Add a local desktop bridge: direct CLI PTY launch, authenticated HTTP hooks,
   bounded incremental transcript reads, explicit approval replies and teardown.
2. Add a Claude transport router without changing provider IDs or storage schema.
   Persist selection in model settings; safely stop the previous transport.
3. Share the live PTY with an embedded terminal. Gate composer submission on an
   empty native prompt, hook readiness and exclusive GUI ownership. Once writing
   begins, uncertain delivery is an error requiring review, never an auto retry.
4. Apply model/effort/permission changes on native resume between turns; settings
   requested for launch are distinct from the model observed in transcript usage.
5. Suppress automatic titles for interactive chats. Keep explicit helpers explicit.
6. Add delivery/lifecycle/protocol tests, run full gates and production build.

## Todos

- [x] Inspect branch, instructions and Orca sources
- [x] Backend bridge and strict native identity
- [x] Interactive adapter, rendering, approval routing and transport ownership
- [x] Composer selection and shared terminal
- [x] Automated verification and fork records
- [ ] Separate human Windows/provider check

## Issues and fixes

The cloud environment initially lacked Rust and Linux desktop libraries. Installed
Rust 1.99.1 and used an isolated Debian container with GTK/WebKit and Git. The first
Rust test run lacked Git (30 unrelated fixture failures); installing Git resolved
all of them. No provider credentials were copied or used.

`cargo fmt --check` finds pre-existing formatting differences in the unchanged
`src-tauri/src/debug_inspector.rs` and `debug_inspector/tests.rs`. All changed Rust
files pass rustfmt. All-target Clippy finds an unchanged needless borrow at
`debug_inspector/tests.rs:161`. These baseline issues were left untouched.

Remote host interactive transport rejects before sending. Attachments, slash
commands and unsupported legacy Thinking/Ultrathink/Ultracode controls use the native
terminal. Operator/orchestration and isolated text helpers require Structured.
On Windows, interactive launch requires the native `claude.exe`; `.cmd`/`.bat`
launchers reject with a clear Settings instruction. Structured launch is unchanged.

## Learnings

- SessionStart is insufficient to authorize terminal input. The actual VT cursor,
  empty framed composer, placeholder attributes and dialog/busy state are checked.
- Hook acceptance, not a successful PTY write, acknowledges delivery. A process-local
  submission ledger rejects repeated attempt IDs. An uncertain write pauses the
  existing app queue and requires explicit review; it never resends itself.
- Frontend cancellation epochs fence asynchronous discovery and startup; backend
  lifecycle locking makes Stop wait for an in-progress spawn and kill its owner.
- Permission replies use authenticated per-process HTTP hooks, never typed approval
  text. AskUserQuestion uses PreToolUse updatedInput; terminal takeover releases
  hooks to the CLI. Timeout/cancellation resolves stale UI prompts.
- Model/effort/Fast changes apply by stopping and natively resuming between turns.
  Launch selections are requested settings, not claimed provider confirmation; the
  native terminal shows applied state and replies carry the observed model.
- Automatic AI titles and automatic worktree branch naming are suppressed. Existing
  local titles/temporary branch names remain; explicit Git helpers are separate.
- No global Claude settings are edited. Named accounts preserve secure-storage
  isolation and remove inherited token overrides, as the structured adapter does.

## Done

User authorized publishing all changes on 2026-10-16. Publish to the requested
`nakul/windows-support-upstream-0.10.0` branch; the final pre-commit web/TypeScript gate passed (6,788 tests / 614 files).
No installer is requested.

Local development with separate MonoCode data:
```sh
git switch nakul/windows-support-upstream-0.10.0
git pull --ff-only
npm ci
npm run tauri:dev-profile
```
This uses `com.monocode.desktop.dev` / MonoCode Dev for app data and webview
storage. Default Claude/Codex login, native transcripts and quota are provider-owned
and remain shared. Select Claude Code — Interactive in the composer. On Windows,
use the native `claude.exe` and have the Rust/MSVC desktop build prerequisites installed.

Automated evidence:
- Final pre-commit full web suite: **6,788 passed / 614 files**; TypeScript clean.
- Production web build and host build passed. Existing CSS/chunk-size warnings remain.
- Final targeted suites: **194 passed / 6 files**, including **24 new interactive
  cases**; TypeScript passed. Production-target Clippy passed; all-target Clippy has
  the unchanged Debug Inspector test warning described above.
- `cargo check --workspace` passed; full Rust tests **749 passed, 2 ignored**.
- Six new Rust tests cover hook contracts, real loopback permission exchange,
  atomic request identities, bounded events and account-scoped transcript paths.
- CLI **2.1.301** installed into a temporary probe directory: `--help` confirms
  default interactive execution and resume/session/effort/settings flags;
  `--permission-mode default --version` succeeds. No signed-in model turn was run.

Separate human desktop/provider checklist (`npm run tauri dev`):
1. Choose Claude Code — Interactive. Complete CLI setup/trust in the shared terminal
   if needed. Send multiline messages and confirm exactly one accepted prompt each.
2. Approve/deny a real tool, answer a question, and transfer an interaction to the
   terminal. Close menus/clear drafts and Return to chat. GUI sends must not enter menus.
3. Change model, effort and Fast between turns. Confirm applied settings in the
   native CLI and observed reply model; native session ID must remain unchanged.
4. Stop during startup, streaming and a pending approval. Resume, switch to Structured
   and back, and restart the app: no duplicate prompt or second conversation owner.
5. Check Windows native-executable discovery, ConPTY output/replay, resize/remount,
   named-account resume and no console flash. Try native attachment/path inputs.
6. Repeat the measured terminal workload with no other model activity; record quota
   before/after, route, requests, model/effort, duration and API-priced usage. Compare
   with the supplied Orca evidence. Automated tests do not establish quota equivalence.

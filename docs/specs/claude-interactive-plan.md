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

Fourth report (2026-10-17): the user cannot follow the diagnostics request
because the terminal action disappears after several minutes. The registry
unconditionally schedules its five-minute child parking timer when a send
rejects with attention; parking stops the interactive owner, disposes the VT
screen and deletes the only diagnostic snapshot. The picker also hides exited
terminals. Small lifecycle repair: give providers an explicit idle-parking veto,
retain native interactive owners until an explicit stop/detach, preserve bounded
metadata reports after Stop, and expose reports independently of a live terminal.
Reproduce the five-minute failure through the production registry/Claude adapter
and real VT parser, then verify no resend and report access after stop/exit.
This repairs disappearing recovery evidence; the first-send prompt mismatch and
automatic `c` reported in Windows remain unconfirmed. Do not erase terminal
drafts or treat a later ownership snapshot as proof of that startup cause.

Reproduction uses the production registry, Claude transport router, real xterm
and production PTY subscriptions, with only desktop IPC replaced. A synthetic
draft blocks the first send; advancing the registry's real five-minute deadline
then killed the process and deleted the evidence on the old source. The repaired
provider veto prevents that stop; a ten-minute fake-clock wait retains the same
owner and report without sending anything. Native exit retains its screen/report;
explicit Stop retains up to 50 metadata-only reports per window, and Forget clears
the report. The existing picker offers View startup diagnostics after disposal;
copying this report starts no provider. This does not recover evidence already
discarded by an older version or a window restart, and is not a reproduction of
the automatic Windows `c`. Web regression/check/build results follow in the changelog.

Repair after the first Windows trial (2026-10-16): user reported a readiness
timeout, a dead terminal panel attached to the composer, and a native black
execution select. Real CLI 2.1.301 startup captured with an isolated local fixture
reproduces an undimmed `Try "…"` placeholder. The old gate rejected that valid
prompt; App failure cleanup then killed the owner and disposed its output.
The loopback CLI trial also emitted UserPromptSubmit and Stop but **no HTTP
SessionStart**. The old backend remained in `starting` forever. Startup now uses
successful PTY creation plus the framed empty-prompt check, and native acceptance
establishes the resumable binding. Setup/menu attention uses a typed error so App
failure cleanup retains the owner, including uncertain-delivery faults that need terminal review before Stop/resume. Early exits surface their exit code promptly.
Resizing waits for spawn acknowledgement. AskUserQuestion HTTP hooks now allow the same human-response window as approvals (600s, exceeding the server's 590s wait). The existing model picker contains the
execution choices in both layouts; native terminal access is an explicit modal
action, with Escape available to native menus. No terminal mounts by default.

Actual CLI 2.1.301 ran in a Linux PTY with a temporary trusted project/config,
a fake local-only key, the production hook/launch arguments, and an Anthropic
response fixture served on loopback. One bracket-pasted multiline prompt produced
exactly one UserPromptSubmit, a Stop hook, and one native assistant transcript
reply. Two local API calls occurred (including CLI startup activity); no external
model was contacted. Captured raw VT startup/completed output and native message
rows are committed as a regression fixture. This validates CLI/protocol behavior;
it does not replace signed-in Windows/Tauri or subscription-meter verification.
Repair automated gates and publication are recorded below.

Second Windows trial repair (2026-10-16, after `5e7056a`): the captured CLI
startup itself enables focus reports (`CSI ? 1004 h`). Real xterm immediately
emits `CSI O`; the old public-onData classifier mislabeled it as human typing,
set terminal ownership and refused the first GUI send within a second. The prior
fixture tests asserted screen readiness but never input ownership; the adapter
unit tests mocked xterm out, so neither caught their interaction.

Orca comparison rechecked against fork GitHub main `1855ba4`: its terminal path
uses xterm's onUserInput provenance, keeps passive focus/query replies separate
from driving input, and covers the terminal with the chat surface. Repair:
use the same provenance distinction with a checked xterm contract; exercise the
production adapter plus actual xterm and PTY event routing; hide terminal access
until a process exists, with no empty prelaunch dialog. Combined tests caught stale byte counters across fresh process starts using the
same PTY ID. A fresh-stream subscription now resets only replacement owners;
ordinary view reattachment retains buffered output. Two turns plus a third after
Stop/native resume passed through the production frontend adapter/xterm/PTY
subscription path against real CLI 2.1.301 in both supervised and Full access.
The real CLI tests replace desktop IPC with a thin Unix PTY test host and use a
loopback API, temporary fake account, and pre-accepted fixture setup/trust. They
do not validate the Rust/ConPTY boundary or signed-in Windows/Tauri GUI. No native
UI automation was used. Full web/build gates are recorded in the changelog.

Third Windows report (2026-10-17, after `ff4717c`): the user still sees the
20s readiness timeout. A fresh chat is not a diagnosis. Requested the current
native terminal state; do not claim the exact session blocker until observed.
Source review found a real ConPTY output defect: its blocking reader accumulates
small reads, but checks the 8ms flush deadline only when another read completes.
A final query/prompt chunk can remain buffered indefinitely while the child waits
for input; the Unix path has an idle poll flush and the prior Unix test host did
not exercise this Windows reader. Plan: use a bounded reader channel and timed
flush for ConPTY, test delivery before more data/EOF, retain the 8ms event budget,
and report bounded readiness metadata on failure without storing terminal text.
Keep prompt safety gates and explicit setup decisions intact. The user reports a normal empty native prompt after opening the terminal. This confirms a bridge failure; the pre-open readiness state remains unknown. Signed-in Windows verification is separate from the open-pipe test.

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
1. Open the existing model picker and choose Interactive. If needed, choose Open native terminal there to complete CLI setup/trust
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


### Repair verification (2026-10-16)

- Captured CLI startup/completed screens pass the real xterm gate; transcript
  fixture renders the native reply. Delivery tests omit HTTP SessionStart,
  retain setup owners for retry, and surface early exits without a 20s delay.
- Both picker layouts expose styled execution choices; composer mounts no native
  select or terminal by default. Terminal modal lets Escape reach native menus.
- Final `npm run check:web`: **6,797 tests / 615 files passed**, strict TypeScript
  passed. Production web and host builds passed.
- Final Rust workspace check and production-target Clippy passed; full workspace
  tests **749 passed / 2 ignored**. Changed Rust file passes rustfmt. Whole-tree
  fmt and all-target Clippy still report only the unchanged Debug Inspector
  formatting / needless borrow described above.
- Rust's unchanged `kill_all_reaps_term_ignoring_children_before_return` failed
  once in the first parallel full run, then passed alone and in the full rerun.
- Manual: first/second signed-in Windows chat turns, setup/menu recovery, native
  resume, approvals/questions and applied controls; quota comparison as above.


### Second repair verification (2026-10-16)

- Final full web check **6,803 passed / 617 files**, including both opt-in real
  CLI cases; strict TypeScript and production web/host builds passed. Existing
  CSS optimizer/bundle-size warnings are unchanged. No Rust source changed.
- The test IPC host initially read the announced transcript before creation,
  causing an ENOENT in one full-suite CLI case. It now waits for initial creation,
  matching the native backend's existing safe-transcript behavior; the final
  complete run passed. This was a test-host defect, not a production-code change.
- Orca fork GitHub main verified at `1855ba49ba1c8c4eb314ba02dbc920acb1094b31`;
  source inspection only, with no changes to that repository.
- Native human follow-up: a fresh Windows interactive chat, two GUI messages and
  Stop/resume. No terminal action should be needed for an already configured CLI.
  Login/trust prompts, if present, remain explicit setup; tests used fixture setup.


### Windows output repair verification (2026-10-17)

- The old Windows read loop was reproduced against a blocking open pipe: its query
  stayed buffered beyond 50ms despite the 8ms budget, then appeared only after a
  second write. The production replacement pump passes open-pipe query/prompt
  delivery plus EOF byte-preservation tests without changing Unix's reader.
- Rust workspace check, production-target Clippy and **751 tests / 2 ignored**
  passed in the Debian build environment. Changed Rust files pass rustfmt.
  Whole-tree format/all-target Clippy still report the unchanged Debug Inspector
  formatting/needless-borrow exceptions recorded above.
- Frontend tests cover missing output, incomplete frame checks, metadata-only
  snapshots and retaining the blocked snapshot after the prompt becomes ready.
  Existing real CLI supervised/Full access tests passed during the full run.
- Final full web check **6,804 passed / 617 files**, including both opt-in real CLI cases; strict TypeScript and production web/host builds passed. Existing CSS optimizer/bundle warnings remain.
- User reports an empty native prompt after opening the view. Asked whether
  Return to chat accepts that prompt; no answer is assumed. The exact pre-open
  session state and signed-in ConPTY/Tauri behavior remain unverified here.
- After pulling, fully restart the native Tauri dev backend before retrying the
  existing chat. A new chat alone does not load this Rust change. If an empty
  prompt is still rejected, Copy diagnostics preserves both blocked and current
  readiness metadata without prompt/screen/account data.

### Lifecycle repair verification (2026-10-17)

- The five-minute disappearance is reproduced through the registry/Claude router
  and real VT parser; the repaired source retains the failed owner past ten fake
  minutes without an attempted prompt write. Another test rechecks the provider
  veto at timer expiry and verifies ordinary parking resumes when permitted.
- Stop/exit report access, Forget cleanup, both existing picker layouts and the
  actual composer-to-report/clipboard path pass regression tests. No Rust source
  changed. Final full web suite **6,811 tests / 618 files passed**, including both opt-in real CLI cases; strict TypeScript and production web/host builds passed. Existing CSS optimizer/bundle warnings remain.
- Human Windows follow-up after updating: send once in the same MonoCode chat.
  If startup fails, open the model picker, Open native terminal, then Copy
  diagnostics before using the terminal or retrying. Paste the copied JSON.
  If the process has stopped, View startup diagnostics opens the retained report.
  A window restart or Forget clears in-memory evidence, so an older lost report
  needs one new failed attempt after updating. The original Windows first-send
  mismatch/automatic `c` remains open; this repair does not claim its cause.

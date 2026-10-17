# Review — Interactive lifecycle, actions and owned-process monitor

Branch: `nakul/windows-support-upstream-0.10.0`
Base: `8bcf6db6a99699f8b67f1c0a5c998ea01bebfa4a`

## Idea

Keep normal Claude Interactive chat seamless, reduce idle work, add existing UI
actions, and expose an optional monitor for processes MonoCode owns. This is a
Large change. Preserve native context, single ownership and send-once safety.

## Research

- The screenshot's `claude-notify.ps1` failure belongs to an inherited command
  hook. MonoCode installs an HTTP Stop hook and preserves user/project hooks.
  Do not erase those settings or silently suppress their failures.
- `Notification` is currently rendered as a chat status without distinguishing
  `idle_prompt`; normal waiting at an empty prompt is not an unresolved question.
- Local CLI is 2.1.301; Windows regression pins 2.1.302. Actual installed help
  advertises `--fork-session` with `--resume`/`--continue`, `--session-id`,
  `--setting-sources` and `--system-prompt-snapshot`. Preserve default setting
  sources and prompt behavior on normal resume. No `/model` or `/effort` sends.
- Real CLI 2.1.301 loopback probes verify `/compact`, full-history native fork
  with `--resume --fork-session --session-id`, text/image Read tools and background
  continuation. `--resume-session-at` is accepted but ignored in Interactive mode,
  including before compaction. Never send it or claim a historical native cut.
- Main system/tool request prefixes match before/after native resume in the probe.
  The CLI also makes its own naming/helper calls; these are counted separately in
  the fixture, not confused with root turns or MonoCode's disabled title helper.
- Background Bash reports `PostToolUse.tool_response.backgroundTaskId` and root
  Stop includes `background_tasks` and `session_crons`. Completion emitted a
  task-notification UserPromptSubmit on 2.1.301; regression also covers no such hook.
  A notification racing old-turn drain must not fail an already accepted prompt.
- Installed hook names include SubagentStart/Stop and TaskCreated/Completed;
  TaskStarted is absent. Background Bash completion was verified in real probes.
  Unknown coverage/work is a reason to skip shutdown, never assume nothing runs.
- Stats dependency comparison: existing windows-sys/libc needs no new crate and
  minimizes dependency size, but requires per-OS maintenance. sysinfo 0.39.6 is
  MIT, supports Windows/macOS/Linux, requires Rust 1.95 and downloads ~235 KiB
  compressed source; executable size impact is unmeasured. Process-only features
  avoid unrelated sensors/disks. User asked before any crate addition; User chose existing native APIs after comparison; add no new crate.

## Plan

1. Filter ordinary idle notifications; preserve genuine approval/question UI and
   report inherited hook errors without editing global settings.
2. Add buffered background/continuation observation and adaptive polling: 200ms
   for activity, interactions and drains; ~1500ms once idle. Sends/replies wake
   immediately. New assistant activity without UserPromptSubmit starts an external
   turn and renders/finishes normally. Sequence gaps remain errors.
3. Add configurable 5–60 minute idle shutdown (default 15). Require empty native
   input, GUI ownership, no pending turns/interactions, complete observation,
   inactivity throughout the interval and no known/uncertain background work.
   Recheck backend activity/sequence/transcript tail/phase before existing teardown.
   Conservatively skip on unknown CLI/background coverage or live tool children.
   Automatic coverage is enabled only for probed 2.1.301/302. Missing Stop arrays,
   scheduled jobs, detached shell patterns and MCP work veto shutdown. Recheck a
   denied automatic park at most once/minute. Native Stop still retains UUID.
   Model/effort/Fast restarts and Compact also wait for known background work.
   Serialize parking with a new send; keep the native binding and resume UUID.
4. Attachments: persist images/text files under app-owned session storage and add
   quoted absolute references to the native prompt. No automatic resend; compare
   native acceptance against the exact expanded prompt. Retain files for native
   resume/forks; no shell quoting or execution. Unsupported attachments fail early.
5. Fork latest native history with verified fork/resume/new-UUID flags. Earlier
   GUI turns retain the existing explicit copied-context branch fallback; reject
   supplied historical cuts before launch. Skip copied native history until the
   target's first accepted input. Ask in sidechat reuses its existing source-context
   snapshot and opens a separate Interactive owner with the same account/model/
   effort. This preserves the sidechat's live source refresh and keeps the parent
   conversation independent, without an extra SDK/headless request.
6. Compact: existing Compact action / exact allow-listed `/compact` only, through
   the same owner. Observe real compact lifecycle; never require UserPromptSubmit
   for a native slash command. Other slash/control commands remain blocked.
7. Add process roots from existing owned child/PTY registries, tree metrics and
   generation-safe samples. Never accept arbitrary PID kill requests. CPU is a
   delta normalized to machine capacity; memory is working set/RSS. Deduplicate
   shared descendants in totals. Label/group owners using existing chat/project
   metadata. Per-row Stop uses existing chat/terminal stop handling; Stop all idle
   uses conservative provider eligibility rather than interrupting background work.
   Bulk stopping rechecks settled output and current idle state; terminal shells and
   unidentified helpers require explicit per-row Stop. Structured bulk stop gets
   a fresh process snapshot and chat-state check; Interactive uses backend park.
8. Add a default-off Experimentation setting and bottom-bar chip/popover. No
   sampling/timers/IPC while disabled. Chip polls ~10s; open popover ~3s, no
   overlapping requests. Show loading, empty, exited and unavailable states.

## Todos

- [x] Read instructions, trace current notification/hooks and check installed help
- [x] User chose existing native APIs; no new crate
- [x] Native compact/fork/background completion probes recorded
- [x] Notification and autonomous-turn regressions
- [x] Adaptive polling and conservative idle shutdown/settings
- [x] Attachments, fork, sidechat and compact through existing UI
- [x] Owned-root stats, grouped monitor and safe stop actions
- [x] Full web/TypeScript, Rust checks/tests/Clippy and builds (baseline exceptions below)
- [ ] Native Windows regression covering new supported actions
- [x] Fork records, normal authorized push and remote SHA verification
- [ ] Separate human desktop/signed-in/cache usage checks

## Issues and fixes

Preserve existing hooks: the failing PowerShell file is
outside this repository on the user's machine. Fix its misleading idle status
here; document what the inherited hook failure means rather than editing
unavailable user configuration. The generic 5-minute registry parking veto remains; the new Interactive policy
owns the stricter 5–60 minute native shutdown path.

The first Windows action run (39017396800, source 421afa7) passed backend,
metrics, normal messages, native resume/fork and compact in the captured Windows scenario, then
left the attachment-reference prompt as `[Pasted text #1 +4 lines]`. The fixed
120ms Enter arrived before the CLI attached the paste. The correction uses a
shared Rust 500ms settling window plus byte-dependent ingest time (64B/ms on
ConPTY, 4096B/ms elsewhere), with no cap and still one Enter. Native fixtures
query that production calculation and assert ordinary accepted prompts exactly
match sends. Uncertain delivery is never retried or erased.

Run 39018068301 passed both full-access scenarios, but supervised Windows still
left the attachment paste editable. A fixed minimum alone is insufficient.
Use Orca's additional 1.5s output-quiet gate after the ingest minimum, requiring
new native output since the paste and failing closed after eight extra seconds.
Production and the Windows host share the gate; passive parser replies stay live.
No second Enter, erase or automatic retry is introduced.

The quiet gate alone also fails supervised Windows (39026195881). Orca marks
Claude as needing a typed request outside a folded paste. Preserve the exact
message by typing one alphanumeric character from it and framing the preceding
and remaining text as paste blocks, in one write. Test long/Unicode/leading
whitespace messages and exact native acceptance; no invented lead instruction.
The native editor expands tabs to four spaces; normalize that before delivery
instead of falsely treating indentation as a different accepted prompt.

A loaded native probe also delivered Stop before its final JSONL flush. Require
the hook's `last_assistant_message` to be rendered before completing that turn.
Keep an autonomous Stop until its assistant arrives, even without a submit hook;
otherwise a late reply becomes a stuck, false external turn. Both orders have
regressions, and native probes exercise the real flush behavior.

Run 39027302518 passed all seven expanded ordinary messages on Windows, but
long-history fork startup omitted the native input row entirely (captured VT
has a wrapped border and no prompt). Request one geometry repaint after settled
startup mismatch, synchronize xterm/PTY sizes, and reapply unchanged readiness
checks. No input clearing, keys, prompt retry or weakened frame recognition.

The first repaint web run passed 6,842 tests but failed the unchanged
FilePaneNavigation blur case (selection 24 versus 1) under concurrent native/
build load. Its files are unchanged and the isolated nine-case rerun passes;
the full rerun without other heavy local work passes all 6,843 tests. No editor changes.

39028767023 proves the width-only repaint reproduces the omitted input. The
opt-in Windows fixture now records five safe geometry/screen probes on failure
and rethrows. Use their results to choose a recovery; do not weaken readiness.

All five geometry probes fail the complete frame check. Local native tests
still pass with CI/GITHUB_ACTIONS enabled. Orca/node-pty uses only the inherit-
cursor creation flag, while portable-pty additionally sets resize-quirk and
Win32-input flags. Add an explicit creation option keeping defaults unchanged,
then A/B flags=1 in the isolated Windows host before choosing production behavior.

Flags=1 also fails on both runners (39029751814). Compare node-pty 1.1.0's
actual bundled ConPTY runtime next, with the same frontend and scenario. The
diagnostic host uses Orca's primary-device response and inherited-cursor handling;
its package is temporary, install scripts are disabled, and no app dependency is
added. Keep the original job failure so an oracle pass cannot mask a product failure.

39030559003: bundled node-pty restores the long fork and its full-access case
passes completely. Supervised retains `R[Pasted text…]` after compact: the lead
is present, but one letter is insufficient. Probe a bounded full first-line
lead. Correction to the earlier flag assumption: node-pty's inherit-cursor
option defaults false and Orca leaves it unset. Compare system flags=0 without
a pre-answer (normal frontend query replies) and bundled ConPTY with that same
setting before changing production. No new app package, DLL or Rust crate yet.

## Learnings

CPU/crate size comparisons must distinguish archive size from actual executable
growth. Native event names are version-specific; do not invent TaskStarted.
Native CLI tests use fake credentials and local replies, never subscription quota.
The Linux Rust process suite needs a container init/reaper (`docker run --init`);
PID 1 as sleep left orphan zombies and produced unrelated cleanup failures.

Latest local gate: 6,843 web tests passed / 619 files, including the captured repaint and both completion races (two opt-in CLI cases
skipped in that run and passed separately on 2.1.301). Strict TypeScript,
production web/host builds, Rust check and production Clippy pass. Rust: 761
passed / two ignored in the corrected container. Windows fixture all-target
Clippy and macOS metrics cross-check pass. Full Rust fmt/test Clippy still hit
unchanged debug_inspector formatting and needless_borrow at tests.rs:161.
Expanded real 2.1.301 loopback probes count 17 API requests / 15 primary requests per permission
mode: two native naming/helper requests, not extra MonoCode title requests.
System/tool prefixes match across a resume with a changed hook URL; fork target
UUID matches the actual native hook identity. Desktop quota/cache meters remain
human checks.

## Done

Feature `421afa7` and paste-minimum correction `8c58290` are published on the
authorized branch. Windows runs 39017396800 and 39018068301 exposed the paste
timing issues above; the output-quiet correction's rerun is recorded after
completion. No installer/version changes requested. Human desktop UI is a
separate follow-up; do not drive the native window from this implementation session.

Human check: use `npm run tauri:dev-profile` (separate app data, shared CLI
account), enable the monitor in Experimentation, try Stop/resume and the new
actions, then compare signed-in prompt-cache/quota behavior within an hour.

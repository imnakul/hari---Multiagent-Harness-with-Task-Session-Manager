# Changelog 04 — MonoCode Windows fork

## 2026-10-17 — Explicit all-account usage refresh always fetches (L-85)
- What: The footer's manual Refresh silently skipped successful snapshots younger than five minutes in all-accounts mode, while selected-account mode forced a read. Explicit Refresh now fetches every configured account including overflow, sequentially with 750ms spacing; repeated clicks stay disabled until completion. Failed reads retain the last snapshot with an error state and permit retry. Automatic polling keeps its existing freshness floor; provider fetch/credential behavior is unchanged.
- Files: `UsageFooter.tsx`, `UsageFooterAllAccounts.test.ts`; remove the obsolete manual-freshness helper and its unit tests from `allAccountsUsage.ts`/tests; L-85/spec records.
- Verified: both new manual-refresh integration regressions fail before and pass after the fix; 76 focused usage/cache/polling tests pass, along with the combined 6,950-test full web suite, strict TypeScript and production build. This fixes a proven skipped-read path, not a guarantee that the provider's own quota endpoint has already updated.
- Commit: combined follow-up with the native-suggestion fix on the authorized 0.10.0 branch.

## 2026-10-17 — Disable hidden native follow-up suggestions for Interactive chat (L-82)
- What: User screenshots and diagnostics show a faint native follow-up at the empty ConPTY prompt, which the draft guard correctly refuses. Disable `promptSuggestionEnabled` only in this Interactive CLI's existing per-launch settings, including resume/fork; keep the user's global preferences and strict draft/menu/ownership checks. No automatic clearing, submitting, MCP changes or user-hook removal. Diagnostics revision: `2026-10-17-no-native-suggestions`.
- Files: `src-tauri/src/claude_interactive.rs` launch setting/test; frontend revision; terminal guard and isolated native-CLI fixture tests; L-82 and `interactive-prompt-suggestions.md` records. No new dependency, CLI flag, installer or version change.
- Verified: installed CLI 2.1.301 schema and `--settings` help checked; 54 focused Interactive tests, nine Rust bridge tests, cargo check, changed-file rustfmt, TypeScript and production build pass. Both isolated real CLI permission cases pass and retain the temporary user's saved suggestion preference. The combined full web rerun passes 6,950 tests; an unchanged editor blur test failed in the earlier run and passed isolated/full reruns without edits. Workspace rustfmt still reports the documented pre-existing Debug Inspector drift. Human Windows check remains: rebuild/restart, send a second message after a reply, and verify a genuine native draft still blocks delivery.
- Commit: this follow-up on the authorized 0.10.0 branch, based on 82d12f2c.

## 2026-10-17 — Correct native pasted-content closing tags (L-82)
- What: The earlier duplicate-turn/timing fix used a plain closing tag in its fixtures. The installed CLI repeats the paste ID in the closing tag; that valid echo was still rejected as different input. Match native same-ID closing tags and their trailing-newline convention while requiring every body/attachment path to remain exact. Keep the original GUI boundary and full duration; no resend or timer-only workaround. Rebuilt diagnostics use `2026-10-17-native-paste-close-id`.
- Files: `claudeInteractivePrompt.ts`, matching and image/text attachment lifecycle tests; `claudeInteractive.ts` diagnostics revision; L-82/spec records. No Rust, dependency, CLI flag, installer or release version changes.
- Verified: native-format matcher and lifecycle regressions fail before and pass after the correction; 71 focused and 6,950 full web tests pass (two opt-in cases skipped there), strict TypeScript and production build pass. Both opt-in real CLI smoke cases pass separately; that fake account uses unwrapped echoes, so signed-in Windows wrapping remains a separate human check. The user confirmed the reported failure used a rebuild after 8f36e078. Rebuild and send a new long prompt with an attachment; old saved duplicates are not rewritten.
- Commit: this follow-up on the authorized 0.10.0 branch, based on c4288b21.

## 2026-10-17 — Include Antigravity CLI in all-accounts usage (L-85)
- What: All-accounts usage now includes the installed, visible Antigravity CLI's saved account across chats. Reuse its existing separate quota/credits chip, binary-scoped cache and manual/automatic refresh; do not invent managed account profiles or borrow a family quota from another provider's active model. Selected-only behavior remains when the experiment is off.
- Files: `src/app/shell/UsageFooter.tsx`, `AntigravityCliUsage.test.ts`; L-85 feature and spec follow-up records. No native code, dependency, installer or version changes.
- Verified: 14 focused footer tests and 6,937 full web tests pass (627 files passed, one opt-in native CLI file skipped); strict TypeScript and production build pass. Manual: enable All accounts usage with Antigravity CLI installed and visible, then inspect its quotas/credits while another provider's chat is selected.
- Commit: this fix on the authorized 0.10.0 branch.

## 2026-10-17 — Refresh account usage automatically on the foreground cadence (L-92)
- What: Match Orca's normal 15-minute poll and five-minute stale-on-activation timing for selected/all-account footer usage, Settings Accounts and open account pickers. Pause while hidden/unfocused, stagger accounts by 750ms, cancel obsolete queues and join shared in-flight reads without queuing extra forced fetches. Existing quota fetch paths and manual refresh remain; no chat prompts, dependencies, Rust, installer or version changes.
- Files: `useRateLimitsPolling.ts` and tests; `rateLimitsCache.ts`, `accountUsage.ts`, footer wiring and account-view/footer regressions. The shared stagger constant also preserves existing initial-load pacing.
- Verified: 85 focused tests, 6,932 full web tests / 628 files (two native CLI opt-in skips), strict TypeScript and production build pass. Account-hook fixtures now use a fixed clock so an old test snapshot is not accidentally treated as a month-old reading on remount. Desktop foreground/minimize behavior remains a human check.
- Commit: automatic-usage follow-up on the authorized 0.10.0 branch.
## 2026-10-17 — Keep folded Interactive prompts and their timer in one turn (L-82)
- What: Recognize Claude's pasted-content representation only when every typed/pasted part exactly matches the pending composer prompt. Keep the original message and turn start; no duplicate external turn, early completion or resend. Different/truncated input remains unconfirmed. Freeze genuine terminal/background turn durations at their own completion without ending concurrent local work.
- Files: `claudeInteractivePrompt.ts` and tests; `claudeInteractive.ts`; session reducer `apply.ts` and external-duration tests; adapter/session lifecycle regression; expanded native CLI probe and a separate Windows messages-only check.
- Verified: 135 focused tests and strict TypeScript pass. Both actual CLI 2.1.301 loopback scenarios pass with the longer multiline prompt; this fake-account CLI does not wrap that prompt, so the supplied Windows wrapper shape is separately covered by deterministic regressions. Full web: 6,921 passed / 627 files (two opt-in skips), production web and host builds pass; targeted native Windows long-paste/single-turn checks pass on 2022/2025 in both permissions (39049439898, source 8f36e078). The broad actions run and human UI verification remain separate. No Rust, dependency, installer or version changes; earlier long-history Windows startup and supervised attachment failures remain separate.
- Commit: this fix on the authorized 0.10.0 branch, based on release 757daab4.
## 2026-10-17 20:55 IST — Windows build 0.10.0-local2-upstream-sync
- Type: chore
- What: New Windows installer with L-85 to L-91 and the New task picker change; version bumped from local1.
- Files: `package.json`, `package-lock.json`, `Cargo.toml`, `Cargo.lock`, `src-tauri/tauri.conf.json` (version); record [windows-0100-local2-upstream-sync-build](../notes/windows-0100-local2-upstream-sync-build/README.md)
- Commit: see git log (version + record commit)
- Verified: tsc ✅ tests ✅ (6,901) cargo test ✅ (756) build ✅; clippy ❌ and fmt ❌ only on pre-existing files (listed in the record); manual: desktop checklist in the record.

## 2026-10-17 20:39 IST — Notification center (L-91)
- Type: feature
- What: A bell next to the minimize/maximize/close buttons shows a dot when something new happened. Click it to see every chat reply, approval, question and automation run since you looked, with project, model and time. Click a card to read it all or open the chat; hover to dismiss it, or clear everything with the X.
- Why: Coming back after a while, there was no single place showing what finished.
- Files: `src/features/notifications/model/notificationCenter.ts` (new), `notifications.ts`, `src/features/notifications/ui/NotificationBell.tsx` (new), `src/app/shell/WindowControls.tsx`, `src/app/App.tsx`, `src/shared/ui/icons.tsx`; tests `notificationCenter.test.ts`, `NotificationBell.test.ts`; spec `docs/specs/notification-center-plan.md`
- Commit: 74df4335
- Verified: tsc ✅ tests ✅ (6,901 passed, 2 skipped); lint not run (no eslint config); desktop check manual.

## 2026-10-17 20:39 IST — Add more tasks quickly (L-90)
- Type: feature
- What: The task editor has an "Add more" toggle. While on, Ctrl+Enter saves the task and starts a new one in the same project.
- Why: Adding many tasks in a row needed Ctrl+Shift+Enter or the mouse.
- Files: `src/features/tasks/ui/TaskEditor.tsx`; `TasksView.test.ts`
- Commit: 737178d1
- Verified: as L-91.

## 2026-10-17 20:39 IST — New task picker uses the project search list (L-75)
- Type: fix
- What: The arrow beside New task now opens the same searchable, scrollable project list as All projects.
- Why: It used a different-looking menu.
- Files: `src/shared/ui/SearchableSelect.tsx` (icon variant), `src/features/tasks/ui/TasksView.tsx`; `TasksView.test.ts`
- Commit: 737178d1
- Note: Remote Control is not offered for Interactive CLI chats: that mode is a terminal with no control channel to start it or read its link. Type `/remote-control` in the terminal instead. Left as is.
- Verified: as L-91.

## 2026-10-17 20:18 IST — Images in Notes and Tasks (L-89)
- Type: feature
- What: You can paste a screenshot, drop image files, or click Insert image in both Notes and the Task editor. The image is saved and placed where your cursor is. Deleting a task also deletes its images.
- Why: Images worked only by dropping files into Notes; Tasks had no way to add them.
- Files: `src/features/notes/ui/useMarkdownImages.tsx` (new shared hook, overlay, button); `NotesView.tsx`; `TaskEditor.tsx`; `MarkdownDetailTabs.tsx` (`actions` slot); `noteImages.ts` (messages); `src-tauri/src/tasks.rs`, `notes.rs` (task image cleanup); `useMarkdownImages.test.ts`
- Commit: 070d7322
- Verified: tsc ✅ tests ✅ (6,892 passed, 2 opt-in skips) cargo test ✅ (756); lint not run (no eslint config); desktop check manual.

## 2026-10-17 20:18 IST — Linked chats nest under their source (L-88)
- Type: feature
- What: Forks, sidechats and second opinions now appear indented under the chat they came from, with a small label. An empty sidechat is no longer lost when you close it.
- Why: Related chats were scattered in the list, and sidechats with no message disappeared.
- Files: `src/features/sessions/model/sessionLinks.ts` (new); `src/app/shell/Sidebar.tsx`; `src/app/App.tsx`; `src/features/sessions/data/sessionStore.ts`; `src-tauri/src/session_store.rs`; `sessionLinks.test.ts`
- Commit: 0fffd479
- Decision: links kept in localStorage to avoid a sessions schema migration; losing them only flattens the list. Nested folders deferred (large change to the folder model).
- Verified: tsc ✅ tests ✅ cargo test ✅; desktop check manual.

## 2026-10-17 20:18 IST — Wrap toggle on chat code blocks (L-87)
- Type: feature
- What: Each code block in a chat has a wrap button next to Copy, so long lines can scroll sideways instead of wrapping.
- Why: Request to control code wrapping in chat.
- Files: `src/features/sessions/ui/AgentMarkdown.tsx`, `HighlightedCodeBlock.tsx`, `src/styles/index.css`, `src/shared/ui/icons.tsx`; `AgentMarkdownCodeWrap.test.ts`
- Commit: 7302d8a9
- Verified: tsc ✅ tests ✅; desktop check manual.

## 2026-10-17 19:56 IST — Resizable Automations list (L-86)
- Type: feature
- What: The Automations list on the left can now be dragged wider or narrower from its right edge, like the Notes list. Double-click the edge to reset it.
- Why: The Automations sidebar was fixed at 280px while Notes could be resized.
- Files: `src/features/automations/ui/AutomationsView.tsx` (`useDragResize` on the list aside, separator handle); `AutomationsView.test.ts` (drag, clamp, remembered width, double-click reset)
- Commit: this commit
- Verified: tsc ✅ tests ✅ (6,883 passed, 2 opt-in skips); lint not run (no eslint config); desktop check manual.

## 2026-10-17 19:47 IST — Merge all accounts usage into the fork branch (L-85)
- Type: chore
- What: Brought in `feature/all-accounts-usage-monocode`: an Experimentation toggle "All accounts usage" (off by default) that shows one bottom-bar usage chip per configured Claude, Codex and Devin account.
- Why: User chose the monocode variant of the three all-accounts usage branches.
- Files: `src/app/shell/allAccountsUsage.ts`, `AccountUsageStrip.tsx`, `UsageFooter.tsx`, `UsageProviderChip.tsx`; `src/features/settings/model/settings.ts` (merged experiment list); docs records. The branch feature ID was renumbered L-80 → L-85 (L-80 is Debug Inspector).
- Commit: merge of 4ae846c4
- Verified: tsc ✅ tests ✅ (6,882 passed, 2 opt-in skips); lint not run (no eslint config); desktop checks manual.

## 2026-10-17 19:30 IST — Expandable process lists in the process monitor (L-84)
- What: Every monitor row (MonoCode app, chats, terminals) now has a disclosure arrow that lists the processes inside it in tree order: name, PID, CPU and memory. View only, no per-process Stop. WebView2 processes read "Web view (main)" or "Web view helper". Lists stay open across refreshes; exited rows show none.
- Files: `src-tauri/src/process_metrics.rs` (process names in all three OS snapshots); `src-tauri/src/process_stats.rs` (`ProcessDetail`, depth-first `details`, `children` on rows + test); `src/app/shell/processMonitorModel.ts` (types, `processLabel`); `src/app/shell/ProcessMonitor.tsx` (`DisclosureButton`, `ProcessList`); `ProcessMonitor.test.ts`; spec follow-up in `docs/specs/process-monitor-app-row.md`.
- Verified: tsc ✅ tests ✅ (6,846 passed, 2 opt-in skips) Rust process tests ✅ (7) Clippy (changed files) ✅ rustfmt ✅ | manual: expand app and terminal rows in the desktop app.
- Commit: cd933ed8

## 2026-10-17 — Process monitor shows MonoCode's own usage (L-84)
- What: The monitor counted only chats and terminals, so with nothing running it read `CPU 0.0% · 0 MiB`. It now adds a non-stoppable "MonoCode app" row (host plus web view processes, minus chat/terminal trees, from one shared snapshot) and includes it in the chip total. Unreadable helper processes are counted and reported instead of blanking the total. Command renamed `owned_process_stats` → `process_monitor_stats` (returns `{ app, owned }`).
- Files: `src-tauri/src/process_stats.rs` (app usage + tests); `src-tauri/src/lib.rs` (command name); `src/app/shell/processMonitorModel.ts` (types, `processTotals`); `src/app/shell/ProcessMonitor.tsx` (app row, totals, empty copy); `ProcessMonitor.test.ts`; spec `docs/specs/process-monitor-app-row.md`.
- Verified: tsc ✅ tests ✅ (6,845 passed, 2 opt-in skips) Rust process tests ✅ (6) Clippy (changed files) ✅ rustfmt ✅ | manual: app row with nothing running; terminal row not double-counted.
- Commit: this commit

## 2026-10-17 — Fix blank window at boot from case-only file name clash
- What: `src/app/shell` held both `ProcessMonitor.tsx` and `processMonitor.ts`. On Windows' case-insensitive file system, `./ProcessMonitor` in `UsageFooter.tsx` resolved to the `.ts` helper, so the missing `ProcessMonitor` export failed the App module load and the boot splash never cleared. Renamed the helper to `processMonitorModel.ts`.
- Files: `src/app/shell/processMonitorModel.ts` (renamed from `processMonitor.ts`); `src/app/shell/ProcessMonitor.tsx` (line 29) and `ProcessMonitor.test.ts` (line 12) imports.
- Verified: tsc ✅ tests ✅ (6,843 passed, 2 opt-in skips) | manual: relaunch `npm run tauri:dev-profile` and confirm the workspace appears.
- Commit: this commit

## 2026-10-17 — Match the reference's actual cursor default and typed request
- What: Bundled node-pty restored the long fork and passed full-access end to end in 39030559003. Supervised capture retained `R[Pasted text…]`, so the literal lead was present but insufficient. Probe a bounded full first-line lead. Also correct the earlier flag assumption: node-pty defaults cursor inheritance to false and Orca does not enable it. Compare flags=0 with normal query replies, plus the bundled runtime with that same default.
- Verified: Windows-target fixture Clippy, changed Rust formatting, reference JS syntax and opt-in transformation pass. Application defaults/dependencies remain unchanged; the latest full frontend gate remains 6,843 passed.
- Commit: diagnostic follow-up on the authorized branch.
## 2026-10-17 — Compare Orca's actual bundled terminal runtime
- What: Flags=1 also failed the complete-frame check on both Windows runners in 39029751814. Add a diagnostic-only node-pty reference host using its pinned bundled ConPTY and Orca's primary-device response. The same frontend, CLI, messages, hooks, transcript and assertions run unchanged; the original failure still fails the job.
- Verified: Reference JavaScript syntax and opt-in test transformation pass. Application dependencies/defaults are unchanged from the 6,843-test checkpoint; node-pty installs only into the runner's temporary diagnostic directory, with install scripts disabled. No new Rust crate or production DLL dependency.
- Commit: diagnostic follow-up on the authorized branch.
## 2026-10-17 — Compare native ConPTY compatibility flags
- What: None of five geometries restored a complete Windows fork prompt. Orca/node-pty passes cursor inheritance only; portable-pty also enables resize-quirk and Win32-input modes. Add an explicit native creation option with the existing default unchanged and test flags=1 only in the opt-in host after the ordinary scenario fails. No new crate or DLL dependency.
- Verified: Windows-target native-host all-target Clippy and changed-file Rust formatting pass. Production frontend/CLI behavior is unchanged from the 6,843-test checkpoint; local native tests also pass with CI/GITHUB_ACTIONS set, so those variables alone do not explain the Windows failure. Native A/B evidence follows in the spec.
- Commit: diagnostic follow-up on the authorized branch.
## 2026-10-17 — Capture terminal-size recovery evidence for native history
- What: The one-column repaint in 39028767023 still omitted the Windows fork input. On native-fixture failure only, capture five read-only geometry probes and complete VT screens, then rethrow the original failure. No production behavior or input changes.
- Verified: Production remains the 6,843-test/TypeScript/build checkpoint 8cec9f6. The opt-in test transforms and skips cleanly locally; native Windows provides the diagnostic evidence. The earlier editor test retry passed without changes.
- Commit: diagnostic follow-up on the authorized branch.

## 2026-10-17 — Request a fresh Windows paint for long native history
- What: Run 39027302518 passed all seven expanded ordinary messages but the long-history fork paint omitted its input row. Request one synchronized one-column resize/restore after settled startup mismatch, then apply the unchanged empty-prompt checks. Preserve user resizing and input ownership; no keys, clearing or resend.
- Files: `claudeInteractiveTerminal.ts`, readiness wait, and a real-VT regression from the captured Windows 2.1.302 output. The escaped JSON fixture preserves exact control bytes across checkouts.
- CI: Run native CLI checks before the independent full-backend check for faster failure feedback; successful jobs still require both.
- Verified: Full web rerun 6,843 passed / 619 files (two opt-in skips), TypeScript, current web/host builds, targeted real-VT/delivery tests and both expanded native CLI 2.1.301 scenarios pass. An unchanged editor blur test failed under combined load, then passed isolated and in the full retry; no editor changes. Windows rerun follows publication.
- Commit: follow-up to c31abbe on the authorized branch.

## 2026-10-17 — Keep typed request text outside Claude's folded paste
- What: Windows run 39026195881 proves output quiet alone does not fix supervised context-only folded pastes. Follow Orca's typed-request contract without adding instructions: one original alphanumeric character stays literal, with the preceding/remainder text framed in the same write. Preserve one Enter, phase/ownership fencing and exact acceptance. Match the native editor's verified four-space tab expansion before sending.
- Completion: Wait for the Stop hook's final assistant text to reach JSONL before completing. Preserve autonomous Stops that precede transcript output; a delayed final reply must not become a stuck false external turn.
- Files: `interactive_delivery.rs`, native fixture hosts, `claudeInteractive.ts` and delivery/real-CLI tests. Regressions include dense single-line, long Unicode, leading-whitespace inputs and both late-JSONL completion orders.
- Verified: 6,840 web tests and 29 targeted delivery tests (including two new late-JSONL cases), strict TypeScript, current web/host builds, 761 Rust tests (two ignored), production Clippy and Windows fixture Clippy pass. Both expanded native CLI 2.1.301 scenarios pass with ten exactly accepted ordinary prompts. Windows rerun follows publication. No global settings, installer or version change.
- Commit: follow-up to eb4cd8a on the authorized branch.

## 2026-10-17 — Observe native paste output before submitting
- What: Run 39018068301 passed full-access on both Windows runners, but supervised mode still left attachment references editable. Add Orca's 1.5s output-quiet gate after the byte-dependent minimum, require output after the paste, and fail closed after eight extra seconds. Production and the Windows fixture share the Rust gate; passive terminal replies remain live. No repeat Enter or resend.
- Files: `src-tauri/src/interactive_delivery.rs`, `claude_interactive.rs`, `pty.rs`; native CLI fixture hosts.
- Verified: 6,839 web tests, strict TypeScript, 760 Rust tests (two ignored), production Clippy, changed-file Rust fmt and Windows fixture Clippy pass. Both real CLI 2.1.301 scenarios pass, with exact accepted prompts and unchanged resume prefix. Native Windows rerun follows publication; no installer/version change.
- Commit: follow-up to 8c58290 on the authorized branch.

## 2026-10-17 — Let Claude attach a paste before the single Enter
- What: Native Windows run 39017396800 passed backend/metrics/messages/resume/fork/compact, then left attachment references in the input as a folded paste. Replace the fixed 120ms wait with a shared Rust 500ms attachment window plus byte-dependent ingest time, following Orca's measured ConPTY floor. Never resend or repeat Enter.
- Verified: TypeScript and both real CLI 2.1.301 scenarios pass; 758 Rust tests (two ignored), production Clippy and Windows-target fixture Clippy pass. Web application code is unchanged from the 6,839-test gate; the opt-in fixture queries the production delay and verifies exact accepted prompts. Native Windows rerun follows this publication.
- Commit: correction following 421afa7 on the same user-authorized branch; no version/installer change.

## 2026-10-17 — Interactive lifecycle/actions and optional process monitor (L-82/L-84)
- What: Filter ordinary idle notifications; track subagents/background snapshots and task-notification continuations; poll at 200ms active/1.5s idle. Configurable 5–60 minute shutdown (default 15) rechecks native activity, transcript tail, ownership, approvals, background coverage and descendants, retaining the same resume UUID. Unknown work/CLI coverage skips shutdown.
- Actions: Persist image/text attachments and send quoted file references; existing Compact uses exact `/compact`; full-history Fork uses verified native fork/resume/new-UUID flags. Historical cuts fall back to copied context because the real Interactive CLI ignores `--resume-session-at`. Ask in sidechat keeps its own Interactive process, account/model/effort and existing refreshed source snapshot. No `/model` or `/effort`, no global defaults/hook writes.
- Monitor: Default-off Experimentation toggle; bottom-bar total CPU/working-set memory, project/chat/mode/idle rows and existing Stop paths. Includes native process descendants, PID-generation CPU deltas, 10s chip/3s open refresh, no disabled sampler, plus loading/empty/exited/unavailable states. Bulk stop rechecks current idle safety without waiting for the automatic shutdown interval. User chose existing native APIs; no new crate.
- Verified: 6,839 web tests / 619 files (two opt-in skips); strict TypeScript, web/host builds, Rust check, production Clippy and 757 Rust tests (two ignored) pass. Windows fixture Clippy and macOS metrics cross-check pass. Existing Debug Inspector fmt/test-Clippy failures remain. Rust cleanup tests pass with a proper container init. Real isolated CLI 2.1.301 probes pass supervised/Full access for messages, native resume, matching system/tool prefix, native full-history fork, compact, actual text/image Read tools and automatic background reply. Native Windows 2.1.302 CI now also checks the full backend and metrics. Native CLI helper/naming requests are accounted for separately. The missing external `claude-notify.ps1` hook remains the user's inherited configuration, not an app hook rewrite.
- Commit: feature publication on the user-authorized 0.10.0 branch; Windows CI evidence follows in the spec. No installer/version change; separate dev profile remains `npm run tauri:dev-profile`.

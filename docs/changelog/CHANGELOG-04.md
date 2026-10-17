# Changelog 04 — MonoCode Windows fork

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

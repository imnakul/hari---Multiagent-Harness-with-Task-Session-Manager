# Changelog 04 — MonoCode Windows fork

## 2026-10-19 21:59 IST — Windows build with L-116 to L-118 (0.14.0-local6)
- Type: chore
- What: New Windows installer with accent-coloured chat links, Interactive chats that keep rendering after a pasted image, and images, videos, a full-size image viewer, image copy and link and image hover previews in every chat.
- Why: User asked to commit, push and build after L-116 to L-118.
- Files: `E:DevelopingInstallable versionsMonoCode_0.14.0-local6_x64.exe` (13,987,754 bytes, SHA-256 B587BB20F66A40E732C41E9C4C863822C4011B0DCCF0700C108C49B43E48609E, NotSigned); version in package.json, package-lock.json, Cargo.toml, Cargo.lock, src-tauri/tauri.conf.json
- Commit: see git log (chore(release): 0.14.0-local6)
- Verified: tsc ✅ tests ✅ (7,466 passed, 2 skipped) cargo ✅ (claude_ tests) lint — (no ESLint config) build ✅ (npm run build:windows); desktop check manual

## 2026-10-19 21:53 IST — Media, image viewer and hover previews in every chat (L-118)
- Type: feature
- What: Image and video paths in replies now show the media in every chat, not only Mono chats. Click an image to see it full size (Esc closes); hover it for Copy and Open file buttons. Hovering a web link in a reply shows its page title and icon, and hovering an image path written as code shows a small thumbnail.
- Why: User asked for media in normal chats, a full-size viewer, a copy button, and hover previews.
- Files: [AgentTranscript.tsx](../../src/features/sessions/ui/AgentTranscript.tsx), [LocalMedia.tsx](../../src/features/sessions/ui/LocalMedia.tsx), [ChatHoverPreviews.tsx](../../src/features/sessions/ui/ChatHoverPreviews.tsx), [AgentMarkdown.tsx](../../src/features/sessions/ui/AgentMarkdown.tsx), [clipboard.ts](../../src/platform/tauri/clipboard.ts)
- Commit: see git log (feat(sessions): media and hover previews in every chat)
- Verified: tsc ✅ tests ✅ (7,466 passed, 2 skipped) cargo — (no Rust change) lint — (no ESLint config) build —; desktop check manual

## 2026-10-19 21:31 IST — Interactive chat survives a pasted image (L-117)
- Type: fix
- What: After sending a pasted image in a Claude Interactive chat, the chat stopped showing Claude's reply ("Interactive observation stopped … exceeds the interactive read limit") even though Claude kept working in the terminal, and Return to chat then refused with "Wait for the native conversation to finish". The app now reads the large image record, drops the image bytes it never shows, and keeps rendering; Return to chat also works after any such stop once Claude is idle.
- Why: Claude stores pasted images as base64 inside one transcript line, which can exceed the 1 MiB read page; after the stop the GUI kept a stale "busy" state.
- Files: [claude_interactive.rs](../../src-tauri/src/claude_interactive.rs), [claudeInteractive.ts](../../src/integrations/harness/providers/claude/claudeInteractive.ts), [claudeInteractive.test.ts](../../src/integrations/harness/providers/claude/claudeInteractive.test.ts)
- Commit: see git log
- Verified: tsc ✅ vitest (claude provider, 317 passed) ✅ cargo (claude_, 46 passed) ✅ lint — (no ESLint config) build —; desktop check manual

## 2026-10-19 21:04 IST — Chat links use the accent colour (L-116)
- Type: style
- What: Links in chat replies, user message link previews and file-name chips (on hover) now use your accent colour, or the theme accent when you have not picked one, instead of a fixed blue.
- Why: User asked for chat links to follow the accent theme colour.
- Files: [index.css](../../src/styles/index.css), [AgentMarkdown.tsx](../../src/features/sessions/ui/AgentMarkdown.tsx), [UserLinkPreview.tsx](../../src/features/sessions/ui/UserLinkPreview.tsx)
- Commit: see git log
- Verified: tsc ✅ tests ✅ (7,465 passed, 2 skipped) cargo — (no Rust change) lint — (no ESLint config) build —; desktop check manual

## 2026-10-19 12:15 IST — Windows build with L-114 and L-115 (0.14.0-local5)
- Type: chore
- What: New Windows installer where the first Interactive message after opening or resuming a chat is handed to Claude when it starts, and the chat folder is pre-trusted so Claude does not stop at a hidden trust question.
- Why: User asked to commit L-114 and L-115 and build 0.14.0-local5.
- Files: `E:\Developing\Installable versions\MonoCode_0.14.0-local5_x64.exe` (14,005,055 bytes, SHA-256 927E36B35B5CAC5868E47FB89AD5DA02CB4868DC2EAFC257FF999478D9AD2905, NotSigned); version in package.json, package-lock.json, Cargo.toml, Cargo.lock, src-tauri/tauri.conf.json
- Commit: see git log (chore(release): 0.14.0-local5)
- Verified: tsc ✅ tests ✅ (7,465 passed, 2 skipped) cargo ✅ (claude_ tests) lint — (no ESLint config) build ✅ (npm run build:windows); desktop check manual

## 2026-10-19 12:07 IST — Claude Interactive pre-trusts the chat folder (L-115)
- Type: feature
- What: On a new account or in a new folder, Claude first asks "Do you trust the files in this folder?" in its hidden terminal, so the first message waited until MonoCode said to open the native terminal. MonoCode now records that answer in Claude's own settings before starting it, the way Orca does, so the question never comes up. It never creates or breaks Claude's settings file and never touches one it cannot read; if anything is in the way, Claude simply asks as before. Settings → Experimentation → "Trust chat folders for Claude Interactive" turns it off (on by default).
- Why: User asked to adopt Orca's folder-trust handling after the L-114 review.
- Files: [claude_folder_trust.rs](../../src-tauri/src/claude_folder_trust.rs) (new), [claude_interactive.rs](../../src-tauri/src/claude_interactive.rs), [lib.rs](../../src-tauri/src/lib.rs), [interactiveIdleSettings.ts](../../src/features/settings/model/interactiveIdleSettings.ts), [settings.ts](../../src/features/settings/model/settings.ts), [SettingsView.tsx](../../src/features/settings/ui/SettingsView.tsx), [claudeInteractive.ts](../../src/integrations/harness/providers/claude/claudeInteractive.ts), [claudeInteractive.test.ts](../../src/integrations/harness/providers/claude/claudeInteractive.test.ts); [spec](../specs/claude-folder-pretrust.md)
- Commit: 47267afa
- Verified: tsc ✅ tests ✅ (7,465 passed, 2 skipped) cargo ✅ (claude_folder_trust:: 5 new, claude_ tests pass) lint — (no ESLint config) build —; desktop check manual

## 2026-10-19 11:50 IST — First Interactive message goes on Claude's command line (L-114)
- Type: fix
- What: The first message after opening or resuming a Claude Interactive chat was often lost, because Claude throws away anything typed while it is still starting. MonoCode now hands that message to Claude when it starts it (the way Orca does), so Claude sends it itself once ready. Later messages are typed in as before, with the L-113 on-screen check. Messages that Claude could mistake for a command (one word, or starting with "-" or "/"), messages with attachments, and /compact are still typed in.
- Why: User approved Orca's approach after the race was reproduced outside MonoCode.
- Files: [claude_interactive.rs](../../src-tauri/src/claude_interactive.rs), [claudeInteractive.ts](../../src/integrations/harness/providers/claude/claudeInteractive.ts), [claudeInteractiveProtocol.ts](../../src/integrations/harness/providers/claude/claudeInteractiveProtocol.ts), and their tests incl. [claudeInteractiveBridge.test.ts](../../src/integrations/harness/providers/claude/claudeInteractiveBridge.test.ts)
- Commit: 0c63df04
- Verified: tsc ✅ tests ✅ (7,464 passed, 2 skipped) cargo ✅ (claude_interactive:: 13 passed, 1 new) lint — (no ESLint config) build —; desktop check manual

## 2026-10-19 11:18 IST — Windows build with L-113 (0.14.0-local4)
- Type: chore
- What: New Windows installer where Interactive sends wait for Claude's prompt to show the message before pressing Enter.
- Why: User asked to commit and build the L-113 fix.
- Files: `E:\Developing\Installable versions\MonoCode_0.14.0-local4_x64.exe` (13,965,146 bytes, SHA-256 1496A158BAC918D88D69D85EED1DDB05B0CE27B272842C9DBF9C1B714670FE8C, NotSigned); version in package.json, package-lock.json, Cargo.toml, Cargo.lock, src-tauri/tauri.conf.json
- Commit: see git log (chore(release): 0.14.0-local4)
- Verified: tsc ✅ tests ✅ (7,449 passed, 2 skipped) cargo — (release build only) lint — (no ESLint config) build ✅ (npm run build:windows); desktop check manual

## 2026-10-19 11:00 IST — Interactive sends wait for Claude's prompt to show the message (L-113)
- Type: fix
- What: Sending to a Claude Interactive chat right after it opened or resumed often did nothing: Claude threw the typed text away while it was still starting, and MonoCode pressed Enter on an empty prompt. MonoCode now checks Claude's input box on screen and presses Enter only once the message is there, retypes it once if Claude visibly cleared it, and otherwise says plainly that nothing was sent so you can send it again.
- Why: User still saw "Prompt delivery is unconfirmed" after L-112.
- Files: [claude_interactive.rs](../../src-tauri/src/claude_interactive.rs), [lib.rs](../../src-tauri/src/lib.rs), [claudeInteractive.ts](../../src/integrations/harness/providers/claude/claudeInteractive.ts), [claudeInteractiveTerminal.ts](../../src/integrations/harness/providers/claude/claudeInteractiveTerminal.ts), [claudeInteractiveProtocol.ts](../../src/integrations/harness/providers/claude/claudeInteractiveProtocol.ts), and their tests
- Commit: c16e8b4d
- Verified: tsc ✅ tests ✅ (7,449 passed, 2 skipped) cargo ✅ (claude_interactive:: 12 passed, 1 new) lint — (no ESLint config) build —; desktop check manual

## 2026-10-19 10:21 IST — Windows build with L-111 and L-112 (0.14.0-local3-upstream-sync)
- Type: chore
- What: New Windows installer with Antigravity CLI in Add MCP server, the lighter glass on the Add MCP and Add Draft dialogs, and Return to chat working after a prompt Claude never picked up.
- Why: User asked to commit and build so work can continue in MonoCode.
- Files: `E:\Developing\Installable versions\MonoCode_0.14.0-local3-upstream-sync_x64.exe` (13,954,886 bytes, SHA-256 5DF0D8D74C7819534B86DA1D0004F6FA6FA9EB4A4A1113BB84CADCBAF93175DA, NotSigned); version in package.json, package-lock.json, Cargo.toml, Cargo.lock, src-tauri/tauri.conf.json
- Commit: 3e3c2c34
- Verified: tsc ✅ tests ✅ (7,441 passed, 2 skipped) cargo — (release build only) lint — (no ESLint config) build ✅ (npm run build:windows); desktop check manual

## 2026-10-19 10:15 IST — Return to chat after an unacknowledged Interactive send (L-112)
- Type: fix
- What: When Claude never picked up a sent prompt, the chat showed "Prompt delivery is unconfirmed", and Return to chat then always said to wait for the conversation to finish, so only Stop Claude helped. Return to chat now hands the chat back once the terminal shows an empty, idle prompt. The message is not resent.
- Why: User hit the dead end on a chat resumed from yesterday.
- Files: [claude_interactive.rs](../../src-tauri/src/claude_interactive.rs), [claudeInteractive.ts](../../src/integrations/harness/providers/claude/claudeInteractive.ts), [claudeInteractive.test.ts](../../src/integrations/harness/providers/claude/claudeInteractive.test.ts)
- Commit: 4a21425d
- Verified: tsc ✅ tests ✅ cargo ✅ (claude_interactive:: 11 passed, 1 new) lint — (no ESLint config) build —; desktop check manual

## 2026-10-19 10:01 IST — Antigravity CLI in Add MCP server, lighter glass for composer dialogs (L-111)
- Type: fix
- What: Add MCP server now offers Antigravity CLI and saves to the same files the MCP list reads. The Add MCP server and Add Draft dialogs use the floating Quick Composer's lighter glass and a light backdrop instead of the dark dialog fill.
- Why: User reported Antigravity CLI missing from the Provider list and both dialogs looking too dark next to the Quick Composer.
- Files: [mcp.rs](../../src-tauri/src/mcp.rs), [McpSettings.tsx](../../src/features/settings/ui/McpSettings.tsx), [Modal.tsx](../../src/shared/ui/Modal.tsx), [index.css](../../src/styles/index.css), [SessionTodoComposer.tsx](../../src/features/session-board/ui/SessionTodoComposer.tsx)
- Commit: 9e8ea67f
- Verified: tsc ✅ tests ✅ (7,440 passed, 2 skipped; 3 new) cargo ✅ (mcp:: 38 passed, 2 new) lint — (no ESLint config) build —; desktop check manual

## 2026-10-19 02:31 IST — Windows build with the Interactive and composer fixes (0.14.0-local2-upstream-sync)
- Type: chore
- What: New Windows installer with L-106 to L-110: Interactive send fixes and the Quick Composer / Add Draft dialog matching the chat composer. The installer file name no longer carries a setup date.
- Why: User asked to commit and build a new version, without the setup-date in the name.
- Files: `E:\Developing\Installable versions\MonoCode_0.14.0-local2-upstream-sync_x64.exe` (13,955,096 bytes, SHA-256 6CE7ED28516961492647757F8F6603C043F329D012E59C2FBE976FB86F6AFCF2, NotSigned); version in package.json, package-lock.json, Cargo.toml, Cargo.lock, src-tauri/tauri.conf.json
- Commit: 9684bb0c
- Verified: tsc ✅ tests ✅ (7,438 passed, 2 skipped) cargo — (release build only) lint — (no ESLint config) build ✅ (npm run build:windows); desktop check manual

## 2026-10-19 02:05 IST — Quick Composer and Add Draft dialog match the chat composer (L-110)
- Type: fix
- What: The floating Quick Composer now uses your UI font, font size and workspace theme instead of the system font. Its model, project and permission controls look like the chat composer's, and when space is short the toolbar scrolls sideways instead of squashing them (the model name no longer shrinks to "G…"). The Add Draft to Sessions / Edit Draft / Work on… dialog is wider, so Start is no longer cut off. It also has a single close button. The floating window now loads the Geist and Inter fonts like the main window. For Claude models, its model menu has the Structured / Interactive switch, so a new session or draft can start in Interactive mode.
- Why: User report with screenshots — the composer in the Add Draft dialog was unreadable and unusable, and the floating composer used the wrong font and mismatched controls.
- Files: [main.tsx](../../src/features/quick-composer/main.tsx), [QuickComposer.tsx](../../src/features/quick-composer/ui/QuickComposer.tsx), [composerControls.ts](../../src/features/sessions/ui/composerControls.ts), [ModelPicker.tsx](../../src/features/sessions/ui/ModelPicker.tsx), [AccessPicker.tsx](../../src/features/sessions/ui/AccessPicker.tsx), [SessionTodoComposer.tsx](../../src/features/session-board/ui/SessionTodoComposer.tsx), [QuickModelSelector.tsx](../../src/features/quick-composer/ui/QuickModelSelector.tsx), [quick-composer.html](../../quick-composer.html), [QuickComposer.modes.test.ts](../../src/features/quick-composer/ui/QuickComposer.modes.test.ts), [QuickModelSelector.test.ts](../../src/features/quick-composer/ui/QuickModelSelector.test.ts), [spec](../specs/quick-composer-consistency.md)
- Commit: bdecdc1d
- Verified: tsc ✅ tests ✅ (7,438 passed, 2 skipped; the 3 new tests fail without the fix) cargo — (no Rust change) lint — (no ESLint config) build —; desktop check manual

## 2026-10-19 01:23 IST — Interactive chat recovers after a failed send (L-109)
- Type: fix
- What: After one failed Interactive send, every later send was refused straight away with the same error until Claude was stopped. Now a Claude API error (such as Overloaded) only ends that turn, so you can send again; after any other failure, Return to chat in the native terminal clears it once the prompt is empty; and a repeat send says how to recover. A late Stop signal from an earlier turn can no longer abort a prompt while it is being pasted.
- Why: Review of Interactive mode after repeated stuck chats; the stuck state was confirmed with a test.
- Files: [claudeInteractive.ts](../../src/integrations/harness/providers/claude/claudeInteractive.ts), [ClaudeInteractiveTerminal.tsx](../../src/features/sessions/ui/ClaudeInteractiveTerminal.tsx), [claude_interactive.rs](../../src-tauri/src/claude_interactive.rs), [claudeInteractive.test.ts](../../src/integrations/harness/providers/claude/claudeInteractive.test.ts)
- Commit: fc9ee6a9
- Verified: tsc ✅ tests ✅ (7,435 passed, 2 skipped; the 3 new tests fail without the fix) cargo ✅ (claude_interactive 10 passed; full --lib 798 passed, 2 failed: fs::tests local_git_never_resolves_login_shell_path and read_only_git_cmd_path_adds_fixed_dirs_to_inherited_path, which fail the same without this change) lint — (no ESLint config) build —; desktop check manual

## 2026-10-19 01:05 IST — An old Stop no longer fails the next Interactive send (L-108)
- Type: fix
- What: In Interactive mode a chat could get stuck: every message failed within a second with "Claude stopped without confirming this prompt" and never reached the terminal. A leftover Stop signal from an earlier turn that had already ended was being applied to each new message. Now only a Stop that arrives after a message is sent can end it.
- Why: Bug report — this chat in MonoCode refused "Actually Build version…" again and again, with the native terminal sitting at an empty prompt.
- Files: [claudeInteractive.ts](../../src/integrations/harness/providers/claude/claudeInteractive.ts), [claudeInteractive.test.ts](../../src/integrations/harness/providers/claude/claudeInteractive.test.ts)
- Commit: b7be077e
- Verified: tsc ✅ tests ✅ (7,432 passed, 2 skipped; the new test fails without the fix) cargo — (no Rust change) lint — (no ESLint config) build —; desktop check manual

## 2026-10-18 22:17 IST — Interactive send after a native dialog, and no repeated turn on reopen (L-106, L-107)
- Type: fix
- What: After you answer a question in Claude's native terminal (for example "trust this folder"), sending from chat now works without clicking Return to chat, as long as the terminal prompt is empty and idle. A half-typed draft still blocks sending. Also, reopening an Interactive chat no longer shows a long prompt and its reply a second time.
- Why: Bug reports — the Teacher chat on imnakul refused to send with "The native terminal currently has input" after the trust question, and this chat repeated a prompt and reply after switching back to it.
- Files: [claudeInteractive.ts](../../src/integrations/harness/providers/claude/claudeInteractive.ts), [claudeInteractiveTerminal.ts](../../src/integrations/harness/providers/claude/claudeInteractiveTerminal.ts), [claudeInteractivePrompt.ts](../../src/integrations/harness/providers/claude/claudeInteractivePrompt.ts), [history.ts](../../src/features/provider-sessions/model/history.ts), tests in `claudeInteractive.test.ts` and `history.test.ts`
- Commit: 82223f9d
- Verified: tsc ✅ tests ✅ (7,431 passed, 2 skipped; the new tests fail without the fix) cargo — (no Rust change) lint — (no ESLint config) build —; desktop check manual

## 2026-10-18 21:12 IST — Windows build of upstream 0.14.0 with the named-chat prompt fix (0.14.0-local1-upstream-sync)
- Type: chore
- What: New Windows installer from `nakul/windows-support-upstream-0.14.0`: the upstream 0.14.0 integration with all fork features, plus the Interactive prompt fix for named chats (L-105).
- Why: User request — one build containing both 0.14.0 and the fix.
- Files: `E:\Developing\Installable versions\MonoCode_0.14.0-local1-upstream-sync_x64-setup_2026-10-18-named-prompt.exe` (13,954,301 bytes, SHA-256 E531B848075BD6803151FC4527F9786013422EA028A86FC7E6B13CE4503C67FA, NotSigned)
- Commit: built from 52003786 (version bump in `Cargo.toml`, `Cargo.lock`, `package.json`, `package-lock.json`, `src-tauri/tauri.conf.json`)
- Verified: build ✅ tsc ✅ tests ✅ (7,428 passed, 2 skipped) cargo test --lib — (no Rust change since the integration's 813 pass); desktop check manual

## 2026-10-18 20:42 IST — Interactive Claude finds the prompt in a named chat on Windows (L-105)
- Type: fix
- What: An Interactive Claude chat that has a name, such as one continued on another account, shows that name in the input box's top border. On Windows MonoCode then failed to find the empty prompt and refused every message with "could not recognize Claude's empty input prompt". It now recognises a border with a name in it.
- Why: Bug report — the chat continued on imnakul resumed with its history in the native terminal, but sending from chat failed.
- Files: [claudeInteractiveTerminal.ts](../../src/integrations/harness/providers/claude/claudeInteractiveTerminal.ts) (`isFrame`), [claudeInteractiveTerminal.test.ts](../../src/integrations/harness/providers/claude/claudeInteractiveTerminal.test.ts)
- Commit: d2734c90
- Verified: on the 0.14.0 branch: tsc ✅ tests ✅ (7,428 passed, 2 skipped; new test fails without the fix) cargo — (no Rust change) lint — (no ESLint config) build ✅ (0.14.0-local1-upstream-sync installer); desktop check manual

## 2026-10-18 — Integrate upstream main / 0.14.0 with local workflows
- What: Merged pinned upstream `a90c558d` (0.14.0 plus post-tag main) above latest fork `b344c56b` on new `nakul/windows-support-upstream-0.14.0`. Applied all six approved choices: optional layout with local managers/footer, native opt-in resource/pressure/tool controls, safe Claude/Codex account continuation, protected Interactive/Remote Control idle behavior and unified Mono overview. Retained all 104 feature IDs; L-90 stays removed.
- Files: 54 conflict files combined rather than taking either side wholesale; integration repairs include sidebar project labels/server snapshots, queue/tool-detail persistence, terminal lifecycle, image resolution, settings visibility and the local-manager footer predicate. Details: `docs/specs/upstream-0.14.0-sync-plan.md` and `docs/notes/archive/upstream-merge-2026-10-18-014.md`; feature register and Windows learnings updated.
- Verified: full web 7,427 passed / 2 opt-in skipped; TypeScript, Rust format/check/Clippy pass; full Rust 813 passed / 2 ignored; host 117 passed / 5 skipped; release-channel 8 passed; production/host builds and whitespace checks pass. Baseline/test-environment failures attributed in the intake record. Human Windows/provider checks remain separate; no installer built.
- Commit: integration merge on `nakul/windows-support-upstream-0.14.0` (SHA in task handoff); publication requires an explicit instruction.

## 2026-10-18 16:18 IST — Same-version Windows build with continue on account (0.10.0-local2-upstream-sync)
- Type: chore
- What: New Windows installer, same version number, adding continue a Claude chat on another account with the resume and switch-back fixes (L-102), process monitor partial totals (L-103) and the Interactive dialog message (L-104).
- Why: User request — build the new changes.
- Files: `E:\Developing\Installable versions\MonoCode_0.10.0-local2-upstream-sync_x64-setup_2026-10-18-continue.exe` (12,443,031 bytes, SHA-256 6BB902A14B80B6F9FEF13CBF96A1AB11B237A22C580F0612EA23E9F5513CDF69, NotSigned)
- Commit: built from 216217ed
- Verified: build ✅ tsc ✅ tests ✅ (6,980 passed, 2 skipped) cargo test --lib ✅ (763); desktop check manual

## 2026-10-18 16:10 IST — Continue on account: resume after switching, and switching back (L-102)
- Type: fix
- What: After moving a Claude chat to another account, the next message now really continues the copied conversation. Before, in the same app run, a Structured chat would quietly start an empty conversation and an Interactive chat would refuse with "bound to a different project or account". Switching the chat back to the first account also works now: the older copy there is brought up to date instead of being refused as "a different version". A copy that went further on its own is still never overwritten.
- Why: Review of L-102 found the in-memory resume bindings kept the old account, and the conflict rule refused every round trip.
- Files: [provider_sessions.rs](../../src-tauri/src/provider_sessions.rs) (`copy_claude_session_at`, `add_missing_files`), [tests.rs](../../src-tauri/src/provider_sessions/tests.rs), [continueOnAccount.ts](../../src/features/providers/model/continueOnAccount.ts) (`continueClaudeSession`), [continueOnAccount.test.ts](../../src/features/providers/model/continueOnAccount.test.ts), [App.tsx](../../src/app/App.tsx) (`continueOnAccount`)
- Commit: 835e5561
- Verified: tsc ✅ tests ✅ (6,980 passed, 2 skipped) cargo test --lib ✅ (763) rustfmt ✅ (touched files) lint — (no ESLint config) build —; desktop check manual

## 2026-10-18 15:48 IST — Continue a Claude chat on another account (L-102)
- Type: feature
- What: A Claude chat can move to another Claude account with its full history. Picking another account in the model picker or footer chip now asks "Continue here" or "New chat"; the usage-limit notice has **Continue on <account>**; Resume session rows have **Resume on <account>**. The chat's native transcript is copied to the other account's folder and resumed by the same session ID. Every place states the one-time uncached cost.
- Why: User request — a usage limit on one account should not force a fresh chat or a lossy summary. Probe first: a copied chat resumed on a different account and answered from its history.
- Files: [provider_sessions.rs](../../src-tauri/src/provider_sessions.rs) (`copy_claude_session_at`, `claude_copy_session`), [lib.rs](../../src-tauri/src/lib.rs), [continueOnAccount.ts](../../src/features/providers/model/continueOnAccount.ts), [ContinueOnAccountDialog.tsx](../../src/features/providers/ui/ContinueOnAccountDialog.tsx), [App.tsx](../../src/app/App.tsx), [UsageLimitNotice.tsx](../../src/features/sessions/ui/UsageLimitNotice.tsx), [Composer.tsx](../../src/features/sessions/ui/Composer.tsx), [SessionPane.tsx](../../src/features/sessions/ui/SessionPane.tsx), [PaneTree.tsx](../../src/features/workspace/ui/PaneTree.tsx), [ProviderConversationList.tsx](../../src/features/provider-sessions/ui/ProviderConversationList.tsx), [ResumeSessionDialog.tsx](../../src/features/provider-sessions/ui/ResumeSessionDialog.tsx), spec [claude-continue-on-account.md](../specs/claude-continue-on-account.md)
- Commit: 54ebecb2
- Verified: tsc ✅ tests ✅ (6,979 passed, 2 skipped) cargo test --lib ✅ (762) rustfmt ✅ (touched files; Debug Inspector drift left) lint — (no ESLint config) build —; desktop check manual

## 2026-10-18 14:37 IST — Process monitor partial totals and Interactive trust-dialog message (L-103, L-104)
- Type: fix
- What: The bottom bar no longer shows "unavailable" for RAM when one chat's processes cannot be read; rows and totals now add up what can be read, and the tooltip says when the total is partial. When an Interactive Claude chat is stopped by a native dialog (for example the "trust this folder" question a newly added account asks), the error now says so instead of "could not recognize Claude's empty input prompt".
- Why: User report — chip showed "CPU · unavailable" with a Codex row of "—", and a worker chat on the imnakul account failed to send. Causes: one unreadable helper blanked the row and the chip's all-or-nothing totals; the imnakul config had never trusted this folder, and the trust question was drawn above the row the check reads.
- Files: [process_stats.rs](../../src-tauri/src/process_stats.rs), [processMonitorModel.ts](../../src/app/shell/processMonitorModel.ts), [ProcessMonitor.tsx](../../src/app/shell/ProcessMonitor.tsx), [ProcessMonitor.test.ts](../../src/app/shell/ProcessMonitor.test.ts), [claudeInteractiveProtocol.ts](../../src/integrations/harness/providers/claude/claudeInteractiveProtocol.ts), [claudeInteractiveTerminal.ts](../../src/integrations/harness/providers/claude/claudeInteractiveTerminal.ts), [claudeInteractive.ts](../../src/integrations/harness/providers/claude/claudeInteractive.ts), [claudeInteractiveTerminal.test.ts](../../src/integrations/harness/providers/claude/claudeInteractiveTerminal.test.ts)
- Commit: 7eba5bf0
- Verified: tsc ✅ tests ✅ (6,966 passed, 2 skipped) cargo test --lib ✅ (759) rustfmt ✅ lint — (no ESLint config) build —; desktop check manual

## 2026-10-18 12:44 IST — Same-version Windows build with GPU monitor and queue fix (0.10.0-local2-upstream-sync)
- Type: chore
- What: New Windows installer, same version number, with GPU terminal rendering (L-99), Interactive follow-ups queueing (L-100) and the process monitor GPU column with hover Stop icon (L-101). `nakul/windows-support` fast-forwarded to this commit and both branches pushed to nakul-fork.
- Why: User request — commit, push and build after confirming CPU, queue and steer now work.
- Files: `E:\Developing\Installable versions\MonoCode_0.10.0-local2-upstream-sync_x64-setup_2026-10-18-gpu.exe` (12,418,042 bytes, SHA-256 BC6A192C49724C92BEF50BDEA172D96C2B458A06C0C078A1C372A4E28CAA19DA, NotSigned)
- Commit: built from 76634f4d
- Verified: build ✅ tsc ✅ tests ✅ (6,964 passed, 2 skipped); cargo fmt clean for L-101 files (existing Debug Inspector drift unchanged); desktop check manual

## 2026-10-18 12:28 IST — Process monitor GPU column and hover Stop icon (L-101)
- Type: feature
- What: The process monitor now shows CPU | RAM | GPU in lined-up columns for every row, and the bottom-bar chip adds GPU. The Stop button is now just a stop icon that appears when you point at a row (or reach it with Tab).
- Why: User request — GPU use was visible in Task Manager but not in the monitor, and always-visible Stop buttons were noisy.
- Files: [process_gpu.rs](../../src-tauri/src/process_gpu.rs), [process_stats.rs](../../src-tauri/src/process_stats.rs), [Cargo.toml](../../src-tauri/Cargo.toml), [lib.rs](../../src-tauri/src/lib.rs), [ProcessMonitor.tsx](../../src/app/shell/ProcessMonitor.tsx), [processMonitorModel.ts](../../src/app/shell/processMonitorModel.ts), [ProcessMonitor.test.ts](../../src/app/shell/ProcessMonitor.test.ts), [settings.ts](../../src/features/settings/model/settings.ts), [SettingsView.tsx](../../src/features/settings/ui/SettingsView.tsx); spec [process-monitor-gpu-column.md](../specs/process-monitor-gpu-column.md)
- Commit: 3f0458c6 (+ 76634f4d rustfmt)
- Verified: tsc ✅ tests ✅ (6,964 passed, 2 skipped) Rust process tests ✅ (9) lint — (no ESLint config) build —; desktop check manual

## 2026-10-18 12:06 IST — Interactive Claude follow-ups queue instead of interrupting the turn (L-100)
- Type: fix
- What: In Interactive CLI mode, a message sent while Claude is working now waits in the queue and goes out when the turn ends. Before, it tried to steer the running turn, Interactive Claude refused, and the refusal stopped the turn and left the message in the composer.
- Why: User report — "it didn't went to queue, also, it interrupted the working session". Cause: steer support was checked for the Claude provider as a whole, not for Interactive sessions, so Monos (and sessions with background tasks) steered by default.
- Files: [steerSupport.ts](../../src/features/sessions/model/steerSupport.ts), [App.tsx](../../src/app/App.tsx), [steerSupport.test.ts](../../src/features/sessions/model/steerSupport.test.ts)
- Commit: dbe57e32
- Verified: tsc ✅ tests ✅ (6,962 passed, 2 skipped) lint — (no ESLint config) build —; desktop check manual

## 2026-10-18 11:55 IST — GPU terminal rendering in Experimentation (L-99)
- Type: feature
- What: New Experimentation switch, "GPU terminal rendering" (off by default). When on, terminals you can see are drawn by the graphics card instead of the CPU. Hidden terminals give the GPU back, at most 8 use it at once, and any terminal whose GPU drawing fails quietly goes back to normal drawing.
- Why: User request — terminals were the biggest CPU users while the GPU sat idle.
- Files: [gpuRenderer.ts](../../src/features/terminal/model/gpuRenderer.ts), [TerminalView.tsx](../../src/features/terminal/ui/TerminalView.tsx), [ClaudeInteractiveTerminal.tsx](../../src/features/sessions/ui/ClaudeInteractiveTerminal.tsx), [settings.ts](../../src/features/settings/model/settings.ts), [SettingsView.tsx](../../src/features/settings/ui/SettingsView.tsx), [gpuRenderer.test.ts](../../src/features/terminal/model/gpuRenderer.test.ts); new dependency `@xterm/addon-webgl` ^0.19.0 (MIT, official xterm.js addon, ~1.25M weekly downloads).
- Commit: 4568b20e
- Verified: tsc ✅ tests ✅ (6,960 passed, 2 skipped) lint — (no ESLint config) build ✅ (addon is a separate 110 kB lazy chunk, 30 kB gzip); desktop check manual

## 2026-10-18 11:44 IST — Same-version Windows build with merged fixes (0.10.0-local2-upstream-sync)
- Type: chore
- What: New Windows installer, same version number, with L-93 to L-98, the native paste closing-ID fix, the no-native-suggestions Interactive fix and the explicit all-accounts refresh.
- Why: User request — test the merged fixes without a version bump.
- Files: `E:\Developing\Installable versions\MonoCode_0.10.0-local2-upstream-sync_x64-setup_2026-10-18-fixes.exe` (12,389,237 bytes, SHA-256 077AC18B1AA14627EB41C8CEF6611AD325B2D8102DB8549CAFF990A9ED1A3A6F)
- Commit: built from 6fe2add6
- Verified: build ✅; desktop check manual (restart open chats so they pick up the suggestion setting)

## 2026-10-18 11:31 IST — Refresh one account from its usage card (L-98)
- Type: feature
- What: Opening a usage chip in the bottom bar now shows a Refresh icon next to the title. It re-reads only that account; while it runs the icon turns into the usual "Updating" spinner. The Refresh button at the end of the bar still refreshes everything.
- Why: User request — refresh a single account without waiting for all of them.
- Files: [UsageProviderChip.tsx (lines 173–176, 474–485)](../../src/app/shell/UsageProviderChip.tsx:474), [AccountUsageStrip.tsx](../../src/app/shell/AccountUsageStrip.tsx), [UsageFooter.tsx](../../src/app/shell/UsageFooter.tsx), [UsageProviderChip.test.ts](../../src/app/shell/UsageProviderChip.test.ts)
- Commit: 6fe2add6
- Verified: tsc ✅ tests ✅ (6,954 passed, 2 skipped) lint — (no ESLint config) build ✅; desktop check manual

## 2026-10-18 00:40 IST — Same-version Windows test build (0.10.0-local2-upstream-sync)
- Type: chore
- What: Built a new Windows installer without changing the version, so it includes L-93 to L-97 (bottom bar in Tasks, one-row task header, in-use account highlight, account choice in the model picker, Antigravity quotas inline). About shows the same version as the 2026-10-17 build, so tell them apart by hash.
- Why: User request, to test the changes before a versioned release.
- Files: E:\Developing\Installable versions\MonoCode_0.10.0-local2-upstream-sync_x64-setup_2026-10-18-accounts.exe; 12,391,496 bytes; SHA-256 872B802A4207E681BA26B3D7344EC6455BE72D13C4FEBF18DDE9773307DA37D4. Built from HEAD c4288b21 plus uncommitted changes. The 2026-10-17 installer (12,387,402 bytes) is unchanged in the same folder.
- Commit: uncommitted
- Verified: unsigned NSIS build ✅ (npm run build:windows); installed check manual

## 2026-10-18 00:33 IST — Show Antigravity quotas in the bottom bar (L-97)
- Type: feature
- What: The Antigravity CLI chip in the bottom bar now shows each model family's 5-hour quota (for example "Gemini 0% used 5h · Claude & GPT 0% used 5h") instead of just "Model quotas". Clicking it still opens the full details.
- Why: The quotas were only visible after clicking the chip.
- Files: [UsageProviderChip.tsx](../../src/app/shell/UsageProviderChip.tsx), [AccountUsageStrip.tsx](../../src/app/shell/AccountUsageStrip.tsx); test `AntigravityCliUsage.test.ts`
- Commit: uncommitted
- Verified: tsc ✅ tests ✅ (6,940 passed, 2 skipped) lint — (no ESLint config) build —; desktop check manual

## 2026-10-17 23:47 IST — Highlight the chat's account, account choice in the model picker (L-95, L-96)
- Type: feature
- What: The usage chip for the account the open chat is using is now highlighted with the same selected look as the model button, and its tooltip says "In use by this chat". When a provider has more than one account, the model picker shows an Account list at the top; choosing another account switches an empty chat, or opens a new chat on that account if the current one already has messages.
- Why: With all accounts shown in the bottom bar you could not tell which account a chat used, and switching accounts needed the bottom bar.
- Files: [UsageProviderChip.tsx](../../src/app/shell/UsageProviderChip.tsx), [UsageFooter.tsx](../../src/app/shell/UsageFooter.tsx), [AccountUsageStrip.tsx](../../src/app/shell/AccountUsageStrip.tsx), [ModelPicker.tsx](../../src/features/sessions/ui/ModelPicker.tsx), [Composer.tsx](../../src/features/sessions/ui/Composer.tsx), [SessionPane.tsx](../../src/features/sessions/ui/SessionPane.tsx), [PaneTree.tsx](../../src/features/workspace/ui/PaneTree.tsx), [App.tsx](../../src/app/App.tsx); tests `UsageFooterAllAccounts.test.ts`, `ModelPicker.test.ts`
- Commit: uncommitted
- Verified: tsc ✅ tests ✅ (6,940 passed, 2 skipped) lint — (no ESLint config) build —; desktop check manual

## 2026-10-17 23:34 IST — Group usage by provider, bottom bar in Tasks, one-row task header (L-85, L-93, L-94)
- Type: feature
- What: With All accounts usage on, the bottom bar now keeps Claude accounts together, then Codex, then Devin, then Antigravity CLI, with a thin divider between groups. The bottom bar now shows in Task Manager and Session Manager too. The task editor header fits on one line: the "Task" label, the Add more toggle and the extra New task button are gone (the New task button at the top left of Tasks does the same). Ctrl/Cmd+Shift+Enter still creates the next task.
- Why: Accounts from different providers were mixed, the bar was missing in two panels, and the editor had two buttons for the same job.
- Files: [allAccountsUsage.ts](../../src/app/shell/allAccountsUsage.ts), [AccountUsageStrip.tsx](../../src/app/shell/AccountUsageStrip.tsx), [UsageFooter.tsx](../../src/app/shell/UsageFooter.tsx), [App.tsx](../../src/app/App.tsx), [TaskEditor.tsx](../../src/features/tasks/ui/TaskEditor.tsx); tests `allAccountsUsage.test.ts`, `UsageFooterAllAccounts.test.ts`, `TasksView.test.ts`
- Commit: uncommitted
- Verified: tsc ✅ tests ✅ (6,938 passed, 2 skipped) lint — (no ESLint config) build —; desktop check manual

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

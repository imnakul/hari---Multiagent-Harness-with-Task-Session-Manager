# Changelog 05 — MonoCode Windows fork

## 2026-11-14 16:16 IST — Hari keeps one link open to the computer (L-277)
- Type: feature
- What: While paired, Hari now keeps one encrypted link open to the computer instead of only asking every few seconds. In view it uses the normal connection; in the background (Android, with "Keep watching in the background" on) it uses a quiet one that checks in every 20 s. The computer's notification list arrives on it within about a second, and Hari polls only once a minute while the link is open. Both sides now keep an outbox that the next phases use (sharing, notification actions). With an older computer, Hari keeps polling as before.
- Why: Phase 1 of the Hari link plan: push instead of poll, and the base for Share, PC control and stats.
- Files: [transport.rs](../../crates/mobile-link/src/transport.rs), [tls.rs](../../crates/mobile-link/src/tls.rs), [ffi.rs](../../crates/mobile-link/src/ffi.rs), [mobile_events.rs](../../src-tauri/src/mobile_events.rs), [mobile_access.rs](../../src-tauri/src/mobile_access.rs), [mobile_notifications.rs](../../src-tauri/src/mobile_notifications.rs), [linkStream.ts](../../mobile/src/features/link/linkStream.ts), [linkProtocol.ts](../../mobile/src/features/link/linkProtocol.ts), [LinkStreamSync.tsx](../../mobile/src/features/link/LinkStreamSync.tsx), [NotificationFeedSync.tsx](../../mobile/src/features/notifications/NotificationFeedSync.tsx), [HariLive.kt](../../mobile/modules/hari-live/android/src/main/java/expo/modules/harilive/HariLive.kt), [SessionNotifications.test.tsx](../../mobile/tests/SessionNotifications.test.tsx) (its kv-store mock was missing since L-275)
- Commit: uncommitted
- Verified: typecheck ✅ (root, mobile) lint ✅ (mobile changed files) tests ✅ (mobile-link 34, src-tauri mobile_ 16, mobile 9 new, SessionNotifications fixed; `tests/mobile/watchFrames.test.ts` can't load from the phone config on Windows, as before) Kotlin compile ✅; phone checks manual

## 2026-11-14 15:36 IST — Plan: always-open Hari link, Share and a later cloud mailbox
- Type: docs
- What: Wrote down the agreed direction for the phone link: one always-open two-way connection, an outbox on each side so nothing is lost, a Share panel, "send to clipboard" both ways with a notification, push for notifications and notes/tasks, and later a cloud mailbox on Nakul's spare Convex account. Local version first.
- Why: Nakul asked to note these pointers before building, and to build and test the local version before any cloud part.
- Files: [hari-link-stream-plan.md](../specs/hari-link-stream-plan.md), [SPECS.md](../specs/SPECS.md), [PLANNED.md](../PLANNED.md)
- Commit: uncommitted
- Update: Share choices answered (files, text and links both ways; DownloadsHari; history of 100). Added notification Approve/Deny/Reply buttons, Wake-on-LAN, find my phone, a Quick Settings "Send clipboard" tile, PC and phone stats with closing busy apps, PC control from the Telegram bot (monitor off, hibernate, apps), notes/tasks sync and 5 build phases. Later: reminders and AI in the Share panel.
- Verified: docs only

## 2026-11-14 15:04 IST — The Windows app installs as Hari (L-276)
- Type: chore
- What: The Windows release installer is now named Hari and adds "Hari" to the Start menu, Desktop and Installed apps. Updating from MonoCode installs Hari next to it (for example `E:InstalledHari`), keeps every setting, chat and account, and swaps MonoCode's shortcuts and Installed apps entry for Hari's. MonoCode's old folder is left on disk. Inside the app the name is still MonoCode.
- Why: The user agreed to rename the desktop app to Hari, keeping the old install for now.
- Files: [tauri.hari.conf.json](../../src-tauri/tauri.hari.conf.json), [hari-installer-hooks.nsh](../../src-tauri/windows/hari-installer-hooks.nsh)
- Commit: uncommitted
- Verified: typecheck — (no TS change) lint — tests — build ✅ (`npm run build:windows` → `Hari_0.16.0-local43_x64-setup.exe`); install and update checks manual

## 2026-11-14 14:52 IST — Hari: the computer's notifications on the phone (L-275)
- Type: feature
- What: Hari now gets the same notifications as the bell on the computer: a reply is ready, an agent needs approval or has a question, an automation ran. A quiet "Watching your computer" entry keeps Hari checking in the background, so they show in the phone's notification panel even with Hari closed. Hari has a Notifications screen (in the drawer and on home): swipe one away, tap to open its chat, Mark all read, Clear all. Each of these changes the computer's bell too. Settings → Notifications on the phone turns background watching, automations, and chats that were open on the computer on or off.
- Why: Hari's alerts almost never arrived. The phone posted only while out of view but checked the computer only while in view. The user asked for always-on notifications that mirror the desktop panel, with swipe to dismiss and tap to open the chat, without a Live Update.
- Files: [notificationCenter.ts](../../src/features/notifications/model/notificationCenter.ts), [notifications.ts](../../src/features/notifications/model/notifications.ts), [NotificationBell.tsx](../../src/features/notifications/ui/NotificationBell.tsx), [mobileNotifications.ts](../../src/features/mobile/model/mobileNotifications.ts), [useMobileNotificationFeed.ts](../../src/features/mobile/hooks/useMobileNotificationFeed.ts), [mobile_notifications.rs](../../src-tauri/src/mobile_notifications.rs), [mobile_access.rs](../../src-tauri/src/mobile_access.rs), [lib.rs](../../src-tauri/src/lib.rs), [HariLive.kt](../../mobile/modules/hari-live/android/src/main/java/expo/modules/harilive/HariLive.kt), [HariLiveService.kt](../../mobile/modules/hari-live/android/src/main/java/expo/modules/harilive/HariLiveService.kt), [notificationFeed.ts](../../mobile/src/features/notifications/notificationFeed.ts), [NotificationFeedSync.tsx](../../mobile/src/features/notifications/NotificationFeedSync.tsx), [SessionNotifications.tsx](../../mobile/src/features/notifications/SessionNotifications.tsx), [notifications/index.tsx](../../mobile/src/app/notifications/index.tsx), [settings/index.tsx](../../mobile/src/app/settings/index.tsx)
- Commit: uncommitted
- Verified: typecheck ✅ (desktop and mobile) lint ✅ (mobile; root has no config) tests ✅ Kotlin compile ✅ build — ; phone and desktop checks manual

## 2026-11-14 14:05 IST — Activity: sites start folded (L-274)
- Type: style
- What: In Activity → Sites, each website now shows only its time, a bar and how many tabs it had. Click a site to see its tab titles; click again to fold them.
- Why: The user asked for Sites to be collapsed by default; the tab titles made the column long.
- Files: [Breakdown.tsx](../../src/features/activity/ui/Breakdown.tsx)
- Commit: uncommitted
- Verified: typecheck ✅ lint — (no config) tests — (no view tests) build —

## 2026-11-14 11:14 IST — Storage page: filter by date (L-273)
- Type: feature
- What: Settings → Storage has a "Saved" date filter: All time, Today, Last 7 days, Last 30 days, Older than 30 days, or Custom dates (one day, or a from–to range; leave one end empty for "before" or "since"). The groups, the "Showing N of M files" line and the delete buttons then cover only files saved in those dates, and the confirmation says so.
- Why: The user asked to filter by a single date or a from–to range before deleting.
- Files: [attachmentStorage.ts](../../src/features/settings/model/attachmentStorage.ts), [attachmentStorage.test.ts](../../src/features/settings/model/attachmentStorage.test.ts), [StorageSettings.tsx](../../src/features/settings/ui/StorageSettings.tsx), [attachment-storage-plan.md](../specs/attachment-storage-plan.md)
- Commit: uncommitted
- Verified: typecheck ✅ tests ✅ (full suite 8180 passed) lint — (no config) build —

## 2026-11-14 10:59 IST — Settings → Storage: saved attachments (L-273)
- Type: feature
- What: A new Storage page in Settings shows every image and file you pasted into chats, plus the copies Interactive Claude read, with their total size. View them by chat, by project or all together, newest first, with the date and time on each. Click an image to see it full size; copy it, show it in its folder, open the chat it came from, or drag it onto a composer. Delete one file, everything in a chat or project, files no chat uses any more, or everything; each delete asks first and says the images will disappear from those chats.
- Why: MonoCode keeps every pasted file forever (about 220 MB on this computer) with no way to see or clean them up.
- Files: [attachment_storage.rs](../../src-tauri/src/attachment_storage.rs), [lib.rs](../../src-tauri/src/lib.rs), [attachmentStorage.ts](../../src/features/settings/model/attachmentStorage.ts), [StorageSettings.tsx](../../src/features/settings/ui/StorageSettings.tsx), [settings.ts](../../src/features/settings/model/settings.ts), [SettingsRail.tsx](../../src/app/shell/SettingsRail.tsx), [SettingsView.tsx](../../src/features/settings/ui/SettingsView.tsx), tests beside the model and in the Rust module
- Commit: uncommitted
- Verified: typecheck ✅ cargo test ✅ (attachment_storage 3) cargo build ✅ tests ✅ (full suite after index fix; settings 515) lint — (no config) build —

## 2026-11-14 10:36 IST — MCP page shows each Claude account's servers (L-272)
- Type: feature
- What: Settings → MCP now lists the MCP servers saved in each Claude account MonoCode manages, beside the ones in your home Claude config. Each row shows which file it comes from. Turning a server on or off, or removing it, changes that account's own file.
- Why: The page only read the home config, but Claude chats in MonoCode run on an account config, so servers added there (like the Aside computer-use server) didn't show and couldn't be switched off.
- Files: [mcp.rs](../../src-tauri/src/mcp.rs), [controls.rs](../../src-tauri/src/mcp/controls.rs), [controls/tests.rs](../../src-tauri/src/mcp/controls/tests.rs), [harness.rs](../../src-tauri/src/harness.rs), [McpSettings.tsx](../../src/features/settings/ui/McpSettings.tsx)
- Commit: uncommitted
- Verified: typecheck ✅ cargo test ✅ (mcp 39) cargo build ✅ tests ✅ (settings 511) lint — (no config) build —

## 2026-11-14 10:29 IST — Whiteboard sends images to Interactive Claude (L-271)
- Type: feature
- What: When a Whiteboard chat runs on Interactive Claude, the board snapshot and any pasted images now go to Claude, the same as other helpers that can see images. Claude opens those files without asking for approval, but any other file it tries to read still asks. Continue cards also now use only the models you picked in AI helper (part of L-269).
- Why: The user said Whiteboard with Interactive CLI couldn't take images, so it wasn't much use; and asked that Claude Code never run as a helper unless picked, for Continue cards too.
- Files: [whiteboardHelper.ts](../../src/integrations/harness/core/whiteboardHelper.ts), [claudeInteractiveHelper.ts](../../src/integrations/harness/providers/claude/claudeInteractiveHelper.ts), [claudeInteractive.ts](../../src/integrations/harness/providers/claude/claudeInteractive.ts), [WhiteboardChat.tsx](../../src/features/whiteboard/ui/WhiteboardChat.tsx), [continueHelper.ts](../../src/integrations/harness/core/continueHelper.ts), tests beside each
- Commit: uncommitted
- Verified: typecheck ✅ lint — (no config) tests ✅ (harness + whiteboard 1553) build —

## 2026-11-14 10:03 IST — Interactive Claude takes PDFs (L-270)
- Type: feature
- What: You can now attach a PDF to an Interactive Claude chat. MonoCode saves it and Claude reads it with its own file tool. Word, Excel and other files Claude can't open still show an error.
- Why: The user asked why PDFs were refused when Interactive only hands Claude a file path anyway. Claude Code's Read tool reads PDFs.
- Files: [claude_interactive.rs](../../src-tauri/src/claude_interactive.rs)
- Commit: uncommitted
- Verified: typecheck ✅ cargo test ✅ lint — (no config) build —

## 2026-11-14 10:03 IST — Helpers use only the models you picked (L-269)
- Type: fix
- What: With AI helper set to Choose a model, Session overview and Improve prompt now try only their own model, then the AI helper's main and backup models. If all of them fail, you see the reason instead of another provider (Claude Code, Gemini) quietly doing the work. Automatic still tries every installed provider.
- Why: The user picked Command Code and OpenCode for helpers, but a failing pick fell through to Claude Code or Gemini, spending their quota without asking.
- Files: [sessionMetadataHelper.ts](../../src/integrations/harness/core/sessionMetadataHelper.ts), [sessionMetadataHelper.test.ts](../../src/integrations/harness/core/sessionMetadataHelper.test.ts)
- Commit: uncommitted
- Verified: typecheck ✅ lint — (no config) tests ✅ (helpers 397) build —

## 2026-11-14 09:50 IST — Hari: image attachments show as thumbnails (L-268)
- Type: fix
- What: In Hari, a message sent with images now shows small thumbnails instead of only "1 attachment". Tapping a thumbnail opens the image full screen. Other files show their name. The computer sends a smaller copy of the image only when the phone asks for it.
- Why: The user couldn't see or open what they had attached from the phone.
- Files: [mobileAttachmentPreview.ts](../../src/features/mobile/model/mobileAttachmentPreview.ts), [mobileWorkspace.ts](../../src/features/mobile/model/mobileWorkspace.ts), [useMobileWorkspace.ts](../../src/features/mobile/hooks/useMobileWorkspace.ts), [mobileTranscript.ts](../../src/features/mobile/model/mobileTranscript.ts), [mobile_access.rs](../../src-tauri/src/mobile_access.rs), [MessageAttachments.tsx](../../mobile/src/features/sessions/MessageAttachments.tsx), [attachmentImages.ts](../../mobile/src/features/sessions/attachmentImages.ts), [TranscriptTurn.tsx](../../mobile/src/features/sessions/TranscriptTurn.tsx)
- Commit: uncommitted
- Verified: typecheck ✅ (desktop, Hari) lint ✅ (Hari) tests ✅ build —

## 2026-11-14 09:50 IST — Tool commands unfold on click (L-267)
- Type: feature
- What: A long command in a finished tool row still shows on one line, but hovering shows it in full and clicking unfolds it onto several lines. Clicking again folds it.
- Why: The user saw tool commands always cut off. One line keeps the activity list even and easy to scan, so unfolding is on demand.
- Files: [AgentTranscript.tsx](../../src/features/sessions/ui/AgentTranscript.tsx), [AgentTranscript.toolWrap.test.ts](../../src/features/sessions/ui/AgentTranscript.toolWrap.test.ts)
- Commit: uncommitted
- Verified: typecheck ✅ lint — (no config) tests ✅ build —

## 2026-11-14 09:50 IST — Interactive Claude: per-chat Reasoning shown (L-266)
- Type: feature
- What: The model picker's Interactive section has a "Reasoning shown" choice: Off, Highlights or Summaries (default). Changing it restarts Claude for that chat with the new setting.
- Why: The user asked for Claude Code's thinking display setting inside chats. Summaries do not cost extra tokens.
- Files: [claude_interactive.rs](../../src-tauri/src/claude_interactive.rs), [models.ts](../../src/features/sessions/model/models.ts), [claudeInteractive.ts](../../src/integrations/harness/providers/claude/claudeInteractive.ts), [ModelPicker.tsx](../../src/features/sessions/ui/ModelPicker.tsx)
- Commit: uncommitted
- Verified: typecheck ✅ cargo check ✅ lint — (no config) tests ✅ build —

## 2026-11-14 09:13 IST — Interactive Claude shows auto-compaction and background tasks (L-265)
- Type: fix
- What: In Interactive Claude sessions, an automatic compaction now shows "Compacting context…" and then "Compacted context", so the chat no longer looks stuck. Background tasks Claude leaves running after a reply (Monitor, background commands) now show as "1 task running in background · <name>" under the chat until they finish or the session is stopped.
- Why: The user saw Interactive Claude look frozen during auto-compaction and lose track of background tasks once a turn ended. Interactive received both hooks but showed nothing for them. A terminal window stealing focus while typing was traced to open Claude Code CLI issues, not MonoCode, so no change was made for it.
- Files: [claudeInteractive.ts](../../src/integrations/harness/providers/claude/claudeInteractive.ts), [claudeInteractive.test.ts](../../src/integrations/harness/providers/claude/claudeInteractive.test.ts), [AgentTranscript.tsx](../../src/features/sessions/ui/AgentTranscript.tsx), [AgentTranscript.background.test.ts](../../src/features/sessions/ui/AgentTranscript.background.test.ts)
- Commit: uncommitted
- Verified: typecheck ✅ lint — (no config) tests ✅ build —

## 2026-11-14 08:10 IST — Zen: Settings button in the top bar (L-264)
- Type: feature
- What: Zen's top-right buttons now include Settings (a gear, after Keep on top). Clicking it leaves Zen, waits for the window to grow back to full size, then opens Settings.
- Why: The user asked for a Settings button in Zen. Settings is a full page that Zen's narrow panel can't hold, so it opens in the normal window, like Focus mode's Settings button.
- Files: [ZenView.tsx](../../src/features/zen/ui/ZenView.tsx), [App.tsx](../../src/app/App.tsx), [ZenView.test.ts](../../src/features/zen/ui/ZenView.test.ts)
- Commit: uncommitted
- Verified: typecheck ✅ lint — (no config) tests ✅ (zen 34) build —

## 2026-11-13 22:51 IST — Settings model dropdowns show Free and locked models (L-263)
- Type: fix
- What: The model dropdowns in Settings (AI helper, Improve prompt, Session overview and each provider's default model) now show the Free pill and a lock like the chat picker does. Locked models are greyed, say why on hover (e.g. "Locked: Needs Goat plan") and can't be picked.
- Why: The user saw no Free badge and no lock in the Command Code model list. The chat picker had them since L-259, but the Settings dropdowns built their options from the model name only and dropped both.
- Files: [ModelBadges.tsx](../../src/features/sessions/ui/ModelBadges.tsx), [SelectMenu.tsx](../../src/features/sessions/ui/SelectMenu.tsx), [SettingsView.tsx](../../src/features/settings/ui/SettingsView.tsx), [modelOptionMarks.test.ts](../../src/features/sessions/ui/modelOptionMarks.test.ts)
- Commit: uncommitted
- Verified: typecheck ✅ lint — (no config) tests ✅ (settings, sessions, prompt-improve: 2606) build —

## 2026-11-13 22:45 IST — Improve prompt says why it used another helper (L-262)
- Type: fix
- What: When the AI helper chosen for Improve prompt fails and another one writes the rewrite, the strip now says so, e.g. "Rewritten by Gemini · Command Code tried a tool", with the full reason on hover. A chosen helper that is not available is named too, and each failure is logged to the developer console with the provider's own error.
- Why: The user picked Command Code (Muse Ember) for Improve prompt but Gemini wrote the rewrite with no explanation. The helper code works against the real CLI in tests, so the in-app failure could not be reproduced; this makes its reason visible.
- Files: [promptImproveHelper.ts](../../src/integrations/harness/core/promptImproveHelper.ts), [usePromptImprove.ts](../../src/features/prompt-improve/ui/usePromptImprove.ts), [PromptImproveControls.tsx](../../src/features/prompt-improve/ui/PromptImproveControls.tsx), tests
- Commit: uncommitted
- Verified: typecheck ✅ lint — (no config) tests ✅ (prompt-improve 69) build —

## 2026-11-12 16:33 IST — Command Code headless with every model; Free and locked models; copy and drag of sent images (L-258 to L-261)
- Type: feature
- What: Command Code chats now run the CLI directly for each message and continue the same conversation, so the model picker lists every model the Go plan can use (Muse Ember included). Models from other plans show greyed with a lock and a reason ("Needs Pro plan", "Pay per use") and can't be picked; free models carry a Free pill. Access is Read only or Full access; Plan never edits. Copying a sent message now includes its images after a restart, and a sent image or file can be dragged onto any chat's composer to attach it again.
- Why: The user is on Command Code's Go plan and wanted every usable model (the old ACP connection listed fewer), locked plan and pay-per-use models, Free badges, a fix for copying images after a restart, and dragging images inside MonoCode. Supervised approvals are not used, so print mode's lack of approval prompts is fine.
- Files: [commandCode.ts](src/integrations/harness/providers/command-code/commandCode.ts), [commandCodeProtocol.ts](src/integrations/harness/providers/command-code/commandCodeProtocol.ts), [commandCodeCatalog.ts](src/integrations/harness/providers/command-code/commandCodeCatalog.ts), [command_code.rs](src-tauri/src/command_code.rs), [harness.rs](src-tauri/src/harness.rs), [lib.rs](src-tauri/src/lib.rs), [child-backend.ts](host/child-backend.ts), [child.ts](src/integrations/harness/core/child.ts), [models.ts](src/features/sessions/model/models.ts), [session.ts](src/features/sessions/model/session.ts), [ModelBadges.tsx](src/features/sessions/ui/ModelBadges.tsx), [ModelPicker.tsx](src/features/sessions/ui/ModelPicker.tsx), [QuickModelSelector.tsx](src/features/quick-composer/ui/QuickModelSelector.tsx), [clipboard.ts](src/platform/tauri/clipboard.ts), [usePathPointerDrag.ts](src/features/sessions/hooks/usePathPointerDrag.ts), [AttachmentChip.tsx](src/features/sessions/ui/AttachmentChip.tsx), [WhiteboardChat.tsx](src/features/whiteboard/ui/WhiteboardChat.tsx); tests `commandCodeProtocol.test.ts`, `commandCodeLive.test.ts`, `commandCodeCatalog.test.ts`, `clipboard.test.ts`; spec [command-code-plan.md](docs/specs/command-code-plan.md)
- Commit: uncommitted
- Verified: typecheck ✅ tests ✅ (full suite 8143 passed; iconCatalog timed out under load, passes alone) cargo test (targeted) ✅ rustfmt ✅ lint — (no config); desktop check manual

## 2026-11-12 11:26 IST — Fix older images going blank in long chats (L-257)
- Type: fix
- What: In a chat with many images, the older ones showed as broken thumbnails and opened to an empty full-screen view, though the files were still on disk. They now stay visible.
- Why: The user asked why past images in an Interactive Claude chat could not be seen. Images saved only as a path are loaded into a short-lived link, and at most 50 are kept; past 50 the oldest link was thrown away even while its image was still on screen. That chat had 60 images. Images now keep their link while they are shown. Every chat type had the bug, not only Interactive Claude.
- Files: [attachments.ts (lines 255–299)](src/features/sessions/model/attachments.ts:255), [AttachmentChip.tsx (lines 13–16, 34–46)](src/features/sessions/ui/AttachmentChip.tsx:13), [WhiteboardChat.tsx (lines 15–22, 96–108)](src/features/whiteboard/ui/WhiteboardChat.tsx:96), [attachments.test.ts (lines 290–325)](src/features/sessions/model/attachments.test.ts:290)
- Commit: uncommitted
- Verified: typecheck ✅ tests ✅ (sessions + whiteboard 2079/2079; the new test fails without the fix) lint — (no config) desktop check manual

## 2026-11-12 11:21 IST — Fix Command Code shown as "not found" in Settings
- Type: fix
- What: Settings → Providers said Command Code CLI (cmdc) was not found, though it was installed and logged in and chats with it worked. The availability check now finds `cmdc` like every other provider.
- Why: The check (`harness_probe_provider`) had its own list of providers and Command Code was missing from it, so it answered "Unknown harness provider" and the pane showed the install hint. Chats used a different lookup, which is why they worked. Part of L-255.
- Files: [harness.rs (lines 1002–1007, test 2300–2318)](src-tauri/src/harness.rs:1002)
- Commit: uncommitted
- Verified: cargo check ✅ rustfmt ✅ `provider_probe_knows_command_code` ✅ live probe finds `cmdc.cmd` ✅ lint — (no config) desktop check manual

## 2026-11-12 10:39 IST — Hari release 0.16.0-local41 (Command Code provider)
- Type: chore
- What: Published `hari-v0.16.0-local41` (run 43157267463) as the latest release: desktop installer with updater signature, Hari APK (versionCode 160041), `latest.json`, `hari-android.json`.
- Why: Ships Command Code as a chat provider and AI helper (L-255). The user asked to push so GitHub builds a version to update to and check.
- Files: version bump in `package.json`, `package-lock.json`, `Cargo.toml`, `Cargo.lock`, `src-tauri/tauri.conf.json`
- Commit: 928bf3b8
- Verified: CI ✅ (all four jobs); `latest.json` and `hari-android.json` served from releases/latest with 0.16.0-local41 ✅; desktop and phone checks manual

## 2026-11-12 10:32 IST — Zen: the chat dropdown shows the open chat first (L-256)
- Type: feature
- What: In Zen, a pane's chat dropdown now lists the chat that's open in that pane at the top, outlined in your accent colour with a "Current" tag and a line under it. Choosing it just closes the dropdown. Before, the open chat was missing from the list.
- Why: User request: show the current session at the top of the dropdown, with a border, so it's clear which one is active.
- Files: [ZenView.tsx (lines 230–266, 829)](src/features/zen/ui/ZenView.tsx:230), [FocusPicker.tsx (lines 72, 714, 736)](src/features/focus/ui/FocusPicker.tsx:72), [FocusPicker.test.ts (line 162)](src/features/focus/ui/FocusPicker.test.ts:162)
- Commit: uncommitted
- Verified: typecheck ✅ vitest focus + zen 121/121 ✅ lint — (no ESLint config in the repo); desktop check manual

## 2026-11-12 10:02 IST — Command Code as a provider and AI helper (L-255)
- Type: feature
- What: Command Code (`cmdc`) is a new provider. In the model picker it lists the account's models (its current one first), Effort, and works with every access level and Plan, approvals, cancel and resume after a restart. Settings → AI helper can use it for Session overview, Improve prompt and Continue; those replies run in Plan mode in an empty folder and fail if it tries to use a tool. If `cmdc` isn't installed, the message says how to install it and sign in. Chats and helper tasks on Command Code send their text to Command Code's servers.
- Why: The user bought a Command Code subscription and asked to use it like the other providers and as the AI helper.
- Files: [commandCode.ts (line 78)](src/integrations/harness/providers/command-code/commandCode.ts:78), [commandCodeProtocol.ts](src/integrations/harness/providers/command-code/commandCodeProtocol.ts), [commandCodeCatalog.ts](src/integrations/harness/providers/command-code/commandCodeCatalog.ts), [commandCodeHelper.ts](src/integrations/harness/providers/command-code/commandCodeHelper.ts), [commandCodeAdapter.ts](src/integrations/harness/providers/command-code/commandCodeAdapter.ts), [session.ts (line 36)](src/features/sessions/model/session.ts:36), [settings.ts (line 1122)](src/features/settings/model/settings.ts:1122), [helperIsolation.ts (line 20)](src/integrations/harness/core/helperIsolation.ts:20), [HarnessIcon.tsx (line 165)](src/features/sessions/ui/HarnessIcon.tsx:165), [command-code.svg](src/assets/providers/command-code.svg), [harness.rs (lines 1036, 3598)](src-tauri/src/harness.rs:1036), [command_code.rs](src-tauri/src/command_code.rs), plus `models.ts`, `availability.ts`, `availabilityState.ts`, `child.ts`, `cliVersions.ts`, `register.ts`, `providerBinaryPaths.ts`, `lib.rs`; spec [command-code-plan.md](docs/specs/command-code-plan.md)
- Commit: uncommitted
- Verified: typecheck ✅ vitest ✅ (18 new tests; 5 list/height expectations updated for the extra provider; full run otherwise green) cargo check ✅ cargo test command_code ✅ rustfmt (new code) ✅ lint — (no ESLint config in the repo); desktop check manual

## 2026-11-12 08:45 IST — Hari release 0.16.0-local40 (Activity scroll, Live Updates permission)
- Type: chore
- What: Published `hari-v0.16.0-local40` (run 43091495606) as the latest release: desktop installer with updater signature, Hari APK (versionCode 160040), `latest.json`, `hari-android.json`. local39 has a tag but no release (its run failed at Version; see the 01:23 entry).
- Why: Ships Activity notes and log scrolling in place with an All | Notes switch (L-253) and the foreground-service permission Live Updates need (L-254). The user asked to push a new release including the Activity changes.
- Files: version bump in `package.json`, `package-lock.json`, `Cargo.toml`, `Cargo.lock`, `src-tauri/tauri.conf.json`
- Commit: b05b2192
- Verified: CI ✅ (all four jobs); `latest.json` and `hari-android.json` served from releases/latest with 0.16.0-local40 ✅; desktop and phone checks manual

## 2026-11-12 01:23 IST — Hari release run failed on local39; config fix, release as local40 (L-254)
- Type: fix
- What: The local39 release stopped at its first step (run 43091034448), before building anything, so nothing was published. That step reads the phone app's settings file before any package is installed, and the L-254 change made the file load an Expo package. The list of Live Update permissions now sits in a small file of its own, and a test checks that the settings file loads without any package. The release goes out as 0.16.0-local40; the `hari-v0.16.0-local39` tag stays on GitHub without a release.
- Why: Release run failure ("Cannot find module 'expo/config-plugins'" from `with-live-update-permissions.js`).
- Files: [live-update-permissions.js](mobile/plugins/live-update-permissions.js), [app.config.js (line 7)](mobile/app.config.js:7), [with-live-update-permissions.js (line 8)](mobile/plugins/with-live-update-permissions.js:8), [nativePermissions.test.ts (lines 98–113)](mobile/tests/nativePermissions.test.ts:98)
- Commit: uncommitted
- Verified: mobile typecheck ✅ lint ✅ nativePermissions 6/6 ✅; the Version job's `node -e "require('./mobile/app.config.js')..."` runs locally ✅

## 2026-11-12 01:12 IST — Hari: Live Updates can start; the APK keeps the foreground-service permission (L-254)
- Type: fix
- What: Turning on Live Updates in Hari showed "Live Updates turned off … requires android.permission.FOREGROUND_SERVICE" and the running-session card never appeared. The phone app was built without the permission Android needs for that card. It now has it, so the card can show on the status bar and lock screen.
- Why: The user sent the phone notice and asked what it meant. Upstream's phone app blocks that permission (it plays no background audio), and the block also removed the one Hari's Live Update module asks for.
- Files: [app.config.js (blockedPermissions, permissions, plugin)](mobile/app.config.js:36), [with-live-update-permissions.js](mobile/plugins/with-live-update-permissions.js), [nativePermissions.test.ts (Live Update test)](mobile/tests/nativePermissions.test.ts:86)
- Commit: uncommitted
- Verified: mobile typecheck ✅ lint ✅ nativePermissions tests 5/5 ✅ (the introspected manifest has both permissions, no remove); APK build in CI; phone check manual

## 2026-11-12 00:18 IST — Hari release 0.16.0-local38 (Improve prompt, Interactive Claude fixes)
- Type: chore
- What: Published `hari-v0.16.0-local38` (run 43079131813) as the latest release: desktop installer with updater signature, Hari APK (versionCode 160038), `latest.json`, `hari-android.json`.
- Why: Ships Improve prompt with the rewrite animation and Stop (L-252), multi-line Interactive Claude messages no longer folding into "[Pasted text]" (L-250), and skills no longer pasted in full (L-251). The user asked to commit and push so GitHub builds it.
- Files: version bump in `package.json`, `package-lock.json`, `Cargo.toml`, `Cargo.lock`, `src-tauri/tauri.conf.json`
- Commit: 6af6a56b
- Verified: CI ✅ (desktop 6m2s, APK 12m18s, first try); `latest.json` and `hari-android.json` served from releases/latest with 0.16.0-local38 ✅; desktop and phone checks manual

## 2026-11-12 00:07 IST — Activity: notes and log scroll in place; a day can show only its notes (L-253)
- Type: feature
- What: In Activity, the Week/Month "Notes by day" list and the Day log no longer stretch the page: the right column is as tall as the left one (at least 320px, at most the visible Activity area, like the task panel) and the list scrolls inside it. On a narrow window, where the columns stack, the list stops at the visible height. The Day log has an **All | Notes** switch with the number of notes, and each day in "Notes by day" has **View notes**, which opens that day showing only its notes.
- Why: The user asked: the notes list ran far below everything else, and they wanted to read one day's notes on their own.
- Files: [ActivityLogFeed.tsx (SCROLL_LIST, filter)](src/features/activity/ui/ActivityLogFeed.tsx:190), [PeriodSummary.tsx (PeriodNotes)](src/features/activity/ui/PeriodSummary.tsx:131), [ActivityView.tsx (logFilter, openDayNotes, MatchLeftColumn)](src/features/activity/ui/ActivityView.tsx:72), [ActivityLogFeed.test.ts](src/features/activity/ui/ActivityLogFeed.test.ts)
- Commit: uncommitted
- Verified: tsc ✅ · vitest activity ✅ 26/26 · desktop check manual

## 2026-11-12 00:03 IST — Improve prompt: rewrite animation and a Stop button (L-252)
- Type: feature
- What: The rewrite now appears with the same animation as a changed chat title: the new text sweeps in from left to right while your draft breaks into particles (skipped with reduced motion). While a rewrite runs, a **Stop** button shows in the strip above the text and the ✨ button shows a stop square; either one (or Esc) ends it and keeps your text.
- Why: The user asked to reuse the title-change animation and asked for a way to stop a slow or stuck rewrite.
- Files: [RewriteReveal.tsx](src/features/prompt-improve/ui/RewriteReveal.tsx) (copy of upstream `ParticleText`, so it stays untouched), [usePromptImprove.ts (reveal)](src/features/prompt-improve/ui/usePromptImprove.ts:143), [PromptImproveControls.tsx (Stop)](src/features/prompt-improve/ui/PromptImproveControls.tsx:236), [Composer.tsx](src/features/sessions/ui/Composer.tsx:2669), [QuickComposer.tsx](src/features/quick-composer/ui/QuickComposer.tsx:1020), [RewriteReveal.test.ts](src/features/prompt-improve/ui/RewriteReveal.test.ts), [usePromptImprove.test.ts](src/features/prompt-improve/ui/usePromptImprove.test.ts)
- Commit: uncommitted
- Verified: tsc ✅ · vitest prompt-improve, helper, quick-composer, sessions/ui, settings ✅ 1503/1503 · prettier on new files and changed hunks ✅ · desktop check manual

## 2026-11-11 23:48 IST — Improve prompt: ✨ rewrites a rough draft into a clear prompt (L-252)
- Type: feature
- What: A ✨ button next to Send (or Ctrl+Alt+I) rewrites the draft in place into a clear, complete prompt that keeps every request, file path, mention, ID and a leading /command. **Original** switches back and forth (hold to peek), **Restore original** returns the first draft, and typing during a run keeps your text and offers **Use rewrite**; Esc cancels. It learns a "How I write" profile and a per-project glossary on this computer from rewrites you send or edit, and offers **Add to AGENTS.md** for a rule you state in 3 prompts. Settings → Chat has Improve prompt (model, effort, instructions with Reset) and How I write (profile, glossaries, Forget, Clear memory). Works in the chat composer and the Session board draft modal; hidden in remote-host chats; not in the floating quick composer or Hari yet.
- Why: The user asked for it after the prompting review: short, mixed-language drafts made agents miss or guess requests.
- Files: [promptImprove.ts](src/features/prompt-improve/model/promptImprove.ts), [promptImproveStore.ts](src/features/prompt-improve/model/promptImproveStore.ts), [agentsRule.ts](src/features/prompt-improve/model/agentsRule.ts), [usePromptImprove.ts](src/features/prompt-improve/ui/usePromptImprove.ts), [PromptImproveControls.tsx](src/features/prompt-improve/ui/PromptImproveControls.tsx), [promptImproveHelper.ts](src/integrations/harness/core/promptImproveHelper.ts), [sessionMetadataHelper.ts (param type)](src/integrations/harness/core/sessionMetadataHelper.ts), [Composer.tsx (usePromptImprove)](src/features/sessions/ui/Composer.tsx:1239), [QuickComposer.tsx](src/features/quick-composer/ui/QuickComposer.tsx), [settings.ts (keybinding, index)](src/features/settings/model/settings.ts), [SettingsView.tsx (PromptImproveGroup, PromptMemoryGroup)](src/features/settings/ui/SettingsView.tsx), 5 new test files, [spec](docs/specs/improve-prompt-plan.md)
- Commit: uncommitted
- Verified: tsc ✅ · vitest prompt-improve + helper ✅ 66/66 · quick-composer, sessions/ui Composer, settings, skills, session-todos, promptPreparation ✅ 860/860 · prettier on new files and changed hunks ✅ · no lint config in the repo · desktop check manual

## 2026-11-11 23:20 IST — Interactive Claude: skills Claude Code already has are no longer pasted in whole (L-251)
- Type: fix
- What: Using a `/skill` in an Interactive Claude chat pasted the skill's full text into the message each time. For skills Claude Code loads itself (`.claude/skills` and plugin skills), MonoCode now sends one line asking Claude to load the skill with its Skill tool, with the file path as a fallback. Other skills are still sent in full; Structured Claude is unchanged.
- Why: Found during the prompting review (7 skill uses in two chats added about 123k characters and brought compaction sooner); the user asked to fix it.
- Files: [skills.ts (SkillTurnOptions, applySkillsToTurn)](src/features/skills/model/skills.ts:440), [promptPreparation.ts](src/features/sessions/model/promptPreparation.ts:12), [App.tsx (3 send paths)](src/app/App.tsx:9617), [skillCatalog.test.ts](src/features/skills/model/skillCatalog.test.ts:557), [promptPreparation.test.ts](src/features/sessions/model/promptPreparation.test.ts:85)
- Commit: uncommitted
- Verified: tsc ✅ · vitest skills + promptPreparation ✅ 83/83 · new test fails without the fix · the old `preparePrompt` test now also expects the new options argument · desktop check manual

## 2026-11-11 23:13 IST — Interactive Claude: multi-line messages no longer fold into "[Pasted text]" (L-250)
- Type: fix
- What: In Interactive Claude, a message of 3+ lines turned into a "[Pasted text #1 +N lines]" pill, and Claude passed it to the model as quoted material the user "did not write", so the model could ignore instructions in it. MonoCode now pastes each message as several small pieces, which Claude inserts as plain typed text. Very long messages (about 240+ lines) still fold.
- Why: Found during the prompting review; the user asked to fix it. Cause: Claude folds any single paste over 800 characters or 2 line breaks, and MonoCode sent everything after the first letter as one paste.
- Files: [interactive_delivery.rs (chunks, payload)](src-tauri/src/interactive_delivery.rs:22), [interactive-pty-host.py (chunks)](src/integrations/harness/providers/claude/fixtures/interactive-pty-host.py:51), [claudeInteractiveCli.test.ts (fold check)](src/integrations/harness/providers/claude/claudeInteractiveCli.test.ts:673)
- Commit: uncommitted
- Verified: cargo test `interactive` ✅ 25/25 · vitest `providers/claude` ✅ 341 (2 skipped) · tsc ✅ · rustfmt ✅ · clippy on the changed file ✅ (7 old errors in harness.rs, claude_interactive.rs, mobile_router.rs) · real-CLI messages-only run ✅ both modes; the old payload fails the new fold check · the full real-CLI run fails at line 780 (background continuation) with the old code too · desktop check manual

## 2026-11-11 18:52 IST — Hari release 0.16.0-local37 (Live Updates crash, chat spinner, all running sessions)
- Type: chore
- What: Published `hari-v0.16.0-local37` (run 43025608667) as the latest release: desktop installer with updater signature, Hari APK (versionCode 160037), `latest.json`, `hari-android.json`.
- Why: Ships the Live Updates launch-crash fix (L-247), the reopened-chat spinner fix (L-248) and every running session on a project's screen (L-249).
- Files: GitHub release only.
- Commit: b1d576b7, 41789cab, 93a14bcc (changes), 5a963bea (records), 010515ce (version)
- Verified: CI ✅ (desktop 8m28s, APK 17m27s, first try; changed `hari-live` Kotlin compiled); `hari-android.json` served from releases/latest with 0.16.0-local37 ✅; phone checks manual

## 2026-11-11 18:31 IST — Hari: every running session on a project's screen (L-249)
- Type: feature
- What: With several sessions running, a project's screen showed only one at a time ("1 of 2") with a skip button. Now every running session shows: the first in the big pill and each other one in its own pill above it, each with open and stop.
- Why: Request on local36 with a screenshot of the "1 of 2" pill.
- Files: [LiveSessions.tsx (NowWorking)](mobile/src/features/sessions/LiveSessions.tsx:171), [LiveSessions.test.tsx](mobile/tests/LiveSessions.test.tsx)
- Commit: uncommitted
- Verified: tsc ✅ expo lint ✅ (0 errors; 2 old warnings) vitest ✅ 245/245 (`../tests/mobile/watchFrames.test.ts` fails to load, pre-existing) · the old skip/"2 of 2" test was rewritten for the new design · phone check manual

## 2026-11-11 18:31 IST — Hari: reopened long chats no longer spin until you scroll (L-248)
- Type: fix
- What: Reopening a chat with long messages showed blank, then a spinner that kept going until you scrolled. The chat now goes straight to its newest messages.
- Why: Report on local36 with a screenshot. Cause: the desktop sends the latest 30 turns, the list draws only its first 25 on opening, so the newest rows were never drawn and the chat waited for them forever. It now scrolls to the end once when that happens, which draws them.
- Files: [Transcript.tsx (INITIAL_ROWS, update)](mobile/src/features/sessions/Transcript.tsx:263), [Transcript.test.tsx](mobile/tests/Transcript.test.tsx)
- Commit: uncommitted
- Verified: tsc ✅ expo lint ✅ (0 errors; 2 old warnings) vitest ✅ 245/245 (watchFrames load failure pre-existing) · new test fails without the fix · phone check manual

## 2026-11-11 17:01 IST — Hari: Live Updates no longer close the app (L-247)
- Type: fix
- What: With Live Updates on and sessions running, Hari closed on every launch until the sessions ended. Now, if the running-session card can't be shown, Hari turns Live Updates off and the notice says Android's reason, instead of closing.
- Why: Report on local36 with the Xiaomi crash report: `ForegroundServiceDidNotStartInTimeException` from `HariLive.start`. `startForegroundService` lets Android close the app if the service doesn't reach the foreground in time, past any try/catch. The service is now started plainly and goes to the foreground itself, or stops.
- Files: [HariLive.kt](mobile/modules/hari-live/android/src/main/java/expo/modules/harilive/HariLive.kt), [HariLiveService.kt](mobile/modules/hari-live/android/src/main/java/expo/modules/harilive/HariLiveService.kt), [LiveUpdates.tsx](mobile/src/features/liveUpdates/LiveUpdates.tsx), [liveService.test.ts](mobile/tests/liveService.test.ts)
- Commit: uncommitted
- Verified: tsc ✅ expo lint ✅ (0 errors; 2 old warnings) vitest ✅ 243/243 (`../tests/mobile/watchFrames.test.ts` fails to load, pre-existing) · new test fails on the old Kotlin · Kotlin compiles in CI only · phone check manual

## 2026-11-11 11:18 IST — Hari release 0.16.0-local36 (look fixes, no blank chat)
- Type: chore
- What: Published `hari-v0.16.0-local36` (run 42966015450) as the latest release: desktop installer with updater signature, Hari APK (versionCode 160036), `latest.json`, `hari-android.json`.
- Why: Ships the local35 look fixes (L-245 follow-up) and the blank-chat fix with its loading spinner (L-246).
- Files: GitHub release only.
- Commit: 8b118ffe, 451f7e45 (fixes), 213ab706 (version)
- Verified: CI ✅ (desktop 6m08s, APK 18m45s, first try; new `hari-system-bars` Kotlin module compiled); `hari-android.json` served from releases/latest with 0.16.0-local36 ✅; phone and desktop checks manual

## 2026-11-11 10:49 IST — Hari: no blank chat after quick scrolls (L-246)
- Type: fix
- What: A chat that got shorter right after opening could leave the phone on empty space, with the scroll-down button showing and a long scroll up to the messages. The chat now notices every scroll on Android, so it sees when you are past the end and brings the end back. And while a reopened chat is still placing the messages it already has, a spinner shows instead of only the wallpaper, so a wait no longer looks like an empty chat.
- Why: Report on local35 (screenshot: empty chat, chevron showing), and the follow-up that the chat might have been loading with no loader shown. Cause: Android drops a scroll event that comes within 100 ms of the last one and never sends the final position, so after two quick scrolls the transcript's place was stale and L-238's back-to-the-end check missed it.
- Files: [Transcript.tsx (scrollEventThrottle, unsettled spinner, TranscriptLoading)](mobile/src/features/sessions/Transcript.tsx:431), [Transcript.test.tsx](mobile/tests/Transcript.test.tsx)
- Commit: uncommitted
- Verified: tsc ✅ expo lint ✅ (0 errors; 2 old warnings) vitest ✅ 241/241 (`../tests/mobile/watchFrames.test.ts` fails to load, pre-existing) · both new tests fail without their change · phone check manual

## 2026-11-11 10:22 IST — Hari look fixes: wallpaper edge to edge, accent switches, readable text (L-245)
- Type: fix
- What: On the phone, the wallpaper now shows under the header, the composer and the navigation bar instead of plain strips; switches and sliders are wholly in the accent colour; text over a wallpaper is easier to read (stronger default dim, darker grey text in light mode); the transcript no longer shows through the composer when photos are attached or a draft is long.
- Why: Feedback on local35: top and bottom looked bad, switches had a green thumb, light mode was hard to read, and typed text sat over chat text.
- Files: [Backdrop.tsx](mobile/src/features/wallpaper/Backdrop.tsx), [GradualBlur.tsx](mobile/src/ui/GradualBlur.tsx), [SessionScreen.tsx](mobile/src/features/sessions/SessionScreen.tsx), [_layout.tsx](mobile/src/app/_layout.tsx), [reading.ts](mobile/src/features/wallpaper/reading.ts), [wallpaper.ts](mobile/src/features/wallpaper/wallpaper.ts), [theme.ts](mobile/src/ui/theme.ts), [AccentSwitch.tsx](mobile/src/ui/AccentSwitch.tsx), [appearance.tsx](mobile/src/app/settings/appearance.tsx), settings index/models and ModelPicker (switch swap), [systemBars.ts](mobile/src/ui/systemBars.ts), [hari-system-bars module](mobile/modules/hari-system-bars), [with-system-bars.js](mobile/plugins/with-system-bars.js), [app.config.js](mobile/app.config.js), tests (look, SessionScreen)
- Commit: uncommitted
- Verified: tsc ✅ expo lint ✅ (0 errors; 2 old warnings in dictation.ts) vitest ✅ 239/239 (`../tests/mobile/watchFrames.test.ts` fails to load, pre-existing) · config plugin checked with `expo config --type introspect` · Kotlin not compiled locally (CI) · phone checks manual

## 2026-11-11 09:34 IST — Hari release 0.16.0-local35 (look, Tasks Focus, Antigravity ACP removed)
- Type: chore
- What: Published `hari-v0.16.0-local35` (run 42955404219) as the latest release: desktop installer with updater signature, Hari APK (versionCode 160035), `latest.json`, `hari-android.json`.
- Why: Ships the Hari look (L-245), Tasks Focus and Carry over (L-243), the Antigravity ACP removal (L-244) and the Interactive Claude fork fix (L-242).
- Files: GitHub release only.
- Commit: 3a721f5d, 940e2213, 061de1e8 (features), 42e2e3b1 (version)
- Verified: CI ✅ (desktop 7m02s, APK 13m00s, first try, Kotlin `setColor` change compiled); `hari-android.json` served from releases/latest with 0.16.0-local35 ✅; phone and desktop checks manual

## 2026-11-11 09:20 IST — Hari look: accent, tint and wallpaper (L-245); version 0.16.0-local35
- Type: feature
- What: Hari phone app, Settings → Appearance:
  - **Accent:** seven colours, any hue from a slider, or "Match wallpaper". Send and stop, dictation's done, Commit, checkboxes, switches and the Live Update card take it, with readable white or dark ink on top.
  - **Tint:** a switch and strength slider that wash backgrounds, cards and sheets in the accent's hue (the old themes did this at a fixed strength).
  - **Wallpaper:** none, six built-in pictures (one follows the accent) or a photo, behind the side menu, project and Mono lists, chats, Tasks, Notes and Settings. Sliders for dim (light and dark apart), card opacity and softness. Chats dim it a little more so messages read well.
  - **Empty-chat photo:** fills the whole screen as the photo itself; the dither is now an option (off by default).
  - Old theme choices carry over (for example Grove becomes the Jade accent with a light tint).
  - Version bumped to 0.16.0-local35 (desktop and phone) for the release.
- Why: User report: the themes weren't visible anywhere, not even on the send button, and the per-chat photo was dithered and didn't fill the screen. User picked 1-A and skipped the spec.
- Files: [theme.ts](mobile/src/ui/theme.ts), [wallpaper.ts](mobile/src/features/wallpaper/wallpaper.ts), [presets.ts](mobile/src/features/wallpaper/presets.ts), [Backdrop.tsx](mobile/src/features/wallpaper/Backdrop.tsx), [appearance.tsx](mobile/src/app/settings/appearance.tsx), [_layout.tsx](mobile/src/app/_layout.tsx), [ScenePager.tsx](mobile/src/ui/ScenePager.tsx), [codeScreen.tsx](mobile/src/features/files/codeScreen.tsx), [useEmptyBackground.ts](mobile/src/features/background/useEmptyBackground.ts), [EmptySession.tsx](mobile/src/features/sessions/EmptySession.tsx), [Composer.tsx](mobile/src/features/sessions/Composer.tsx), [DictationBar.tsx](mobile/src/features/sessions/DictationBar.tsx), [CommitSheet.tsx](mobile/src/features/changes/CommitSheet.tsx), [ChangesView.tsx](mobile/src/features/changes/ChangesView.tsx), [LiveUpdates.tsx](mobile/src/features/liveUpdates/LiveUpdates.tsx), [nativeLive.ts](mobile/src/features/liveUpdates/nativeLive.ts), [HariLive.kt](mobile/modules/hari-live/android/src/main/java/expo/modules/harilive/HariLive.kt), drawer/sidebar/Mono home page colours, `expo-image` added; [look.test.ts](mobile/tests/look.test.ts), [WorkspaceLayout.test.tsx](mobile/tests/WorkspaceLayout.test.tsx) (mocks the backdrop); version in package.json, package-lock.json, Cargo.toml, Cargo.lock, tauri.conf.json
- Commit: uncommitted
- Note: the wallpaper is softened once by the image view (no live blur), so screens slide as cheaply as with a photo. Code, diffs and bottom sheets stay solid. No reduce-transparency fallback: React Native has no Android API for it.
- Verified: mobile tsc ✅, expo lint ✅ (2 old warnings in dictation.ts), vitest ✅ 237/237 (`tests/mobile/watchFrames.test.ts` fails to load as before, unrelated); Kotlin built in CI; phone check manual

## 2026-11-11 08:22 IST — Hari running-project row height; Notes listener rejections
- Type: fix
- What: In the Hari side menu, a project with running chats no longer sits taller than the other projects (its row is now 52dp like the rest). On the desktop, Notes no longer leaves an unhandled error behind when it listens for notes saved from the phone outside the app (tests showed "transformCallback" errors).
- Why: User report (screenshot of the running card's extra padding) and question about the Notes test errors.
- Files: [WorkspaceDrawer.tsx (lines 758–761)](mobile/src/features/workspace/WorkspaceDrawer.tsx:758), [NotesView.tsx (lines 196–204)](src/features/notes/ui/NotesView.tsx:196)
- Commit: uncommitted
- Verified: mobile tsc ✅ expo lint ✅; root tsc ✅; vitest notes 65 ✅

## 2026-11-11 07:49 IST — Remove Antigravity ACP (L-244)
- Type: refactor
- What: Antigravity through Google's ACP runtime (`agy_acp_server`) is gone from the desktop app, the phone app and the remote host: its provider, Providers setup panel, models, MCP rows, AI-helper option and settings. Antigravity CLI (`agy`) stays and is unchanged. Imported Antigravity conversations now open in Antigravity CLI.
- Why: User request (chose to remove it completely, including the `antigravity` id). The ACP runtime started a large tree of MCP servers and was no longer used.
- Files: deleted `src-tauri/src/antigravity_acp.rs`, `src/integrations/harness/core/antigravity*.ts`, `AntigravitySetupPanel.tsx`, `host/antigravity.ts`, `host/antigravity-browser.mjs`; [antigravity_cli.rs](src-tauri/src/antigravity_cli.rs) (`antigravity_helper_directory` moved here), [harness.rs](src-tauri/src/harness.rs), [mcp.rs](src-tauri/src/mcp.rs), [controls.rs](src-tauri/src/mcp/controls.rs), [lib.rs](src-tauri/src/lib.rs), [main.rs](src-tauri/src/main.rs), [session.ts](src/features/sessions/model/session.ts), [sessionImport.ts](src/integrations/harness/core/sessionImport.ts), [ModelPicker.tsx](src/features/sessions/ui/ModelPicker.tsx), [SettingsView.tsx](src/features/settings/ui/SettingsView.tsx), [McpSettings.tsx](src/features/settings/ui/McpSettings.tsx), [providers.ts](host/providers.ts), [server.ts](host/server.ts), [types.ts](mobile/src/features/workspace/types.ts) and their tests; [spec](docs/specs/remove-antigravity-acp.md)
- Commit: uncommitted
- Note: a remote host only lists harnesses the desktop knows, so remote Antigravity ACP is gone too. An `agy_acp_server` tree that is already running is not stopped; end it from the process monitor.
- Verified: root tsc ✅, vitest ✅ (740 files, 8037 passed); host tsc ✅, host vitest ✅ (103 passed); mobile tsc ✅, expo lint ✅; cargo test --lib ✅ except 2 pre-existing macOS-only `fs` tests (`/opt/homebrew/bin`); clippy no new warnings; rustfmt clean on changed lines; no root ESLint config (web lint = tsc); desktop check manual

## 2026-11-11 07:22 IST — Hari Tasks: Focus a task and Carry over (L-243)
- Type: feature
- What: On the phone, tapping a task shows a "Focus today" chip that pins it to today's Focus (tap "In Focus" to unpin). With Focus on, a bar lists how many unfinished tasks are left from an earlier day's Focus, and its Carry over button pins them to today, like the desktop.
- Why: User request: put a task in Focus from the phone, and the desktop's Carry over button.
- Files: [mobile_tools.rs](src-tauri/src/mobile_tools.rs) (`tasks.update` takes `focusDate` + `today`, `focus_change`, new test), [tools.ts](mobile/src/features/tools/tools.ts) (`updateTask`, `carryOverTasks`), [tasks/index.tsx](mobile/src/app/tasks/index.tsx) (`focusTasks`, Focus chip, Carry over bar), [tools.test.ts](mobile/tests/tools.test.ts), [LOCAL-FEATURES.md](docs/LOCAL-FEATURES.md), [spec](docs/specs/hari-sidebar-tasks-live-fixes-plan.md)
- Commit: uncommitted
- Note: needs the desktop from this release; an older desktop leaves the task as it was and the phone asks to update MonoCode.
- Verified: cargo test mobile_tools ✅ (4/4); mobile tsc ✅, expo lint ✅, vitest tools ✅ (18/18; full run 230/230, `tests/mobile/watchFrames.test.ts` fails to load as before, unrelated); phone check manual

## 2026-11-11 01:16 IST — Interactive Claude forks show their replies again (L-242)
- Type: fix
- What: A chat forked in Interactive Claude (also when forked onto another Claude account) now shows Claude's replies and finishes its turn. Before, the chat stayed empty while the terminal had the full reply.
- Why: User report. Claude 2.1.322 creates the forked conversation file about half a second after it reports the first prompt; MonoCode looked for the file only at that moment, never found it, and kept skipping the transcript for the whole chat.
- Files: [claude_interactive.rs](src-tauri/src/claude_interactive.rs) (`fork_since`, `handle_hook`, `claude_interactive_poll`, `fork_turn_offset`, new test), [LOCAL-FEATURES.md](docs/LOCAL-FEATURES.md)
- Commit: uncommitted
- Verified: cargo test claude_interactive ✅ (16/16, new regression test); rustfmt on changed hunks ✅; clippy: no new warnings; desktop check manual (fork a chat in Interactive, with and without moving it to another account)

## 2026-11-11 01:09 IST — Hari release 0.16.0-local34 (side menu, Tasks filters, Live Update fixes)
- Type: chore
- What: Published `hari-v0.16.0-local34` (run 42884153492) as the latest release: desktop installer with updater signature, Hari APK (versionCode 160034), `latest.json`, `hari-android.json`.
- Why: Ships running projects in the side menu, Tasks filters, the colour logo and the Live Update and Activity fixes (L-241).
- Files: GitHub release only.
- Commit: cc2d2a08 (feature), 389e1ecb (version)
- Verified: CI ✅ (desktop 8m09s, APK 17m16s, first try); `hari-android.json` served from releases/latest with 0.16.0-local34 ✅; phone checks manual (spec § Phone check)

## 2026-11-11 00:47 IST — Hari: running projects in the side menu, Tasks filters, colour logo; Live Update and Activity fixes (L-241, L-239, L-240)
- Type: feature + fix
- What: Hari phone app:
  - The side menu shows running projects: the project name shimmers as on the desktop, and the number of running sessions sits at the right of the row. Tapping the number shows those sessions, and tapping a session opens it.
  - Tasks gains a Focus button for today's tasks, Group by Status (the default) or Project, and a project filter.
  - The side menu, empty chat, connect screen and Mono home show the colour feather-and-flute logo.
  - Live Updates no longer crash the app. If a card can't be shown, Hari turns Live Updates off and says so. Leftover cards clear at launch and expire within 2 minutes after the app dies. The status-bar chip reads "Working" instead of the session title.
- What (desktop Activity):
  - Sites now include the Aside browser.
  - Each site lists up to 8 tabs, each with its own time.
- Why: The user reported "Hari keeps stopping" after a Live Update card stayed on screen indefinitely, and a Super Island too wide with the title. They asked for running sessions in the side menu, Tasks filters and the real logo. Aside wasn't in the browser list, so all of the day's site time was dropped.
- Files:
  - Phone:
    - `mobile/modules/hari-live/android/.../{HariLive.kt,HariLiveService.kt,HariLiveModule.kt}` (try/catch, `fail`, `clearStale`, `clearAll`, `renew`, `setTimeoutAfter`)
    - `mobile/src/features/liveUpdates/{liveCards.ts,nativeLive.ts,LiveUpdates.tsx}`
    - `mobile/src/features/workspace/WorkspaceDrawer.tsx` (`ProjectRow` running list)
    - `mobile/src/app/tasks/index.tsx`
    - `mobile/src/features/tools/tools.ts` (`inFocusOn`, `localDay`, `taskProjectKey`, `groupTasks(by)`)
    - `mobile/src/ui/brand.ts` (`HARI_LOGO`), `mobile/assets/images/hari-logo.png`
    - `EmptySession.tsx`, `ConnectScreen.tsx`, `MonoHome.tsx`
    - Tests: `mobile/tests/{tools,liveCards}.test.ts`
  - Desktop:
    - `src-tauri/src/mobile_tools.rs` (task summary adds `createdAt`, `focusDate`, `focusDays`)
    - `src-tauri/src/activity/{aw.rs,agent.rs}` (`aside`, `TabUsage`, 8 tabs)
    - `src/features/activity/{model/activity.ts,ui/Breakdown.tsx}`
- Spec: [hari-sidebar-tasks-live-fixes-plan.md](../specs/hari-sidebar-tasks-live-fixes-plan.md)
- Verified:
  - Phone: mobile tsc ✅, eslint on changed files ✅, mobile vitest 228 ✅ (the `watchFrames` suite load failure predates this change), Kotlin `:hari-live:compileReleaseKotlin` ✅.
  - Desktop: root tsc ✅, activity vitest 23 ✅, `cargo test` activity 38 and mobile_tools 3 ✅, rustfmt check ✅.
  - Manual: the phone and desktop checks in the spec.
- Commit: the commit with this entry

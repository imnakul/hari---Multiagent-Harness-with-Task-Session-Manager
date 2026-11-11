# Changelog 05 — MonoCode Windows fork

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

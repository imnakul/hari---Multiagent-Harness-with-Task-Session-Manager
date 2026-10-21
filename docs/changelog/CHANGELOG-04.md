# Changelog 04 — MonoCode Windows fork
## 2026-10-22 00:57 IST — Worktree removal, terminal start and Claude copy stop blocking the app; store guardrail test (L-170, L-171, L-172)
- Type: fix
- What: Removing a worktree used to hold the shared database lock while git deleted the folder, which can take several seconds on Windows, so every save in the app waited. It now takes the lock only for the quick database steps before and after. Opening a terminal and continuing a Claude chat on another account now run on background threads instead of the main thread. A new test fails if any backend command touches saved data on the window's threads again. The leftover responsiveness ideas (Soon and Deferred) are listed in PLANNED.md.
- Why: User request: do the three "do now" follow-ups from the T3 Code and Orca study and record the rest.
- Files: [worktrees.rs](../../src-tauri/src/worktrees.rs) (`remove_with_sessions`, `remove_with_sessions_using`, test `removal_releases_the_store_lock_while_git_removes_the_tree`), [pty.rs](../../src-tauri/src/pty.rs) (`pty_spawn`), [provider_sessions.rs](../../src-tauri/src/provider_sessions.rs) (`claude_copy_session`), [background_work.rs](../../src-tauri/src/background_work.rs) (`store_command_guard`), [PLANNED.md — Responsiveness follow-ups](../PLANNED.md), [backend-responsiveness-plan.md](../specs/backend-responsiveness-plan.md)
- Commit: uncommitted
- Verified: cargo test --lib 832 passed, 2 failed (the same two macOS PATH tests in `fs.rs` that fail on Windows before this change) rustfmt ✅ tsc ✅ vitest ✅ (7665) lint — (no ESLint config) build —; desktop check manual
## 2026-10-22 00:45 IST — Notes "File note under…" menu lists every project (L-169)
- Type: fix
- What: The Notes `+` menu showed at most six projects, so others could not be picked and the menu never got long enough to scroll. It now lists every remembered project (current project first, Personal last) and scrolls when it is taller than the window.
- Why: User report: the Notes dropdown did not show all projects and did not scroll.
- Files: [notes.ts](../../src/features/notes/notes.ts) (`noteProjectChoices`), [notes.test.ts (lines 100–127)](../../src/features/notes/notes.test.ts:100)
- Commit: uncommitted
- Verified: tsc ✅ vitest ✅ (notes 65, all 7665) lint — (no ESLint config) build —; desktop check manual
## 2026-10-21 23:22 IST — Saves never wait for git; store work off the window's threads; reads beside writes (L-166, L-167, L-168)
- Type: fix
- What: Notes, tasks, chats and other saved data now load and save on background threads, so the window's buttons (minimize, maximize, clicks) answer even while saves queue. A chat's branch and repo are read straight from the project's `.git` folder; git itself only runs in the background when the folder cannot tell (for example a detached HEAD), and every git read now has a time limit. Chat lists, transcript pages, tasks and notes load on their own database connection, so they no longer wait behind a save.
- Why: User report of slow buttons across the app after L-163; patterns 0–4 and 6 from the T3 Code and Orca study.
- Files: [background_work.rs (lines 51–66)](../../src-tauri/src/background_work.rs:51), [fs.rs](../../src-tauri/src/fs.rs) (`git_info_for`, `git_info_from_files`, `git_output_within`), [session_store.rs](../../src-tauri/src/session_store.rs) (`SessionStore::read`, store commands), [mono_transcript.rs](../../src-tauri/src/mono_transcript.rs) (`page_at`), tasks.rs, notes.rs, reminders.rs, session_board.rs, automations.rs, prompts.rs, artifacts.rs, control.rs, provider_sessions.rs, claude_interactive.rs, worktrees.rs, debug_inspector.rs, window.rs, perf_probe.rs; spec [backend-responsiveness-plan.md](../specs/backend-responsiveness-plan.md)
- Commit: uncommitted
- Verified: cargo check ✅ cargo test --lib 829 passed, 2 failed (`fs::tests::read_only_git_cmd_path_adds_fixed_dirs_to_inherited_path`, `local_git_never_resolves_login_shell_path`: expect macOS Homebrew dirs, fail on Windows before this change too) tsc ✅ vitest ✅ lint — (no ESLint config) build — (not asked); desktop check manual
## 2026-10-21 22:43 IST — Performance patterns from T3 Code and Orca (research)
- Type: docs
- What: Read how T3 Code and Orca keep their apps responsive (where blocking work runs, how they get the git branch, how they limit and time out git, how they save state), and ranked which patterns fit MonoCode. Rechecked against both projects' latest code (T3 680152e2, Orca 84a9f995, both 2026-10-21), which added a new top pattern: a save never waits for git. No code changed.
- Why: User request after the L-163 slowdown, to learn better patterns before fixing more.
- Files: [perf-patterns-t3-orca.md](../notes/perf-patterns-t3-orca.md)
- Commit: uncommitted
- Verified: docs only
## 2026-10-21 21:16 IST — Sidechats, Handoff and Second opinion in Focus mode; deeper sidechats in the sidebar (L-164, L-165)
- Type: fix
- What: In Focus mode, Ask in sidechat now opens the sidechat as a Focus pane straight away; before, it only showed after leaving Focus. Handoff and Second opinion now show under replies in Focus and open as Focus panes too. In the project sidebar, a sidechat started from another sidechat now nests under it at any depth; before, the third level was missing.
- Why: User report with screenshots.
- Files: [App.tsx (lines 11724–11730, 16509)](../../src/app/App.tsx:11724), [sessionLinks.ts (lines 141–153)](../../src/features/sessions/model/sessionLinks.ts:141), [sessionLinks.test.ts (line 87)](../../src/features/sessions/model/sessionLinks.test.ts:87)
- Commit: uncommitted
- Verified: tsc ✅ lint — (repo has no linter) tests ✅ (web 7665) build —; desktop check manual
## 2026-10-21 21:10 IST — Saves stop holding the database while git runs (L-163)
- Type: fix
- What: Saving a chat and listing a project's chats used to look up the git branch and repo while holding the one database lock that every save in the app shares. That lookup starts up to three git processes. New task, Delete and other saves had to wait behind it, often several times in a row. The lookup now happens before the lock is taken, so those saves only wait for the database itself.
- Why: User report: Delete took about 20 s and New task showed a spinner for about 10 s.
- Files: [session_store.rs (lines 235, 302, 1251–1280, 1931)](../../src-tauri/src/session_store.rs:1251), [mono_transcript.rs (lines 325, 428)](../../src-tauri/src/mono_transcript.rs:428), test at [session_store.rs (line 5137)](../../src-tauri/src/session_store.rs:5137)
- Commit: uncommitted
- Verified: cargo test ✅ (session_store, mono_transcript, artifacts: 98) rustfmt ✅ tsc ✅ web tests ✅ (7665) build —
## 2026-10-21 17:34 IST — Project dropdown in Focus chat search (L-162)
- Type: feature
- What: In Focus mode's chat search (New ⌄ → Continue, + more, and the empty screen), the row of project tabs is replaced by one Filter by project dropdown under the search box: All projects, then each project. The chosen project's logo shows beside it. Two projects with the same folder name show their full paths. The Model toggle is unchanged.
- Why: User request: the horizontal project tabs did not fit; a dropdown filter instead.
- Files: [FocusPicker.tsx (lines 128–186, 304–315)](../../src/features/focus/ui/FocusPicker.tsx:128), [FocusPicker.test.ts (lines 63–90)](../../src/features/focus/ui/FocusPicker.test.ts:63)
- Commit: uncommitted
- Verified: tsc ✅ lint — (repo has no linter) tests ✅ (focus 70) build —; desktop check manual
## 2026-10-21 17:20 IST — Backend call timing in the Performance log (L-161)
- Type: chore
- What: A Performance log (Ctrl+Alt+Shift+P → Start log) now also records how long every backend call takes, what else was waiting at the time, and once a second how quickly the main thread, the background workers and the database answer. Slow file loads are listed too. It only runs while a log records.
- Why: Clicks across the app (Copy to Notes, first open of Settings, Automations and Tasks, New task, attaching files) got slow. Database cost and CPU were ruled out; this log shows which queue the calls wait in, so the real cause can be fixed.
- Files: [perf_probe.rs](../../src-tauri/src/perf_probe.rs:1), [lib.rs (lines 47, 794–796)](../../src-tauri/src/lib.rs:47), [backendTiming.ts](../../src/shared/debug/backendTiming.ts:1), [perfRecorder.ts (lines 123, 328)](../../src/shared/debug/perfRecorder.ts:123), [backendTiming.test.ts](../../src/shared/debug/backendTiming.test.ts:1)
- Commit: uncommitted
- Verified: tsc ✅ lint — (repo has no linter) tests ✅ (debug 9) cargo check ✅ rustfmt ✅ build —
## 2026-10-21 16:55 IST — WebView2 crash recovery and saved composer drafts (L-160)
- Type: fix
- What: On Windows, when the part of WebView2 that draws the window crashes (it went blank before), MonoCode now reloads the window by itself and says so in a short notice. It tries at most 3 times in 2 minutes. Text typed in a chat box but not sent is now kept across any reload or crash, for 14 days. Crashes are written to `webview-crashes.log` in the app data folder. Text typed in a chat box no longer vanishes when you go in or out of Focus mode.
- Why: The window went blank after WebView2 renderer crashes under memory pressure (crash dumps 20–21 Oct), and unsent text was lost. Separately, Focus mode keeps the hidden workspace copy of a chat's composer, which kept writing its older text over what was typed in Focus.
- Files: [webview_recovery.rs](../../src-tauri/src/webview_recovery.rs:1), [lib.rs (lines 76, 356, 392, 740)](../../src-tauri/src/lib.rs:76), [window.rs (line 125)](../../src-tauri/src/window.rs:125), [Cargo.toml (line 63)](../../src-tauri/Cargo.toml:63), [draftCache.ts (lines 43–150)](../../src/features/sessions/model/draftCache.ts:43), [Composer.tsx (lines 1095–1129)](../../src/features/sessions/ui/Composer.tsx:1095), [Composer.test.ts (line 895)](../../src/features/sessions/ui/Composer.test.ts:895), [WebviewRecoveryNotice.tsx](../../src/app/shell/WebviewRecoveryNotice.tsx:1), [App.tsx (lines 134, 17256)](../../src/app/App.tsx:17256), [draftCache.persist.test.ts](../../src/features/sessions/model/draftCache.persist.test.ts:1), [spec](../specs/webview-crash-recovery-plan.md)
- Commit: uncommitted
- Verified: tsc ✅ lint — (repo has no linter) tests ✅ (web 89 in draft and composer files, plus the Focus draft regression test; Rust webview_recovery 4) cargo check ✅; build —; desktop check manual
## 2026-10-21 16:15 IST — 0.16.0-local6 Windows build, rebuilt with L-158 and L-159
- Type: chore
- What: The 0.16.0-local6 installer was rebuilt at the same version and file name, now with close buttons on Focus project and chat tabs (L-158) and drag to reorder those tabs (L-159). Run it over the current install; it replaces the earlier local6 file.
- Why: User asked to commit, push and rebuild under the same installer name.
- Files: `E:DevelopingInstallable versionsMonoCode_0.16.0-local6-focus-resize-drag-frosted-sidebar_x64.exe` (14,913,304 bytes, SHA-256 47FC78DC70DC5500B62535D1590DD31009F2E80213C63255F1B5649C9813B5EB, NotSigned)
- Commit: built from 168bf7b5
- Verified: build ✅ (npm run build:windows); desktop check manual
## 2026-10-21 16:11 IST — Drag to reorder Focus project and chat tabs (L-159)
- Type: feature
- What: With Group by project on in Focus mode, project tabs and chat tabs can be dragged left or right to change their order; the other tabs slide aside while you drag. Moving a chat tab also moves its pane. With a tab focused, Ctrl+Shift+Left/Right moves it. A short press still just selects the tab.
- Why: User request: reorder the Focus tabs from the top bar.
- Files: [FocusGroupTabs.tsx](../../src/features/focus/ui/FocusGroupTabs.tsx:1), [FocusView.tsx (lines 807–830)](../../src/features/focus/ui/FocusView.tsx:807), [focusGrid.ts (line 107)](../../src/features/focus/model/focusGrid.ts:107), [FocusGroupTabs.test.ts](../../src/features/focus/ui/FocusGroupTabs.test.ts:1), [focusGrid.test.ts](../../src/features/focus/model/focusGrid.test.ts:1)
- Commit: 168bf7b5
- Verified: tsc ✅ tests ✅ (focus 69 + app 476 passed) build ✅; desktop check manual
## 2026-10-21 14:38 IST — Close buttons on Focus project and chat tabs (L-158)
- Type: feature
- What: With Group by project on in Focus mode, hovering a project tab or a chat tab shows a small × at its right end. A chat's × removes that chat from Focus; a project's × removes all of that project's chats at once. With a tab focused, Delete does the same. The chats keep running; they only leave Focus.
- Why: User request: closing a project with three chats took three clicks.
- Files: [FocusGroupTabs.tsx](../../src/features/focus/ui/FocusGroupTabs.tsx:1), [FocusView.tsx (lines 118, 801)](../../src/features/focus/ui/FocusView.tsx:118), [App.tsx (lines 5543, 16518)](../../src/app/App.tsx:5543), [FocusGroupTabs.test.ts](../../src/features/focus/ui/FocusGroupTabs.test.ts:1), [FocusView.test.ts](../../src/features/focus/ui/FocusView.test.ts:1), [FocusViewResize.test.ts](../../src/features/focus/ui/FocusViewResize.test.ts:1)
- Commit: d75325b8
- Verified: tsc ✅ tests ✅ (focus + app: 538 passed) build —; desktop check manual
## 2026-10-21 14:30 IST — 0.16.0-local6 Windows build, rebuilt with L-156 and L-157
- Type: chore
- What: The 0.16.0-local6 installer was rebuilt at the same version and file name, now with smooth Focus pane resizing (L-156) and the hover sidebar tint that follows Sidebar opacity (L-157). Run it over the current install; it replaces the earlier local6 file.
- Why: User asked to commit, push and build, keeping the build name.
- Files: `E:DevelopingInstallable versionsMonoCode_0.16.0-local6-focus-resize-drag-frosted-sidebar_x64.exe` (14,924,108 bytes, SHA-256 AD91FB2E063DC83B77D0E4876DCAA5D368C1C3C908292F819EB7DF7F83DE3C99, NotSigned; replaces the 13:49 file)
- Commit: built from 5d0a4334
- Verified: tsc ✅ tests ✅ (focus + app: 534 passed) build ✅ (npm run build:windows); desktop check manual
## 2026-10-21 14:24 IST — Hover sidebar tint follows Sidebar opacity (L-157)
- Type: feature
- What: In dark mode, the floating hover sidebar's tint now uses the Sidebar opacity slider in Settings > Appearance > Translucency, instead of a fixed value. Lower shows more of the window behind it. Light mode keeps its own light tint, because light mode turns translucency off.
- Why: User request: reuse the existing setting instead of tuning the tint by hand.
- Files: [index.css (line 873)](../../src/styles/index.css:873)
- Commit: 5d0a4334
- Verified: CSS only; tsc ✅ (unchanged) tests — (no CSS tests); desktop check manual
## 2026-10-21 14:12 IST — Smooth Focus pane resizing (L-156) and darker hover sidebar tint (L-154)
- Type: fix
- What: Dragging the edge between Focus panes no longer stutters. During the drag each chat keeps its size (the card crops it or shows a little empty space), and it re-wraps once when you let go. The hover sidebar's dark-mode tint goes from 0.5 to 0.8, so less of the window shows through.
- Why: User report with a perf log: resizing ran at 16–36 FPS with 65–90 ms of work per frame, because every chat transcript re-wrapped at the new width on every frame. User asked for the 0.8 tint.
- Files: [FocusView.tsx (lines 139–150, 204–241, 693)](../../src/features/focus/ui/FocusView.tsx:139), [FocusViewResize.test.ts](../../src/features/focus/ui/FocusViewResize.test.ts:1), [FocusView.test.ts (line 118)](../../src/features/focus/ui/FocusView.test.ts:118), [index.css (line 872)](../../src/styles/index.css:872)
- Commit: 5d0a4334
- Verified: tsc ✅ tests ✅ (focus + app: 534 passed) build —; desktop check manual
## 2026-10-21 13:49 IST — 0.16.0-local6 Windows build
- Type: chore
- What: New Windows installer, version 0.16.0-local6: 0.16.0-local5 plus L-143 to L-155. Focus panes resize by dragging and are rounded cards whose focus ring glides between them. The Continue picker has project chips and a Model toggle. Project tabs show status dots. In the new layout, Focus always uses the hover sidebar, and you can drag a session from the sidebar into Focus. The hover sidebar is frosted without a live blur. Settings is in the sidebar views list instead of the project menu. Working cards have a dismiss button.
- Why: User asked to commit, push and build a new version.
- Files: `E:DevelopingInstallable versionsMonoCode_0.16.0-local6-focus-resize-drag-frosted-sidebar_x64.exe` (14,922,893 bytes, SHA-256 ACCED1BB6628DE895F9CD7E915BFFDA141CAE8396E4DFE6239957F1B845CB93B, NotSigned); version bump in package.json, package-lock.json, Cargo.toml, Cargo.lock, src-tauri/tauri.conf.json.
- Commit: built from bb22fe20
- Verified: tsc ✅ tests ✅ (full suite: 7,638 passed, 2 skipped) build ✅ (npm run build:windows); desktop check manual
## 2026-10-21 13:31 IST — No Settings in the project tab menu (L-155)
- Type: feature
- What: In the new sidebar layout, the project tab's dropdown no longer lists Settings. Settings is always in the list of views at the top of the sidebar.
- Why: User request: the dropdown entry duplicated the always-visible Settings row.
- Files: [Sidebar.tsx](../../src/app/shell/Sidebar.tsx) (`headerProject`); test in `SidebarRename.test.ts` ("leaves Settings out of the project tab menu (L-155)")
- Commit: bb22fe20
- Verified: tsc ✅ tests ✅ (sidebar, source-control: 279 passed) build —; desktop check manual

## 2026-10-21 13:25 IST — Frosted hover sidebar without a live blur (L-154)
- Type: style
- What: The hover sidebar looks frosted again: a see-through tint, a faint grain and a light top edge. Tuned to the user's values: tint 50% dark, 30% light; the window behind is dimmed 30% dark, 20% light; a stronger grain in dark mode mutes what shows through. It is drawn without a real background blur, so hovering stays smooth.
- Why: User request: get the frosted look back without losing the L-148 frame-rate fix.
- Files: [index.css](../../src/styles/index.css) (`.sidebar-peek`, `--peek-frost-alpha`)
- Commit: bb22fe20
- Verified: tsc ✅ tests ✅ (app, focus: 531 passed) build ✅; desktop check manual

## 2026-10-21 13:13 IST — Drag a session into Focus (L-153)
- Type: feature
- What: In Focus mode, drag a session from the sidebar (including the hover sidebar) onto the Focus panes and let go to open it there, the same as picking it from Continue. An "Open in Focus" highlight shows while you hold it over the panes.
- Why: User request: open an existing session in Focus by drag and drop.
- Files: [focusSessionDrop.ts](../../src/features/focus/model/focusSessionDrop.ts); [Sidebar.tsx](../../src/app/shell/Sidebar.tsx) (`onOpenSessionInFocus`); [FocusView.tsx](../../src/features/focus/ui/FocusView.tsx) (drop area and hint); [App.tsx](../../src/app/App.tsx); tests in `focusSessionDrop.test.ts`, `SidebarRename.test.ts`, `FocusView.test.ts`
- Commit: bb22fe20
- Verified: tsc ✅ tests ✅ (app, focus, sessions: 2425 passed) build —; desktop check manual

## 2026-10-21 13:13 IST — Focus uses the hover sidebar in the new layout (L-152)
- Type: feature
- What: With the new sidebar layout on, Focus mode always shows the sidebar on hover, even if you keep it pinned open. Leaving Focus brings back whatever you had before.
- Why: User request: Focus should get the full width without changing the saved sidebar choice.
- Files: [App.tsx](../../src/app/App.tsx) (`sidebarPinnedShown`, toggle guard)
- Commit: bb22fe20
- Verified: tsc ✅ tests ✅ build —; desktop check manual

## 2026-10-21 12:51 IST — Focus ring glides between panes (L-151)
- Type: feature
- What: In Focus mode, the accent edge and glow around the focused pane now slide smoothly to the next pane you focus, instead of jumping. Dragging a resize edge keeps it in place without lag, and reduced motion turns the slide off.
- Why: User request: a smooth gliding effect when moving between session panes.
- Files: [FocusView.tsx](../../src/features/focus/ui/FocusView.tsx) (`focusRing`); [index.css](../../src/styles/index.css) (`.focus-ring`); tests in `FocusView.test.ts`
- Commit: bb22fe20
- Verified: tsc ✅ tests ✅ (focus: 53 passed) build —; desktop check manual

## 2026-10-21 12:46 IST — Dismiss Working cards (L-150)
- Type: feature
- What: Each card in the sidebar's Working list shows a × on hover. Clicking it hides that card, for example a finished automation report you don't need to open. The chat shows up again the next time it works.
- Why: User request: a Done card could only be cleared by opening the chat.
- Files: [LiveAgentsPreview.tsx](../../src/features/sessions/ui/LiveAgentsPreview.tsx); [App.tsx](../../src/app/App.tsx) (`dismissedLiveRuns`); [Sidebar.tsx](../../src/app/shell/Sidebar.tsx), [ProjectRail.tsx](../../src/app/shell/ProjectRail.tsx) (pass-through); tests in `LiveAgentsPreview.test.ts`
- Commit: bb22fe20
- Verified: tsc ✅ tests ✅ (sessions, app: 2367 passed) build —; desktop check manual

## 2026-10-21 12:42 IST — Pages show every project; views above project tabs (L-149)
- Type: feature
- What: In the new layout, Inbox, Notes and Automations show items from all projects, whichever project is open. The sidebar now shows Search and the page list at the top, then the project tabs, then the sessions; only the sessions scroll.
- Why: User request: checking another project's automations meant switching projects, and the project tabs belong with the sessions they switch.
- Files: [App.tsx](../../src/app/App.tsx) (`appViewScope`); [Sidebar.tsx](../../src/app/shell/Sidebar.tsx) (views placement); test in `SidebarRename.test.ts`
- Commit: bb22fe20
- Verified: tsc ✅ tests ✅ (app, focus, notes, automations, inbox: 976 passed) build —; desktop check manual

## 2026-10-21 12:37 IST — New layout sidebar: Settings row, pages leave Focus, smooth floating sidebar (L-148)
- Type: feature
- What: The new layout sidebar shows Settings under Session Manager. Opening Automations, Notes, Task Manager, Settings and the other sidebar pages from Focus mode now leaves Focus so the page is visible. Focus no longer repeats those buttons in its header in the new layout. The floating sidebar is now a solid card instead of blurred glass, so hovering its rows stays smooth.
- Why: User request: the hover sidebar already reaches those pages, pages opened from it in Focus were hidden behind Focus, and the perf log showed about 30 FPS while hovering the floating sidebar.
- Files: [Sidebar.tsx](../../src/app/shell/Sidebar.tsx) (Views list); [App.tsx](../../src/app/App.tsx) (`sidebarPages`, Focus props); [index.css](../../src/styles/index.css) (`.sidebar-peek`)
- Commit: bb22fe20
- Verified: tsc ✅ tests ✅ (focus, app: 523 passed) build —; desktop check manual

## 2026-10-21 12:15 IST — Focus project tabs show status (L-147)
- Type: feature
- What: In Focus mode grouped by project, a project tab shimmers while one of its chats works and shows an amber dot when a chat needs you or a green dot when all its chats are finished. A working chat tab shimmers its title. The tab names and counts now line up with the project icon.
- Why: User request: see at a glance which project needs attention, and the project tab text sat off the icon's line.
- Files: [focusPaneTag.ts](../../src/features/focus/model/focusPaneTag.ts) (`focusProjectStatus`); [FocusView.tsx](../../src/features/focus/ui/FocusView.tsx) (project and chat tabs); tests in `focusPaneTag.test.ts`, `FocusView.test.ts`
- Commit: bb22fe20
- Verified: tsc ✅ tests ✅ (focus, app: 523 passed) build —; desktop check manual

## 2026-10-21 12:08 IST — Closing a Focus pane stays on its project (L-146)
- Type: fix
- What: In Focus mode grouped by project, closing the focused chat now focuses another chat of the same project, so the view stays on that project instead of jumping to the first one.
- Why: User report: closing a pane in freeproductshub switched the view to portfolio2.
- Files: [focusGroups.ts](../../src/features/focus/model/focusGroups.ts) (`focusAfterClose`); [App.tsx](../../src/app/App.tsx) (`onCloseFocusPane`); [focusGroups.test.ts](../../src/features/focus/model/focusGroups.test.ts)
- Commit: bb22fe20
- Verified: tsc ✅ tests ✅ (focus, app: 519 passed) build —; desktop check manual
## 2026-10-21 12:06 IST — Resizable Focus panes, glowing focused card, Continue filters (L-143–L-145)
- Type: feature
- What: In Focus mode, drag the gap between columns to make one wider, or the gap between two stacked chats to make one taller; double-click a gap for equal sizes, and sizes are remembered. Panes are now rounded cards with small gaps, and the focused one has an accent edge with a soft glow. The Continue chat list has project chips at the top to show one project's chats, and a Model toggle that shows each chat's model.
- Why: User request with screenshots: adjustable pane sizes, a nicer focused pane, and a project filter plus model display in Continue.
- Files: [focusLayout.ts](../../src/features/focus/model/focusLayout.ts); [FocusSash.tsx](../../src/features/focus/ui/FocusSash.tsx); [FocusView.tsx](../../src/features/focus/ui/FocusView.tsx); [FocusPicker.tsx](../../src/features/focus/ui/FocusPicker.tsx); [BoardSessionCard.tsx](../../src/features/session-board/ui/BoardSessionCard.tsx) (`boardModelLabel` exported); [index.css](../../src/styles/index.css) (`.focus-pane`); tests in focusLayout.test.ts, FocusView.test.ts, FocusPicker.test.ts
- Commit: bb22fe20
- Verified: tsc ✅ tests ✅ (focus, session board: 108 passed) build —; desktop check manual
## 2026-10-21 02:02 IST — 0.16.0-local5 Windows build
- Type: chore
- What: New Windows installer, version 0.16.0-local5: 0.16.0-local4 plus L-136 (the Focus terminal opens inside its chat card), L-137 (the pane outline uses your accent), L-138 (skills saved with Windows line endings work in Interactive sends), L-139 (the Lightness slider works in light mode), L-140 (sidebar session cards in the new layout), L-141 (Focus header shortcuts and the top-left Focus button in Settings) and L-142 (darker text in light mode over a wallpaper).
- Why: User asked to commit, push and build a new version.
- Files: `E:\Developing\Installable versions\MonoCode_0.16.0-local5-light-lightness-focus-shortcuts-sidebar-cards_x64.exe` (14,914,103 bytes, SHA-256 7B4A6D75823BD1CD76E0B7FE6A6CC19F2CF8C22FA939D26E5D7F1C77A9D955D6, NotSigned); version bump in package.json, package-lock.json, Cargo.toml, Cargo.lock, src-tauri/tauri.conf.json.
- Commit: built from fcc4952e
- Verified: tsc ✅ tests ✅ (styles, sessions, settings: 2,387 passed; src/app, settings, focus: 994 passed) build ✅ (npm run build:windows); desktop check manual
## 2026-10-21 01:46 IST — Darker text in light mode over a wallpaper (L-142)
- Type: fix
- What: In light mode with a Windows wallpaper, text is darker, including grey labels and descriptions. A frosted panel behind Settings and the chat was tried and removed before any commit, at the user's request.
- Why: User feedback: even at the lowest light-mode lightness, the white wash over the wallpaper left grey text hard to read.
- Files: [index.css](../../src/styles/index.css) (`html.is-windows.has-app-wallpaper.theme-light`); [insetWallpaper.test.ts](../../src/styles/insetWallpaper.test.ts)
- Commit: fcc4952e
- Verified: tsc ✅ tests ✅ (styles, sessions, settings: 2,387 passed) build —; desktop check manual
## 2026-10-21 01:31 IST — Lightness slider works in light mode; Focus header order; top-left Focus button in Settings (L-139, L-141)
- Type: feature
- What: Removed the Light-mode frost slider. Instead, the Lightness slider under Settings → Appearance → Color now also works in light mode, where lower values soften the white; light and dark each keep their own value. Focus mode's header now reads Focus, Task Manager, Automations, Settings, then a gap, then New and Group by project. Settings now shows the Focus button at the top left, as other views do; it closes Settings and opens Focus mode.
- Why: User feedback: use the existing lightness control instead of a new one, and the button order shown in a screenshot.
- Files: [appearance.ts](../../src/features/settings/model/appearance.ts) (`applyThemeLightLightness`); [SettingsView.tsx](../../src/features/settings/ui/SettingsView.tsx) (`dark-lightness` row); [focusModeToggle.ts](../../src/app/shell/focusModeToggle.ts); [settings.ts](../../src/features/settings/model/settings.ts); [index.css](../../src/styles/index.css) (`--theme-light-lightness`); [floatingMain.tsx](../../src/features/monos/floatingMain.tsx); [main.tsx](../../src/features/quick-composer/main.tsx); [FocusView.tsx](../../src/features/focus/ui/FocusView.tsx); [App.tsx](../../src/app/App.tsx); [insetWallpaper.test.ts](../../src/styles/insetWallpaper.test.ts)
- Commit: fcc4952e
- Verified: tsc ✅ tests ✅ (settings, focus, app, styles, skills, monos, quick composer: 1,441 passed; new CSS test fails without the fix) build —; desktop check manual
## 2026-10-21 01:02 IST — Skill send fix, Light-mode frost, sidebar session cards, Focus shortcuts (L-138–L-141)
- Type: feature + fix
- What: An Interactive message using a skill saved with Windows line endings failed before any terminal opened; the skill text is now cleaned first. Light theme over a Windows wallpaper gets a Light-mode frost slider in Settings → Appearance, with a glass edge and sheen (replaced at 01:31 before any commit, see above). In the new layout, each sidebar session shows its branch and model under the title, as a card. Focus mode's title bar has Task Manager, Automations and Settings buttons.
- Why: User report (send failed with no terminal) and three requests with screenshots.
- Files: [skills.ts](../../src/features/skills/model/skills.ts) (`readSkillBody`); [claudeInteractive.ts](../../src/integrations/harness/providers/claude/claudeInteractive.ts); [appearance.ts](../../src/features/settings/model/appearance.ts); [SettingsView.tsx](../../src/features/settings/ui/SettingsView.tsx); [settings.ts](../../src/features/settings/model/settings.ts); [index.css](../../src/styles/index.css); [Sidebar.tsx](../../src/app/shell/Sidebar.tsx) (`SessionCard`); [FocusView.tsx](../../src/features/focus/ui/FocusView.tsx); [App.tsx](../../src/app/App.tsx); tests in skillCatalog.test.ts, insetWallpaper.test.ts, SidebarRename.test.ts
- Commit: 995e5926 (L-138), fcc4952e
- Verified: tsc ✅ tests ✅ (1,398 passed, 2 skipped, plus the new sidebar test) build —; desktop check manual
## 2026-10-21 00:39 IST — Focus terminal opens inside its chat card; pane outline uses your accent (L-136, L-137)
- Type: fix
- What: In Focus mode the project terminal now opens inside the focused chat's card instead of under every card. The focused pane's outline now uses your chosen accent colour, with a faint inner glow.
- Why: User request (screenshot): the outline showed the theme blue, and the terminal spanned all cards.
- Files: [FocusView.tsx](../../src/features/focus/ui/FocusView.tsx) (`dockInPane`); [App.tsx](../../src/app/App.tsx) (dock layout effect deps); [ActivePaneRing.tsx](../../src/shared/ui/ActivePaneRing.tsx); [index.css](../../src/styles/index.css) (`.active-pane-ring`); [FocusView.test.ts](../../src/features/focus/ui/FocusView.test.ts)
- Commit: fcc4952e
- Verified: tsc ✅ tests ✅ (focus, workspace, app: 855 passed) build —; desktop check manual
## 2026-10-20 22:59 IST — 0.16.0-local4 Windows build
- Type: chore
- What: New Windows installer, version 0.16.0-local4: 0.16.0-local3 plus L-135 (a new chat in Focus mode stays open), L-136 (Focus mode's Terminal button opens the focused chat's project terminal, and the usage footer follows the focused pane) and L-137 (an accent outline on the focused pane).
- Why: User asked to commit, push and build a new version.
- Files: `E:\Developing\Installable versions\MonoCode_0.16.0-local4-focus-terminal-usage-active-outline_x64.exe` (14,915,005 bytes, SHA-256 11B2B417D24DF2D0A3DBF7BCF73A0DD7A0B1FB0FC25F4338684124275B70E2BF, NotSigned); version bump in package.json, package-lock.json, Cargo.toml, Cargo.lock, src-tauri/tauri.conf.json.
- Commit: built from 6e78cc13
- Verified: tsc ✅ tests ✅ (7,602 passed, 2 skipped) build ✅ (npm run build:windows); desktop check manual
## 2026-10-20 22:11 IST — Terminal and usage follow the focused pane in Focus mode; active pane outline (L-136, L-137)
- Type: fix
- What: In Focus mode the Terminal button at the bottom right did nothing visible, because the terminal panel lived in the hidden workspace. It now opens beside the Focus grid, for the project of the chat you last clicked. The usage footer also follows that chat, so its model is the one highlighted. The focused chat now has a thin outline in your accent colour, in Focus mode and in workspace splits, whenever more than one pane is on screen.
- Why: User report with a screenshot: terminals not opening in Focus, usage fixed to one model, and no clear sign of the active pane.
- Files: [App.tsx](../../src/app/App.tsx) (`projectDockHosts`, `focusPaneSession`, `focusEntryCwd`, `usageSource`); [FocusView.tsx](../../src/features/focus/ui/FocusView.tsx); [ActivePaneRing.tsx](../../src/shared/ui/ActivePaneRing.tsx); [PaneTree.tsx](../../src/features/workspace/ui/PaneTree.tsx); [FocusView.test.ts](../../src/features/focus/ui/FocusView.test.ts)
- Commit: 6e78cc13
- Verified: tsc ✅ tests ✅ (focus, workspace, projects, terminal, src/app: 1070 passed) build —; desktop check manual
## 2026-10-20 21:38 IST — Focus mode's New chat no longer vanishes (L-135)
- Type: fix
- What: In Focus mode, New made a chat that showed for a moment and then disappeared, leaving the first chat focused. The app was clearing away chats that no tab holds, and a new chat in Focus has no tab yet. Chats in the Focus grid now count as open.
- Why: User report: adding a new session in Focus mode did not work.
- Files: [useIdleSessionDetach.ts](../../src/app/hooks/useIdleSessionDetach.ts) (`shownSessionIds`); [App.tsx](../../src/app/App.tsx) (`focusShownIds`); [useIdleSessionDetach.test.ts](../../src/app/hooks/useIdleSessionDetach.test.ts)
- Commit: 99d85a1a
- Verified: tsc ✅ tests ✅ (src/app + focus: 499 passed; new test fails without the fix) build —; desktop check manual
## 2026-10-20 20:56 IST — 0.16.0-local3 Windows build
- Type: chore
- What: New Windows installer, version 0.16.0-local3: 0.16.0-local2 plus L-132 project slots in the new layout, the L-119 link card height fix, L-133 Interactive sends that work while Claude's status line animates, and L-134 pasted images shown at once with a loader.
- Why: User asked to commit, push and build a new version.
- Files: `E:\Developing\Installable versions\MonoCode_0.16.0-local3-project-slots-paste-preview-busy-send_x64.exe` (14,910,094 bytes, SHA-256 FF31F2C45FAE3E2B2A5044A56EDBDD807D26195C37D72C318D106F3B1E95F857, NotSigned); version bump in package.json, package-lock.json, Cargo.toml, Cargo.lock, src-tauri/tauri.conf.json.
- Commit: built from a6ab0620
- Verified: tsc ✅ tests ✅ (7,598 passed, 2 skipped; FileEditorCrlfGit failed once under memory pressure and passed on rerun) build ✅ (npm run build:windows); desktop check manual
## 2026-10-20 20:38 IST — Pasted images show at once with a loader (L-134)
- Type: feature
- What: Pasting a screenshot or file now shows its chip straight away: an image appears dimmed with a spinning loader until it is saved, then becomes the normal thumbnail. A screenshot the app has to read from the system clipboard shows a "Pasted image" chip with a spinner. If nothing could be attached, the composer now says so instead of silently dropping the paste.
- Why: Pasted images took a while to appear with no sign anything was happening.
- Files: [attachments.ts](../../src/features/sessions/model/attachments.ts) (`pendingAttachmentsFor`, `pendingPreviewUrls`); [AttachmentChip.tsx](../../src/features/sessions/ui/AttachmentChip.tsx) (`PendingAttachmentChip`); [Composer.tsx](../../src/features/sessions/ui/Composer.tsx) (`pasteFiles`, `attachPasted`); [Composer.pasteImage.test.ts](../../src/features/sessions/ui/Composer.pasteImage.test.ts)
- Commit: a6ab0620
- Verified: tsc ✅ tests ✅ (sessions: 1892 passed) build ✅; desktop check manual
## 2026-10-20 20:38 IST — Interactive sends work while Claude's status line animates (L-133)
- Type: fix
- What: An Interactive Claude send could fail with "Prompt delivery is unconfirmed" when Claude's status line kept redrawing, because the app waited for the terminal to go quiet. Now, if the terminal stays busy, the app presses Enter once Claude's prompt shows the message and has held still for 1.5 seconds. If the terminal never draws the paste at all, it still stops without pressing Enter.
- Why: User report of the error with a busy native terminal; chose the screen fallback.
- Files: [interactive_delivery.rs](../../src-tauri/src/interactive_delivery.rs) (`PasteSettle`, `check_paste`); [claude_interactive.rs](../../src-tauri/src/claude_interactive.rs); [main.rs](../../scripts/interactive-pty-host/src/main.rs); [claudeInteractive.ts](../../src/integrations/harness/providers/claude/claudeInteractive.ts) (`awaitPasteShown`, `retryEnter`); [interactive-node-pty-host.mjs](../../src/integrations/harness/providers/claude/fixtures/interactive-node-pty-host.mjs); [claudeInteractive.test.ts](../../src/integrations/harness/providers/claude/claudeInteractive.test.ts); [claudeInteractiveCli.test.ts](../../src/integrations/harness/providers/claude/claudeInteractiveCli.test.ts)
- Commit: ddb84aa9
- Verified: tsc ✅ tests ✅ (Claude provider: 324 passed; Rust interactive_delivery: 5 passed) build ✅; desktop check manual
## 2026-10-20 19:30 IST — Link preview cards no longer cut their text (L-119)
- Type: fix
- What: With Link previews set to Always, the cards under a reply were a fixed height, so the description was cut off part-way through its second line. Cards now grow to fit the site name, title and up to three lines of description, and the preview image grows with them.
- Why: The preview text could not be read.
- Files: [ChatHoverPreviews.tsx](../../src/features/sessions/ui/ChatHoverPreviews.tsx) (`InlineLinkCard`); [AgentMarkdownLinkPreviews.test.ts](../../src/features/sessions/ui/AgentMarkdownLinkPreviews.test.ts)
- Commit: 3bdd8314
- Verified: tsc ✅ tests ✅ (link preview tests) build ✅; desktop check manual
## 2026-10-20 19:25 IST — Project slots look like the Theme switch (L-132)
- Type: style
- What: With two or more project slots, they now sit in a bordered switch like Settings → Theme (System / Dark / Light). The current slot has the selected pill, which glides when you switch, and a soft highlight follows the pointer across slots. Other slots are wider, so more of their names show. The + stays outside the switch.
- Why: The slots read as loose labels; a switch makes it clear they are one control and which project is current.
- Files: [ProjectSlots.tsx](../../src/features/projects/ui/ProjectSlots.tsx); [ProjectSlots.test.ts](../../src/features/projects/ui/ProjectSlots.test.ts)
- Commit: 91487de7
- Verified: tsc ✅ tests ✅ (projects: 131 passed) build ✅; desktop check manual
## 2026-10-20 19:00 IST — Named project slots, steadier project slide (L-132)
- Type: fix
- What: Project slots that aren't current now show their name next to the icon, muted, instead of the icon alone. When you switch project, the slide now runs the way the slots do: a slot to the left comes in from the left. Only the sessions area slides; the project row, search, Inbox, Notes, Task Manager, Automations and Session Manager stay still.
- Why: Icons alone didn't say which project was which; the slide went the wrong way for left slots and moved parts of the sidebar that do not change.
- Files: [ProjectSlots.tsx](../../src/features/projects/ui/ProjectSlots.tsx); [Sidebar.tsx](../../src/app/shell/Sidebar.tsx) (slide direction from slot order, slide only the content under the nav, overlay clipped to the list); [ProjectSlots.test.ts](../../src/features/projects/ui/ProjectSlots.test.ts)
- Commit: 91487de7
- Verified: tsc ✅ tests ✅ (7,592 passed, 2 skipped) build ✅ (npm run build); desktop check manual
## 2026-10-20 18:25 IST — Project slots in the new layout (L-132)
- Type: feature
- What: The new layout's top row now holds up to four project slots. The + after them adds a project as a new slot; clicking a slot switches to it, with a background that glides across. The current slot shows its name and the usual ⌄ project menu; the others shrink to their icon. × on hover or a middle-click closes a slot (never the last one). Slots come back after a restart. This replaces the Ctrl+click project tabs from L-130.
- Why: User asked for a visible + and slots instead of a hidden Ctrl+click shortcut.
- Files: [projectSlots.ts](../../src/features/projects/model/projectSlots.ts); [ProjectSlots.tsx](../../src/features/projects/ui/ProjectSlots.tsx); [Sidebar.tsx](../../src/app/shell/Sidebar.tsx); [SearchableProjectPicker.tsx](../../src/features/projects/ui/SearchableProjectPicker.tsx) (L-130 code removed); removed projectTabs.ts, ProjectTabs.tsx and their tests; spec [inset-project-slots-plan.md](../specs/inset-project-slots-plan.md)
- Commit: 91487de7
- Verified: tsc ✅ tests ✅ (7,592 passed, 2 skipped) build ✅ (npm run build); desktop check manual
## 2026-10-20 17:00 IST — 0.16.0-local2 Windows build
- Type: chore
- What: New Windows installer, version 0.16.0-local2: 0.16.0-local1 plus L-126 wallpaper in the new layout, L-127 uncropped project logos, L-128 Focus mode group by project, L-129 project menu hover glide, L-130 inset project tabs (fixed order) and L-131 inset sidebar blur on Windows.
- Why: User asked to push and build a new version for testing.
- Files: `E:\Developing\Installable versions\MonoCode_0.16.0-local2-inset-blur-project-tabs-focus-groups_x64.exe` (14,916,850 bytes, SHA-256 DFC661B121007C4AFA86CD0E0EBB136D9A1EF011EB46A239FC8C6532340372E2, NotSigned); version bump in package.json, package-lock.json, Cargo.toml, Cargo.lock, src-tauri/tauri.conf.json.
- Commit: built from b9e5f0af
- Verified: tsc ✅ tests ✅ (7,587 passed, 2 skipped) build ✅ (npm run build:windows); desktop check manual
## 2026-10-20 16:13 IST — Inset sidebar blur on Windows, fixed project tab order (L-131, L-130)
- Type: fix
- What: In the new layout on Windows, the sidebar now lets the desktop blur through as much as the classic sidebar does, and the Sidebar opacity slider is back in Settings → Appearance to tune it. Project tabs no longer swap places when you switch project: they stay in the order you added them, and the current one is highlighted.
- Why: The new layout painted its sidebar at a fixed 80% near-black, hiding the Acrylic blur; and the current project was dropped from the tab row, so the others shifted on every switch.
- Files: `src/styles/index.css`; `src/features/settings/ui/SettingsView.tsx`; `src/features/settings/model/settings.ts` (+ test); `src/features/projects/model/projectTabs.ts` (+ test); `src/features/projects/ui/ProjectTabs.tsx` (+ test); `src/app/shell/Sidebar.tsx`; spec `docs/specs/inset-project-tabs-plan.md`
- Commit: b9e5f0af
- Verified: tsc ✅ tests ✅ (7,587 passed, 2 skipped) build ✅; desktop check manual
## 2026-10-20 16:01 IST — Project menu glide and inset project tabs (L-129, L-130)
- Type: feature
- What: Hover now glides smoothly between rows of the sidebar project menu and the Switch project list. In the inset layout, Ctrl+clicking a project in Switch project keeps it as a small tab beside the project name; clicking a tab switches to that project. A plain click still just switches.
- Why: User asked for the glide in both lists, and for a way to keep a few projects one click apart.
- Files: `src/features/sessions/ui/SharedHoverHighlight.tsx`; `src/features/projects/ui/SearchableProjectPicker.tsx`; `src/features/projects/model/projectTabs.ts`; `src/features/projects/ui/ProjectTabs.tsx`; `src/app/shell/Sidebar.tsx`; tests `SharedHoverHighlight.test.ts`, `projectTabs.test.ts`, `ProjectTabs.test.ts`; spec `docs/specs/inset-project-tabs-plan.md`
- Commit: 13941da2, 0e10d7db
- Verified: tsc ✅ tests ✅ (7,586 passed, 2 skipped) build ✅; desktop check manual
## 2026-10-20 15:52 IST — Focus mode: group by project (L-128)
- Type: feature
- What: Focus mode has a "Group by project" button. When on, two tab rows appear under the top bar: one tab per project with chats in Focus, and one tab per chat of the chosen project. The grid then shows only that project's chats; switching projects is one click. Turning it off shows every chat again in the same places.
- Why: User wanted to switch projects side by side as tabs, with each project's running chats under it.
- Files: `src/features/focus/model/focusGroups.ts`; `src/features/focus/ui/FocusGroupTabs.tsx`; `src/features/focus/ui/FocusView.tsx`; tests `src/features/focus/model/focusGroups.test.ts`, `src/features/focus/ui/FocusView.test.ts`; spec `docs/specs/focus-group-by-project-plan.md`
- Commit: 76e7000c
- Verified: tsc ✅ tests ✅ (7,574 passed, 2 skipped) build ✅; desktop check manual
## 2026-10-20 15:01 IST — Wallpaper in the new layout; logos not cropped (L-126, L-127)
- Type: fix
- What: In the new layout, the Windows wallpaper now shows through the main workspace card, tinted by Glass strength, in light and dark mode, as it does in the classic layout. Project logos fit inside their square instead of being cut off.
- Why: User saw the new layout's card stay solid white over the wallpaper, and some project logos cropped.
- Files: `src/styles/index.css` (inset wallpaper rules); `src/features/projects/ui/ProjectLogoIcon.tsx`; `src/features/quick-composer/ui/QuickProjectIcon.tsx`; tests `src/styles/insetWallpaper.test.ts`, `src/features/projects/ui/ProjectLogoIcon.test.ts`
- Commit: 7bcc4627, eac0f169
- Verified: tsc ✅ tests ✅ (7,566 passed, 2 skipped) build ✅; desktop check manual
## 2026-10-20 11:27 IST — 0.16.0-local1 Windows build (upstream 0.16.0)
- Type: chore
- What: New Windows installer, version 0.16.0-local1: upstream 0.16.0 (phone companion pairing, sidebar swipe, context-menu polish) on top of 0.14.0-local10 plus L-123 Focus button everywhere, L-124 usage-limit turn fix and L-125 terminal Stop fix.
- Why: User asked to commit, push and build the 0.16.0 intake for testing.
- Files: `E:\Developing\Installable versions\MonoCode_0.16.0-local1-upstream-0.16-phone-companion_x64.exe` (14,899,780 bytes, SHA-256 7DA672BBEAE43C54F03F5D737933269F78C4C7E139EA1497CA9AA26645C869DD, NotSigned); version bump in package.json, package-lock.json, Cargo.toml, Cargo.lock, src-tauri/tauri.conf.json.
- Commit: built from f6f940a8
- Verified: tsc ✅ tests ✅ (7,563 passed, 2 skipped) build ✅ (npm run build:windows); desktop check manual

## 2026-10-20 11:12 IST — Take in upstream MonoCode 0.16.0 (phone companion)
- Type: chore
- What: A new branch, `nakul/windows-support-upstream-0.16.0`, brings in upstream 0.16.0: the phone companion app and desktop pairing, sidebar swipe between projects, context-menu polish and a Windows phone-connection fix. All fork features stay.
- Why: Keep the fork current with upstream.
- Files: [upstream-merge-2026-10-20-016.md](../notes/archive/upstream-merge-2026-10-20-016.md) (every conflict decision), [App.tsx (lines 8539, 8942, 10814)](../../src/app/App.tsx:8539), [Sidebar.tsx (line 2767)](../../src/app/shell/Sidebar.tsx:2767), [mobileAttachments.test.ts (line 22)](../../src/features/mobile/model/mobileAttachments.test.ts:22)
- Commit: f6f940a8
- Verified: typecheck ✅ tests ✅ (7,563) build ✅ cargo fmt ❌ (pre-existing, mcp.rs) clippy ❌ (pre-existing fork lints + 1 upstream) cargo test ❌ 816/818 (2 macOS-only tests from the 0.14 intake)
## 2026-10-20 10:43 IST — Terminals stopped from the process monitor no longer freeze (L-125)
- Type: fix
- What: Stopping a terminal from the process monitor left its tab showing the last screen and ignoring typing, and only closing the tab helped. The tab now shows that the process exited and offers Restart.
- Why: Stopping a shell from the monitor silently cut the tab off from it, so the tab never learned the shell had ended.
- Files: [pty.rs (pty_kill)](../../src-tauri/src/pty.rs:384), [pty.ts (stopPty)](../../src/platform/tauri/pty.ts:206), [ProcessMonitor.tsx (line 180)](../../src/app/shell/ProcessMonitor.tsx:180), [pty.test.ts (line 94)](../../src/platform/tauri/pty.test.ts:94), [ProcessMonitor.test.ts (line 26)](../../src/app/shell/ProcessMonitor.test.ts:26)
- Commit: uncommitted
- Verified: typecheck ✅ cargo check ✅ lint — (no linter configured) tests ✅ build —

## 2026-10-20 10:34 IST — Focus button always at the top left (L-123)
- Type: feature
- What: The Focus mode button now sits first in the header at the window's left edge in every view: the project rail, the session sidebar, Session Manager, Task Manager, Inbox and the other full-window views, or the title bar when no sidebar is open. Before, it showed only in the workspace title bar beside the tabs.
- Why: Focus mode should be one click away from anywhere.
- Files: [focusModeToggle.ts](../../src/app/shell/focusModeToggle.ts:1), [TitleBar.tsx (FocusToggleButton, OverlayNav, title bar slots)](../../src/app/shell/TitleBar.tsx:653), [ProjectRail.tsx (header)](../../src/app/shell/ProjectRail.tsx:425), [Sidebar.tsx (header)](../../src/app/shell/Sidebar.tsx:2771), [App.tsx (root provider)](../../src/app/App.tsx:16242)
- Commit: uncommitted
- Verified: typecheck ✅ lint — (no linter configured) tests ✅ (7,511) build —

## 2026-10-20 04:45 IST — Interactive Claude no longer works forever after a usage limit (L-124)
- Type: fix
- What: After Claude hit a usage limit, its notice ("You've hit your weekly limit · resets …") started a new "Working" turn whose timer never stopped, and stopping Claude or closing its terminal did not end it. The notice now shows as an error in the chat, and stopping Claude, closing its terminal or Claude exiting ends any turn it was working on.
- Why: The chat looked busy with no way to stop it.
- Files: [claudeInteractive.ts (lines 249–268, 542–571, 1305)](../../src/integrations/harness/providers/claude/claudeInteractive.ts:249), [claudeInteractive.test.ts (lines 888, 1030–1054)](../../src/integrations/harness/providers/claude/claudeInteractive.test.ts:888)
- Commit: uncommitted
- Verified: typecheck ✅ lint — (no linter configured) tests ✅ (7,511) build —

## 2026-10-20 04:20 IST — Focus mode (L-123)
- Type: feature
- What: A Focus button at the top left of the title bar (or Ctrl+Shift+E) hides the sidebars and tabs and shows running chats from every project side by side: up to 4 columns, then the 5th to 8th chats split the columns into two rows, with more in "+N more". Chats stay after they finish and never move on their own; drag a pane's header to move it. Each pane shows its project and a status tag. A New split button starts a chat in any project, continues a Done, Needs attention or Draft chat, or imports a CLI conversation, and an empty Focus shows those three full screen. Leaving Focus brings the workspace back as it was.
- Why: Work on several projects at once without switching through the Session Manager.
- Files: [focusGrid.ts](../../src/features/focus/model/focusGrid.ts), [focusPaneTag.ts](../../src/features/focus/model/focusPaneTag.ts), [FocusView.tsx](../../src/features/focus/ui/FocusView.tsx), [FocusTopBar.tsx](../../src/features/focus/ui/FocusTopBar.tsx), [FocusPicker.tsx](../../src/features/focus/ui/FocusPicker.tsx), [App.tsx](../../src/app/App.tsx), [TitleBar.tsx](../../src/app/shell/TitleBar.tsx), [BoardSessionCard.tsx](../../src/features/session-board/ui/BoardSessionCard.tsx), [appShortcuts.ts](../../src/features/settings/model/appShortcuts.ts), [settings.ts](../../src/features/settings/model/settings.ts), [icons.tsx](../../src/shared/ui/icons.tsx), [focus-mode-plan.md](../specs/focus-mode-plan.md)
- Commit: uncommitted
- Verified: typecheck ✅ lint — (no linter configured) tests ✅ (7,508) build —

## 2026-10-20 03:37 IST — Focus mode spec (L-123, draft)
- Type: docs
- What: Draft spec for Focus mode: a title-bar button that hides the sidebars and tiles every running chat from any project (4 columns, then two rows, up to 8), keeps finished chats, never reorders on its own, supports drag to move, and adds a New split button (Start new, Continue, Import).
- Why: User wants to work on several projects side by side instead of switching through the Session Manager.
- Files: [focus-mode-plan.md](../specs/focus-mode-plan.md), [SPECS.md](../specs/SPECS.md)
- Commit: uncommitted
- Verified: docs only

## 2026-10-20 02:35 IST — 0.14.0-local10 Windows build (L-122)
- Type: chore
- What: New Windows installer, version 0.14.0-local10, adding the project name shimmer during external turns (L-122) on top of local9 (task editor + button, Interactive Claude auto-compact and queue fix).
- Why: User asked to commit, push and build L-122.
- Files: `E:\Developing\Installable versions\MonoCode_0.14.0-local10-project-shimmer-external-turns_x64.exe` (14,023,090 bytes, SHA-256 2E2FB17B53863A055CA553F28A61E44010D7C421D6BD446D9EAB06829BB49E6E, NotSigned); version bump in package.json, package-lock.json, Cargo.toml, Cargo.lock, src-tauri/tauri.conf.json.
- Commit: built from e7534c37
- Verified: tsc ✅ tests ✅ (7,488 passed, 2 skipped) lint — (no ESLint config) build ✅ (npm run build:windows); desktop check manual

## 2026-10-20 02:25 IST — Project name shimmers during external turns (L-122)
- Type: fix
- What: The project name in the sidebar now shimmers while a chat in that project is working on a turn the app did not send (a phone turn, or Interactive Claude carrying on in the background), the same as the chat row already did.
- Why: User saw a chat working while its project name stayed still.
- Files: [workingSessions.ts](../../src/features/sessions/model/workingSessions.ts), [App.tsx](../../src/app/App.tsx) (`workingSessionIds`, `busyProjectPaths`), [workingSessions.test.ts](../../src/features/sessions/model/workingSessions.test.ts)
- Commit: e7534c37
- Verified: tsc ✅ tests ✅ (7,488 passed, 2 skipped) lint — (no ESLint config) build —; desktop check manual

## 2026-10-20 02:04 IST — Windows rebuild of 0.14.0-local9 with L-121
- Type: chore
- What: New Windows installer, still versioned 0.14.0-local9, that adds the Interactive Claude auto-compact and queue fix (L-121) to the task editor + button build.
- Why: User asked to commit, push and build, keeping the version because the earlier local9 installer was never installed.
- Files: `E:\Developing\Installable versions\MonoCode_0.14.0-local9-task-plus-interactive-queue_x64.exe` (14,018,128 bytes, SHA-256 010D1C75E0DB1CD94A922E99236EA15A383EF82EB8DA03DCC050D7281A3A3F3A, NotSigned). The earlier `MonoCode_0.14.0-local9-task-plus-button_x64.exe` lacks L-121.
- Commit: built from fd40cef0
- Verified: tsc ✅ tests ✅ (7,486 passed, 2 skipped) lint — (no ESLint config) build ✅ (npm run build:windows); desktop check manual


## 2026-10-20 01:52 IST — Interactive Claude: auto-compact no longer ends the turn, and mid-work sends queue (L-121)
- Type: fix
- What: In an Interactive Claude chat, when Claude compacts its memory on its own as a message lands, the turn stays open until Claude really finishes. A message sent while Claude is still working on its own now waits in the queue and goes out once Claude is idle, instead of being refused.
- Why: The user's message with two images showed "Ran for 4s" with no reply while Claude kept working for minutes; the next message was sent straight away and Claude refused it ("has not reached an idle conversation state"). The transcript showed an auto-compact right at that prompt, and the app treated its end hook (`PostCompact`) like the end of the turn.
- Files: [claudeInteractive.ts](../../src/integrations/harness/providers/claude/claudeInteractive.ts), [steerSupport.ts](../../src/features/sessions/model/steerSupport.ts), [messageQueue.ts](../../src/features/sessions/model/messageQueue.ts), [App.tsx](../../src/app/App.tsx), tests in claudeInteractive.test.ts, messageQueue.test.ts, steerSupport.test.ts
- Commit: fd40cef0
- Verified: tsc ✅ tests ✅ (7,486 passed, 2 skipped; the auto-compact test fails on the old code) lint — (no ESLint config) build —; desktop check manual

## 2026-10-20 01:25 IST — Windows build with the task editor + button (0.14.0-local9)
- Type: chore
- What: New Windows installer where the task editor has a + button before Focus today, and Ctrl+Enter creates the next task without an Add more toggle.
- Why: User asked to commit, push and build after the L-90 change.
- Files: `E:\Developing\Installable versions\MonoCode_0.14.0-local9-task-plus-button_x64.exe` (14,021,954 bytes, SHA-256 78B116EBD655AD78E57CF8A9039239F326A0DC9CA4F1FC81715AB1C17EAABD79, NotSigned); version in package.json, package-lock.json, Cargo.toml, Cargo.lock, src-tauri/tauri.conf.json
- Commit: see git log (chore(release): 0.14.0-local9)
- Verified: tsc ✅ tests ✅ (7,482 passed, 2 skipped) lint — (no ESLint config) build ✅ (npm run build:windows); desktop check manual

## 2026-10-20 01:14 IST — Task editor + New task button and Ctrl+Enter are back (L-90, L-94)
- Type: fix
- What: The task editor has an icon-only + button just before Focus today, filled so it looks different from copy and delete. It saves the task and starts the next one, and so does plain Ctrl+Enter (Ctrl+Shift+Enter still works). There is no Add more toggle. The header stays on one row without the "Task" label.
- Why: L-94 (2026-10-17) removed the editor's New task button and the shortcut, but the user still uses them to add several tasks in a row. A first restore at 00:58 also brought back Add more; the user asked for just the + button and Ctrl+Enter.
- Files: [TaskEditor.tsx](../../src/features/tasks/ui/TaskEditor.tsx), [TasksView.test.ts](../../src/features/tasks/ui/TasksView.test.ts)
- Commit: 503a0e27
- Verified: tsc ✅ tests ✅ (7,482 passed, 2 skipped) lint — (no ESLint config) build —; desktop check manual

## 2026-10-20 00:38 IST — Windows build with L-120 (0.14.0-local8)
- Type: chore
- What: New Windows installer where two messages queued behind a running reply both run, in order, instead of the first being skipped.
- Why: User asked to commit, push and build after L-120.
- Files: `E:\Developing\Installable versions\MonoCode_0.14.0-local8-queue-order-fix_x64.exe` (14,022,703 bytes, SHA-256 C2EBCCC2ECCC410F367255B08AFBC8B0A33136D57A23F8C6F21482D60A514A44, NotSigned); version in package.json, package-lock.json, Cargo.toml, Cargo.lock, src-tauri/tauri.conf.json
- Commit: see git log (chore(release): 0.14.0-local8)
- Verified: tsc ✅ tests ✅ (7,482 passed, 2 skipped) lint — (no ESLint config) build ✅ (npm run build:windows); desktop check manual

## 2026-10-19 23:24 IST — Two queued messages both run in order (L-120)
- Type: fix
- What: When two messages were queued behind a running reply, the first queued one stopped after about a second and the second was sent in its place, so the agent never saw the first. Both now run, one after the other.
- Why: User saw the first queued message ("Ran for 1s", no reply) skipped in a Claude Interactive chat. The cause is in the shared queue code, not Claude: the finished turn closed itself a second time after a slow save, which ended the queued turn that had just started.
- Files: [messageQueue.ts](../../src/features/sessions/model/messageQueue.ts), [App.tsx](../../src/app/App.tsx), [messageQueue.test.ts](../../src/features/sessions/model/messageQueue.test.ts)
- Commit: uncommitted
- Verified: tsc ✅ tests ✅ (7,482 passed, 2 skipped) lint — (no ESLint config) build —; desktop check manual

## 2026-10-19 22:45 IST — Windows build with L-119 (0.14.0-local7)
- Type: chore
- What: New Windows installer with the Link previews setting (Off, On hover, Always) and rich link cards showing the page's picture, title and description.
- Why: User asked to commit, push and build after L-119.
- Files: `E:\Developing\Installable versions\MonoCode_0.14.0-local7-link-preview-cards_x64.exe` (14,017,793 bytes, SHA-256 C921933E30ECC3AFBFED8416DBCE06FA052BC9BB3D787B7464D9A894D3736D0F, NotSigned); version in package.json, package-lock.json, Cargo.toml, Cargo.lock, src-tauri/tauri.conf.json
- Commit: see git log (chore(release): 0.14.0-local7)
- Verified: tsc ✅ tests ✅ (7,479 passed, 2 skipped) cargo ✅ (link_preview) lint — (no ESLint config) build ✅ (npm run build:windows); desktop check manual

## 2026-10-19 22:28 IST — Link previews setting and rich link cards (L-119)
- Type: feature
- What: Settings → Chat → Link previews chooses Off, On hover (default) or Always. Link cards now show the page's picture, title, description and site name. Always also puts up to three small cards under each finished reply, loaded only as you scroll to them. Pictures are shrunk to small thumbnails and kept in memory only (the last 100 links), so nothing fills your disk.
- Why: User asked for a hover/always toggle and rich previews for normal pages (no special X/Twitter handling), sized appropriately and without storage growth.
- Files: [link_preview.rs](../../src-tauri/src/link_preview.rs), [linkPreview.ts](../../src/features/sessions/model/linkPreview.ts), [linkPreviewSettings.ts](../../src/features/settings/model/linkPreviewSettings.ts), [ChatHoverPreviews.tsx](../../src/features/sessions/ui/ChatHoverPreviews.tsx), [AgentMarkdown.tsx](../../src/features/sessions/ui/AgentMarkdown.tsx), [SettingsView.tsx](../../src/features/settings/ui/SettingsView.tsx), [settings.ts](../../src/features/settings/model/settings.ts)
- Commit: see git log (feat(sessions): link preview setting and rich link cards)
- Decision: [chat-link-previews.md](../specs/chat-link-previews.md)
- Verified: tsc ✅ tests ✅ (7,479 passed, 2 skipped) cargo ✅ (link_preview, 5 passed) lint — (no ESLint config) build —; desktop check manual

## 2026-10-19 21:59 IST — Windows build with L-116 to L-118 (0.14.0-local6)
- Type: chore
- What: New Windows installer with accent-coloured chat links, Interactive chats that keep rendering after a pasted image, and images, videos, a full-size image viewer, image copy and link and image hover previews in every chat.
- Why: User asked to commit, push and build after L-116 to L-118.
- Files: `E:\Developing\Installable versions\MonoCode_0.14.0-local6-media-previews-pasted-image-fix_x64.exe` (13,987,754 bytes, SHA-256 B587BB20F66A40E732C41E9C4C863822C4011B0DCCF0700C108C49B43E48609E, NotSigned); version in package.json, package-lock.json, Cargo.toml, Cargo.lock, src-tauri/tauri.conf.json
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

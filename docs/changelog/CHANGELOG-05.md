# Changelog 05 — MonoCode Windows fork

## 2026-11-19 12:55 IST — Claude background tasks stay visible and don't block messages; Hari Select text, Share tables and Show more (L-365, L-366)

- Why: user report: a CodeRabbit review Claude ran in the background never showed, and the next message failed with "Return to an empty, idle native prompt…". Phone: the Select text bar vanished on lifting the finger; Share tables were squeezed and couldn't scroll; long Share texts didn't fold.
- What (L-365): the reply ending no longer clears interactive Claude's background list (root cause). The line shimmers, has an × per task (sends one short "stop it" message), and keeps the chat working for cards, idle hibernate and idle close. A send during background work goes on the running settings with a note; new settings apply after it ends (`/model` and `/effort` were not used: they overwrite Claude's global defaults). No extra turns or tokens. Desktop Share footer: Copy left, time right.
- What (L-366): Android dropped the selection because the hidden system menu refuses to open on lift; Android now keeps its menu. Tables size columns to their text (64–320 px) and scroll; Share text is touchable (not selectable) and folds past 700 characters or 12 lines.
- Verified: desktop vitest ✅ (8243; one flaky failure on a loaded first run, passes on rerun), tsc ✅; claude interactive + apply tests ✅; phone tsc ✅, lint ✅, vitest ✅ (367).
- Commit: (pending)

## 2026-11-19 05:57 IST — Hari: side menu closes from the strip while a chat loads (L-364)

- Why: user report: the side menu stuck while a chat took a while to load. A slow chat keeps JS busy, and the strip's tap waited for it.
- What: the tap now shuts the drawer on the UI thread (RNGH Tap beside the pan).
- Verified: phone tsc ✅, lint ✅, vitest ✅ (365; tests/mobile/watchFrames.test.ts fails to load before and after, unrelated).
- Commit: 8f2ba01b (in 0.16.0-local63)

## 2026-11-19 05:50 IST — Claude tools off until switched on per project; Hari shows Windows' own memory (L-362, L-363)

- L-362: Claude Code's user-scope MCP servers no longer start in every new project. MonoCode keeps a per-project on list (`~/.monocode/mcp-on-demand.json`) and passes the rest as `deniedMcpServers`; a switch in an open chat restarts it on the same conversation (`--resume`) at the next message. Local configs set to match (backups beside each): Codex tabularis off, OpenCode and Antigravity aside off.
- L-363: `pc.stats` sends kernel paged/non-paged memory and the handle count; Hari's Stats shows them under Memory, amber over 4 GB.
- Verified: desktop tsc ✅, vitest claude + MCP settings ✅ (370), cargo test mcp ✅ (40), mobile_pc ✅ (14); phone tsc ✅, vitest ✅ (365), lint: no new problems.
- Commit: 769e81f5 (in 0.16.0-local62)

## 2026-11-19 05:11 IST — Hari: composer keeps its draft open, side menu always closes, swipe back follows the thumb (L-359 to L-361)
- Type: fix
- What: A chat's composer comes back open with its whole draft and pictures (it showed one line after Share). The dimmed strip, a swipe right and Back always close the side menu. A swipe back from the left edge moves the screen with the thumb, then slides it off as the previous screen fades in, or springs back.
- Why: User report 2026-11-19 (two screenshots): the menu stayed open after switching projects and a tap on the strip did nothing; the left-edge back jumped with no motion; the composer showed one line after Share.
- Files: see L-359 to L-361 in [LOCAL-FEATURES.md](../LOCAL-FEATURES.md)
- Commit: 769e81f5 (in 0.16.0-local62)
- Verified: phone tsc ✅ lint ✅ vitest ✅ (363; old `watchFrames` load failure). Needs a check on the phone.

## 2026-11-19 01:23 IST — Share: history limit with a count, search, and the desktop's row under each message (L-356 to L-358)
- Type: feature
- What: Share keeps 100, 250, 500 or 1000 messages (Settings on the desktop's Share panel or in Hari), shown as "64 / 250" at the top; pinned and saved don't count. A search button on both sides shows only messages matching every word. On the desktop, Copy and the day and time ("Today · 14:05") sit under each message, outside the card, as on the phone.
- Why: User request 2026-11-19 (screenshot of the desktop Share panel).
- Files: see L-356 to L-358 in [LOCAL-FEATURES.md](../LOCAL-FEATURES.md)
- Commit: 4ab7616e (in 0.16.0-local61)
- Verified: desktop tsc ✅ vitest src/features/mobile (95) ✅ cargo check ✅ cargo test mobile_share (12) ✅; phone tsc ✅ lint ✅ vitest ✅ (363; old `watchFrames` load failure). Manual: desktop search, count, limit in Settings, row under messages; phone search, count, Settings → Share → Keep messages.

## 2026-11-19 00:42 IST — Hari: block actions, Select text and bookmarks; Command Code keeps working; Share link menu (L-351 to L-355)
- Type: feature
- What: On the phone, code blocks wrap (with a wrap button), and code, tables and quotes have Add task, Add to notes and Copy. Select text opens a whole reply to select across, with Hari's own bar (Copy, Bookmark, Add to notes, Add task). A bookmark button under each reply saves to the desktop's session Bookmarks. Command Code turns ask the model to keep working until the task is done. The desktop Share panel's link right-click opens in the default browser, MonoCode's browser, or copies the link.
- Why: User report 2026-11-18 (two screenshots): code ran off the phone's screen, only one block could be selected at a time, no bookmarks or block actions on the phone, Command Code (Muse Ember) stopped after announcing each next step, and Share links had no "open in default browser".
- Files: see L-351 to L-355 in [LOCAL-FEATURES.md](../LOCAL-FEATURES.md); spec [hari-chat-blocks-select-bookmarks-plan.md](../specs/hari-chat-blocks-select-bookmarks-plan.md)
- Commit: 8ada324f (in 0.16.0-local61)
- Verified: desktop tsc ✅ vitest (mobile, session panel, Command Code: 1205) ✅ cargo check ✅ cargo test mobile_bookmarks ✅; phone tsc ✅ lint ✅ vitest ✅ (361; old `watchFrames` load failure). Needs a check on the phone and desktop.

## 2026-11-18 10:19 IST — Hari: chat composer no longer stuck mid-screen after minimising (L-350)
- Type: fix
- What: Coming back to Hari, the composer settles where the keyboard really is, instead of staying raised in the middle of the screen.
- Why: User report 2026-11-18 (screenshot: composer stuck mid-screen after returning from minimised). Android hides the keyboard while the app is away without the move events the composer follows.
- Files: see L-350 in [LOCAL-FEATURES.md](../LOCAL-FEATURES.md)
- Commit: ba1e8503 (released in 0.16.0-local60)
- Verified: phone typecheck ✅ lint ✅ phone vitest ✅ (357; `watchFrames` load failure is old). Needs a check on the phone.

## 2026-11-18 10:15 IST — Hari: places with the side menu, reopened where you left them, swipes everywhere, files saved straight to the phone (L-346 to L-349)
- Type: feature
- What: Tasks, Notes, Computer (Share and Control) and Notifications are main screens switched from the side menu, not pop-up sheets. Each project and place reopens where it was left (session, note, tab, folder). A swipe left opens the side menu and a swipe right goes back a step everywhere; on sliders, wide tables and notification rows only from the edge. A file tapped in the computer's files saves straight to Downloads/Hari with progress on the row, then Open.
- Why: User report 2026-11-18 (sidebar missing on these screens, state lost on switching, swipes inconsistent, files going through Share); decisions 1A, 2A, 3A, 4A in [hari-places-and-swipes-plan.md](../specs/hari-places-and-swipes-plan.md).
- Files: see L-346 to L-349 in [LOCAL-FEATURES.md](../LOCAL-FEATURES.md)
- Commit: a4e0415c (released in 0.16.0-local60)
- Verified: phone typecheck ✅ lint ✅ (2 old warnings) phone vitest ✅ (357; `tests/mobile/watchFrames.test.ts` fails to load on HEAD too) cargo check ✅. Needs a check on the phone.

## 2026-11-18 09:59 IST — Hari: switches clear old session layers, side menu shuts on minimise, back goes up a folder (L-343, L-344, L-345)
- Type: fix
- What: Picking a project, session or Mono from the side menu, or a session from a notification, shows only that place; sessions open before no longer stay in front. The side menu shuts when Hari is minimised, so it can't stay stuck half open. In the computer's files, the phone's back goes up one folder.
- Why: User report 2026-11-18: switching projects kept showing the other project's session (two layers with three sessions); the menu stuck after minimising; back left the file browser.
- Files: see L-343, L-344 and L-345 in [LOCAL-FEATURES.md](../LOCAL-FEATURES.md)
- Commit: 8679c348 (released in 0.16.0-local60)
- Verified: phone typecheck ✅ lint ✅ (2 old warnings) phone vitest ✅ (351; `tests/mobile/watchFrames.test.ts` fails to load on HEAD too). Needs a check on the phone.

## 2026-11-17 23:44 IST — Phone chats open at the newest message and don't jump; update file cleaned up (L-341, L-342)
- Type: fix
- What: A phone chat opens on its latest 20 turns instead of 3, so older ones load only when you scroll up yourself. Nothing scrolls the list while you drag it or it glides. At the newest message it stays there as the desktop's fresh copy lands; scrolled up, it keeps your place. "Updating…" shows under the header while a kept copy waits for the desktop. The update installer is deleted from Hari's cache once installed.
- Why: User report 2026-11-17: opening a chat kept loading and showed older messages, then jumped elsewhere while scrolling. User report 2026-11-17 (screenshot): Hari's cache at 110 MB.
- Files: see L-341 and L-342 in [LOCAL-FEATURES.md](../LOCAL-FEATURES.md)
- Commit: 037bc3b8 (released in 0.16.0-local59)
- Verified: phone typecheck ✅ lint ✅ (2 old warnings) phone vitest ✅ (347; `tests/mobile/watchFrames.test.ts` fails to load on HEAD too). Needs a check on the phone.

## 2026-11-17 20:13 IST — Share header in one row and a pin card; phone tables scroll; phone session pins (L-337, L-338, L-339, L-340)
- Type: feature + fix
- What: The desktop Share header is one row: Share, Notifications and Files tabs (Storage renamed) in place of the title, then a filter icon, a Settings gear and Close. Pinned items sit in a card at the top that opens in place, with an arrow to go to the message and "2 of 3" arrows for several pins. In Hari, a swipe on a table or code block scrolls it; the side menu opens from the right edge there. Hari's session list drops the swipe actions; a long press opens a menu to pin a session on the phone, and pinned sessions come first.
- Why: User request 2026-11-17 (screenshots: Share's second tabs row; pin bar only scrolled to the message). User report 2026-11-17: reading a wide table in a session opened the side menu. User request 2026-11-17: phone-only pinning, a hold menu instead of swipe; Rename and Delete on the phone left as they are.
- Files: see L-337 to L-340 in [LOCAL-FEATURES.md](../LOCAL-FEATURES.md)
- Commit: 00981dfa (released in 0.16.0-local59)
- Verified: root typecheck ✅ mobile and shared-ui vitest ✅ (31 files); phone typecheck ✅ lint ✅ (2 old warnings) full phone vitest ✅ (343). Needs a check in the desktop app and on the phone.

## 2026-11-17 19:31 IST — Phone notifications after updates; Share panel width and unroll (L-334, L-335, L-336)
- Type: fix + feature
- What: After a Hari update, phone notifications stopped reaching the computer until Notification access was turned off and on; Hari now restarts its notification reader itself, says in its Notifications settings when the reader isn't running, and the computer says why it's quiet instead of asking to turn Send to computer on. The Share and Browser side panels no longer come back squeezed after Hari is minimised. The desktop Share panel now unrolls down from the top bar and rolls back up to close.
- Why: User report 2026-11-17 (Xiaomi phone: access on and connected, but the computer said "turn on Send to computer"; toggling access fixed it). User report 2026-11-17 (screenshots: Share panel narrow after restoring from minimised, until a click). User request 2026-11-17: open from the top instead of the right.
- Files: see L-334, L-335 and L-336 in [LOCAL-FEATURES.md](../LOCAL-FEATURES.md)
- Commit: 81bbe516 (released in 0.16.0-local59)
- Verified: root typecheck ✅ full vitest ✅ (770 files); Rust `mobile_phone_notifications` tests ✅ (6); phone typecheck ✅ lint ✅ `phoneNotices` tests ✅ (6). Kotlin is compiled by the release build. Needs a check on the phone and in the desktop app.

## 2026-11-17 17:54 IST — Hari Share: messages with a list, code or a table were squeezed (L-333)
- Type: fix
- What: In Hari's Share chat, a text message with a numbered or bulleted list was only as wide as its first line, so the list broke words over many short lines. Code blocks, tables, quotes and rules had the same problem. Messages with any of these now take the full bubble width; plain text and headings still size to fit.
- Why: User report 2026-11-17 (screenshot: "Two issues:" message). Cause: Markdown list text fills its row (`flex: 1`) and code and tables scroll sideways, which gives them no width inside a bubble that sizes to its content.
- Files: see L-333 in [LOCAL-FEATURES.md](../LOCAL-FEATURES.md)
- Commit: 417a1931, f340d9a6 (released in 0.16.0-local58)
- Verified: phone typecheck ✅ lint ✅ `markdown` tests ✅ (8). Needs a check on the phone.

## 2026-11-17 17:08 IST — Desktop Share: tabs, type dropdown, Settings (L-332)
- Type: feature
- What: The desktop Share panel has the app's gliding tabs under its title: Share, Notifications, Storage (the phone's files) and Settings. The kinds of item (All, Media, Files, Links, Text, Saved) moved to a dropdown beside Close. Settings holds the phone's name, battery, heat, storage, network and last update, Find my phone, and Share's storage on this computer with Delete all. The bell, phone and box buttons in the header are gone.
- Why: User request 2026-11-17: the header and filter rows were crowded; tabs and a settings view instead.
- Files: see L-332 in [LOCAL-FEATURES.md](../LOCAL-FEATURES.md)
- Commit: 6d530c9d (released in 0.16.0-local57)
- Verified: root typecheck ✅; mobile feature tests ✅ (92). Needs a check in the desktop app.

## 2026-11-17 16:24 IST — Hari Share hold menu; old Antigravity automations fixed (L-330, L-331)
- Type: fix
- What: In Hari's Share chat, holding a message now offers Add to notes, Add task, Pin, Save and Delete. The row under a card shows only Copy and Save, with the time right beside them on the card's own side. Image and text cards no longer show a bookmark inside. Separately, automations saved with the removed Antigravity (ACP) agent (L-244) kept failing with "Harness is not connected"; they now move to Antigravity CLI with the same model.
- Why: User request 2026-11-17: Notes, Tasks and Pin only in the hold menu; time looked disconnected at the far end; bookmark duplicated; "wallpapers" and "freeproductshub" automations failing daily since 2026-11-12.
- Files: see L-330 and L-331 in [LOCAL-FEATURES.md](../LOCAL-FEATURES.md)
- Commit: d93879ef (released in 0.16.0-local57)
- Verified: phone typecheck ✅ lint ✅ phone tests ✅ (337); root typecheck ✅ automations tests ✅ (73). Needs a check on the phone, and the next automation run on the desktop.

## 2026-11-17 15:25 IST — Interactive Claude: long messages stopped sending (L-329)
- Type: fix
- What: In Interactive CLI mode, every long message (and every message with an attachment) stopped with "Prompt delivery is unconfirmed: Claude's prompt never showed the message". Claude Code 2.1.326 now caps its input box and scrolls a tall draft inside it, and the top border reads "── ↑ 21 more ──" with the `❯` row hidden. MonoCode's draft reader needed that `❯` row under a plain border. It now also reads a scrolled box.
- Why: User report 2026-11-17: no message could be sent in Interactive mode, in new or resumed chats.
- Files: `src/integrations/harness/providers/claude/claudeInteractiveTerminal.ts`, `claudeInteractiveTerminal.test.ts`
- Commit: afb017f0 (released in 0.16.0-local56)
- Verified: root typecheck ✅; Claude provider and sessions tests ✅ (2390). Needs a check in the desktop app with a long message.

## 2026-11-17 14:05 IST — Hari: task editor, side menu on the right, Share background (L-327, L-328)
- Type: feature
- What: In Hari Tasks, status and project are one pill each that opens a short list, and Edit slides up a full editor (title, status, project, tags, Markdown details with Write | Preview). The side menu now opens from the right, and its button is at the top right. In a session on Android, swipe left opens it and swipe right goes back to the project's sessions. The side menu order is Notifications, lists, then Share, Tasks, Notes and Settings, with the search at the bottom. Share can have its own background (Settings → Appearance → Share background). In-app updates fall back to the release's own APK when the Pages link fails.
- Why: User request 2026-11-17: "Blocked" pill cut off, no way to edit a task's details on the phone, one-handed use, sidebar order, Share background, and the phone's update download failing.
- Files: see L-327 and L-328 in [LOCAL-FEATURES.md](../LOCAL-FEATURES.md); spec [hari-tasks-drawer-share-background.md](../specs/hari-tasks-drawer-share-background.md)
- Commit: 1d5bd5ee (L-327), 2d339b22 (L-328); released in 0.16.0-local56
- Verified: phone typecheck ✅ lint ✅ (2 old warnings) phone tests ✅ (337; `tests/mobile/watchFrames.test.ts` fails to load in the phone run, untouched); root typecheck ✅ root tests ✅ (769 files); `cargo check` ✅ `mobile_tools` tests ✅. Needs a check on the phone and a new APK.

## 2026-11-17 08:17 IST — Hari Share chat tidier, hold a message to delete it (L-326)
- Type: feature
- What: In Hari's Share chat, messages no longer each say "Link to your computer" or "from your computer"; a note at the top says it once and goes away for good when closed. Each message shows its day and time (Today, Yesterday, then the date) on its button row: at the left end under your messages, at the right end under the computer's. Holding a message now opens a menu with Pin, Save and Delete.
- Why: User request 2026-11-17: labels repeated on every message; date wanted beside the buttons; "Holding a message is not showing any option". Cause: only a hold on a message's text was caught, and it put a Delete button below the message, often off screen.
- Files: see L-326 in [LOCAL-FEATURES.md](../LOCAL-FEATURES.md)
- Commit: uncommitted
- Verified: phone typecheck ✅ lint ✅ `shareModel` tests ✅ (29). Needs a check on the phone.

## 2026-11-16 23:26 IST — Phone notifications in desktop Share (L-325)
- Type: feature
- What: The phone's notifications can show on the computer. In Hari, Settings → Share → Notifications on computer turns it on (Android asks for Notification access). The desktop Share panel gets a bell button that opens Phone notifications: what's on the phone now and what left it in the last 24 hours. Dismissing one on the computer clears it on the phone. One-time codes are dotted out until clicked. Banking, payment, authenticator and password apps start switched off; any app can be switched off on the phone. Nothing is saved to disk or queued while the computer is away.
- Why: User request 2026-11-16 (2: A A A).
- Files: see L-325 in [LOCAL-FEATURES.md](../LOCAL-FEATURES.md); spec [phone-notifications-plan.md](../specs/phone-notifications-plan.md)
- Commit: 2277d68d
- Verified: typecheck ✅ (root, mobile) lint ✅ (mobile; root has no ESLint config) tests ✅ (root mobile features 20 files, 95 tests; Rust 5; mobile 331, `watchFrames.test.ts` failed before) Kotlin compile ✅. Phone and desktop checks manual.

## 2026-11-16 23:08 IST — Markdown Live mode removed (L-324)
- Type: refactor
- What: Markdown everywhere in the desktop app (Notes, Tasks, Session summaries, .md files, plans) now has two views, Preview and Source. It opens in Preview; Ctrl+E switches between them, and double-clicking text in Preview opens Source at that line. A blank new note or task opens in Source. The Live editor is gone.
- Why: User decision 2026-11-16 (1A): remove Live mode completely.
- Files: see L-324 in [LOCAL-FEATURES.md](../LOCAL-FEATURES.md); spec [remove-markdown-live.md](../specs/remove-markdown-live.md)
- Commit: 5dbf9d35
- Verified: typecheck ✅ tests ✅ (21 files, 186 tests; the 70 unhandled `listen` errors from `NotesView.test.ts` were there before). Desktop check manual.

## 2026-11-16 23:02 IST — Share opens smoothly on both sides (L-323)
- Type: fix
- What: Hari no longer asks the computer for the whole Share history on every reconnect, only on the first connect after pairing or when the phone has none. The Share chat no longer jumps to the bottom a second time or overlaps text as link cards and pictures load. On the computer, the Share panel slides in and out more slowly and softly.
- Why: User report 2026-11-16: phone Share "bottom shows up once in a chat, and then again it shows after a delay, sometimes overlapping text"; "if it's already connected don't do it"; desktop slide "very fast".
- Files: see L-323 in [LOCAL-FEATURES.md](../LOCAL-FEATURES.md)
- Commit: 007987af
- Verified: root typecheck ✅; phone typecheck ✅ lint ✅ `shareModel` tests ✅ (27). Needs a check on the phone and the computer.

## 2026-11-15 22:31 IST — Hari update check no longer says Up to date when it cannot read a release (L-322)
- Type: fix
- What: Check for updates now says Couldn't check (with Open the release page) when the newest release can't be read, instead of Up to date.
- Why: User report 2026-11-15: the phone said latest, did not show its version and did not see local55. Cause: the L-315 fix (accept APKs on GitHub Pages, show the installed version) landed after the local54 tag, so local54 and older reject local55's Pages link and reported that as Up to date. Those builds need local55 installed by hand once; from local55 on, updates work in the app.
- Files: [hariUpdate.ts](../../mobile/src/features/updates/hariUpdate.ts), [useHariUpdate.ts](../../mobile/src/features/updates/useHariUpdate.ts), [hariUpdate.test.ts](../../mobile/tests/hariUpdate.test.ts)
- Commit: 66bac951
- Verified: phone typecheck ✅ lint ✅ `hariUpdate` tests ✅ (7)

## 2026-11-15 21:09 IST — Share bubble: send the clipboard from over any app (L-321)
- Type: feature
- What: Hari (Android) has a Share bubble, off until turned on in Settings → Share. It floats over other apps; one tap sends what you copied (text, a link or a picture) to the computer and shows ✓ (or the picture) with Undo for 4 seconds. The same clipboard again wiggles and says Already sent. Drag to move (snaps to a side, never sends); hold for Send again, Open Share or Hide bubble. It hides while Hari is open.
- Why: User request 2026-11-15 ("Build it all": phone floating bubble that sends the clipboard on tap, with a setting to turn it on or off).
- Files: see L-321 in [LOCAL-FEATURES.md](../LOCAL-FEATURES.md)
- Commit: fb6a6f4f (released in 0.16.0-local55 with L-318..L-320)
- Verified: phone typecheck ✅ lint ✅ tests ✅ (324; the known `watchFrames` file fails as before), `shareModel` test for ids and Undo ✅, Kotlin `:hari-live:compileDebugKotlin` ✅ with no warnings in the new code. Needs the new APK and a check on the phone.

## 2026-11-15 20:59 IST — Share bar: send to the phone from over any app (L-320)
- Type: feature
- What: Ctrl+Alt+H opens a small glass window that floats above every app with Share's composer in it. Type, paste (text, links, pictures) or drop files on it and Send; it stays open and shows ✓ Sent, and closes with its × or the shortcut. It remembers where it was and how big, and moves back on screen when a monitor is unplugged. The shortcut can be changed or turned off in Settings → Shortcuts ("App: Share Bar"); a chord another app holds shows "Shortcut taken".
- Why: User request 2026-11-15 ("Build it all": desktop floating Share bar).
- Files: see L-320 in [LOCAL-FEATURES.md](../LOCAL-FEATURES.md)
- Commit: 9d83bda9
- Verified: Rust `share_bar` tests ✅ (5) `window::tests` ✅, rustfmt ✅, clippy clean in the changed files; desktop typecheck ✅, tests ✅ (settings, mobile, platform, quick-composer: 801), `vite build` ✅ (`share-bar.html` built). The window itself needs a manual check on the desktop.

## 2026-11-15 20:48 IST — Minimal mode, Restart and Shut down from the phone (L-318, L-319)
- Type: feature
- What: Hari's Control tab has a second row of tiles. Minimal asks first (naming the apps it will close), then sets Windows power mode to Best power efficiency, turns the monitor off and asks the apps picked in Settings → Connections → Minimal mode to close; tapping it again restores the power mode, reopens those apps and turns the monitor on. Restart and Shut down each ask first and don't force apps closed.
- Why: User request 2026-11-15 (locked: Minimal mode 1A, Restart and Shut down 2A).
- Files: see L-318 and L-319 in [LOCAL-FEATURES.md](../LOCAL-FEATURES.md)
- Commit: 3c7b8f1e
- Verified: Rust `mobile_pc` tests ✅ (14, five new; the read-only power-mode check passes here), phone typecheck ✅ lint ✅ `pcModel` tests ✅ (13), desktop typecheck ✅ `src/features/mobile` tests ✅ (85). Phone tiles and the real power change need a manual check (new phone JS; no new APK native code).

## 2026-11-15 19:14 IST — Share stays in step on both sides; one card per message (L-317)
- Type: feature + fix
- What: the phone fills its Share history in from the computer on each connect (all of it after a reinstall, with a loader the first time); Remove travels both ways, and the phone remembers what it removed so a fill-in won't bring it back; a file without an ending gets one from its type (the phone when sending, the computer on receipt, from the first bytes when the type is generic); the phone opens files in their default app; phone link cards use the full width; the computer's Share message is one card with Copy (Save and Pin on hover) at the bottom left and the time at the bottom right, the other actions in the right-click menu.
- Why: User report 2026-11-15 (history gone after reinstall, Remove on one side only, gallery pictures with no ending, an app chooser every time, narrow link cards, a card inside a card).
- Files: see L-317 in [LOCAL-FEATURES.md](../LOCAL-FEATURES.md)
- Commit: c30bc4a4
- Verified: Rust `mobile_share` tests ✅ (11), phone typecheck ✅ lint ✅ tests ✅ (31), desktop typecheck ✅ `src/features/mobile` tests ✅ (84). `cargo clippy -D warnings` fails only in files this change doesn't touch (attachment_storage, claude_interactive, harness, mobile_router). The direct open on the phone needs a new APK.

## 2026-11-15 17:17 IST — Phone takes updates from GitHub Pages; version stays in view (L-315 fix)
- Type: fix
- What: local53 put a GitHub Pages link in `hari-android.json`, and the phone accepts only github.com links there, so it dropped the update and showed Up to date. The phone now also accepts an APK on the repo owner’s GitHub Pages (`imnakul.github.io`, https only). Phones on local53 or older need one reinstall by hand (user’s choice: keep Pages links rather than a GitHub fallback). The Updates row now shows the installed version beside Up to date.
- Why: User report 2026-11-15 (phone on local50 or older showed Up to date with no version).
- Files: `mobile/src/features/updates/hariUpdate.ts` (`pagesHost`), `useHariUpdate.ts`, `HariUpdateCard.tsx`, `mobile/tests/hariUpdate.test.ts`
- Commit: 10ffec46
- Verified: phone typecheck ✅ lint ✅ `hariUpdate` tests ✅ (6, one new). The desktop updater is not affected (it checks the signature, not the address).

## 2026-11-15 17:12 IST — Desktop window keeps its see-through glass (L-314 fix)
- Type: fix
- What: since local52 the desktop window was created hidden on Windows (`"visible": false`) so a sign-in launch would not flash; the window then lost its see-through glass and the Share panel showed as a black, solid panel. The window is created visible again; a sign-in launch hides it at once in setup.
- Why: User report 2026-11-15 (black panel on local53).
- Files: `src-tauri/tauri.windows.conf.json`, `src-tauri/src/lib.rs` (comment), L-314 in [LOCAL-FEATURES.md](../LOCAL-FEATURES.md)
- Commit: f3a56fce
- Verified: `cargo check` ✅. Cause found by elimination (the only window change since local50); confirm in dev mode.

## 2026-11-15 16:58 IST — Hari Share composer at the bottom (L-316)
- Type: feature
- What: the phone's Share page now reads as a session's chat: messages oldest first with the newest at the bottom, the page opens at its end and follows new messages when it is there, and the composer is docked at the bottom, riding on the keyboard (the session's keyboard lift). The filters, Delete all and the pin bar stay fixed at the top. The file picker holds the composer in place as it opens (as L-309).
- Why: User request 2026-11-15.
- Files: see L-316 in [LOCAL-FEATURES.md](../LOCAL-FEATURES.md)
- Commit: see the 0.16.0-local54 commit
- Verified: phone typecheck ✅ lint ✅ `shareModel` tests ✅ (21). Phone check manual.

## 2026-11-15 16:42 IST — Update downloads from GitHub Pages (L-315)
- Type: feature
- What: the release build now puts the new installer and APK on GitHub Pages, checks both can be downloaded, and only then writes the update files with Pages links (the release keeps a copy and its links are used if Pages fails). Turned on Pages (built by Actions) with a `hari-v*` tag rule on the `github-pages` environment, and removed the dead custom domain devnakul.me from `imnakul.github.io`, which sent every Pages address there.
- Why: GitHub release downloads were very slow on the user's network; Pages has about 100 GB a month with no card.
- Files: see L-315 in [LOCAL-FEATURES.md](../LOCAL-FEATURES.md)
- Commit: see the 0.16.0-local53 commit
- Verified: workflow edited; first real check is the local53 release run. Download speed on phone and PC manual.

## 2026-11-15 16:27 IST — Hari chats no longer hang on the spinner; Quit Hari; Launch on startup (L-312..L-314)
- Type: fix, feature
- What: L-312: a long chat opened from a notification could stay on its spinner. The phone sent the hidden chat to its end once to have its newest rows drawn; when the computer's fresh copy replaced the one kept on the phone, or a running reply grew, the new end was never drawn and the chat waited for it. It now goes again whenever the chat changes before it shows, goes on once the end is drawn and the screen is full, and shows the chat at its end within 1.5 s regardless. L-313: Quit Hari in Settings and on the always-on notification (Android). L-314: Launch on startup for the desktop app, starting in the tray (Windows).
- Why: User report and requests 2026-11-15.
- Files: see L-312 to L-314 in [LOCAL-FEATURES.md](../LOCAL-FEATURES.md)
- Commit: see the 0.16.0-local52 commit
- Verified: phone typecheck ✅ lint ✅ Transcript tests ✅ (17; the 3 new ones fail without the fix) SessionScreen tests ✅ (mock fixed for L-309); Android `compileDebugKotlin` ✅; `cargo check` ✅ `cargo test startup::` ✅; desktop typecheck ✅ settings tests ✅. Phone and desktop checks manual.
- Note: `tests/mobile/watchFrames.test.ts` fails to load from the phone's test run before and after this change.

## 2026-11-15 15:32 IST — Phone shares no longer freeze the computer; Share always in Hari's drawer (L-310, L-311)
- Type: fix
- What: L-310: the computer handled the phone's outbox while holding its phone-service lock, and a shared text or link then looked up the phone's name under that same lock, so the service waited on itself for good. The phone showed "Reconnecting to desktop" with the computer on, shares stayed in the outbox, and MonoCode's window froze (its status commands wait on that lock). The outbox now runs off the lock. Share history had no phone-to-computer text at all, so every such share since L-279 hit it. L-311: the drawer keeps Share once paired, with Wake computer added while offline; Back closes a picture opened from the chat box; Share's picture frame is thinner.
- Why: User report 2026-11-15 (a link shared from Brave, then the computer stuck).
- Files: see L-310 and L-311 in [LOCAL-FEATURES.md](../LOCAL-FEATURES.md)
- Commit: see the 0.16.0-local51 commit
- Verified: `cargo check` ✅; phone typecheck ✅ lint ✅ Composer tests ✅ (8). Phone and computer checks manual.
- Note: GitHub's download server gave this PC about 11 KB/s (Cloudflare about 6 MB/s), which is why updates failed on both devices.

## 2026-11-15 14:35 IST — Hari's chat box stays put when Photo Library opens (L-309)
- Type: fix
- What: On Android, opening Photo Library, Camera or Files from the + menu dropped the keyboard at once, so the chat box fell in one frame just before the picker covered it. The chat box now stays where it is under the picker, then glides to the keyboard's place (up if it comes back, down if not) when you return.
- Why: User report 2026-11-15.
- Files: see L-309 in [LOCAL-FEATURES.md](../LOCAL-FEATURES.md)
- Commit: see the 0.16.0-local50 commit
- Verified: phone typecheck ✅ lint ✅ (`tests/Composer.test.tsx` keeps its earlier display-name lint error) Composer tests ✅ (8). Phone check manual.

## 2026-11-15 14:27 IST — Hari usage shows the real time left; refresh in the header (L-308)
- Type: fix
- What: The phone's usage (Settings → Usage and the model picker) showed the 5-hour limit as "reset due" with the old window's numbers, because it reused the computer's saved reading until a manual refresh. It now asks for a new reading when a window has ended since the last one or the reading is over 5 minutes old, so it shows the time left (e.g. "5h · 4h 30m"). On the Usage page the refresh button moved into the header beside "Usage", turns into a spinner while it asks, and the intro line is gone.
- Why: User request 2026-11-15.
- Files: see L-308 in [LOCAL-FEATURES.md](../LOCAL-FEATURES.md)
- Commit: see the 0.16.0-local49 commit
- Verified: desktop typecheck ✅ tests ✅ (`src/features/mobile`: 84); phone typecheck ✅ lint ✅. Phone check manual.

## 2026-11-15 14:20 IST — Hari's Control tab as a control centre, swipe between Share and Control, extra screen dimming (L-307)
- Type: feature
- What: The phone's Control tab opens on its controls with no gap at the top. Square tiles like a phone's control centre: Monitor, Hibernate, Screenshot; Microphone, Sound, Camera; Bluetooth, Hibernate when idle, Files; a switch tile fills with the accent when on. Volume and a new Brightness are wide sliders you drag; the output device is a menu; what's playing is a full-width box with Previous, Play/Pause and Next. Stats, Running apps and Apps follow. A sideways swipe anywhere moves between Share and Control, the header switch following the finger (a drag on a slider stays the slider's). Brightness dims all the computer's screens below their own lowest setting, down to 20%: a see-through black layer over each monitor that clicks pass through, left out of screenshots and screen sharing, gone when MonoCode quits (Windows only).
- Why: User request 2026-11-15 (Suggest).
- Files: see L-307 in [LOCAL-FEATURES.md](../LOCAL-FEATURES.md)
- Commit: see the 0.16.0-local49 commit
- Verified: phone typecheck ✅ lint ✅; desktop typecheck ✅ tests ✅ (`src/features/mobile`, `src/shared/ui`: 122); Rust `cargo check` ✅, `screen_dim` and `mobile_pc` tests ✅. Phone and desktop checks manual.

## 2026-11-15 13:18 IST — Desktop Share panel: clear like the chats, your accent, the chat's composer, smooth slide, gliding tabs, Phone files back and refresh (L-306)
- Type: fix
- What: The docked Share panel no longer sits on a frosted layer (the blur flattened the wallpaper into grey); it's clear like the chats beside it, and frosted only when it floats over another view. Your own messages and the panel's buttons follow the accent chosen in Appearance instead of the theme's blue. The composer is the chat's box with Share's own labelled buttons (Attach, Clipboard, Open there or To clipboard, Send), all one size, Send in your accent. The panel slides with transform and opacity, so the chat isn't laid out again on every frame. Every tab switcher (`SegmentedSwitch`) now glides its selected background to the new tab. Phone files: back goes up a folder and, from the top, back to Share; Refresh always asks again (a late older answer is ignored) and turns into a spinner while it waits, and the list says it's asking the phone instead of staying blank.
- Why: User report 2026-11-15 — L-302 hadn't delivered the glass look, theme colours, chat composer, smooth slide or gliding tabs, and Phone files' back and refresh did nothing.
- Files: see L-306 in [LOCAL-FEATURES.md](../LOCAL-FEATURES.md)
- Commit: see the 0.16.0-local49 commit
- Verified: typecheck ✅ tests ✅ (desktop 8234; one test failed in the first full run and not in a second; MonoSidebar.test.ts logs an unhandled Tauri error, also without this change). Desktop checks manual.

## 2026-11-15 10:25 IST — Share in the background, glass Share panel, Claude's terminal and clearer notifications on the phone (L-299 to L-305)
- Type: feature
- What: Android's share sheet sends to the computer without bringing Hari up (a background task), and Windows Explorer gets "Share with Hari" (right-click → Show more options, and Send to), which sends files to the phone without showing MonoCode. The desktop Share panel is glass, uses the tab switcher, shows a light placeholder while it slides, draws messages like chat, slides Notes, Task, Pin and Save in on hover, and has a right-click menu with Remove. On the phone: messages in Share get Copy, Notes, Task, Pin and Save underneath (no swipe-to-delete); the unsent Share text survives restarts; the composer holds its own text so long prompts don't lag; + grows a small menu up out of the button; attachments in the composer open on tap; the loading cover is clear; "Claude is busy on your computer" shows Claude's terminal with Esc, Enter, Return to chat and Stop Claude; notifications read "Project · Chat" / "Finished · Opus 5.5" and a swipe marks them read on both sides. AGENTS.md gains the rule to reuse components and keep the glass look.
- Why: User reports and requests in three Discuss rounds, 2026-11-15 (spec [share-polish-background-send.md](../specs/archive/share-polish-background-send.md)).
- Files: see L-299 to L-305 in [LOCAL-FEATURES.md](../LOCAL-FEATURES.md)
- Commit: see the 0.16.0-local48 commit
- Verified: typecheck ✅ (desktop, mobile) lint ✅ (mobile; 2 old warnings in `dictation.ts`) tests ✅ (desktop 8234; one whiteboard icon test timed out in the full run and passes alone; phone 314; Rust mobile_ and share_args 39) rustfmt ✅ cargo check ✅ Kotlin compile ✅. `tests/mobile/watchFrames.test.ts` can't load from the phone config on Windows, as before. Desktop and phone checks manual.

## 2026-11-15 09:05 IST — Hari: Share and Control get their top bar back; Antigravity on the Usage page (L-298, L-296)
- Type: fix
- What: On Android, the Computer hub (Share | Control) wasn't counted as a modal, so Hari's own top bar (the side-menu button) was drawn over the hub's Close and Share | Control toggle, and the side menu could open a project under the hub, which then still showed Share. The hub is now a modal like Notifications, Tasks and Notes. Hari → Settings → Usage now lists Antigravity (one row per model family), read with the bottom bar's account key.
- Why: User report with screenshots; reproduced on the phone over adb (the Close and toggle were present but covered).
- Files: [SceneFade.tsx](../../mobile/src/ui/SceneFade.tsx), [mobileAccountUsage.ts](../../src/features/mobile/model/mobileAccountUsage.ts)
- Commit: see the 0.16.0-local48 commit
- Verified: typecheck ✅ (desktop, mobile) tests ✅ (phone 314; desktop phone link 83); phone check after install: open Share from the side menu → Close and toggle show; Close, then open a project → New | Sessions; Settings → Usage shows Antigravity

## 2026-11-15 02:59 IST — Share side panel, phone controls for sound, camera and Bluetooth, hibernate when idle, usage and files both ways (L-290 to L-297)
- Type: feature + fix
- What:
  - **Share (L-290, L-291):** a side panel on the computer instead of a full page; messaging-app bubbles (pictures keep their shape, picture grids, formatted text, link cards); pins and saves synced with the phone; files up to 1 GB with resume and a space check; files over 10 MB from the computer wait for a Download tap; storage use and Delete all (keeps pinned and saved). "Send to Share" in the chat selection, link, Browser and Files menus. The phone gets the same look, Share in the side menu and a lighter composer.
  - **Hibernate when idle (L-292):** a moon button in the bottom bar and a switch on Hari's Control tab; after 2 minutes with no chat working, a 30-second notice with Cancel, then hibernate.
  - **Hari Control (L-293 to L-295):** spinners beside app actions, Network on one line, Apps and Running apps fold, Lock removed; microphone, volume, sound output and now-playing controls; camera access switch; Bluetooth on/off with paired devices.
  - **Usage (L-296):** Command Code's 5-hour, weekly and monthly usage in the bottom bar; Hari → Settings → Usage for every provider and account.
  - **Files (L-297):** Hari browses the computer's drives and sends a file to Share; the computer's Share panel browses the phone's storage.
  - **Fix:** the Mono panel header left room for 4 title-bar buttons, but there are 5 since the Share button (L-279), so it slid under them.
- Why: User requests 2026-11-14 (plan locked in the session: 1-A, no tray apps, 3-A, build all at once, hibernate on idle on the desktop too).
- Files: [plan](../specs/share-chat-pc-control-plan.md); Rust [mobile_share.rs](../../src-tauri/src/mobile_share.rs), [mobile_pc.rs](../../src-tauri/src/mobile_pc.rs), [mobile_pc_extra.rs](../../src-tauri/src/mobile_pc_extra.rs), [command_code_usage.rs](../../src-tauri/src/command_code_usage.rs), [Cargo.toml](../../src-tauri/Cargo.toml); desktop [SharePanel.tsx](../../src/features/mobile/ui/SharePanel.tsx), [PhoneFilesView.tsx](../../src/features/mobile/ui/PhoneFilesView.tsx), [sendToShare.ts](../../src/features/mobile/model/sendToShare.ts), [IdleHibernate.tsx](../../src/app/shell/IdleHibernate.tsx), [UsageFooter.tsx](../../src/app/shell/UsageFooter.tsx), [MonoSidebar.tsx](../../src/features/monos/ui/MonoSidebar.tsx); phone [DeviceControls.tsx](../../mobile/src/features/pc/DeviceControls.tsx), [ComputerControl.tsx](../../mobile/src/features/pc/ComputerControl.tsx), [computer/files.tsx](../../mobile/src/app/computer/files.tsx), [settings/usage.tsx](../../mobile/src/app/settings/usage.tsx), [SharePanel.tsx](../../mobile/src/features/share/SharePanel.tsx), [HariFiles.kt](../../mobile/modules/hari-live/android/src/main/java/expo/modules/harilive/HariFiles.kt)
- Commit: see the 0.16.0-local47 commit
- Verified: typecheck ✅ (desktop, mobile) lint ✅ (mobile; 2 old warnings in `dictation.ts`) tests ✅ (desktop vitest 8235; phone 314; Rust lib 941, with 2 old failures in `fs.rs` that expect macOS paths such as `/opt/homebrew/bin` and fail on Windows) rustfmt ✅; desktop and phone checks manual (list in the plan's Done)

## 2026-11-14 22:36 IST — Storage: Project filter, app dropdowns, smoother scrolling (L-289)
- Type: fix + feature
- What: Settings → Storage has a Project filter (pick one or more, plus "Not linked to a chat"); its Project and date dropdowns are the app's own (`SearchableSelect`, like the Tasks toolbar). Tiles now draw small square copies of each picture made off the main thread, skip layout and paint while off screen, and lost their per-tile blur, so long galleries scroll smoothly. "Clear filters" resets both.
- Why: User report: no project filter, the page lagged when scrolling, the project picker should take several, and the date dropdown wasn't the app's own.
- Files: [attachmentStorage.ts](../../src/features/settings/model/attachmentStorage.ts), [StorageSettings.tsx](../../src/features/settings/ui/StorageSettings.tsx), [storageThumbnails.ts](../../src/features/settings/ui/storageThumbnails.ts), [attachmentStorage.test.ts](../../src/features/settings/model/attachmentStorage.test.ts)
- Commit: see the 0.16.0-local46 commit
- Verified: typecheck ✅ tests ✅ (desktop settings, mobile and shared UI: 642, incl. 3 new); desktop check manual

## 2026-11-14 22:36 IST — Hari: one Computer screen, Monitor on, Wake in the side menu, Haptics switch (L-288)
- Type: feature + fix
- What: Share and Computer are one screen with Share | Control tabs, switched by the same toggle as a project's New | Sessions. The side menu always shows Computer (and Wake computer when the phone can send it), not only in Monos-only mode; the Monos-only footer has one Computer button. Share reads like a chat (from the computer on the left, to it on the right, by day) and pictures show as thumbnails instead of file names. Control shows Monitor on while the monitor is off, and it works (the computer reports `monitorOff` and wakes the screen with a tiny mouse nudge). Settings → Feel → Haptics turns tap vibration off everywhere.
- Why: User requests in the session (Computer in the sidebar, reuse the switch, Monitor on, Wake in a proper place, haptics toggle, image thumbnails).
- Files: [ComputerHub.tsx](../../mobile/src/features/pc/ComputerHub.tsx), [ComputerControl.tsx](../../mobile/src/features/pc/ComputerControl.tsx), [SharePanel.tsx](../../mobile/src/features/share/SharePanel.tsx), [shareModel.ts](../../mobile/src/features/share/shareModel.ts), [wake.ts](../../mobile/src/features/pc/wake.ts), [WorkspaceDrawer.tsx](../../mobile/src/features/workspace/WorkspaceDrawer.tsx), [MonoHome.tsx](../../mobile/src/features/workspace/MonoHome.tsx), [ui/haptics.ts](../../mobile/src/ui/haptics.ts), [settings/haptics.ts](../../mobile/src/features/settings/haptics.ts), [mobile_pc.rs](../../src-tauri/src/mobile_pc.rs); every phone file that vibrated now imports `@/ui/haptics`
- Commit: see the 0.16.0-local46 commit
- Verified: typecheck ✅ (mobile, desktop) lint ✅ (mobile; 2 old warnings in `dictation.ts`) tests ✅ (phone 314; Rust mobile_pc 6) rustfmt ✅; phone + desktop checks manual. `tests/mobile/watchFrames.test.ts` in the phone run is an old entry for a file that no longer exists.

## 2026-11-14 22:36 IST — Share as its own view on the computer (L-287)
- Type: feature
- What: The title-bar phone icon and a Share page in the sidebar open a full Share view: a chat-style timeline with the phone (day separators), pictures and videos inline, files with Open and Show in folder, links with Open, Open on phone and Copy, filters (All, Media, Files, Links, Text), and drop or paste files to send. Replaces the popover.
- Why: User request: "a Sidebar Panel, where proper chats, media, and everything we can see and use it".
- Files: [ShareView.tsx](../../src/features/mobile/ui/ShareView.tsx), [ShareBubble.tsx](../../src/features/mobile/ui/ShareBubble.tsx), [ShareComposer.tsx](../../src/features/mobile/ui/ShareComposer.tsx), [PhoneStatus.tsx](../../src/features/mobile/ui/PhoneStatus.tsx), [shareView.ts](../../src/features/mobile/model/shareView.ts), [App.tsx](../../src/app/App.tsx), [Sidebar.tsx](../../src/app/shell/Sidebar.tsx), [mobile_share.rs](../../src-tauri/src/mobile_share.rs); [spec](../specs/share-panel-plan.md)
- Commit: see the 0.16.0-local46 commit
- Verified: typecheck ✅ tests ✅ (`shareView.test.ts`; Rust mobile_share 8) rustfmt ✅; desktop check manual

## 2026-11-14 21:41 IST — Hari: open a chat link on the phone or the computer (L-286)
- Type: feature
- What: Tapping a web link (or a link card) in a Hari chat now asks "On phone" or "On computer". On computer, the link opens in the computer's default browser and a toast says so. If the computer isn't connected, Hari says so instead.
- Why: User request: open links from chats in the desktop browser (a `localhost` page only opens there).
- Files: [openLink.ts](../../mobile/src/features/share/openLink.ts), [shareTransfers.ts](../../mobile/src/features/share/shareTransfers.ts), [Markdown.tsx](../../mobile/src/features/sessions/Markdown.tsx), [LinkCard.tsx](../../mobile/src/features/tools/LinkCard.tsx), [mobile_share.rs](../../src-tauri/src/mobile_share.rs), [ProjectScreen.test.tsx](../../mobile/tests/ProjectScreen.test.tsx)
- Commit: uncommitted
- Verified: typecheck ✅ (mobile) lint ✅ (mobile changed files) tests ✅ (Rust mobile_share 8 incl. 1 new; phone 298) rustfmt ✅; phone + desktop checks manual (needs a new desktop build)

## 2026-11-14 21:41 IST — Hari: Camera in the + menu (L-285)
- Type: feature
- What: The + menu in a Hari chat now has Camera next to Photos and Files. The photo is attached like any picked photo. If the camera is off for Hari, a prompt explains and offers Open Settings.
- Why: User request.
- Files: [attachments.ts](../../mobile/src/features/sessions/attachments.ts), [Composer.tsx](../../mobile/src/features/sessions/Composer.tsx), [Icon.tsx](../../mobile/src/ui/Icon.tsx), [app.json](../../mobile/app.json), [Composer.test.tsx](../../mobile/tests/Composer.test.tsx)
- Commit: uncommitted
- Verified: typecheck ✅ (mobile) lint ✅ (changed source files; `tests/Composer.test.tsx:73` display-name error is older) tests ✅ (Composer); phone check manual (permission text needs a new build)

## 2026-11-14 21:41 IST — Hari: quicker composer and lighter chat scrolling (L-284)
- Type: fix
- What: Tapping the message box no longer drags: the box lifts with the keyboard and the chat moves with it instead of trailing. Long chats keep fewer rows ready off screen, so scrolling and flinging feel lighter.
- Why: User report: the composer rose very slowly on tap and scrolling felt heavy. Cause: the box's height change re-rendered the whole chat on every animation frame and restarted the list's padding animation each frame.
- Files: [SessionScreen.tsx](../../mobile/src/features/sessions/SessionScreen.tsx), [Composer.tsx](../../mobile/src/features/sessions/Composer.tsx), [Transcript.tsx](../../mobile/src/features/sessions/Transcript.tsx)
- Commit: uncommitted
- Verified: typecheck ✅ (mobile) lint ✅ tests ✅ (Transcript, Composer, ProjectScreen); feel on device is a manual check
## 2026-11-14 19:53 IST — Aside link: clear names, Claude accounts, no session floods (L-283)
- Type: fix
- What: Aside's model picker now shows `hari-claude-interactive`, `hari-command-code` and `hari-antigravity` instead of `monocode-…`. With more than one Claude account in MonoCode, each account is its own entry (`hari-claude-interactive-<account name>`) and its chats run on that account. "Add models to Aside" replaces the old `monocode-…` entries. When an agent in an Aside chat ran `aside exec` without `-m`, Aside sent that request back to Hari, which started another session each time (Command Code made several and then timed out after 30 minutes); such a request now gets a short answer telling the agent to use `repl` or `aside exec -m <Aside model>`, and the CLI project's guide says the same. Aside's background memory "dreaming" pass is answered locally instead of starting a session. Aside now sends its chat ID, which keeps two chats that start alike apart.
- Why: User report: names showed `monocode`, no Interactive or account; a single Ask Aside chat with Command Code created many sessions and then stopped without doing the task.
- Files: [asideModels.ts](../../src/features/aside-link/model/asideModels.ts), [asideRequest.ts](../../src/features/aside-link/model/asideRequest.ts), [useAsideLink.ts](../../src/features/aside-link/hooks/useAsideLink.ts), [AsideLinkSettings.tsx](../../src/features/aside-link/ui/AsideLinkSettings.tsx), [App.tsx](../../src/app/App.tsx), [aside_link.rs](../../src-tauri/src/aside_link.rs), tests beside them
- Commit: uncommitted
- Verified: typecheck ✅ (root) lint — (root has no ESLint config) tests ✅ (aside-link 26 incl. 5 new, Rust aside_link 9 incl. 2 new) rustfmt ✅; Aside and desktop checks manual

## 2026-11-14 19:21 IST — Tasks and Notes offline on the phone (L-281)
- Type: feature
- What: Hari now keeps a copy of the computer's Tasks and Notes. When the computer is off or out of reach, the Tasks and Notes screens still open, with a "Computer not connected" line, and notes read before (plus the 20 newest) open in full. New tasks, ticking or moving tasks, and note edits made then wait on the phone and go to the computer when it's back. If the same task or note was changed on the computer later, the computer's copy stays (the note editor offers Reload or Keep mine); something deleted on the computer stays deleted. The phone's copy refreshes by itself whenever the computer's Tasks or Notes change.
- Why: Phase 5 of the Hari link plan: use Tasks and Notes from the phone without the computer.
- Files: [mobile_tools.rs](../../src-tauri/src/mobile_tools.rs), [mobile_events.rs](../../src-tauri/src/mobile_events.rs), [notes.rs](../../src-tauri/src/notes.rs), [tasks.rs](../../src-tauri/src/tasks.rs), [toolsOverlay.ts](../../mobile/src/features/tools/toolsOverlay.ts), [toolsCache.ts](../../mobile/src/features/tools/toolsCache.ts), [tools.ts](../../mobile/src/features/tools/tools.ts), [ToolsSync.tsx](../../mobile/src/features/tools/ToolsSync.tsx), [ToolsOffline.tsx](../../mobile/src/features/tools/ToolsOffline.tsx), [linkStream.ts](../../mobile/src/features/link/linkStream.ts), [tasks/index.tsx](../../mobile/src/app/tasks/index.tsx), [notes/index.tsx](../../mobile/src/app/notes/index.tsx), [notes/[noteId].tsx](../../mobile/src/app/notes/[noteId].tsx), [_layout.tsx](../../mobile/src/app/_layout.tsx)
- Commit: uncommitted
- Verified: typecheck ✅ (mobile) lint ✅ (mobile changed files) tests ✅ (src-tauri mobile_ 32 incl. 2 new, phone 308 incl. 15 new — `tests/mobile/watchFrames.test.ts` can't load from the phone config on Windows, as before) rustfmt ✅; phone and desktop checks manual

## 2026-11-14 19:02 IST — Computer: control the computer from Hari (L-280)
- Type: feature
- What: Hari has a Computer screen (Home footer). It shows the computer's CPU, GPU, memory, drives, network and uptime, refreshed every 3 seconds while open, and has Monitor off, Lock, Hibernate and Screenshot (the picture arrives in Share). The apps chosen on the computer (Settings → Phone: Hari, Claude, ChatGPT and Antigravity to start; any program can be added) can be opened, closed, minimized, maximized and restarted, and the running apps can be sorted and minimized, maximized, closed or ended. When the computer can't be reached, Wake computer turns it on over the home network. On the computer, the Share popover shows the phone's battery, temperature, storage and network, and Find my phone rings the phone loudly for up to 2 minutes.
- Why: Phase 4 of the Hari link plan: do from Hari what the Telegram bot does every day (monitor off, hibernate, app control, wake).
- Files: [mobile_pc.rs](../../src-tauri/src/mobile_pc.rs), [mobile_share.rs](../../src-tauri/src/mobile_share.rs), [mobile_access.rs](../../src-tauri/src/mobile_access.rs), [process_stop.rs](../../src-tauri/src/process_stop.rs), [lib.rs](../../src-tauri/src/lib.rs), [Cargo.toml](../../src-tauri/Cargo.toml), [mobilePc.ts](../../src/features/mobile/model/mobilePc.ts), [ShareButton.tsx](../../src/features/mobile/ui/ShareButton.tsx), [PhoneAppsSettings.tsx](../../src/features/mobile/ui/PhoneAppsSettings.tsx), [MobileSettings.tsx](../../src/features/mobile/ui/MobileSettings.tsx), [pcModel.ts](../../mobile/src/features/pc/pcModel.ts), [wakeStore.ts](../../mobile/src/features/pc/wakeStore.ts), [PcSync.tsx](../../mobile/src/features/pc/PcSync.tsx), [ComputerParts.tsx](../../mobile/src/features/pc/ComputerParts.tsx), [computer/index.tsx](../../mobile/src/app/computer/index.tsx), [_layout.tsx](../../mobile/src/app/_layout.tsx), [MonoHome.tsx](../../mobile/src/features/workspace/MonoHome.tsx), [nativeLive.ts](../../mobile/src/features/liveUpdates/nativeLive.ts), [HariPc.kt](../../mobile/modules/hari-live/android/src/main/java/expo/modules/harilive/HariPc.kt), [HariLiveModule.kt](../../mobile/modules/hari-live/android/src/main/java/expo/modules/harilive/HariLiveModule.kt), [AndroidManifest.xml](../../mobile/modules/hari-live/android/src/main/AndroidManifest.xml)
- Commit: uncommitted
- Verified: typecheck ✅ (root, mobile) lint ✅ (mobile changed files; root has no ESLint config) tests ✅ (desktop mobile 79 incl. 5 new + window args, src-tauri mobile_ 30, phone 293 incl. 11 new — `tests/mobile/watchFrames.test.ts` can't load from the phone config on Windows, as before) rustfmt ✅ Kotlin compile ✅; phone and desktop checks manual

## 2026-11-14 16:51 IST — Share between Hari and the computer (L-279)
- Type: feature
- What: Text, links, the clipboard and files now go both ways between the phone and the computer. On the computer, a phone icon beside the bell opens Share: type and send, send the clipboard, send files, and see the last 100 items. On the phone, Share sits in the Home footer, any app's share menu has "Hari: send to computer", and a Quick Settings tile sends the clipboard. A clipboard item lands on the other side's clipboard with a notification. Files go to DownloadsHari on the computer and Download/Hari on the phone (up to 100 MB each). Texts wait while the other side is off; a failed file can be tried again.
- Why: Phase 3 of the Hari link plan: move things between the phone and the computer without other apps.
- Files: [mobile_share.rs](../../src-tauri/src/mobile_share.rs), [mobile_events.rs](../../src-tauri/src/mobile_events.rs), [mobile_access.rs](../../src-tauri/src/mobile_access.rs), [notifications.rs](../../src-tauri/src/notifications.rs), [lib.rs](../../src-tauri/src/lib.rs), [mobileShare.ts](../../src/features/mobile/model/mobileShare.ts), [ShareButton.tsx](../../src/features/mobile/ui/ShareButton.tsx), [WindowControls.tsx](../../src/app/shell/WindowControls.tsx), [shareModel.ts](../../mobile/src/features/share/shareModel.ts), [shareStore.ts](../../mobile/src/features/share/shareStore.ts), [shareTransfers.ts](../../mobile/src/features/share/shareTransfers.ts), [ShareSync.tsx](../../mobile/src/features/share/ShareSync.tsx), [share/index.tsx](../../mobile/src/app/share/index.tsx), [MonoHome.tsx](../../mobile/src/features/workspace/MonoHome.tsx), [HariShare.kt](../../mobile/modules/hari-live/android/src/main/java/expo/modules/harilive/HariShare.kt), [AndroidManifest.xml](../../mobile/modules/hari-live/android/src/main/AndroidManifest.xml)
- Commit: uncommitted
- Verified: typecheck ✅ (root, mobile) lint ✅ (mobile changed files; root has no ESLint config) tests ✅ (desktop share model 3 + window args, src-tauri mobile_ 24, phone 282 incl. 16 new — `tests/mobile/watchFrames.test.ts` can't load from the phone config on Windows, as before) rustfmt ✅ Kotlin compile ✅; phone and desktop checks manual

## 2026-11-14 16:27 IST — Answer from Hari's notifications (L-278)
- Type: feature
- What: The computer's notifications in the phone's panel now have buttons. Approvals get Approve and Deny; questions get an Answer box; a finished chat gets a Reply box. The tap goes straight to the computer without opening Hari. A sent one leaves the panel and is read on the computer; a failed one stays with the reason and its buttons. A typed answer picks the choice it names, or is the typed answer where the question allows one.
- Why: Phase 2 of the Hari link plan: act on a notification without opening the app.
- Files: [mobile_notifications.rs](../../src-tauri/src/mobile_notifications.rs), [mobileNotifications.ts](../../src/features/mobile/model/mobileNotifications.ts), [mobileWorkspace.ts](../../src/features/mobile/model/mobileWorkspace.ts), [App.tsx](../../src/app/App.tsx), [notificationActions.ts](../../mobile/src/features/notifications/notificationActions.ts), [PanelActions.tsx](../../mobile/src/features/notifications/PanelActions.tsx), [NotificationFeedSync.tsx](../../mobile/src/features/notifications/NotificationFeedSync.tsx), [notificationFeed.ts](../../mobile/src/features/notifications/notificationFeed.ts), [_layout.tsx](../../mobile/src/app/_layout.tsx)
- Commit: uncommitted
- Verified: typecheck ✅ (root, mobile) lint ✅ (mobile changed files; root has no ESLint config) tests ✅ (desktop mobile model 9, src-tauri mobile_ 17, phone 266 — `tests/mobile/watchFrames.test.ts` can't load from the phone config on Windows, as before) rustfmt ✅; phone checks manual

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

## 2026-11-14 14:05 IST — Activity: sites start folded (L-282)
- Type: style
- What: In Activity → Sites, each website now shows only its time, a bar and how many tabs it had. Click a site to see its tab titles; click again to fold them.
- Why: The user asked for Sites to be collapsed by default; the tab titles made the column long.
- Files: [Breakdown.tsx](../../src/features/activity/ui/Breakdown.tsx)
- Commit: uncommitted
- Verified: typecheck ✅ lint — (no config) tests — (no view tests) build —
- Renumbered: was L-274 until 2026-11-14 19:30, when the Aside link (published as L-274 in 0.16.0-local44) merged in.

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

## 2026-11-14 06:17 IST — Aside's Ask Aside panel can use MonoCode's CLIs (L-274)
- Type: feature
- What: MonoCode can now answer Aside's "Ask Aside" side panel. Turn it on in Settings → Connections → Aside browser and press "Add models to Aside"; Aside then lists "Hari · Claude", "Hari · Command Code" and "Hari · Antigravity" models. Each Aside chat runs here as a conversation in a pinned project named CLI, streams its reply (and tool steps as thinking) back to Aside, follows Aside's Reasoning setting, and stops when Aside stops. Aside's chat titles and memory requests are answered locally without running a model.
- Why: The user wanted Ask Aside to use the Claude Code, Command Code and Antigravity subscriptions they already run in MonoCode instead of Aside's own providers, and to see those chats in MonoCode.
- Files: [aside_link.rs](../../src-tauri/src/aside_link.rs), [lib.rs](../../src-tauri/src/lib.rs), [aside-link](../../src/features/aside-link), [App.tsx](../../src/app/App.tsx), [SettingsView.tsx](../../src/features/settings/ui/SettingsView.tsx), [settings.ts](../../src/features/settings/model/settings.ts), [aside-link-plan.md](../specs/aside-link-plan.md)
- Commit: uncommitted
- Verified: typecheck ✅ lint — (no config) tests ✅ (vitest 8173) cargo test aside_link ✅ (7) build —

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

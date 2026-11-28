# Changelog 05 — MonoCode Windows fork

## 2026-11-28 09:24 IST — Release 0.16.0-local77

- Type: chore
- Why: user asked to release, to judge the keyboard speed in a release build.
- What: version 0.16.0-local77, carrying L-412 to L-417 (Hari Tabs layout, Hari Dev, 250 ms keyboard lift and message scroll on Android, compact tab tops, Delete all in Settings, round arc, swipe back and menu swipe). The release-config snapshot test now takes the version from `package.json`, since each release changes it.
- Files: version files (`package.json`, `package-lock.json`, `Cargo.toml`, `Cargo.lock`, `src-tauri/tauri.conf.json`), [appConfig.test.ts](../../mobile/tests/appConfig.test.ts)
- Commit: release commit after 7943089b
- Verified: mobile tsc ✅ expo lint ✅ vitest ✅ (watchFrames load failure pre-existing) | manual: phone checks pending

## 2026-11-28 09:16 IST — Hari: Share's box folds as the keyboard closes; swipe from the right opens the menu on every tab (L-417)
- Type: fix
- What: In Share, closing the keyboard (for example with Back) now folds the message box to one line as the keyboard starts going down, instead of a second later. In the Tabs layout, a swipe left from the right edge of any tab opens the side menu.
- Why: The box waited for Android's "keyboard hidden" event, which comes at the end of the roughly one-second slide. The tabs never turned on the menu swipe, and the menu button at the top is out of thumb's reach.
- Files: [SharePanel.tsx](../../mobile/src/features/share/SharePanel.tsx:690), [TabScreen.tsx](../../mobile/src/features/tabs/TabScreen.tsx:76)
- Commit: 7943089b (in 0.16.0-local77)
- Verified: typecheck ✅ lint ✅ tests ✅ (437; watchFrames load failure is pre-existing) build —

## 2026-11-28 09:14 IST — Hari: messages rise with the keyboard; swipe back from a new session; the project arc goes round (L-414, L-416)
- Type: fix
- What: On Android, the messages in a session and in Share now move up and down with the keyboard in the same quarter second as the message box, so they no longer slide under it. In the Tabs layout, a new session's page (from the + on Sessions) now goes back with a swipe right, as a session already did. The project arc on the Sessions tab goes round: sliding past the last project comes back to All, and the other way round. With only two or three places, they repeat round the arc.
- Why: The 09:00 fix sped up only the box. The chat list library still scrolled the messages on every frame of Android's roughly one-second keyboard slide. The list now keeps the library's padding but does its own 250 ms scroll. The back button at the top is out of reach one-handed. The arc should cycle, as asked.
- Files: [QuickChatScrollView.tsx](../../mobile/src/features/sessions/QuickChatScrollView.tsx) (new), [ChatScrollView.tsx](../../mobile/src/features/sessions/ChatScrollView.tsx), [SharePanel.tsx](../../mobile/src/features/share/SharePanel.tsx), [ProjectScreen.tsx](../../mobile/src/features/workspace/ProjectScreen.tsx:116), [tabMath.ts](../../mobile/src/features/tabs/tabMath.ts:40), [PlaceArc.tsx](../../mobile/src/features/tabs/PlaceArc.tsx), [HariTabBar.tsx](../../mobile/src/features/tabs/HariTabBar.tsx:155), [tabGestures.test.ts](../../mobile/tests/tabGestures.test.ts)
- Commit: 7943089b (in 0.16.0-local77)
- Verified: typecheck ✅ lint ✅ tests ✅ (437; watchFrames load failure is pre-existing) build —

## 2026-11-28 09:05 IST — Hari Tabs: no tab names at the top; Delete all moves to Settings; more room above the bar (L-415)
- Type: feature
- What: The tabs no longer show their name in large type at the top, because the bottom bar already shows which tab is open. Each page now starts just under the menu button. Sessions still names the project it's showing, in smaller type. Share's text-only "Delete all" button is gone from its toolbar. It's now a row under Share in Settings ("Delete all messages"), and it still asks before deleting. The Sessions arc sits higher above the bar, so it's clear of the bar.
- Why: Asked for: the headings took space the bar already covers, Delete all was too easy to hit in the toolbar, and the arc sat too close to the bar.
- Files: [TabScreen.tsx](../../mobile/src/features/tabs/TabScreen.tsx:58), [confirmDeleteAll.ts](../../mobile/src/features/share/confirmDeleteAll.ts), [settings/index.tsx](../../mobile/src/app/settings/index.tsx:444), [SharePanel.tsx](../../mobile/src/features/share/SharePanel.tsx), [HariTabBar.tsx](../../mobile/src/features/tabs/HariTabBar.tsx:50), the five tab routes in `mobile/src/app/(tabs)/`
- Commit: 7943089b (in 0.16.0-local77)
- Verified: typecheck ✅ lint ✅ tests ✅ (435; watchFrames load failure is pre-existing) build —

## 2026-11-28 09:00 IST — Hari: keyboard lift in 250 ms on Android; see-through arc bubbles with the name above (L-414, L-412)
- Type: fix
- What: On Android, the message box now rises with the keyboard in a quarter of a second, instead of about a second. This applies to Share, sessions and every other screen that lifts a box over the keyboard. The Sessions arc's circles are now see-through bubbles over the wallpaper, not dark discs, and the project's name shows above the arc instead of under your thumb.
- Why: Measured on the phone (Xiaomi keyboard), Android's keyboard slide reports 285 ms but runs about 1 s with a long tail: 85% at 625 ms, 94% at 870 ms, and the last frame at about 1 s. The box followed it frame by frame, so it crawled up. Now it glides to where the keyboard is going. The dark circles came from the shared glass component, which is a solid card on Android by design (L-235); the arc now draws its own bubble.
- Files: [SessionScreen.tsx](../../mobile/src/features/sessions/SessionScreen.tsx:870), [PlaceArc.tsx](../../mobile/src/features/tabs/PlaceArc.tsx)
- Commit: 7943089b (in 0.16.0-local77)
- Verified: typecheck ✅ lint ✅ tests ✅ build —

## 2026-11-28 08:29 IST — Hari Share: draws only the newest messages; one-line composer; smooth keyboard on a new session (L-414)
- Type: fix
- What: Share now builds only its newest 20 messages when it opens, and 20 more each time you scroll near the top, without moving what you're reading. Jumping to a pinned message further back draws back to it first. The send box is one line (Files, the text field, Clipboard) and opens into the full box when tapped or holding a draft. While Share is out of view, its list no longer reacts to the keyboard, so opening the keyboard on another page (a new session from the + on Sessions) rises smoothly.
- Why: Share drew its whole history (up to the kept limit, ~100 here) every time it opened, which was its slow first frame. It also stayed loaded under other pages and re-laid out all those messages on every frame of a keyboard raised elsewhere. The remaining slow lift was measured later: Android's own keyboard slide (see the 09:00 entry).
- Files: [SharePanel.tsx](../../mobile/src/features/share/SharePanel.tsx:209), [shareModel.ts](../../mobile/src/features/share/shareModel.ts), [shareModel.test.ts](../../mobile/tests/shareModel.test.ts)
- Commit: 7943089b (in 0.16.0-local77)
- Verified: typecheck ✅ lint ✅ tests ✅ (435; watchFrames load failure is pre-existing) build —

## 2026-11-28 08:19 IST — Hari Tabs: a tap switches at once, no pages over each other (L-412)
- Type: fix
- What: Tapping a tab now clears the page you're leaving and starts sliding the new one in straight away, along with the bar's highlight. The new tab's own update renders a frame later, so the switch never stalls with two pages drawn over each other. The same happens when picking a project from the Sessions arc.
- Why: The old page was only hidden once the new tab had finished rendering. A heavy tab (Share most of all) left both pages on screen, and the switch and the highlight seemed stuck. Measured with a production JS bundle, 8 switches: p50 15 ms, p90 30 ms (debug bundle: 25 ms / 93 ms).
- Files: [TabScreen.tsx](../../mobile/src/features/tabs/TabScreen.tsx:24), [HariTabBar.tsx](../../mobile/src/features/tabs/HariTabBar.tsx:102)
- Commit: 7943089b (in 0.16.0-local77)
- Verified: typecheck ✅ lint ✅ tests ✅ build —

## 2026-11-28 08:10 IST — Hari Tabs: tabs glide in, no bounce (L-412)
- Type: fix
- What: A tab now glides in smoothly from its side of the bar. Coming back to a tab no longer flashes it in place first, then jumps aside and slides back. A page opened over the tabs still slides over the tab underneath, which stays drawn.
- Why: The tab left was still drawn in place, so for a frame it showed where it was before sliding in, which read as a bounce. The ease-out also braked hard at the end.
- Files: [TabScreen.tsx](../../mobile/src/features/tabs/TabScreen.tsx:40), [tabTransition.ts](../../mobile/src/features/tabs/tabTransition.ts:16)
- Commit: 7943089b (in 0.16.0-local77)
- Verified: typecheck ✅ lint ✅ tests ✅ (tabGestures) build —

## 2026-11-28 08:08 IST — Hari Tabs: hidden tabs stop re-rendering; smaller, higher arc (L-412)
- Type: fix
- What: Switching tabs no longer redraws every tab behind the scenes. Tabs you've left now pause until you come back, and the new one slides in from its side of the bar on its own. The Sessions arc's circles and icons are smaller (52 pt, from 64) and sit higher above the bar.
- Why: Tab switching was slow and laggy. A tab animation on the navigator kept every left tab "in transition", so none ever paused: all five re-rendered on every update (Share alone about 300 ms each time), all the time. Opening a tab also woke Sessions and the bar to save which tab was open.
- Files: [_layout.tsx](../../mobile/src/app/(tabs)/_layout.tsx:15), [TabScreen.tsx](../../mobile/src/features/tabs/TabScreen.tsx:30), [tabTransition.ts](../../mobile/src/features/tabs/tabTransition.ts:1), [tabsMemory.ts](../../mobile/src/features/tabs/tabsMemory.ts:103), [tabMath.ts](../../mobile/src/features/tabs/tabMath.ts:7), [ArcFaces.tsx](../../mobile/src/features/tabs/ArcFaces.tsx:13), [sessionsArc.tsx](../../mobile/src/features/tabs/sessionsArc.tsx:10), [HariTabBar.tsx](../../mobile/src/features/tabs/HariTabBar.tsx:49), [tabGestures.test.ts](../../mobile/tests/tabGestures.test.ts:47)
- Commit: 7943089b (in 0.16.0-local77)
- Verified: typecheck ✅ lint ✅ tests ✅ (watchFrames load failure is pre-existing) build — · phone profiler: hidden tabs idle at 0 renders, was 5 per update

## 2026-11-28 07:58 IST — Hari Tabs: the bar's highlight always sits on a tab (L-412)
- Type: fix
- What: Sliding a thumb along the tab bar, the highlight now hops from tab to tab as the thumb crosses into each, instead of trailing the thumb and stopping between two tabs. Letting go settles it on the chosen tab at once, before the page switches; letting go over the tab already open (or dragging down off the bar) puts it straight back. A tap moves it at once too.
- Why: The highlight followed the finger exactly and, on release, waited for the page to switch; released over the open tab, nothing moved it back, so it sat between tabs and then jumped late.
- Files: [HariTabBar.tsx](../../mobile/src/features/tabs/HariTabBar.tsx:36)
- Commit: 7943089b (in 0.16.0-local77)
- Verified: typecheck ✅ lint ✅ tests ✅ (tabGestures) build —

## 2026-11-28 07:57 IST — Hari: no dark rectangle inside glass cards over a wallpaper (L-412)
- Type: fix
- What: On Android, with a wallpaper set, every glass card, the tab bar and the side menu showed a darker rectangle inside them. They are now clear all the way through.
- Why: The cards are see-through over a wallpaper, and Android drew their drop shadow under the whole card, so it showed through as a block. It was hidden while the new tabs painted black; making them clear revealed it. Cards now have no shadow while a wallpaper is set.
- Files: [LiquidView.tsx (line 284)](../../mobile/src/ui/LiquidView.tsx:284)
- Commit: 7943089b (in 0.16.0-local77)
- Verified: typecheck ✅ lint ✅ tests ✅ (431; tests/mobile/watchFrames.test.ts fails to load on Windows, unchanged) build — · phone screenshot ✅

## 2026-11-28 07:50 IST — Hari Tabs: Sessions in the middle, arc on a hold-and-slide, wallpaper shows (L-412)
- Type: feature
- What: The bottom tabs now run Share, Computer, Sessions, Monos, Running. Holding the Sessions tab raises the arc of places over the bar; sliding the same finger left or right moves through All and the recent projects (with a tick for each), and letting go opens the one in the middle. Dragging down off the bar first leaves things as they were. Tapping Sessions while a project shows goes back to All. Monos no longer has an arc, and the tab titles are plain again. On All, only a project with sessions at work has the arrow, and it folds out just those (waiting ones first); a long press on a project opens Change icon / Remove from arc. The tab pages no longer paint black over the wallpaper.
- Why: The user asked for running-only fold-outs, the new tab order, an arc that is part of the Sessions hold rather than a separate panel, and for the wallpaper to show on the new tabs.
- Files: [_layout.tsx](../../mobile/src/app/(tabs)/_layout.tsx:22), [HariTabBar.tsx](../../mobile/src/features/tabs/HariTabBar.tsx:1), [sessionsArc.tsx](../../mobile/src/features/tabs/sessionsArc.tsx:1), [PlaceArc.tsx](../../mobile/src/features/tabs/PlaceArc.tsx:1), [tabMath.ts](../../mobile/src/features/tabs/tabMath.ts:1), [ProjectCard.tsx](../../mobile/src/features/tabs/ProjectCard.tsx:1), [TabScreen.tsx](../../mobile/src/features/tabs/TabScreen.tsx:1), [sessions.tsx](../../mobile/src/app/(tabs)/sessions.tsx:1), [monos.tsx](../../mobile/src/app/(tabs)/monos.tsx:1), [tabGestures.test.ts](../../mobile/tests/tabGestures.test.ts:32), [watchRule.test.ts](../../mobile/tests/watchRule.test.ts:5); removed ArcOverlay.tsx, arcReveal.ts and its test
- Commit: 7943089b (in 0.16.0-local77)
- Verified: typecheck ✅ lint ✅ tests ✅ (431; tests/mobile/watchFrames.test.ts fails to load on Windows, upstream file, unchanged) build —

## 2026-11-28 07:42 IST — Hari Tabs: arc on a lift, search at the top, smaller + (L-412)
- Type: feature
- What: The bottom tabs now run Sessions, Monos, Share, Computer, Running. The place arc is hidden until you hold the Sessions or Monos tab and lift your finger up, or tap the tab's title (it has a small arrow). It rises over the bottom of the tab; a tap on a place picks it and puts the arc away, and a tap outside or Back closes it. A project's search and filter now sit at the top of its list, not above the arc. The + is smaller (48 pt) and sits at the bottom right.
- Why: The user asked for the tab order change, for the search to move from above the arc, for a smaller +, and for the arc to show only on a hold-and-lift gesture.
- Files: [_layout.tsx](../../mobile/src/app/(tabs)/_layout.tsx:1), [HariTabBar.tsx](../../mobile/src/features/tabs/HariTabBar.tsx:1), [arcReveal.ts](../../mobile/src/features/tabs/arcReveal.ts:1), [ArcOverlay.tsx](../../mobile/src/features/tabs/ArcOverlay.tsx:1), [TabScreen.tsx](../../mobile/src/features/tabs/TabScreen.tsx:1), [PlusButton.tsx](../../mobile/src/features/tabs/PlusButton.tsx:5), [sessions.tsx](../../mobile/src/app/(tabs)/sessions.tsx:1), [monos.tsx](../../mobile/src/app/(tabs)/monos.tsx:1), [SessionsPage.tsx](../../mobile/src/features/sessions/SessionsPage.tsx:1), [FileSearchBar.tsx](../../mobile/src/features/files/FileSearchBar.tsx:1), [arcReveal.test.ts](../../mobile/tests/arcReveal.test.ts:1)
- Commit: 7943089b (in 0.16.0-local77)
- Verified: typecheck ✅ lint ✅ tests ✅ (430) build —

## 2026-11-28 07:38 IST — Hari Tabs slide by direction; project cards fold out (L-412)
- Type: feature
- What: Moving between tabs now slides the new tab in from the side it sits on, with a quick fade (220 ms, eased out). Changing project on the Sessions arc does the same inside the tab. On the Sessions All page, each project card opens the project on a tap, and its arrow folds out its sessions (waiting first, then working, then the latest; five shown, then "Show all"). Each session opens on a tap, like the Classic drawer. With reduce motion on, nothing moves.
- Why: The user asked for directional, snappy transitions and for expandable, clickable cards like the old sidebar.
- Files: [tabTransition.ts](../../mobile/src/features/tabs/tabTransition.ts:14), [_layout.tsx](../../mobile/src/app/(tabs)/_layout.tsx:1), [PageSlide.tsx](../../mobile/src/features/tabs/PageSlide.tsx:22), [ProjectCard.tsx](../../mobile/src/features/tabs/ProjectCard.tsx:30), [sessions.tsx](../../mobile/src/app/(tabs)/sessions.tsx:1)
- Commit: 7943089b (in 0.16.0-local77)
- Verified: typecheck ✅ lint ✅ tests ✅ (427) build — (not on the phone: it was in use)

## 2026-11-28 07:33 IST — Hari Tabs side menu rows line up (L-412)

- Type: fix
- What: In the Tabs layout's side menu, Notes, Tasks, Notifications and Settings now start at the same left edge, under the More title, and fill the card's width.
- Why: the glass card centres what it holds, so each row shrank to its label and sat centred, leaving the icons out of line.
- Files: [TabsSideMenu.tsx](../../mobile/src/features/tabs/TabsSideMenu.tsx:66)
- Commit: 7943089b (in 0.16.0-local77)
- Verified: typecheck ✅ lint ✅ | manual: open the menu on the phone

## 2026-11-28 07:35 IST — Hari Running tab shows sessions as a tree (L-412)

- Type: feature
- What: The Running tab lists each running or waiting session by its own title, under its project's name and mascot, joined by a tree line. Monos at work sit under a Monos heading. Every group starts open, so all sessions show at once; tap a heading to fold or unfold it. Each session shows Working with its model and branch, or what it waits on (Approve: …, Has a question), and how long ago it last moved.
- Why: the tab showed one card per session with only the project's name, so you couldn't tell sessions apart.
- Files: [running.tsx](../../mobile/src/app/(tabs)/running.tsx:1), [runningRows.ts](../../mobile/src/features/tabs/runningRows.ts:46), [runningRows.test.ts](../../mobile/tests/runningRows.test.ts:1)
- Commit: 7943089b (in 0.16.0-local77)
- Verified: typecheck ✅ lint ✅ tests ✅ | phone screenshot: three projects, one session each ✅ | folding not tried (taps blocked)

## 2026-11-28 07:31 IST — Hari Tabs layout: place arc, + button, bar and Share fixes (L-412)

- Type: feature
- What: Sessions and Monos now have an arc of circles at the bottom: All first, then the five projects or Monos opened last. Drag it sideways or tap a circle; long-press for Change icon (an app icon or emoji, kept on this phone) or Remove from arc. Sessions shows every project under All and a project's sessions when one is picked; each project's list stays loaded after its first visit. The + opens a New session picker (search, picked project first) or New Mono. The tab bar no longer collapses to a thin strip, and its highlight glides without overshooting. On the Share tab the composer sits just above the bar, and the chat has more side padding.
- Why: Phases 2 and 3 of the spec were not built; the bar was unusable and bounced; Share had a gap under the composer.
- Files: [PlaceArc.tsx](../../mobile/src/features/tabs/PlaceArc.tsx:1), [ArcFaces.tsx](../../mobile/src/features/tabs/ArcFaces.tsx:1), [ArcMenu.tsx](../../mobile/src/features/tabs/ArcMenu.tsx:1), [TabSheet.tsx](../../mobile/src/features/tabs/TabSheet.tsx:1), [IconPickerSheet.tsx](../../mobile/src/features/tabs/IconPickerSheet.tsx:1), [NewSessionSheet.tsx](../../mobile/src/features/tabs/NewSessionSheet.tsx:1), [PlusButton.tsx](../../mobile/src/features/tabs/PlusButton.tsx:1), [sessions.tsx](../../mobile/src/app/(tabs)/sessions.tsx:1), [monos.tsx](../../mobile/src/app/(tabs)/monos.tsx:1), [HariTabBar.tsx](../../mobile/src/features/tabs/HariTabBar.tsx:1), [tabMath.ts](../../mobile/src/features/tabs/tabMath.ts:1), [tabsMemory.ts](../../mobile/src/features/tabs/tabsMemory.ts:1), [SharePanel.tsx](../../mobile/src/features/share/SharePanel.tsx:1), [share-tab.tsx](../../mobile/src/app/(tabs)/share-tab.tsx:1), [SessionScreen.tsx (SheetLayout)](../../mobile/src/features/sessions/SessionScreen.tsx:171)
- Commit: 7943089b (in 0.16.0-local77)
- Verified: typecheck ✅ lint (changed files) ✅ tests (6 files, 48) ✅ | phone screenshots: bar, Sessions All list + arc + +, Share spacing ✅ | taps on the phone not tested (adb input blocked)

## 2026-11-27 19:47 IST — Hari Dev installs as its own app (L-413 fix)

- Type: fix
- What: `npm run android:dev` now regenerates the Android project for Hari Dev before building. It had reused an old Hari project, built plain Hari, and Android refused it as a downgrade.
- Why: install failed with INSTALL_FAILED_VERSION_DOWNGRADE (160073 < 160076).
- Files: [android-dev.mjs](../../mobile/scripts/android-dev.mjs:1)
- Commit: 7943089b (in 0.16.0-local77)
- Verified: dev prebuild gives package com.hardbeat920.monocodemobile.dev, name Hari Dev, scheme hari-dev ✅ | manual: install on phone pending

## 2026-11-27 19:33 IST — Hari Dev build (L-413) and Tabs layout, phases 1 and 4 (L-412)

- Type: feature
- What: Hari Dev installs beside Hari. Settings has a Layout choice (Classic, Tabs, Monos only). Tabs shows Sessions, Share, Monos, Computer and Running on a glass bar you can slide a finger along, with a side menu for Notes, Tasks, Notifications and Settings. Running lists working and waiting sessions and Monos. The place arc, icon picker and + button are not built yet.
- Why: spec docs/specs/hari-tabs-layout-plan.md.
- Files: `mobile/src/features/tabs/`, `mobile/src/app/(tabs)/`, `mobile/src/features/settings/appLayout.ts`, `mobile/src/app/_layout.tsx`, `mobile/src/app/settings/index.tsx`, `mobile/app.config.js`
- Commit: 7943089b (in 0.16.0-local77)
- Verified: mobile tsc ✅ expo lint ✅ (2 old warnings) vitest 422 pass, 2 files fail to load (watchRule, watchFrames; not touched) | manual: phone checks pending

## 2026-11-27 10:53 IST — Release 0.16.0-local76

- Type: chore
- Why: user asked to release.
- What: version 0.16.0-local76, carrying L-411 (Hari Share scrolls back; shortcut and tile say "Sent to Hari (desktop)").
- Files: version files (`package.json`, `package-lock.json`, `Cargo.toml`, `Cargo.lock`, `src-tauri/tauri.conf.json`)
- Commit: release commit after aa001d97
- Verified: mobile tsc ✅ expo lint ✅ vitest ✅ | manual: phone checks pending

## 2026-11-27 10:47 IST — Hari Share scrolls back; shortcut and tile say "Sent to Hari (desktop)" (L-411)

- Type: fix
- What: Share no longer jumps back to the bottom while you read older messages. It moves to the end only right after it opens or a new message arrives. The Send to computer shortcut and the Quick Settings tile now show "Sent to Hari (desktop)" after a send.
- Why: user report on 0.16.0-local75: Share still stuck at the bottom; the shortcut showed no confirmation; the tile should say "Sent to Hari (desktop)". Cause (from source; not reproduced on the phone, none connected): L-409 stopped following only on drag and scroll events, but KeyboardChatScrollView registers native handlers for those same events (`useScrollState`), so they likely never reached the app, and every size change (cards, pictures) still scrolled to the end. Success of a clipboard send showed no toast of Hari's (L-408 removed it).
- Files: [shareModel.ts](mobile/src/features/share/shareModel.ts), [SharePanel.tsx](mobile/src/features/share/SharePanel.tsx), [HariClip.kt](mobile/modules/hari-live/android/src/main/java/expo/modules/harilive/HariClip.kt), [shareModel.test.ts](mobile/tests/shareModel.test.ts)
- Commit: aa001d97 (in 0.16.0-local76)
- Verified: mobile tsc ✅ expo lint ✅ vitest shareModel (39) ✅ | Kotlin compiled by the release build | manual: phone checks pending

## 2026-11-27 09:30 IST — Release 0.16.0-local75

- Type: chore
- Why: user asked to release.
- What: version 0.16.0-local75, carrying L-409 (Hari Share scrolls back through old messages) and L-410 (Browser page feedback works with Interactive Claude and copies; Copy beside Add to chat).
- Files: version files (`package.json`, `package-lock.json`, `Cargo.toml`, `Cargo.lock`, `src-tauri/tauri.conf.json`)
- Commit: release commit after 5c96833a
- Verified: tsc ✅ vitest ✅ mobile tests ✅ | manual: desktop and phone checks pending

## 2026-11-27 09:26 IST — Browser picks work with Interactive Claude; Copy beside Add to chat (L-410)

- Type: fix
- What: page feedback from the Browser picker (and other text notes) now goes to Interactive Claude as part of the message, so the turn is sent instead of failing with "Interactive attachments support images, PDFs and text files". Copying such a message copies the note's text instead of "Copy failed … File content is no longer available". The picker's Changes list has a Copy button that copies the same note and keeps the picks.
- Why: user report: a message with "Page feedback: 1 item" didn't send in Interactive Claude and couldn't be copied. Cause: notes are text-only attachments (no file); Interactive handed every attachment to its file saver, which rejects that kind, and Copy looked for file bytes.
- Files: [claudeInteractivePrompt.ts](src/integrations/harness/providers/claude/claudeInteractivePrompt.ts), [claudeInteractive.ts](src/integrations/harness/providers/claude/claudeInteractive.ts), [history.ts](src/features/provider-sessions/model/history.ts), [clipboard.ts](src/platform/tauri/clipboard.ts), [browserTabs.ts](src/features/browser/model/browserTabs.ts), [browserContext.ts](src/features/browser/model/browserContext.ts), [browser_picker.js](src-tauri/src/browser_picker.js), tests in `claudeInteractive.test.ts` and `clipboard.test.ts`
- Commit: 5c96833a (in 0.16.0-local75)
- Verified: tsc ✅ vitest (claude providers, clipboard, provider-sessions, browser: 609) ✅ | lint: no root lint script | manual: desktop checks pending

## 2026-11-27 08:41 IST — Hari Share scrolls back through old messages (L-409)

- Type: fix
- What: in Hari's Share chat you can scroll up to older messages again. While your finger is on the list it no longer jumps back to the newest message; it follows new messages again once it rests at the bottom or after you send. The empty Share note now names the "Send to computer" tile.
- Why: user report on 0.16.0-local73: Share was stuck on the latest messages. Cause (from source; not reproduced on the phone): the chat followed its end on every size change while within 80 points of it, and a drag counted as "at the end" until it had moved 80 points. Link cards and pictures that load, or vanish when the computer is off, change the size often enough to snap every drag back.
- Files: [shareModel.ts](mobile/src/features/share/shareModel.ts), [SharePanel.tsx](mobile/src/features/share/SharePanel.tsx), [shareModel.test.ts](mobile/tests/shareModel.test.ts)
- Commit: 5c96833a (in 0.16.0-local75)
- Verified: mobile tsc ✅ expo lint (changed files) ✅ vitest shareModel ✅ (36) | manual: phone check pending

## 2026-11-27 08:38 IST — Release 0.16.0-local74

- Type: chore
- Why: user asked to release.
- What: version 0.16.0-local74, carrying L-406 fix (Hari shortcuts in the manifest, so Hinata lists them), L-407 (Control Center tile sends text, links and pictures) and L-408 (one-tap send without Hari's own toast; Share bubble removed).
- Files: version files (`package.json`, `package-lock.json`, `Cargo.toml`, `Cargo.lock`, `src-tauri/tauri.conf.json`)
- Commit: release commit after 01c4636e
- Verified: mobile tsc ✅ expo lint ✅ prebuild + gradle ✅ | manual: phone checks pending

## 2026-11-27 08:37 IST — One-tap send without a second toast; Share bubble removed (L-408)

- Type: feature
- What: the Control Center tile and the Send to computer shortcut send what you copied in one tap, and only Android's own "Hari pasted from your clipboard" shows. Hari shows a message only when something fails. The Share bubble is removed, with its Settings switch and the Display over other apps permission; Settings → Share now says where the tile and shortcut are.
- Why: user report: two toasts per send (Android's, then Hari's). The user asked to remove the bubble now that the tile works.
- Files: [HariClip.kt](mobile/modules/hari-live/android/src/main/java/expo/modules/harilive/HariClip.kt), [HariShare.kt](mobile/modules/hari-live/android/src/main/java/expo/modules/harilive/HariShare.kt), [HariLiveModule.kt](mobile/modules/hari-live/android/src/main/java/expo/modules/harilive/HariLiveModule.kt), [HariLive.kt](mobile/modules/hari-live/android/src/main/java/expo/modules/harilive/HariLive.kt), [AndroidManifest.xml](mobile/modules/hari-live/android/src/main/AndroidManifest.xml), [with-hari-shortcuts.js](mobile/plugins/with-hari-shortcuts.js), [settings/index.tsx](mobile/src/app/settings/index.tsx), [nativeLive.ts](mobile/src/features/liveUpdates/nativeLive.ts); removed `HariBubble.kt`, `hari_bubble_icon.xml`, `hari_bubble_check.xml`, `useShareBubble.ts`
- Commit: 01c4636e (in 0.16.0-local74)
- Verified: mobile tsc ✅ expo lint (changed files) ✅ | expo prebuild ✅ gradle hari-live Kotlin + app resources ✅ | manual: phone checks pending

## 2026-11-27 08:16 IST — Hari shortcuts show in shortcut apps (L-406 fix)

- Type: fix
- What: Hari's Send to computer and Open Share shortcuts now show in edge-swipe shortcut apps such as Hinata.
- Why: user report on 0.16.0-local73: Hinata listed no Hari shortcuts. Root cause: the shortcuts were published while Hari runs (dynamic). Apps other than the default launcher can't read those; they read the shortcuts an app declares in its manifest.
- Files: [with-hari-shortcuts.js](mobile/plugins/with-hari-shortcuts.js) (new config plugin: `res/xml/hari_shortcuts.xml`, labels, `android.app.shortcuts` on MainActivity), [app.config.js](mobile/app.config.js), [HariShortcuts.kt](mobile/modules/hari-live/android/src/main/java/expo/modules/harilive/HariShortcuts.kt) (now removes local73's run-time shortcuts), [HariLiveModule.kt](mobile/modules/hari-live/android/src/main/java/expo/modules/harilive/HariLiveModule.kt)
- Commit: 01c4636e (in 0.16.0-local74)
- Verified: expo prebuild ✅ (manifest meta-data, strings and shortcut XML generated) | gradle hari-live Kotlin + app resources ✅ | manual: phone checks pending

## 2026-11-27 08:08 IST — Control Center tile sends text, links and pictures (L-407)

- Type: feature
- What: Hari's Control Center (Quick Settings) tile is now "Send to computer". It sends whatever is copied, text, a link or a picture, as a Share bubble tap does. Before, it was "Send clipboard" and sent text only.
- Why: user request, to use the tile in place of the Share bubble.
- Files: [HariShare.kt](mobile/modules/hari-live/android/src/main/java/expo/modules/harilive/HariShare.kt) (`HariClipboardTile`), [AndroidManifest.xml](mobile/modules/hari-live/android/src/main/AndroidManifest.xml) (tile label)
- Commit: 01c4636e (in 0.16.0-local74)
- Verified: Kotlin compile ✅ | manual: phone checks pending

## 2026-11-27 06:12 IST — Release 0.16.0-local73

- Type: chore
- Why: user asked to push and release.
- What: version 0.16.0-local73, carrying L-406 (Hari app shortcuts: Send to computer, Open Share).
- Files: version files (`package.json`, `package-lock.json`, `Cargo.toml`, `Cargo.lock`, `src-tauri/tauri.conf.json`)
- Commit: release commit after 071c8e71
- Verified: Kotlin compile ✅ | manual: phone checks pending

## 2026-11-27 06:10 IST — Hari app shortcuts: Send to computer, Open Share (L-406)

- Type: feature
- What: Hari has two app shortcuts. Send to computer sends the clipboard's text, link or picture to the computer, as a Share bubble tap does. Open Share opens the Share screen. Long-press Hari's icon, or add them in an edge-swipe shortcut app.
- Why: user request, to run Share from an edge-swipe app.
- Files: [HariShortcuts.kt](mobile/modules/hari-live/android/src/main/java/expo/modules/harilive/HariShortcuts.kt), [HariLiveModule.kt](mobile/modules/hari-live/android/src/main/java/expo/modules/harilive/HariLiveModule.kt) (publishes them when the module starts)
- Commit: 071c8e71 (in 0.16.0-local73)
- Verified: Kotlin compile ✅ (`gradlew :hari-live:compileReleaseKotlin`) | manual: phone checks pending

## 2026-11-26 15:56 IST — Release 0.16.0-local72

- Type: chore
- Why: user asked to push and release.
- What: version 0.16.0-local72, carrying L-404 (Activity Ask and Whiteboard chats no longer drop into an endless loader) and L-405 (Hari listed under Android's Usage access).
- Files: version files (`package.json`, `package-lock.json`, `Cargo.toml`, `Cargo.lock`, `src-tauri/tauri.conf.json`)
- Commit: release commit after af48261c
- Verified: tsc ✅, vitest detach/whiteboard/activity ✅ (141) | manual: desktop and phone checks pending

## 2026-11-26 15:51 IST — Hari shows under Android's Usage access (L-405)

- Type: fix
- What: Hari now appears in Settings → App usage data, so phone screen time can be turned on.
- Why: user report. Root cause: `PACKAGE_USAGE_STATS` was only in the git-ignored `mobile/android` manifest from a local prebuild. The release workflow runs `expo prebuild` fresh, so the released APK never declared it, and Android lists only apps that declare it.
- Files: [AndroidManifest.xml](mobile/modules/hari-live/android/src/main/AndroidManifest.xml) (the hari-live module declares the permission; it merges into every build)
- Commit: af48261c (in 0.16.0-local72)
- Verified: manifest review only; needs a Hari release build to check on the phone

## 2026-11-26 15:50 IST — Activity Ask and Whiteboard chats no longer vanish into an endless loader (L-404)

- Type: fix
- What: opening Ask in Activity or the Whiteboard Agent showed the chat for a moment, then "Starting…" forever. Those chats now stay open.
- Why: user report. Root cause: the idle detach (`useIdleSessionDetach`) removes every idle chat that no tab shows, about 250 ms after a change. Embedded chats have no tab, so they were removed, and the panels went back to the loader.
- Files: [useIdleSessionDetach.ts](src/app/hooks/useIdleSessionDetach.ts) (new `embeddedSessionIds` ref counts as shown), [App.tsx](src/app/App.tsx) (fills it with the Ask and sheet chat ids), [WhiteboardAgentPanel.tsx](src/features/whiteboard/ui/WhiteboardAgentPanel.tsx) (reopens when the chat goes missing), [useIdleSessionDetach.test.ts](src/app/hooks/useIdleSessionDetach.test.ts)
- Commit: af48261c (in 0.16.0-local72)
- Verified: typecheck ✅ tests ✅ (detach 20, whiteboard, activity, localTurnSubmission) lint — (no ESLint config) build —

## 2026-11-26 13:15 IST — Release 0.16.0-local71

- Type: chore
- Why: user asked to commit, push and release.
- What: version 0.16.0-local71, carrying L-395 to L-403 (ClickUp attachments, Activity Ask, hourly notes, phone screen time, fixed Activity layout, accent selection, block copy, Share without a jump, Whiteboard Agent as a real chat).
- Files: version files (`package.json`, `package-lock.json`, `Cargo.toml`, `Cargo.lock`, `src-tauri/tauri.conf.json`); `localTurnSubmission.test.ts` gained the new turn bindings (`activityAsk`, `whiteboardSheet`) in b9ccfe6b.
- Commit: release commit after b9ccfe6b
- Verified: tsc ✅, vitest full ✅ (803 files, 8456 tests) | cargo ✅ (1002 pass; 2 macOS-only git PATH tests in fs.rs fail on Windows, untouched) | manual: desktop checks pending

## 2026-11-26 09:51 IST — Block copy, Share without a jump, Whiteboard Agent as a real chat (L-401 to L-403)

- Type: feature
- What: in agent replies, hover a heading to copy its section or a list to copy the list; Alt+click copies one paragraph or list item; the selection toolbar has Copy. The Share panel shows its header and composer at once, so nothing shifts when the history arrives. The Whiteboard's Agent panel is now a real chat per sheet with the normal composer (any harness, images and files, tools); it can read the sheet with the new `whiteboard.read` app action and draw on it. The old helper chat stays readable behind a clock button.
- Why: user request.
- Files: [HoverBlockActions.tsx](src/features/sessions/ui/HoverBlockActions.tsx), [SharePanel.tsx](src/features/mobile/ui/SharePanel.tsx), [WhiteboardAgentPanel.tsx](src/features/whiteboard/ui/WhiteboardAgentPanel.tsx), [whiteboardChats.ts](src/features/whiteboard/model/whiteboardChats.ts), [whiteboardRead.ts](src/features/whiteboard/model/whiteboardRead.ts), [agentApp.ts](src/features/agent-app/model/agentApp.ts), [App.tsx](src/app/App.tsx), [control_cli.rs](src-tauri/src/control_cli.rs)
- Commit: b9ccfe6b (in 0.16.0-local71)
- Verified: typecheck ✅ tests ✅ (vitest whiteboard/agent-app/mobile/sessions, cargo control_cli 14) lint — (no ESLint config) build —

## 2026-11-26 14:56 IST — Accent text selection (L-400); verified L-395 to L-399; Hari usage access row

- Type: fix
- What: selected text is tinted with the accent colour instead of system blue. Hari settings now shows "Usage access is off. Turn it on" under Share screen time when the permission is missing. The L-395 to L-399 batch was verified and its spec marked Done.
- Why: user request (selection colour); a row from the spec's UI details was missing.
- Files: [index.css (::selection)](src/styles/index.css), [settings/index.tsx](mobile/src/app/settings/index.tsx), [spec](docs/specs/activity-ask-phone-layout-clickup-attachments-plan.md)
- Commit: b9ccfe6b (in 0.16.0-local71)
- Verified: typecheck ✅ tests ✅ (desktop vitest 429, cargo 79) lint — (no ESLint config) build —

## 2026-11-26 07:17 IST — Activity Ask, hourly notes, phone screen time, fixed layout; ClickUp attachments (L-395 to L-399)

- Type: feature
- What: ClickUp New task takes files (paperclip, paste, drop) and uploads them after Create, with a retry for failed ones; its dropdowns and dates are glass. Activity gets an Ask tab (chat that reads your activity), hourly AI notes for hours with computer use but no prompts, phone screen time from Hari (Android usage access) with MonoCode / Browser / Other apps / Phone chips, and a layout with a fixed top, two independently scrolling columns and foldable sections.
- Why: spec activity-ask-phone-layout-clickup-attachments-plan.md.
- Files: see the L-395 to L-399 rows in docs/LOCAL-FEATURES.md.
- Spec: [activity-ask-phone-layout-clickup-attachments-plan.md](../specs/activity-ask-phone-layout-clickup-attachments-plan.md)
- Commit: b9ccfe6b (in 0.16.0-local71)
- Verified: typecheck ✅ (desktop and mobile) vitest ✅ (clickup, activity, agent-app, sessions/data, DateTimePicker, windowArgs: 32 files, 428 tests plus mobile PhoneUsageModel) cargo ✅ (activity 46, mobile_phone_usage 6, clickup 15, control_cli 13) lint — (ESLint config broken) build — | manual: desktop and phone checks pending

## 2026-11-24 18:12 IST — Release 0.16.0-local70

- Type: chore
- Why: user asked to push and release.
- What: version 0.16.0-local70, carrying L-392 to L-394 (Whiteboard drawings land, sheet backgrounds, Whiteboard tool for chats).
- Files: version files (`package.json`, `package-lock.json`, `Cargo.toml`, `Cargo.lock`, `src-tauri/tauri.conf.json`).
- Commit: release commit after c4b15652
- Verified: tsc ✅, vitest full ✅ (794 files, 8394 tests; iconCatalog timed out under load and passes alone, unrelated) | cargo ✅ (control_cli) | manual: desktop checks pending

## 2026-11-24 10:53 IST — Draw on the Whiteboard from any chat (L-394)

- Type: feature
- What: the composer's + menu has Whiteboard (also `/whiteboard`). With it on, the agent draws its answer on a new Whiteboard sheet: the Whiteboard opens on that sheet and the drawing appears. The agent can come back to the same sheet to change it. It works with every harness, because it is a MonoCode app CLI action (`whiteboard.draw`) like Notes or Tasks.
- Why: user asked to choose Whiteboard in the chat composer and get visuals drawn on a new sheet.
- Files: [whiteboardTool.ts](src/features/whiteboard/model/whiteboardTool.ts), [agentApp.ts](src/features/agent-app/model/agentApp.ts), [operatorCommand.ts](src/features/sessions/model/operatorCommand.ts), [Composer.tsx](src/features/sessions/ui/Composer.tsx), [modeCommands.tsx](src/features/sessions/ui/modeCommands.tsx), [monocodeToolCall.ts](src/features/sessions/model/monocodeToolCall.ts), [App.tsx](src/app/App.tsx), [WhiteboardView.tsx](src/features/whiteboard/ui/WhiteboardView.tsx), [control_cli.rs](src-tauri/src/control_cli.rs), tests
- Spec: [whiteboard-backgrounds-and-draw-tool-plan.md](../specs/whiteboard-backgrounds-and-draw-tool-plan.md)
- Commit: c4b15652 (in 0.16.0-local70)
- Verified: typecheck ✅ tests ✅ (whiteboard, sessions, agent-app: 214 files, 2277 tests) cargo ✅ (control_cli, 12) lint — (ESLint config broken) build — | manual: desktop checks pending

## 2026-11-24 10:53 IST — Sheet backgrounds: colour, opacity and patterns (L-393)

- Type: feature
- What: a paint bucket button beside Grid on the Whiteboard sets the open sheet's background. Default keeps today's look. You can also pick a fill colour (presets or your own) with opacity, and a pattern: dots, grid, lines or graph paper. Patterns move and zoom with the canvas. Each sheet remembers its own background.
- Why: user asked for a dot surface and custom backgrounds per sheet.
- Files: [sheetBackground.ts](src/features/whiteboard/model/sheetBackground.ts), [sheets.ts](src/features/whiteboard/model/sheets.ts), [SheetBackgroundMenu.tsx](src/features/whiteboard/ui/SheetBackgroundMenu.tsx), [WhiteboardTopBar.tsx](src/features/whiteboard/ui/WhiteboardTopBar.tsx), [WhiteboardView.tsx](src/features/whiteboard/ui/WhiteboardView.tsx), [icons.tsx](src/shared/ui/icons.tsx), [sheetBackground.test.ts](src/features/whiteboard/model/sheetBackground.test.ts)
- Spec: [whiteboard-backgrounds-and-draw-tool-plan.md](../specs/whiteboard-backgrounds-and-draw-tool-plan.md)
- Commit: c4b15652 (in 0.16.0-local70)
- Verified: typecheck ✅ tests ✅ lint — build — | manual: desktop checks pending

## 2026-11-24 10:53 IST — Whiteboard drawings no longer vanish (L-392)

- Type: fix
- What: the Whiteboard chat could say "Drew 24" while the sheet stayed empty. Drawings now wait until the editor is fully open. Several drawings queued for a closed sheet all appear, in order.
- Why: user saw an empty canvas after three drawing replies.
- Root cause (from the code; not reproduced in the UI): Excalidraw hands over its API before the editor is mounted, and drawings sent to it then were dropped. A second race let an effect use the previous sheet's editor right after a switch.
- Files: [whiteboardApi.ts](src/features/whiteboard/model/whiteboardApi.ts), [WhiteboardView.tsx](src/features/whiteboard/ui/WhiteboardView.tsx), [whiteboardRuns.ts](src/features/whiteboard/model/whiteboardRuns.ts), tests
- Commit: c4b15652 (in 0.16.0-local70)
- Verified: typecheck ✅ tests ✅ lint — build — | manual: desktop checks pending

## 2026-11-24 07:07 IST — Release 0.16.0-local69

- Type: chore
- Why: user asked to push and release.
- What: version 0.16.0-local69, carrying L-386 to L-391 (Mono Stop and Send now, ClickUp fixes, continue a task in a chat, useful-only copy, Whiteboard reply dot).
- Files: version files (`package.json`, `package-lock.json`, `Cargo.toml`, `Cargo.lock`, `src-tauri/tauri.conf.json`).
- Commit: release commit after d501508d
- Verified: tsc ✅, vitest full ✅ (790 files, 8377 tests) | cargo not run (no Rust changes) | manual: desktop checks pending

## 2026-11-24 06:30 IST — Whiteboard shows a dot in the sidebar when a reply lands while you are away (L-391)

- Type: feature
- What: ask the Whiteboard for something, go elsewhere, and when it finishes (a reply or an error) the Whiteboard entry in the sidebar shows a dot at the end of its name, like Inbox. It shows in the full sidebar, the rail and the compact rail. Opening the Whiteboard clears it. Stopping a request leaves no dot.
- Why: user asked to know when a Whiteboard task is done without watching it.
- Files: [whiteboardRuns.ts](src/features/whiteboard/model/whiteboardRuns.ts), [App.tsx](src/app/App.tsx), [Sidebar.tsx](src/app/shell/Sidebar.tsx), [ProjectRail.tsx](src/app/shell/ProjectRail.tsx), [whiteboardRuns.test.ts](src/features/whiteboard/model/whiteboardRuns.test.ts)
- Commit: d501508d (in 0.16.0-local69)
- Verified: typecheck ✅ tests ✅ (whiteboard + app/shell, 319; iconCatalog timed out under load and passes alone, unrelated) lint — (ESLint config broken) build —

## 2026-11-24 06:15 IST — Copy a ClickUp task or subtask; sessions and copies carry only the useful part (L-390)

- Type: feature
- What:
  - The ClickUp task panel has a Copy button beside Close. It copies the task's name, description and files; pasting into a composer here attaches the files too.
  - Each subtask in the panel shows a Copy button on hover (or keyboard focus) that copies that subtask the same way.
  - New session, Continue in a session and Give to a Mono now send only the name, description and files. The ClickUp link, status, priority, list, assignees, dates, tags and custom fields are left out. Files too big to attach are linked.
  - Task Manager's Copy is now just the title and description (no status, project, dates or tags).
- Why: user asked that copies and sessions carry only the useful content of a task.
- Files: [clickupTasks.ts](src/features/clickup/model/clickupTasks.ts), [clickupSessionContext.ts](src/features/clickup/model/clickupSessionContext.ts), [ClickupCopyButton.tsx](src/features/clickup/ui/ClickupCopyButton.tsx) (new), [ClickupTaskPanel.tsx](src/features/clickup/ui/ClickupTaskPanel.tsx), [ClickupTaskDetails.tsx](src/features/clickup/ui/ClickupTaskDetails.tsx), [ClickupView.tsx](src/features/clickup/ui/ClickupView.tsx), [tasks.ts](src/features/tasks/tasks.ts), [TaskEditor.tsx](src/features/tasks/ui/TaskEditor.tsx), [TasksView.tsx](src/features/tasks/ui/TasksView.tsx), tests
- Commit: d501508d (in 0.16.0-local69)
- Verified: typecheck ✅ tests ✅ (clickup + tasks + focus + zen, 302) lint — (ESLint config broken) build —

## 2026-11-24 06:08 IST — ClickUp: continue a task in an existing chat (L-389)

- Type: feature
- What: the task panel's Start session menu gains "Continue in a session…". It shows Zen's chat list for the linked project (search, model, time, a spinner on chats that are replying). Picking a chat opens it and sends the task's details and files; if that chat is replying, the task waits in its queue and goes next.
- Why: user asked to start a ClickUp task in an existing session, reusing Zen's session picker, queued when the session is busy.
- Files: [ClickupTaskPanel.tsx](src/features/clickup/ui/ClickupTaskPanel.tsx), [ClickupView.tsx](src/features/clickup/ui/ClickupView.tsx), [FocusPicker.tsx](src/features/focus/ui/FocusPicker.tsx) (optional `statusOf` on `ProjectChatList`), [App.tsx](src/app/App.tsx), [ClickupView.test.ts](src/features/clickup/ui/ClickupView.test.ts)
- Commit: d501508d (in 0.16.0-local69)
- Verified: typecheck ✅ tests ✅ (clickup + focus + zen, 165) lint — (ESLint config broken) build —

## 2026-11-24 05:42 IST — ClickUp: the task panel width handle sits in the gap before it (L-388)

- Type: fix
- What: the handle that changes the task panel width now sits in the gap between the views and the panel (on the Board, between the last column and the panel) instead of inside the panel edge, where it was clipped and hard to reach. Hovering the gap shows the line; drag to resize, double-click to reset.
- Why: user could not find or use a width slider between the last Board column and the New/Edit task panel.
- Files: [ClickupView.tsx](src/features/clickup/ui/ClickupView.tsx) (panel frame split: outer sized frame holds the handle, inner frame clips and draws the border)
- Note: ClickUp vanishing from the sidebar after switching projects was the project link check removed in L-387; it needs the updated build.
- Commit: d501508d (in 0.16.0-local69)
- Verified: typecheck ✅ tests ✅ (clickup, 42) lint — (ESLint config broken) build —

## 2026-11-24 05:39 IST — ClickUp: always in the sidebar, List pinned to the pane, Status menu hides instead of picks (L-387)

- Type: fix
- What:
  - ClickUp shows in the sidebar in every project again. It used to hide whenever the open project was not the one ClickUp was linked to, so it seemed to vanish.
  - The List view now scrolls inside itself, like Task Manager's list and ClickUp's own Board and Table: the toolbar and page stay put and the list no longer bounces the page.
  - The task panel opens like the Share panel: it folds down first, then the views narrow beside it (it used to slide in across the window).
  - Status menu: every status starts ticked ("All statuses"); unticking one hides its tasks, ticking it again brings them back, and "All statuses" shows everything. The choice is remembered; an older "statuses to show" pick is dropped so everything shows once.
  - The Status menu lists only statuses the open list's tasks use (on a single list tab, that list's; on All, every list's).
- Why: user reported the List scrolling the page, ClickUp missing from the sidebar, and asked for an untick-to-hide Status menu limited to the list's statuses, with the panel opening like the Share panel.
- Files: [App.tsx](src/app/App.tsx), [ClickupView.tsx](src/features/clickup/ui/ClickupView.tsx), [ClickupTaskViews.tsx](src/features/clickup/ui/ClickupTaskViews.tsx), [clickupViewState.ts](src/features/clickup/model/clickupViewState.ts), [clickupConfig.ts](src/features/clickup/model/clickupConfig.ts) (removed `clickupVisibleFor` and its test), [SearchableSelect.tsx](src/shared/ui/SearchableSelect.tsx) (optional `allPicked`)
- Commit: d501508d (in 0.16.0-local69)
- Verified: typecheck ✅ tests ✅ (clickup + shared/ui, 86) lint — (ESLint config broken) build —

## 2026-11-23 08:13 IST — Monos: Stop button, Send now on waiting messages, room between turns (L-386)

- Type: fix
- Why: user: a Mono chat had no Stop or Send now button, and the next message sat right on the previous reply's buttons.
- What: while a Mono replies, its composer shows Stop in Send's place until you type (Send comes back and the message waits its turn). A message waiting for the reply shows "Waiting to send · Send now" under its bubble; Send now delivers it mid-reply, or stops the reply first when the Mono's provider can't take messages mid-turn. Cause of the cramped gap: L-379 made the reply buttons always visible but kept them in the old 24px slot, so nothing was left between them and the next message; the slot is now 36px with the buttons 12px above its bottom.
- Files: `src/features/monos/ui/MonoComposer.tsx` (`onStop`), `src/features/sessions/ui/SessionPane.tsx`, `src/features/sessions/ui/AgentTranscript.tsx` (`onSendMessageNow`), `src/styles/index.css`; tests `MonoComposer.test.ts`, `AgentTranscript.inlineWork.test.ts`.
- Commit: d501508d (in 0.16.0-local69)
- Verified: tsc ✅, vitest monos + sessions ✅ | manual: desktop check pending

## 2026-11-22 15:57 IST — Release 0.16.0-local68; tests follow the repos chip and new banner layout

- Type: chore
- Why: user asked to commit, push and release. Two Composer paste tests counted the repos chip lookup (L-385) as a clipboard call, and four Codex banner tests still expected the reply in the banner body after L-383 moved it to the subtitle.
- What: version 0.16.0-local68. The paste tests stub the nested-repos lookup; the Codex tests check the subtitle.
- Files: `src/features/sessions/ui/Composer.pasteImage.test.ts`, `src/integrations/harness/providers/codex/codexApprovalUi.test.ts`, version files.
- Commit: 3d75f39e (in 0.16.0-local68)
- Verified: tsc ✅, vitest full ✅ after fixes, cargo test --lib: 983 pass, 2 fail in `fs.rs` git-path tests (untouched by this release, already failing before it)

## 2026-11-22 15:52 IST — ClickUp: open, copy and save attachments; write comments; Start session brings details and files; New task in the side panel (L-381)

- Type: feature
- Why: user: attachments only opened ClickUp's web page; asked to open them on the desktop, copy the file in one click, save a copy, post comments as them, have Start session carry the task's details and attachments, and show New task in the side panel.
- What: clicking an attachment downloads it once through the ClickUp connection (into the app cache) and opens it in the default app; Copy puts the file itself on the clipboard (now on Windows and Linux too, not only macOS); Save as writes a copy where you choose; Open in ClickUp is still there. A comment box under Comments posts as you (Ctrl+Enter; hidden on read-only lists). Start session (new session or a Mono) now sends status, priority, list, assignees, dates, tags and filled-in custom fields, and attaches up to 10 of the task's files (over 20 MB or failed ones are named instead); the button reads "Gathering files…" meanwhile. New task opens in the same resizable side panel instead of a dialog.
- Files: `src-tauri/src/clickup.rs` (`clickup_post_comment`, `clickup_download_attachment`, `clickup_save_attachment`; token only sent to ClickUp hosts, redirects followed without it, 200 MB cap), `src-tauri/src/lib.rs`, `src-tauri/src/pasteboard.rs` (Windows/Linux file copy via arboard), `src/features/clickup/model/clickupApi.ts`, `clickupTasks.ts` (`sessionPromptForTask` extras), new `clickupSessionContext.ts`, `src/features/clickup/ui/ClickupTaskDetails.tsx`, `ClickupTaskPanel.tsx`, `ClickupView.tsx` (`CreateTaskPanel`), `src/app/App.tsx` (attachments into the composer / Mono draft); tests `ClickupView.test.ts`, `clickupTasks.test.ts`, cargo `clickup`.
- Commit: 3d75f39e (in 0.16.0-local68)
- Verified: tsc ✅, vitest ✅ (clickup 43), cargo test clickup ✅ (12), clippy (no new warnings) | manual: desktop check pending; whether ClickUp accepts the API token for file downloads is unverified (falls back to a plain request)

## 2026-11-22 15:35 IST — ClickUp: resizable task panel, even Board spacing, no Mark done (L-381)

- Type: style
- Why: user: the gap between the open task and the board columns was uneven; remove Mark done; let the task panel be resized.
- What: the task panel can be dragged wider or narrower from its left edge (double-click resets; the width is remembered, up to 70% of the window). On the Board it sits 12px from the last column and from the window edges, the same as the gap between columns. The Mark done / Reopen button is gone (status is still set from the Status field).
- Files: `src/features/clickup/ui/ClickupView.tsx`, `ClickupTaskPanel.tsx`, `src/features/clickup/model/clickupViewState.ts` (`panelWidth`); test `clickupViewState.test.ts`.
- Commit: 3d75f39e (in 0.16.0-local68)
- Verified: tsc ✅, vitest ✅ (clickup 39) | manual: desktop check pending

## 2026-11-22 15:29 IST — Share panel: folds down first, then the chat makes room (L-376)

- Type: style
- Why: user: the desktop Share panel still looked like it came in from the right edge, opening and closing.
- What: the fold and the chat narrowing ran together, so below the unrolling panel the chat's edge swept left, which read as a slide from the right. They now take turns: opening, the panel folds down from the top over the chat (300 ms), then the chat narrows smoothly underneath it (220 ms); closing, the chat widens back underneath first (180 ms), then the panel folds up (220 ms). Over another view (overlay) there is no chat step. Turning around mid-way keeps the room already made.
- Files: `src/shared/ui/SlidePanel.tsx`; test `src/shared/ui/SlidePanel.test.ts`.
- Commit: 3d75f39e (in 0.16.0-local68)
- Verified: tsc ✅, vitest ✅ (shared, mobile, browser: 64 files, 400 tests) | manual: desktop check pending

## 2026-11-22 15:26 IST — ClickUp: counts in the Status filter and list tabs (L-381)

- Type: feature
- What: Each status in the Status dropdown shows how many tasks it has, and each list tab (All, and every list) shows its task count. Counts follow Show done and "Assignee: me"; list counts also follow the Status pick, so a tab shows what you would see after switching to it.
- Why: user asked for counts in the status filter and list switcher.
- Files: [ClickupView.tsx](src/features/clickup/ui/ClickupView.tsx), [SegmentedSwitch.tsx](src/shared/ui/SegmentedSwitch.tsx) (optional `count` on an option)
- Commit: 3d75f39e (in 0.16.0-local68)
- Verified: typecheck ✅ tests ✅ (clickup 39, shared 253) lint — (no ESLint config) build —

## 2026-11-22 15:24 IST — ClickUp: Table groups slide open and shut (L-381)

- Type: fix
- What: Folding or opening a group in the Table now slides smoothly like the List and the sidebar, instead of jumping. Each cell's content runs the same reveal animation, and the rows are removed once it ends.
- Why: user reported the Table fold jumping.
- Files: [ClickupTaskViews.tsx](src/features/clickup/ui/ClickupTaskViews.tsx) (`ClickupTableRows`), [RevealHeight.tsx](src/shared/ui/RevealHeight.tsx) (logic moved into a shared `useRevealHeight` hook; `RevealHeight` behaves the same)
- Commit: 3d75f39e (in 0.16.0-local68)
- Verified: typecheck ✅ tests ✅ (1140 across clickup, shared, workspace, app) lint — (no ESLint config) build —

## 2026-11-22 15:22 IST — ClickUp: Board fits the pane height, empty groups hidden, Status filter (L-381)

- Type: feature
- What:
  - The Board is pinned to the pane like Task Manager's: columns end at the bottom of the window and cards scroll inside each column; the page itself no longer scrolls.
  - Groups with no tasks are hidden in every view, Board included.
  - New "Status" multi-select dropdown in the view row (the app's shared dropdown): pick the statuses to see, or "All statuses". The choice is remembered. Picks that no longer exist (Show done off, list unlinked) are ignored, so a stale filter never empties the page.
- Why: user asked for a fixed board height, no empty columns, and a status filter.
- Files: [ClickupView.tsx](src/features/clickup/ui/ClickupView.tsx), [ClickupTaskViews.tsx](src/features/clickup/ui/ClickupTaskViews.tsx), [clickupViewState.ts](src/features/clickup/model/clickupViewState.ts)
- Commit: 3d75f39e (in 0.16.0-local68)
- Verified: typecheck ✅ tests ✅ (39) lint — (no ESLint config) build —

## 2026-11-22 15:19 IST — ClickUp: whole group row folds in List and Table (L-381)

- Type: fix
- What: In List and Table, clicking anywhere on a group's row (TO DO, IN PROGRESS…) folds or opens it, not only the status label. The hover highlight covers the whole row.
- Why: user asked for the full row to be clickable.
- Files: [ClickupBits.tsx](src/features/clickup/ui/ClickupBits.tsx), [ClickupTaskViews.tsx](src/features/clickup/ui/ClickupTaskViews.tsx)
- Commit: 3d75f39e (in 0.16.0-local68)
- Verified: typecheck ✅ tests ✅ (38) lint — (no ESLint config) build —

## 2026-11-22 15:06 IST — ClickUp: resizable Board columns (L-381)

- Type: feature
- What: The Board always fits the window (it never runs off the right edge). Dragging the divider between two columns moves width from one to the other; the other columns stay as they are. Widths are remembered per column, and a double-click on any divider makes all columns equal again. Columns get no narrower than 140 px from dragging.
- Follow-up (same day): the first version gave every column one shared width and let the row scroll sideways; with many statuses all columns were squeezed to the minimum, so dragging did nothing, and the row ran past the screen with no visible scrollbar.
- Why: user asked for column resizing in the ClickUp Board.
- Files: [ClickupTaskViews.tsx](src/features/clickup/ui/ClickupTaskViews.tsx), [ClickupView.tsx](src/features/clickup/ui/ClickupView.tsx), [clickupViewState.ts](src/features/clickup/model/clickupViewState.ts), [BoardColumns.tsx](src/shared/ui/board/BoardColumns.tsx) (optional `grow` and `edge` props)
- Commit: 3d75f39e (in 0.16.0-local68)
- Verified: typecheck ✅ tests ✅ (241, incl. Task Manager and session boards) lint — (no ESLint config) build —

## 2026-11-22 15:05 IST — ClickUp: full task details, shared dropdowns, smooth folds, X close (L-381)

- Type: feature
- What:
  - The task panel now shows everything ClickUp has on a task, under the editable fields: links (from URL fields, the description and comments), attachments (name, type, size, date; open in the browser), subtasks with status, checklists with done state, relationships (parent, waiting on, blocking, linked), details (task ID, creator, dates, watchers, time estimate and tracked, points, tags, every custom field) and comments. New `clickup_task_details` command; only http(s) links are shown.
  - The panel's "Close" text button is now an X icon button.
  - The New task form (List, Priority, Status), the assignee picker and ClickUp settings (Project) use the app's own searchable dropdown instead of native selects.
  - Folding a status group in List view slides open and closed, the same as sidebar folders.
  - Fixed the Assignee button cutting names on the letter "s" ("Nakul Sriva" → "Nakul").
- Why: user asked for all task details (links and attachments first), shared dropdowns, smooth folds and an X close button.
- Files: [clickup.rs](src-tauri/src/clickup.rs), [lib.rs](src-tauri/src/lib.rs), [clickupApi.ts](src/features/clickup/model/clickupApi.ts), [clickupViewState.ts](src/features/clickup/model/clickupViewState.ts), [ClickupTaskDetails.tsx](src/features/clickup/ui/ClickupTaskDetails.tsx), [ClickupTaskPanel.tsx](src/features/clickup/ui/ClickupTaskPanel.tsx), [ClickupTaskForm.tsx](src/features/clickup/ui/ClickupTaskForm.tsx), [ClickupAssigneePicker.tsx](src/features/clickup/ui/ClickupAssigneePicker.tsx), [ClickupSetup.tsx](src/features/clickup/ui/ClickupSetup.tsx), [ClickupTaskViews.tsx](src/features/clickup/ui/ClickupTaskViews.tsx)
- Commit: 3d75f39e (in 0.16.0-local68)
- Verified: typecheck ✅ tests ✅ (clickup 37, cargo clickup 9) lint — (no ESLint config) build —

## 2026-11-22 14:50 IST — ClickUp: list tabs in the view row, "Assignee: me" filter (L-381)

- Type: feature
- What:
  - The list tabs (All, and each linked list) moved from the title bar to the start of the second row, before Group and Sort.
  - A new "Assignee: <your first name>" button sits in the middle of that row, styled like Task Manager's Focus button, with a "your tasks / all tasks" count. Click it to see only tasks assigned to you; click again to see everyone's. The choice is remembered.
  - The app asks ClickUp once who the token belongs to (new `clickup_me` command). If that fails, the button stays hidden and every task shows.
- Why: user asked for the tabs in the second row and a quick "my tasks" filter.
- Files: [clickup.rs](src-tauri/src/clickup.rs), [lib.rs](src-tauri/src/lib.rs), [clickupApi.ts](src/features/clickup/model/clickupApi.ts), [clickupViewState.ts](src/features/clickup/model/clickupViewState.ts), [ClickupView.tsx](src/features/clickup/ui/ClickupView.tsx), [icons.tsx](src/shared/ui/icons.tsx)
- Commit: 3d75f39e (in 0.16.0-local68)
- Verified: typecheck ✅ tests ✅ (clickup 33, cargo clickup 8) lint — (no ESLint config) build —

## 2026-11-22 14:46 IST — ClickUp: List, Table and Board, grouped by status, with sorting (L-381)

- Type: feature
- What:
  - The ClickUp page has the Task Manager's List / Table / Board switch, plus Group and Sort menus and an up/down button for the sort direction.
  - Grouping: by status (ClickUp's coloured status pills with counts, in the list's status order; click to fold a group), by assignee, by priority, by list (when "All" shows several lists), or none. The Board always has columns (status by default) and shows empty status columns too.
  - Sorting like ClickUp: status, task name, assignee, priority, due date, start date, date created, date updated, date closed (with Show done). Empty values go last. Table headers sort too; a second click flips the direction.
  - The Table shows Name, Status, Assignee, Priority, Due, Start, then the lists' custom fields (drop-down values keep their colour, e.g. Severity S2/S3), Tags, Task ID, Date created, Date updated and List.
  - The view, grouping, sort and folded groups are remembered on this device.
- Why: user asked for ClickUp-like views, status grouping and sort options, reusing the Task Manager's pieces.
- Files: [clickup.rs](src-tauri/src/clickup.rs) (created/closed dates, custom ID, tags, custom fields), [clickupApi.ts](src/features/clickup/model/clickupApi.ts), [clickupViewState.ts](src/features/clickup/model/clickupViewState.ts), [ClickupTaskViews.tsx](src/features/clickup/ui/ClickupTaskViews.tsx), [ClickupBits.tsx](src/features/clickup/ui/ClickupBits.tsx), [ClickupTaskRow.tsx](src/features/clickup/ui/ClickupTaskRow.tsx), [ClickupView.tsx](src/features/clickup/ui/ClickupView.tsx), [clickupTasks.ts](src/features/clickup/model/clickupTasks.ts) (old fixed sort removed)
- Commit: 3d75f39e (in 0.16.0-local68)
- Verified: typecheck ✅ tests ✅ (clickup 32, cargo clickup 8) lint — (no ESLint config) build —

## 2026-11-22 14:27 IST — Repos chip in the composer; Inbox tab opens items beside the chat; ClickUp in every sidebar; Inbox switch card (L-385, L-380, L-381)

- Type: feature + fix
- What:
  - In a project folder that holds several repos (like rigorup-active), the composer shows "3 repos" instead of "No repo". Its menu lists each repo with its current branch; clicking one opens it in Changes. "New worktree" is hidden there.
  - Clicking an item in the sidebar's Inbox tab opens its details in the side panel beside the chat, instead of jumping to the Inbox page. With no chat tab open, the Inbox page still opens on it.
  - ClickUp now shows in the classic project rail, the compact rail and the project picker, not only in the floating sidebar.
  - Settings › Inbox: "Show Inbox in the side panel" sits in its own "Side panel" card, lined up with the other sections.
- Why: user found "No repo" in a multi-repo folder, Inbox clicks leaving the session, ClickUp missing in the classic layout, and the switch out of line.
- Files: [NestedReposChip.tsx](src/features/source-control/ui/NestedReposChip.tsx), [NestedReposChip.test.ts](src/features/source-control/ui/NestedReposChip.test.ts), [Composer.tsx](src/features/sessions/ui/Composer.tsx), [SessionPane.tsx](src/features/sessions/ui/SessionPane.tsx), [PaneTree.tsx](src/features/workspace/ui/PaneTree.tsx), [App.tsx](src/app/App.tsx), [Sidebar.tsx](src/app/shell/Sidebar.tsx), [ProjectRail.tsx](src/app/shell/ProjectRail.tsx), [SettingsView.tsx](src/features/settings/ui/SettingsView.tsx)
- Commit: 3d75f39e (in 0.16.0-local68)
- Verified: typecheck ✅ lint — (no ESLint config) tests ✅ (shell, inbox, settings, clickup, composer, workspace, chip) build —

## 2026-11-22 14:00 IST — Inbox tab keeps its rows while refreshing (L-380 rework)

- Type: fix
- What: pressing Refresh in the Inbox tab no longer blanks the list until GitHub answers; the rows stay and the Refresh icon spins. Opening another repository still starts from the loading state, so one repository's items never show under another.
- Why: spec review found the pane reset to "checking" on every refresh.
- Files: [InboxSidebarPane.tsx](src/features/inbox/ui/InboxSidebarPane.tsx), [InboxSidebarPane.test.ts](src/features/inbox/ui/InboxSidebarPane.test.ts)
- Commit: 3d75f39e (in 0.16.0-local68)
- Verified: typecheck ✅ lint — (no ESLint config) tests ✅ (InboxSidebarPane 8) build —

## 2026-11-22 13:50 IST — Mono reply bar, Inbox tab, ClickUp page, Interactive Mono sessions, Hari banners (L-379 to L-384)

- Type: feature
- What: six parts of `docs/specs/mono-bar-inbox-clickup-interactive-plan.md`. A: the Mono reply bar stays visible (L-379). B: a GitHub Inbox tab in the project sidebar, switched on in Settings (L-380). C: a ClickUp page for the lists linked to a project, with the token in the OS keychain, task create/edit/done, start a session or give a task to a Mono, and four `clickup.*` agent actions (L-381). D: Claude sessions a Mono starts run Interactive and tell the Mono when done (L-382). E: Hari-Desktop banners show reply, project, model and account (L-383). F: phone notifications show as Hari-Phone banners (L-384).
- Files: `src/features/clickup/`, `src-tauri/src/clickup.rs`, `src/features/inbox/ui/InboxSidebarPane.tsx`, `src/features/mobile/model/phoneBanners.ts`, `src/features/agent-app/model/agentApp.ts`, `src/app/App.tsx`, `src/app/shell/Sidebar.tsx`, `src/app/shell/TitleBar.tsx`, `src-tauri/src/{control_cli,notifications,mobile_phone_notifications,lib}.rs`, and the tests beside them.
- Commit: 3d75f39e (in 0.16.0-local68)
- Verified: typecheck ✅ lint — (no ESLint config in the repo) tests ✅ (352 files, 3838 tests; unhandled `transformCallback` errors from Tauri event listeners in settings tests; the same errors appear on `4382809e`, so they predate this work) cargo ✅ (clickup 7, control_cli 11, notifications 13, mobile_phone 7) build —. Desktop behaviour not checked: manual checklist in the report.

## 2026-11-22 08:54 IST — Plan: Mono reply bar, Inbox tab, ClickUp panel, Monos starting Interactive Claude

- Type: docs
- Why: user asked to record the agreed next work before building any of it.
- What: a full Complex spec (for a worker agent, with acceptance criteria, tests and manual checks) covering six parts: Mono reply bar, Inbox tab, ClickUp panel (answers recorded), Mono-started Claude sessions run Interactive (normal chats unchanged), Hari-Desktop banners with reply, project, model and account, and phone notifications as Hari-Phone desktop banners. It also records why the Mono reply bar never appears (the hover rule expects a direct child; upstream's later portal host wraps it).
- Files: `docs/specs/mono-bar-inbox-clickup-interactive-plan.md`, `docs/specs/SPECS.md`.
- Commit: 3d75f39e (in 0.16.0-local68)
- Verified: docs only

## 2026-11-22 08:35 IST — Working panel shows when a run finished (L-378)

- Type: feature
- Why: user request: the Working panel's finished cards showed how long a run took but not when it finished.
- What: finished cards now show the finish time before the duration: "Today, 5am · 1m 36s", "Yesterday, 8:15pm · 3m 17s", and the date and time before that (year only when it differs). Shown in the sidebar and the project rail.
- Files: `src/features/sessions/model/liveAgents.ts`, `src/features/sessions/ui/LiveAgentsPreview.tsx`; tests `liveAgents.test.ts`, `LiveAgentsPreview.test.ts`.
- Commit: 3d75f39e (in 0.16.0-local68)
- Verified: tsc ✅, vitest ✅ (app/shell + sessions: 224 files, 2321 tests) | manual: desktop check pending

## 2026-11-22 08:30 IST — Repository dropdown beside Workspace (L-377)

- Type: feature
- Why: user request: in a project folder holding several repos, pick the repo from a dropdown at the top beside the Workspace chooser instead of tabs in Changes; and the Workspace chooser didn't work for the chosen repo.
- What: a Repository dropdown (with each repo's colour dot) now sits beside Workspace in the sidebar header; Changes and History follow it. Workspace lists and creates worktrees of the chosen repo; before, it looked in the project folder, which isn't a repository, so it found none. Picking another repo while on one of the old repo's worktrees returns to the project folder. Layouts without that header show the dropdown at the top of Changes and History.
- Files: `src/features/source-control/ui/NestedRepoPicker.tsx` (new, + test), `nestedRepos.ts`, `SidebarWorktreeSwitcher.tsx` (+ test), `src/app/shell/Sidebar.tsx`.
- Commit: 3d75f39e (in 0.16.0-local68)
- Verified: tsc ✅, vitest ✅ (source-control 29 files / 189 tests; app/shell, shared/ui, mobile, windowArgs 61 files / 418 tests) | manual: desktop check pending

## 2026-11-20 15:59 IST — Share panel folds down from the top (L-376)

- Type: style
- Why: user request: the desktop Share panel looked like it slid in from the right; they wanted a smooth expand and collapse.
- What: the panel now grows out of the top-right corner (where the Share button is) with a small scale and fade, and shrinks back into that corner to close. Turning it around mid-way reverses smoothly; reduced motion skips it.
- Follow-up (user: "still jumping", dev server): three jumps found. The chat beside the docked panel snapped to its new width at the start of opening and after closing; it now narrows and widens with the panel. The placeholder swapped to the messages with a jump at the end of opening; the messages now fade in. Closing swapped the messages back to the placeholder; they now stay until it has closed.
- Follow-up (user: should fold out from the top, where the button is, and fold back up): the panel now stays at its resting spot and is uncovered from its top edge down with a slight tilt that flattens, and folds back up to close; nothing slides in from the side. Its slot widens underneath so the chat narrows smoothly, and the panel is frosted while it moves because it briefly lies over the chat.
- Files: `src/shared/ui/SlidePanel.tsx`, `src/features/mobile/ui/SharePanel.tsx`; test `src/shared/ui/SlidePanel.test.ts` (new).
- Commit: 3d75f39e (in 0.16.0-local68)
- Verified: tsc ✅, vitest ✅ (shared/ui, mobile, browser, SessionPanel: 40 files, 176 tests) | manual: desktop check pending

## 2026-11-20 15:45 IST — Files sent from the phone keep their names (L-375)

- Type: fix
- Why: user report: a file sent from Hari's Share panel arrived as "1565.pdf"; from the PC names stayed the same.
- What: the paperclip picker gives a content:// address that often ends in a number, and Expo takes the file name from that address. Hari now asks Android for the file's real name (the one shown in Files) and only falls back to the old name on builds without the new native code.
- Files: `mobile/modules/hari-live/android/.../HariFiles.kt`, `HariLiveModule.kt`, `mobile/src/features/liveUpdates/nativeLive.ts`, `mobile/src/features/share/SharePanel.tsx`; test `mobile/tests/pickedFileName.test.ts` (new).
- Commit: 3b562dc1 (in 0.16.0-local67)
- Verified: Hari tsc ✅, expo lint ✅, vitest ✅ (pickedFileName, shareModel) | manual: phone check pending (needs a new native build)

## 2026-11-20 15:41 IST — Group colour styles; groups and folders slide open (L-374)

- Type: feature
- Why: user feedback: project group colours didn't show, the coloured groups looked heavy, and only some lists slid open.
- What: a new Settings › Group colours choice (Off, Tint, Background, Border, Background + border, Side bar, Tint + side bar, Fade) for session and project groups; Repository colours gets the same list. Project groups now show their colour on the whole card (before, only on the mascot, hidden while open). Explorer folders, project groups, session groups and Task list groups slide open and shut. Session groups default to Tint, a little lighter than before (12% instead of 18%).
- Files: `src/shared/ui/colorSurface.ts` (new, + test), `repoColors.ts` (+ test), `SettingsView.tsx`, `settings.ts`, `ProjectRail.tsx`, `Sidebar.tsx`, `FileTree.tsx`, `TaskList.tsx`; tests `ProjectGroups.test.ts`, `SidebarRename.test.ts`, `Sidebar.test.ts`, `TasksView.test.ts`.
- Commit: cdadd406 (in 0.16.0-local67)
- Verified: tsc ✅, vitest ✅ (776 files) | manual: desktop check pending

## 2026-11-20 15:23 IST — Stronger repo tint; no duplicate Copy on Share link cards (L-372, L-371)

- Why: user feedback: the repo tint was too faint; a link card's menu showed both Copy link and Copy, which copied the same thing.
- What: the Explorer tint goes from 7% to 12% of the repo colour. On a Share item that is only a link (no other text, no picture), the menu drops Copy and keeps Copy link; items with more text keep both.
- Files: `repoColors.ts` (+ test), `src/features/mobile/ui/ShareBubble.tsx`.
- Verified: tsc ✅, vitest ✅ (repoColors, mobile feature 20 files) | manual: desktop check pending
- Commit: cdadd406 (in 0.16.0-local67)

## 2026-11-20 15:08 IST — Repository colours; subtasks on desktop, Hari and Operator (L-372, L-373)

- Why: user request. In a folder holding several repos it was hard to tell which repo a file belongs to; and tasks needed real steps with their own status, shown as a clean hierarchy that opens and closes smoothly, on the phone too.
- What (L-372): each nested repo gets a colour. Explorer tints its subtree, adds a side bar, or both; the Changes switcher shows a dot. Settings › Appearance › Repository colours: Disabled / Tint (default) / Bar / Both.
- What (L-373): tasks hold up to 100 subtasks (title + status). The task editor has a Subtasks section (add, rename, move, delete, status). List rows and Board cards show "done/total"; it slides the steps open as a tree with connector lines, ticks save at once. Hari: the same toggle and tree in Tasks (ticks queue offline), and a Subtasks section in the edit sheet. Operator `tasks.write` accepts `subtasks` (titles or `{id,title,status}`). Writers that don't send subtasks (older phones) keep the stored ones.
- Files: see L-372 and L-373 in `docs/LOCAL-FEATURES.md`.
- Verified: desktop tsc ✅, vitest ✅ (773 files; useQuickAttachments and iconCatalog failed under load, pass alone; TasksView.test's 140 "transformCallback" errors are the same at HEAD), windowArgs ✅, cargo clippy ✅ (no warnings in changed files), cargo fmt ✅ (changed files; existing diffs elsewhere), Rust tests ✅ (tasks 21, mobile_tools 6); Hari tsc ✅, lint ✅ (changed files), vitest ✅ (tools, toolsOffline 38) | manual: desktop and phone checks pending
- Commit: cdadd406 (in 0.16.0-local67)

## 2026-11-20 14:08 IST — Share panel: open a link card in the default browser from anywhere on it (L-371)

- Why: user report: right-clicking a link card in Share showed no "Open in default browser". The link items (L-355) only appeared when the click landed exactly on the link text; most of a card (picture, description) isn't that.
- What: right-click anywhere on a link card now offers Open in default browser, Open in MonoCode browser and Copy link, using the card's link.
- Files: `src/features/mobile/ui/ShareBubble.tsx` (`onContextMenu`).
- Verified: tsc ✅, vitest ✅ (mobile feature 96) | manual: desktop check pending
- Commit: 408015a6 (in 0.16.0-local66)

## 2026-11-20 13:20 IST — Files outside the project open; Changes works on folders holding several repos (L-369, L-370)

- Why: user report. A chat in `Teacher` named `MANUAL_CHECKS.md`, which is in the parent `rigorup-active`; opening it failed ("cannot find the file") and Explorer/default app did nothing. And `rigorup-active` holds three repos but isn't one, so Changes always said "No uncommitted changes".
- What (L-369): when a named file isn't in the chat's project, MonoCode looks in projects around it (ones containing it, closest first, then others in its sidebar group) and opens the match there. The chat's file menu (Explorer, default app, copy path) uses the same path.
- What (L-370): new desktop command lists repos one level inside a folder that isn't a repo. Changes and History show a repository switcher; diffs, "all changes" and commits open from the picked repo. The pick is remembered per folder. Explorer, search and file badges are unchanged. Remote projects and Hari are not covered.
- Files: `relatedProjectRoots.ts` (new), `fileIndex.ts`, `AgentMarkdown.tsx`; `src-tauri/src/nested_repos.rs` (new), `lib.rs`, `platform/tauri/fs.ts`, `source-control/model/nestedRepos.ts` (new), `Sidebar.tsx`, `App.tsx`.
- Verified: tsc ✅, vitest ✅ (full run 8250+; iconCatalog timed out under load, passes alone; switcher's store needed a server snapshot, fixed), windowArgs ✅, cargo clippy ✅ (new file), cargo fmt ✅ (new file), Rust tests ✅ (2) | manual: desktop checks pending
- Commit: 408015a6 (in 0.16.0-local66)

## 2026-11-20 11:22 IST — Hari: watching notification closes without the computer; session list shows the account (L-367, L-368)

- Why: user request. The "Watching your computer" notification stayed on (and kept the phone checking) with MonoCode closed, though nothing could arrive; the phone's session list showed the model but not which account a chat runs on.
- What (L-367): background watching now runs only while the computer answers. After 2 minutes without an answer (the same wait as the session cards), the service and its notification stop. Android won't restart it from the background, so opening Hari with the computer reachable turns it back on. Settings' note says so.
- Also (L-365): the idle "background tasks" line now sits right under the reply that started the work, not at the bottom of the chat (`AgentTranscript.tsx`).
- What (L-368): the desktop sends `accountName` with each phone session (only when that provider has 2+ accounts, as on the desktop card); the phone shows "Opus 5.5 · Work". An older desktop sends none and the row looks as before.
- Files: `mobile/src/features/notifications/watchRule.ts` (new), `NotificationFeedSync.tsx` (watching effect), `mobile/src/app/settings/index.tsx` (note); `src/features/mobile/model/mobileProviderAccounts.ts` (`mobileSessionAccountName`), `mobileWorkspace.ts` (two summaries); phone `workspace/types.ts`, `sessions/sessionModelLabel.ts` (new), `SessionCard.tsx`, `SessionsPage.tsx`.
- Verified: desktop tsc ✅, vitest ✅ (8243; iconCatalog timed out once under load, passes alone); phone tsc ✅, lint ✅ (changed files), vitest ✅ (375; tests/mobile/watchFrames.test.ts fails to load before and after, unrelated) | manual: phone checks pending
- Commit: 22a9528d (in 0.16.0-local65)

## 2026-11-19 12:55 IST — Claude background tasks stay visible and don't block messages; Hari Select text, Share tables and Show more (L-365, L-366)

- Why: user report: a CodeRabbit review Claude ran in the background never showed, and the next message failed with "Return to an empty, idle native prompt…". Phone: the Select text bar vanished on lifting the finger; Share tables were squeezed and couldn't scroll; long Share texts didn't fold.
- What (L-365): the reply ending no longer clears interactive Claude's background list (root cause). The line shimmers, has an × per task (sends one short "stop it" message), and keeps the chat working for cards, idle hibernate and idle close. A send during background work goes on the running settings with a note; new settings apply after it ends (`/model` and `/effort` were not used: they overwrite Claude's global defaults). No extra turns or tokens. Desktop Share footer: Copy left, time right.
- What (L-366): Android dropped the selection because the hidden system menu refuses to open on lift; Android now keeps its menu. Tables size columns to their text (64–320 px) and scroll; Share text is touchable (not selectable) and folds past 700 characters or 12 lines.
- Verified: desktop vitest ✅ (8243; one flaky failure on a loaded first run, passes on rerun), tsc ✅; claude interactive + apply tests ✅; phone tsc ✅, lint ✅, vitest ✅ (367).
- Commit: 442e8894 (in 0.16.0-local64)

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
- Commit: 01c4636e (in 0.16.0-local74)
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
- Commit: 01c4636e (in 0.16.0-local74)
- Verified: typecheck ✅ (mobile) lint ✅ (mobile changed files) tests ✅ (Rust mobile_share 8 incl. 1 new; phone 298) rustfmt ✅; phone + desktop checks manual (needs a new desktop build)

## 2026-11-14 21:41 IST — Hari: Camera in the + menu (L-285)
- Type: feature
- What: The + menu in a Hari chat now has Camera next to Photos and Files. The photo is attached like any picked photo. If the camera is off for Hari, a prompt explains and offers Open Settings.
- Why: User request.
- Files: [attachments.ts](../../mobile/src/features/sessions/attachments.ts), [Composer.tsx](../../mobile/src/features/sessions/Composer.tsx), [Icon.tsx](../../mobile/src/ui/Icon.tsx), [app.json](../../mobile/app.json), [Composer.test.tsx](../../mobile/tests/Composer.test.tsx)
- Commit: 01c4636e (in 0.16.0-local74)
- Verified: typecheck ✅ (mobile) lint ✅ (changed source files; `tests/Composer.test.tsx:73` display-name error is older) tests ✅ (Composer); phone check manual (permission text needs a new build)

## 2026-11-14 21:41 IST — Hari: quicker composer and lighter chat scrolling (L-284)
- Type: fix
- What: Tapping the message box no longer drags: the box lifts with the keyboard and the chat moves with it instead of trailing. Long chats keep fewer rows ready off screen, so scrolling and flinging feel lighter.
- Why: User report: the composer rose very slowly on tap and scrolling felt heavy. Cause: the box's height change re-rendered the whole chat on every animation frame and restarted the list's padding animation each frame.
- Files: [SessionScreen.tsx](../../mobile/src/features/sessions/SessionScreen.tsx), [Composer.tsx](../../mobile/src/features/sessions/Composer.tsx), [Transcript.tsx](../../mobile/src/features/sessions/Transcript.tsx)
- Commit: 01c4636e (in 0.16.0-local74)
- Verified: typecheck ✅ (mobile) lint ✅ tests ✅ (Transcript, Composer, ProjectScreen); feel on device is a manual check
## 2026-11-14 19:53 IST — Aside link: clear names, Claude accounts, no session floods (L-283)
- Type: fix
- What: Aside's model picker now shows `hari-claude-interactive`, `hari-command-code` and `hari-antigravity` instead of `monocode-…`. With more than one Claude account in MonoCode, each account is its own entry (`hari-claude-interactive-<account name>`) and its chats run on that account. "Add models to Aside" replaces the old `monocode-…` entries. When an agent in an Aside chat ran `aside exec` without `-m`, Aside sent that request back to Hari, which started another session each time (Command Code made several and then timed out after 30 minutes); such a request now gets a short answer telling the agent to use `repl` or `aside exec -m <Aside model>`, and the CLI project's guide says the same. Aside's background memory "dreaming" pass is answered locally instead of starting a session. Aside now sends its chat ID, which keeps two chats that start alike apart.
- Why: User report: names showed `monocode`, no Interactive or account; a single Ask Aside chat with Command Code created many sessions and then stopped without doing the task.
- Files: [asideModels.ts](../../src/features/aside-link/model/asideModels.ts), [asideRequest.ts](../../src/features/aside-link/model/asideRequest.ts), [useAsideLink.ts](../../src/features/aside-link/hooks/useAsideLink.ts), [AsideLinkSettings.tsx](../../src/features/aside-link/ui/AsideLinkSettings.tsx), [App.tsx](../../src/app/App.tsx), [aside_link.rs](../../src-tauri/src/aside_link.rs), tests beside them
- Commit: 01c4636e (in 0.16.0-local74)
- Verified: typecheck ✅ (root) lint — (root has no ESLint config) tests ✅ (aside-link 26 incl. 5 new, Rust aside_link 9 incl. 2 new) rustfmt ✅; Aside and desktop checks manual

## 2026-11-14 19:21 IST — Tasks and Notes offline on the phone (L-281)
- Type: feature
- What: Hari now keeps a copy of the computer's Tasks and Notes. When the computer is off or out of reach, the Tasks and Notes screens still open, with a "Computer not connected" line, and notes read before (plus the 20 newest) open in full. New tasks, ticking or moving tasks, and note edits made then wait on the phone and go to the computer when it's back. If the same task or note was changed on the computer later, the computer's copy stays (the note editor offers Reload or Keep mine); something deleted on the computer stays deleted. The phone's copy refreshes by itself whenever the computer's Tasks or Notes change.
- Why: Phase 5 of the Hari link plan: use Tasks and Notes from the phone without the computer.
- Files: [mobile_tools.rs](../../src-tauri/src/mobile_tools.rs), [mobile_events.rs](../../src-tauri/src/mobile_events.rs), [notes.rs](../../src-tauri/src/notes.rs), [tasks.rs](../../src-tauri/src/tasks.rs), [toolsOverlay.ts](../../mobile/src/features/tools/toolsOverlay.ts), [toolsCache.ts](../../mobile/src/features/tools/toolsCache.ts), [tools.ts](../../mobile/src/features/tools/tools.ts), [ToolsSync.tsx](../../mobile/src/features/tools/ToolsSync.tsx), [ToolsOffline.tsx](../../mobile/src/features/tools/ToolsOffline.tsx), [linkStream.ts](../../mobile/src/features/link/linkStream.ts), [tasks/index.tsx](../../mobile/src/app/tasks/index.tsx), [notes/index.tsx](../../mobile/src/app/notes/index.tsx), [notes/[noteId].tsx](../../mobile/src/app/notes/[noteId].tsx), [_layout.tsx](../../mobile/src/app/_layout.tsx)
- Commit: 01c4636e (in 0.16.0-local74)
- Verified: typecheck ✅ (mobile) lint ✅ (mobile changed files) tests ✅ (src-tauri mobile_ 32 incl. 2 new, phone 308 incl. 15 new — `tests/mobile/watchFrames.test.ts` can't load from the phone config on Windows, as before) rustfmt ✅; phone and desktop checks manual

## 2026-11-14 19:02 IST — Computer: control the computer from Hari (L-280)
- Type: feature
- What: Hari has a Computer screen (Home footer). It shows the computer's CPU, GPU, memory, drives, network and uptime, refreshed every 3 seconds while open, and has Monitor off, Lock, Hibernate and Screenshot (the picture arrives in Share). The apps chosen on the computer (Settings → Phone: Hari, Claude, ChatGPT and Antigravity to start; any program can be added) can be opened, closed, minimized, maximized and restarted, and the running apps can be sorted and minimized, maximized, closed or ended. When the computer can't be reached, Wake computer turns it on over the home network. On the computer, the Share popover shows the phone's battery, temperature, storage and network, and Find my phone rings the phone loudly for up to 2 minutes.
- Why: Phase 4 of the Hari link plan: do from Hari what the Telegram bot does every day (monitor off, hibernate, app control, wake).
- Files: [mobile_pc.rs](../../src-tauri/src/mobile_pc.rs), [mobile_share.rs](../../src-tauri/src/mobile_share.rs), [mobile_access.rs](../../src-tauri/src/mobile_access.rs), [process_stop.rs](../../src-tauri/src/process_stop.rs), [lib.rs](../../src-tauri/src/lib.rs), [Cargo.toml](../../src-tauri/Cargo.toml), [mobilePc.ts](../../src/features/mobile/model/mobilePc.ts), [ShareButton.tsx](../../src/features/mobile/ui/ShareButton.tsx), [PhoneAppsSettings.tsx](../../src/features/mobile/ui/PhoneAppsSettings.tsx), [MobileSettings.tsx](../../src/features/mobile/ui/MobileSettings.tsx), [pcModel.ts](../../mobile/src/features/pc/pcModel.ts), [wakeStore.ts](../../mobile/src/features/pc/wakeStore.ts), [PcSync.tsx](../../mobile/src/features/pc/PcSync.tsx), [ComputerParts.tsx](../../mobile/src/features/pc/ComputerParts.tsx), [computer/index.tsx](../../mobile/src/app/computer/index.tsx), [_layout.tsx](../../mobile/src/app/_layout.tsx), [MonoHome.tsx](../../mobile/src/features/workspace/MonoHome.tsx), [nativeLive.ts](../../mobile/src/features/liveUpdates/nativeLive.ts), [HariPc.kt](../../mobile/modules/hari-live/android/src/main/java/expo/modules/harilive/HariPc.kt), [HariLiveModule.kt](../../mobile/modules/hari-live/android/src/main/java/expo/modules/harilive/HariLiveModule.kt), [AndroidManifest.xml](../../mobile/modules/hari-live/android/src/main/AndroidManifest.xml)
- Commit: 01c4636e (in 0.16.0-local74)
- Verified: typecheck ✅ (root, mobile) lint ✅ (mobile changed files; root has no ESLint config) tests ✅ (desktop mobile 79 incl. 5 new + window args, src-tauri mobile_ 30, phone 293 incl. 11 new — `tests/mobile/watchFrames.test.ts` can't load from the phone config on Windows, as before) rustfmt ✅ Kotlin compile ✅; phone and desktop checks manual

## 2026-11-14 16:51 IST — Share between Hari and the computer (L-279)
- Type: feature
- What: Text, links, the clipboard and files now go both ways between the phone and the computer. On the computer, a phone icon beside the bell opens Share: type and send, send the clipboard, send files, and see the last 100 items. On the phone, Share sits in the Home footer, any app's share menu has "Hari: send to computer", and a Quick Settings tile sends the clipboard. A clipboard item lands on the other side's clipboard with a notification. Files go to DownloadsHari on the computer and Download/Hari on the phone (up to 100 MB each). Texts wait while the other side is off; a failed file can be tried again.
- Why: Phase 3 of the Hari link plan: move things between the phone and the computer without other apps.
- Files: [mobile_share.rs](../../src-tauri/src/mobile_share.rs), [mobile_events.rs](../../src-tauri/src/mobile_events.rs), [mobile_access.rs](../../src-tauri/src/mobile_access.rs), [notifications.rs](../../src-tauri/src/notifications.rs), [lib.rs](../../src-tauri/src/lib.rs), [mobileShare.ts](../../src/features/mobile/model/mobileShare.ts), [ShareButton.tsx](../../src/features/mobile/ui/ShareButton.tsx), [WindowControls.tsx](../../src/app/shell/WindowControls.tsx), [shareModel.ts](../../mobile/src/features/share/shareModel.ts), [shareStore.ts](../../mobile/src/features/share/shareStore.ts), [shareTransfers.ts](../../mobile/src/features/share/shareTransfers.ts), [ShareSync.tsx](../../mobile/src/features/share/ShareSync.tsx), [share/index.tsx](../../mobile/src/app/share/index.tsx), [MonoHome.tsx](../../mobile/src/features/workspace/MonoHome.tsx), [HariShare.kt](../../mobile/modules/hari-live/android/src/main/java/expo/modules/harilive/HariShare.kt), [AndroidManifest.xml](../../mobile/modules/hari-live/android/src/main/AndroidManifest.xml)
- Commit: 01c4636e (in 0.16.0-local74)
- Verified: typecheck ✅ (root, mobile) lint ✅ (mobile changed files; root has no ESLint config) tests ✅ (desktop share model 3 + window args, src-tauri mobile_ 24, phone 282 incl. 16 new — `tests/mobile/watchFrames.test.ts` can't load from the phone config on Windows, as before) rustfmt ✅ Kotlin compile ✅; phone and desktop checks manual

## 2026-11-14 16:27 IST — Answer from Hari's notifications (L-278)
- Type: feature
- What: The computer's notifications in the phone's panel now have buttons. Approvals get Approve and Deny; questions get an Answer box; a finished chat gets a Reply box. The tap goes straight to the computer without opening Hari. A sent one leaves the panel and is read on the computer; a failed one stays with the reason and its buttons. A typed answer picks the choice it names, or is the typed answer where the question allows one.
- Why: Phase 2 of the Hari link plan: act on a notification without opening the app.
- Files: [mobile_notifications.rs](../../src-tauri/src/mobile_notifications.rs), [mobileNotifications.ts](../../src/features/mobile/model/mobileNotifications.ts), [mobileWorkspace.ts](../../src/features/mobile/model/mobileWorkspace.ts), [App.tsx](../../src/app/App.tsx), [notificationActions.ts](../../mobile/src/features/notifications/notificationActions.ts), [PanelActions.tsx](../../mobile/src/features/notifications/PanelActions.tsx), [NotificationFeedSync.tsx](../../mobile/src/features/notifications/NotificationFeedSync.tsx), [notificationFeed.ts](../../mobile/src/features/notifications/notificationFeed.ts), [_layout.tsx](../../mobile/src/app/_layout.tsx)
- Commit: 01c4636e (in 0.16.0-local74)
- Verified: typecheck ✅ (root, mobile) lint ✅ (mobile changed files; root has no ESLint config) tests ✅ (desktop mobile model 9, src-tauri mobile_ 17, phone 266 — `tests/mobile/watchFrames.test.ts` can't load from the phone config on Windows, as before) rustfmt ✅; phone checks manual

## 2026-11-14 16:16 IST — Hari keeps one link open to the computer (L-277)
- Type: feature
- What: While paired, Hari now keeps one encrypted link open to the computer instead of only asking every few seconds. In view it uses the normal connection; in the background (Android, with "Keep watching in the background" on) it uses a quiet one that checks in every 20 s. The computer's notification list arrives on it within about a second, and Hari polls only once a minute while the link is open. Both sides now keep an outbox that the next phases use (sharing, notification actions). With an older computer, Hari keeps polling as before.
- Why: Phase 1 of the Hari link plan: push instead of poll, and the base for Share, PC control and stats.
- Files: [transport.rs](../../crates/mobile-link/src/transport.rs), [tls.rs](../../crates/mobile-link/src/tls.rs), [ffi.rs](../../crates/mobile-link/src/ffi.rs), [mobile_events.rs](../../src-tauri/src/mobile_events.rs), [mobile_access.rs](../../src-tauri/src/mobile_access.rs), [mobile_notifications.rs](../../src-tauri/src/mobile_notifications.rs), [linkStream.ts](../../mobile/src/features/link/linkStream.ts), [linkProtocol.ts](../../mobile/src/features/link/linkProtocol.ts), [LinkStreamSync.tsx](../../mobile/src/features/link/LinkStreamSync.tsx), [NotificationFeedSync.tsx](../../mobile/src/features/notifications/NotificationFeedSync.tsx), [HariLive.kt](../../mobile/modules/hari-live/android/src/main/java/expo/modules/harilive/HariLive.kt), [SessionNotifications.test.tsx](../../mobile/tests/SessionNotifications.test.tsx) (its kv-store mock was missing since L-275)
- Commit: 01c4636e (in 0.16.0-local74)
- Verified: typecheck ✅ (root, mobile) lint ✅ (mobile changed files) tests ✅ (mobile-link 34, src-tauri mobile_ 16, mobile 9 new, SessionNotifications fixed; `tests/mobile/watchFrames.test.ts` can't load from the phone config on Windows, as before) Kotlin compile ✅; phone checks manual

## 2026-11-14 15:36 IST — Plan: always-open Hari link, Share and a later cloud mailbox
- Type: docs
- What: Wrote down the agreed direction for the phone link: one always-open two-way connection, an outbox on each side so nothing is lost, a Share panel, "send to clipboard" both ways with a notification, push for notifications and notes/tasks, and later a cloud mailbox on Nakul's spare Convex account. Local version first.
- Why: Nakul asked to note these pointers before building, and to build and test the local version before any cloud part.
- Files: [hari-link-stream-plan.md](../specs/hari-link-stream-plan.md), [SPECS.md](../specs/SPECS.md), [PLANNED.md](../PLANNED.md)
- Commit: 01c4636e (in 0.16.0-local74)
- Update: Share choices answered (files, text and links both ways; DownloadsHari; history of 100). Added notification Approve/Deny/Reply buttons, Wake-on-LAN, find my phone, a Quick Settings "Send clipboard" tile, PC and phone stats with closing busy apps, PC control from the Telegram bot (monitor off, hibernate, apps), notes/tasks sync and 5 build phases. Later: reminders and AI in the Share panel.
- Verified: docs only

## 2026-11-14 15:04 IST — The Windows app installs as Hari (L-276)
- Type: chore
- What: The Windows release installer is now named Hari and adds "Hari" to the Start menu, Desktop and Installed apps. Updating from MonoCode installs Hari next to it (for example `E:InstalledHari`), keeps every setting, chat and account, and swaps MonoCode's shortcuts and Installed apps entry for Hari's. MonoCode's old folder is left on disk. Inside the app the name is still MonoCode.
- Why: The user agreed to rename the desktop app to Hari, keeping the old install for now.
- Files: [tauri.hari.conf.json](../../src-tauri/tauri.hari.conf.json), [hari-installer-hooks.nsh](../../src-tauri/windows/hari-installer-hooks.nsh)
- Commit: 01c4636e (in 0.16.0-local74)
- Verified: typecheck — (no TS change) lint — tests — build ✅ (`npm run build:windows` → `Hari_0.16.0-local43_x64-setup.exe`); install and update checks manual

## 2026-11-14 14:52 IST — Hari: the computer's notifications on the phone (L-275)
- Type: feature
- What: Hari now gets the same notifications as the bell on the computer: a reply is ready, an agent needs approval or has a question, an automation ran. A quiet "Watching your computer" entry keeps Hari checking in the background, so they show in the phone's notification panel even with Hari closed. Hari has a Notifications screen (in the drawer and on home): swipe one away, tap to open its chat, Mark all read, Clear all. Each of these changes the computer's bell too. Settings → Notifications on the phone turns background watching, automations, and chats that were open on the computer on or off.
- Why: Hari's alerts almost never arrived. The phone posted only while out of view but checked the computer only while in view. The user asked for always-on notifications that mirror the desktop panel, with swipe to dismiss and tap to open the chat, without a Live Update.
- Files: [notificationCenter.ts](../../src/features/notifications/model/notificationCenter.ts), [notifications.ts](../../src/features/notifications/model/notifications.ts), [NotificationBell.tsx](../../src/features/notifications/ui/NotificationBell.tsx), [mobileNotifications.ts](../../src/features/mobile/model/mobileNotifications.ts), [useMobileNotificationFeed.ts](../../src/features/mobile/hooks/useMobileNotificationFeed.ts), [mobile_notifications.rs](../../src-tauri/src/mobile_notifications.rs), [mobile_access.rs](../../src-tauri/src/mobile_access.rs), [lib.rs](../../src-tauri/src/lib.rs), [HariLive.kt](../../mobile/modules/hari-live/android/src/main/java/expo/modules/harilive/HariLive.kt), [HariLiveService.kt](../../mobile/modules/hari-live/android/src/main/java/expo/modules/harilive/HariLiveService.kt), [notificationFeed.ts](../../mobile/src/features/notifications/notificationFeed.ts), [NotificationFeedSync.tsx](../../mobile/src/features/notifications/NotificationFeedSync.tsx), [SessionNotifications.tsx](../../mobile/src/features/notifications/SessionNotifications.tsx), [notifications/index.tsx](../../mobile/src/app/notifications/index.tsx), [settings/index.tsx](../../mobile/src/app/settings/index.tsx)
- Commit: 01c4636e (in 0.16.0-local74)
- Verified: typecheck ✅ (desktop and mobile) lint ✅ (mobile; root has no config) tests ✅ Kotlin compile ✅ build — ; phone and desktop checks manual

## 2026-11-14 14:05 IST — Activity: sites start folded (L-282)
- Type: style
- What: In Activity → Sites, each website now shows only its time, a bar and how many tabs it had. Click a site to see its tab titles; click again to fold them.
- Why: The user asked for Sites to be collapsed by default; the tab titles made the column long.
- Files: [Breakdown.tsx](../../src/features/activity/ui/Breakdown.tsx)
- Commit: 01c4636e (in 0.16.0-local74)
- Verified: typecheck ✅ lint — (no config) tests — (no view tests) build —
- Renumbered: was L-274 until 2026-11-14 19:30, when the Aside link (published as L-274 in 0.16.0-local44) merged in.

## 2026-11-14 11:14 IST — Storage page: filter by date (L-273)
- Type: feature
- What: Settings → Storage has a "Saved" date filter: All time, Today, Last 7 days, Last 30 days, Older than 30 days, or Custom dates (one day, or a from–to range; leave one end empty for "before" or "since"). The groups, the "Showing N of M files" line and the delete buttons then cover only files saved in those dates, and the confirmation says so.
- Why: The user asked to filter by a single date or a from–to range before deleting.
- Files: [attachmentStorage.ts](../../src/features/settings/model/attachmentStorage.ts), [attachmentStorage.test.ts](../../src/features/settings/model/attachmentStorage.test.ts), [StorageSettings.tsx](../../src/features/settings/ui/StorageSettings.tsx), [attachment-storage-plan.md](../specs/attachment-storage-plan.md)
- Commit: 01c4636e (in 0.16.0-local74)
- Verified: typecheck ✅ tests ✅ (full suite 8180 passed) lint — (no config) build —

## 2026-11-14 10:59 IST — Settings → Storage: saved attachments (L-273)
- Type: feature
- What: A new Storage page in Settings shows every image and file you pasted into chats, plus the copies Interactive Claude read, with their total size. View them by chat, by project or all together, newest first, with the date and time on each. Click an image to see it full size; copy it, show it in its folder, open the chat it came from, or drag it onto a composer. Delete one file, everything in a chat or project, files no chat uses any more, or everything; each delete asks first and says the images will disappear from those chats.
- Why: MonoCode keeps every pasted file forever (about 220 MB on this computer) with no way to see or clean them up.
- Files: [attachment_storage.rs](../../src-tauri/src/attachment_storage.rs), [lib.rs](../../src-tauri/src/lib.rs), [attachmentStorage.ts](../../src/features/settings/model/attachmentStorage.ts), [StorageSettings.tsx](../../src/features/settings/ui/StorageSettings.tsx), [settings.ts](../../src/features/settings/model/settings.ts), [SettingsRail.tsx](../../src/app/shell/SettingsRail.tsx), [SettingsView.tsx](../../src/features/settings/ui/SettingsView.tsx), tests beside the model and in the Rust module
- Commit: 01c4636e (in 0.16.0-local74)
- Verified: typecheck ✅ cargo test ✅ (attachment_storage 3) cargo build ✅ tests ✅ (full suite after index fix; settings 515) lint — (no config) build —

## 2026-11-14 10:36 IST — MCP page shows each Claude account's servers (L-272)
- Type: feature
- What: Settings → MCP now lists the MCP servers saved in each Claude account MonoCode manages, beside the ones in your home Claude config. Each row shows which file it comes from. Turning a server on or off, or removing it, changes that account's own file.
- Why: The page only read the home config, but Claude chats in MonoCode run on an account config, so servers added there (like the Aside computer-use server) didn't show and couldn't be switched off.
- Files: [mcp.rs](../../src-tauri/src/mcp.rs), [controls.rs](../../src-tauri/src/mcp/controls.rs), [controls/tests.rs](../../src-tauri/src/mcp/controls/tests.rs), [harness.rs](../../src-tauri/src/harness.rs), [McpSettings.tsx](../../src/features/settings/ui/McpSettings.tsx)
- Commit: 01c4636e (in 0.16.0-local74)
- Verified: typecheck ✅ cargo test ✅ (mcp 39) cargo build ✅ tests ✅ (settings 511) lint — (no config) build —

## 2026-11-14 10:29 IST — Whiteboard sends images to Interactive Claude (L-271)
- Type: feature
- What: When a Whiteboard chat runs on Interactive Claude, the board snapshot and any pasted images now go to Claude, the same as other helpers that can see images. Claude opens those files without asking for approval, but any other file it tries to read still asks. Continue cards also now use only the models you picked in AI helper (part of L-269).
- Why: The user said Whiteboard with Interactive CLI couldn't take images, so it wasn't much use; and asked that Claude Code never run as a helper unless picked, for Continue cards too.
- Files: [whiteboardHelper.ts](../../src/integrations/harness/core/whiteboardHelper.ts), [claudeInteractiveHelper.ts](../../src/integrations/harness/providers/claude/claudeInteractiveHelper.ts), [claudeInteractive.ts](../../src/integrations/harness/providers/claude/claudeInteractive.ts), [WhiteboardChat.tsx](../../src/features/whiteboard/ui/WhiteboardChat.tsx), [continueHelper.ts](../../src/integrations/harness/core/continueHelper.ts), tests beside each
- Commit: 01c4636e (in 0.16.0-local74)
- Verified: typecheck ✅ lint — (no config) tests ✅ (harness + whiteboard 1553) build —

## 2026-11-14 10:03 IST — Interactive Claude takes PDFs (L-270)
- Type: feature
- What: You can now attach a PDF to an Interactive Claude chat. MonoCode saves it and Claude reads it with its own file tool. Word, Excel and other files Claude can't open still show an error.
- Why: The user asked why PDFs were refused when Interactive only hands Claude a file path anyway. Claude Code's Read tool reads PDFs.
- Files: [claude_interactive.rs](../../src-tauri/src/claude_interactive.rs)
- Commit: 01c4636e (in 0.16.0-local74)
- Verified: typecheck ✅ cargo test ✅ lint — (no config) build —

## 2026-11-14 10:03 IST — Helpers use only the models you picked (L-269)
- Type: fix
- What: With AI helper set to Choose a model, Session overview and Improve prompt now try only their own model, then the AI helper's main and backup models. If all of them fail, you see the reason instead of another provider (Claude Code, Gemini) quietly doing the work. Automatic still tries every installed provider.
- Why: The user picked Command Code and OpenCode for helpers, but a failing pick fell through to Claude Code or Gemini, spending their quota without asking.
- Files: [sessionMetadataHelper.ts](../../src/integrations/harness/core/sessionMetadataHelper.ts), [sessionMetadataHelper.test.ts](../../src/integrations/harness/core/sessionMetadataHelper.test.ts)
- Commit: 01c4636e (in 0.16.0-local74)
- Verified: typecheck ✅ lint — (no config) tests ✅ (helpers 397) build —

## 2026-11-14 09:50 IST — Hari: image attachments show as thumbnails (L-268)
- Type: fix
- What: In Hari, a message sent with images now shows small thumbnails instead of only "1 attachment". Tapping a thumbnail opens the image full screen. Other files show their name. The computer sends a smaller copy of the image only when the phone asks for it.
- Why: The user couldn't see or open what they had attached from the phone.
- Files: [mobileAttachmentPreview.ts](../../src/features/mobile/model/mobileAttachmentPreview.ts), [mobileWorkspace.ts](../../src/features/mobile/model/mobileWorkspace.ts), [useMobileWorkspace.ts](../../src/features/mobile/hooks/useMobileWorkspace.ts), [mobileTranscript.ts](../../src/features/mobile/model/mobileTranscript.ts), [mobile_access.rs](../../src-tauri/src/mobile_access.rs), [MessageAttachments.tsx](../../mobile/src/features/sessions/MessageAttachments.tsx), [attachmentImages.ts](../../mobile/src/features/sessions/attachmentImages.ts), [TranscriptTurn.tsx](../../mobile/src/features/sessions/TranscriptTurn.tsx)
- Commit: 01c4636e (in 0.16.0-local74)
- Verified: typecheck ✅ (desktop, Hari) lint ✅ (Hari) tests ✅ build —

## 2026-11-14 09:50 IST — Tool commands unfold on click (L-267)
- Type: feature
- What: A long command in a finished tool row still shows on one line, but hovering shows it in full and clicking unfolds it onto several lines. Clicking again folds it.
- Why: The user saw tool commands always cut off. One line keeps the activity list even and easy to scan, so unfolding is on demand.
- Files: [AgentTranscript.tsx](../../src/features/sessions/ui/AgentTranscript.tsx), [AgentTranscript.toolWrap.test.ts](../../src/features/sessions/ui/AgentTranscript.toolWrap.test.ts)
- Commit: 01c4636e (in 0.16.0-local74)
- Verified: typecheck ✅ lint — (no config) tests ✅ build —

## 2026-11-14 09:50 IST — Interactive Claude: per-chat Reasoning shown (L-266)
- Type: feature
- What: The model picker's Interactive section has a "Reasoning shown" choice: Off, Highlights or Summaries (default). Changing it restarts Claude for that chat with the new setting.
- Why: The user asked for Claude Code's thinking display setting inside chats. Summaries do not cost extra tokens.
- Files: [claude_interactive.rs](../../src-tauri/src/claude_interactive.rs), [models.ts](../../src/features/sessions/model/models.ts), [claudeInteractive.ts](../../src/integrations/harness/providers/claude/claudeInteractive.ts), [ModelPicker.tsx](../../src/features/sessions/ui/ModelPicker.tsx)
- Commit: 01c4636e (in 0.16.0-local74)
- Verified: typecheck ✅ cargo check ✅ lint — (no config) tests ✅ build —

## 2026-11-14 09:13 IST — Interactive Claude shows auto-compaction and background tasks (L-265)
- Type: fix
- What: In Interactive Claude sessions, an automatic compaction now shows "Compacting context…" and then "Compacted context", so the chat no longer looks stuck. Background tasks Claude leaves running after a reply (Monitor, background commands) now show as "1 task running in background · <name>" under the chat until they finish or the session is stopped.
- Why: The user saw Interactive Claude look frozen during auto-compaction and lose track of background tasks once a turn ended. Interactive received both hooks but showed nothing for them. A terminal window stealing focus while typing was traced to open Claude Code CLI issues, not MonoCode, so no change was made for it.
- Files: [claudeInteractive.ts](../../src/integrations/harness/providers/claude/claudeInteractive.ts), [claudeInteractive.test.ts](../../src/integrations/harness/providers/claude/claudeInteractive.test.ts), [AgentTranscript.tsx](../../src/features/sessions/ui/AgentTranscript.tsx), [AgentTranscript.background.test.ts](../../src/features/sessions/ui/AgentTranscript.background.test.ts)
- Commit: 01c4636e (in 0.16.0-local74)
- Verified: typecheck ✅ lint — (no config) tests ✅ build —

## 2026-11-14 06:17 IST — Aside's Ask Aside panel can use MonoCode's CLIs (L-274)
- Type: feature
- What: MonoCode can now answer Aside's "Ask Aside" side panel. Turn it on in Settings → Connections → Aside browser and press "Add models to Aside"; Aside then lists "Hari · Claude", "Hari · Command Code" and "Hari · Antigravity" models. Each Aside chat runs here as a conversation in a pinned project named CLI, streams its reply (and tool steps as thinking) back to Aside, follows Aside's Reasoning setting, and stops when Aside stops. Aside's chat titles and memory requests are answered locally without running a model.
- Why: The user wanted Ask Aside to use the Claude Code, Command Code and Antigravity subscriptions they already run in MonoCode instead of Aside's own providers, and to see those chats in MonoCode.
- Files: [aside_link.rs](../../src-tauri/src/aside_link.rs), [lib.rs](../../src-tauri/src/lib.rs), [aside-link](../../src/features/aside-link), [App.tsx](../../src/app/App.tsx), [SettingsView.tsx](../../src/features/settings/ui/SettingsView.tsx), [settings.ts](../../src/features/settings/model/settings.ts), [aside-link-plan.md](../specs/aside-link-plan.md)
- Commit: 01c4636e (in 0.16.0-local74)
- Verified: typecheck ✅ lint — (no config) tests ✅ (vitest 8173) cargo test aside_link ✅ (7) build —

## 2026-11-14 08:10 IST — Zen: Settings button in the top bar (L-264)
- Type: feature
- What: Zen's top-right buttons now include Settings (a gear, after Keep on top). Clicking it leaves Zen, waits for the window to grow back to full size, then opens Settings.
- Why: The user asked for a Settings button in Zen. Settings is a full page that Zen's narrow panel can't hold, so it opens in the normal window, like Focus mode's Settings button.
- Files: [ZenView.tsx](../../src/features/zen/ui/ZenView.tsx), [App.tsx](../../src/app/App.tsx), [ZenView.test.ts](../../src/features/zen/ui/ZenView.test.ts)
- Commit: 01c4636e (in 0.16.0-local74)
- Verified: typecheck ✅ lint — (no config) tests ✅ (zen 34) build —

## 2026-11-13 22:51 IST — Settings model dropdowns show Free and locked models (L-263)
- Type: fix
- What: The model dropdowns in Settings (AI helper, Improve prompt, Session overview and each provider's default model) now show the Free pill and a lock like the chat picker does. Locked models are greyed, say why on hover (e.g. "Locked: Needs Goat plan") and can't be picked.
- Why: The user saw no Free badge and no lock in the Command Code model list. The chat picker had them since L-259, but the Settings dropdowns built their options from the model name only and dropped both.
- Files: [ModelBadges.tsx](../../src/features/sessions/ui/ModelBadges.tsx), [SelectMenu.tsx](../../src/features/sessions/ui/SelectMenu.tsx), [SettingsView.tsx](../../src/features/settings/ui/SettingsView.tsx), [modelOptionMarks.test.ts](../../src/features/sessions/ui/modelOptionMarks.test.ts)
- Commit: 01c4636e (in 0.16.0-local74)
- Verified: typecheck ✅ lint — (no config) tests ✅ (settings, sessions, prompt-improve: 2606) build —

## 2026-11-13 22:45 IST — Improve prompt says why it used another helper (L-262)
- Type: fix
- What: When the AI helper chosen for Improve prompt fails and another one writes the rewrite, the strip now says so, e.g. "Rewritten by Gemini · Command Code tried a tool", with the full reason on hover. A chosen helper that is not available is named too, and each failure is logged to the developer console with the provider's own error.
- Why: The user picked Command Code (Muse Ember) for Improve prompt but Gemini wrote the rewrite with no explanation. The helper code works against the real CLI in tests, so the in-app failure could not be reproduced; this makes its reason visible.
- Files: [promptImproveHelper.ts](../../src/integrations/harness/core/promptImproveHelper.ts), [usePromptImprove.ts](../../src/features/prompt-improve/ui/usePromptImprove.ts), [PromptImproveControls.tsx](../../src/features/prompt-improve/ui/PromptImproveControls.tsx), tests
- Commit: 01c4636e (in 0.16.0-local74)
- Verified: typecheck ✅ lint — (no config) tests ✅ (prompt-improve 69) build —

## 2026-11-12 16:33 IST — Command Code headless with every model; Free and locked models; copy and drag of sent images (L-258 to L-261)
- Type: feature
- What: Command Code chats now run the CLI directly for each message and continue the same conversation, so the model picker lists every model the Go plan can use (Muse Ember included). Models from other plans show greyed with a lock and a reason ("Needs Pro plan", "Pay per use") and can't be picked; free models carry a Free pill. Access is Read only or Full access; Plan never edits. Copying a sent message now includes its images after a restart, and a sent image or file can be dragged onto any chat's composer to attach it again.
- Why: The user is on Command Code's Go plan and wanted every usable model (the old ACP connection listed fewer), locked plan and pay-per-use models, Free badges, a fix for copying images after a restart, and dragging images inside MonoCode. Supervised approvals are not used, so print mode's lack of approval prompts is fine.
- Files: [commandCode.ts](src/integrations/harness/providers/command-code/commandCode.ts), [commandCodeProtocol.ts](src/integrations/harness/providers/command-code/commandCodeProtocol.ts), [commandCodeCatalog.ts](src/integrations/harness/providers/command-code/commandCodeCatalog.ts), [command_code.rs](src-tauri/src/command_code.rs), [harness.rs](src-tauri/src/harness.rs), [lib.rs](src-tauri/src/lib.rs), [child-backend.ts](host/child-backend.ts), [child.ts](src/integrations/harness/core/child.ts), [models.ts](src/features/sessions/model/models.ts), [session.ts](src/features/sessions/model/session.ts), [ModelBadges.tsx](src/features/sessions/ui/ModelBadges.tsx), [ModelPicker.tsx](src/features/sessions/ui/ModelPicker.tsx), [QuickModelSelector.tsx](src/features/quick-composer/ui/QuickModelSelector.tsx), [clipboard.ts](src/platform/tauri/clipboard.ts), [usePathPointerDrag.ts](src/features/sessions/hooks/usePathPointerDrag.ts), [AttachmentChip.tsx](src/features/sessions/ui/AttachmentChip.tsx), [WhiteboardChat.tsx](src/features/whiteboard/ui/WhiteboardChat.tsx); tests `commandCodeProtocol.test.ts`, `commandCodeLive.test.ts`, `commandCodeCatalog.test.ts`, `clipboard.test.ts`; spec [command-code-plan.md](docs/specs/command-code-plan.md)
- Commit: 01c4636e (in 0.16.0-local74)
- Verified: typecheck ✅ tests ✅ (full suite 8143 passed; iconCatalog timed out under load, passes alone) cargo test (targeted) ✅ rustfmt ✅ lint — (no config); desktop check manual

## 2026-11-12 11:26 IST — Fix older images going blank in long chats (L-257)
- Type: fix
- What: In a chat with many images, the older ones showed as broken thumbnails and opened to an empty full-screen view, though the files were still on disk. They now stay visible.
- Why: The user asked why past images in an Interactive Claude chat could not be seen. Images saved only as a path are loaded into a short-lived link, and at most 50 are kept; past 50 the oldest link was thrown away even while its image was still on screen. That chat had 60 images. Images now keep their link while they are shown. Every chat type had the bug, not only Interactive Claude.
- Files: [attachments.ts (lines 255–299)](src/features/sessions/model/attachments.ts:255), [AttachmentChip.tsx (lines 13–16, 34–46)](src/features/sessions/ui/AttachmentChip.tsx:13), [WhiteboardChat.tsx (lines 15–22, 96–108)](src/features/whiteboard/ui/WhiteboardChat.tsx:96), [attachments.test.ts (lines 290–325)](src/features/sessions/model/attachments.test.ts:290)
- Commit: 01c4636e (in 0.16.0-local74)
- Verified: typecheck ✅ tests ✅ (sessions + whiteboard 2079/2079; the new test fails without the fix) lint — (no config) desktop check manual

## 2026-11-12 11:21 IST — Fix Command Code shown as "not found" in Settings
- Type: fix
- What: Settings → Providers said Command Code CLI (cmdc) was not found, though it was installed and logged in and chats with it worked. The availability check now finds `cmdc` like every other provider.
- Why: The check (`harness_probe_provider`) had its own list of providers and Command Code was missing from it, so it answered "Unknown harness provider" and the pane showed the install hint. Chats used a different lookup, which is why they worked. Part of L-255.
- Files: [harness.rs (lines 1002–1007, test 2300–2318)](src-tauri/src/harness.rs:1002)
- Commit: 01c4636e (in 0.16.0-local74)
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
- Commit: 01c4636e (in 0.16.0-local74)
- Verified: typecheck ✅ vitest focus + zen 121/121 ✅ lint — (no ESLint config in the repo); desktop check manual

## 2026-11-12 10:02 IST — Command Code as a provider and AI helper (L-255)
- Type: feature
- What: Command Code (`cmdc`) is a new provider. In the model picker it lists the account's models (its current one first), Effort, and works with every access level and Plan, approvals, cancel and resume after a restart. Settings → AI helper can use it for Session overview, Improve prompt and Continue; those replies run in Plan mode in an empty folder and fail if it tries to use a tool. If `cmdc` isn't installed, the message says how to install it and sign in. Chats and helper tasks on Command Code send their text to Command Code's servers.
- Why: The user bought a Command Code subscription and asked to use it like the other providers and as the AI helper.
- Files: [commandCode.ts (line 78)](src/integrations/harness/providers/command-code/commandCode.ts:78), [commandCodeProtocol.ts](src/integrations/harness/providers/command-code/commandCodeProtocol.ts), [commandCodeCatalog.ts](src/integrations/harness/providers/command-code/commandCodeCatalog.ts), [commandCodeHelper.ts](src/integrations/harness/providers/command-code/commandCodeHelper.ts), [commandCodeAdapter.ts](src/integrations/harness/providers/command-code/commandCodeAdapter.ts), [session.ts (line 36)](src/features/sessions/model/session.ts:36), [settings.ts (line 1122)](src/features/settings/model/settings.ts:1122), [helperIsolation.ts (line 20)](src/integrations/harness/core/helperIsolation.ts:20), [HarnessIcon.tsx (line 165)](src/features/sessions/ui/HarnessIcon.tsx:165), [command-code.svg](src/assets/providers/command-code.svg), [harness.rs (lines 1036, 3598)](src-tauri/src/harness.rs:1036), [command_code.rs](src-tauri/src/command_code.rs), plus `models.ts`, `availability.ts`, `availabilityState.ts`, `child.ts`, `cliVersions.ts`, `register.ts`, `providerBinaryPaths.ts`, `lib.rs`; spec [command-code-plan.md](docs/specs/command-code-plan.md)
- Commit: 01c4636e (in 0.16.0-local74)
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
- Commit: 01c4636e (in 0.16.0-local74)
- Verified: mobile typecheck ✅ lint ✅ nativePermissions 6/6 ✅; the Version job's `node -e "require('./mobile/app.config.js')..."` runs locally ✅

## 2026-11-12 01:12 IST — Hari: Live Updates can start; the APK keeps the foreground-service permission (L-254)
- Type: fix
- What: Turning on Live Updates in Hari showed "Live Updates turned off … requires android.permission.FOREGROUND_SERVICE" and the running-session card never appeared. The phone app was built without the permission Android needs for that card. It now has it, so the card can show on the status bar and lock screen.
- Why: The user sent the phone notice and asked what it meant. Upstream's phone app blocks that permission (it plays no background audio), and the block also removed the one Hari's Live Update module asks for.
- Files: [app.config.js (blockedPermissions, permissions, plugin)](mobile/app.config.js:36), [with-live-update-permissions.js](mobile/plugins/with-live-update-permissions.js), [nativePermissions.test.ts (Live Update test)](mobile/tests/nativePermissions.test.ts:86)
- Commit: 01c4636e (in 0.16.0-local74)
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
- Commit: 01c4636e (in 0.16.0-local74)
- Verified: tsc ✅ · vitest activity ✅ 26/26 · desktop check manual

## 2026-11-12 00:03 IST — Improve prompt: rewrite animation and a Stop button (L-252)
- Type: feature
- What: The rewrite now appears with the same animation as a changed chat title: the new text sweeps in from left to right while your draft breaks into particles (skipped with reduced motion). While a rewrite runs, a **Stop** button shows in the strip above the text and the ✨ button shows a stop square; either one (or Esc) ends it and keeps your text.
- Why: The user asked to reuse the title-change animation and asked for a way to stop a slow or stuck rewrite.
- Files: [RewriteReveal.tsx](src/features/prompt-improve/ui/RewriteReveal.tsx) (copy of upstream `ParticleText`, so it stays untouched), [usePromptImprove.ts (reveal)](src/features/prompt-improve/ui/usePromptImprove.ts:143), [PromptImproveControls.tsx (Stop)](src/features/prompt-improve/ui/PromptImproveControls.tsx:236), [Composer.tsx](src/features/sessions/ui/Composer.tsx:2669), [QuickComposer.tsx](src/features/quick-composer/ui/QuickComposer.tsx:1020), [RewriteReveal.test.ts](src/features/prompt-improve/ui/RewriteReveal.test.ts), [usePromptImprove.test.ts](src/features/prompt-improve/ui/usePromptImprove.test.ts)
- Commit: 01c4636e (in 0.16.0-local74)
- Verified: tsc ✅ · vitest prompt-improve, helper, quick-composer, sessions/ui, settings ✅ 1503/1503 · prettier on new files and changed hunks ✅ · desktop check manual

## 2026-11-11 23:48 IST — Improve prompt: ✨ rewrites a rough draft into a clear prompt (L-252)
- Type: feature
- What: A ✨ button next to Send (or Ctrl+Alt+I) rewrites the draft in place into a clear, complete prompt that keeps every request, file path, mention, ID and a leading /command. **Original** switches back and forth (hold to peek), **Restore original** returns the first draft, and typing during a run keeps your text and offers **Use rewrite**; Esc cancels. It learns a "How I write" profile and a per-project glossary on this computer from rewrites you send or edit, and offers **Add to AGENTS.md** for a rule you state in 3 prompts. Settings → Chat has Improve prompt (model, effort, instructions with Reset) and How I write (profile, glossaries, Forget, Clear memory). Works in the chat composer and the Session board draft modal; hidden in remote-host chats; not in the floating quick composer or Hari yet.
- Why: The user asked for it after the prompting review: short, mixed-language drafts made agents miss or guess requests.
- Files: [promptImprove.ts](src/features/prompt-improve/model/promptImprove.ts), [promptImproveStore.ts](src/features/prompt-improve/model/promptImproveStore.ts), [agentsRule.ts](src/features/prompt-improve/model/agentsRule.ts), [usePromptImprove.ts](src/features/prompt-improve/ui/usePromptImprove.ts), [PromptImproveControls.tsx](src/features/prompt-improve/ui/PromptImproveControls.tsx), [promptImproveHelper.ts](src/integrations/harness/core/promptImproveHelper.ts), [sessionMetadataHelper.ts (param type)](src/integrations/harness/core/sessionMetadataHelper.ts), [Composer.tsx (usePromptImprove)](src/features/sessions/ui/Composer.tsx:1239), [QuickComposer.tsx](src/features/quick-composer/ui/QuickComposer.tsx), [settings.ts (keybinding, index)](src/features/settings/model/settings.ts), [SettingsView.tsx (PromptImproveGroup, PromptMemoryGroup)](src/features/settings/ui/SettingsView.tsx), 5 new test files, [spec](docs/specs/improve-prompt-plan.md)
- Commit: 01c4636e (in 0.16.0-local74)
- Verified: tsc ✅ · vitest prompt-improve + helper ✅ 66/66 · quick-composer, sessions/ui Composer, settings, skills, session-todos, promptPreparation ✅ 860/860 · prettier on new files and changed hunks ✅ · no lint config in the repo · desktop check manual

## 2026-11-11 23:20 IST — Interactive Claude: skills Claude Code already has are no longer pasted in whole (L-251)
- Type: fix
- What: Using a `/skill` in an Interactive Claude chat pasted the skill's full text into the message each time. For skills Claude Code loads itself (`.claude/skills` and plugin skills), MonoCode now sends one line asking Claude to load the skill with its Skill tool, with the file path as a fallback. Other skills are still sent in full; Structured Claude is unchanged.
- Why: Found during the prompting review (7 skill uses in two chats added about 123k characters and brought compaction sooner); the user asked to fix it.
- Files: [skills.ts (SkillTurnOptions, applySkillsToTurn)](src/features/skills/model/skills.ts:440), [promptPreparation.ts](src/features/sessions/model/promptPreparation.ts:12), [App.tsx (3 send paths)](src/app/App.tsx:9617), [skillCatalog.test.ts](src/features/skills/model/skillCatalog.test.ts:557), [promptPreparation.test.ts](src/features/sessions/model/promptPreparation.test.ts:85)
- Commit: 01c4636e (in 0.16.0-local74)
- Verified: tsc ✅ · vitest skills + promptPreparation ✅ 83/83 · new test fails without the fix · the old `preparePrompt` test now also expects the new options argument · desktop check manual

## 2026-11-11 23:13 IST — Interactive Claude: multi-line messages no longer fold into "[Pasted text]" (L-250)
- Type: fix
- What: In Interactive Claude, a message of 3+ lines turned into a "[Pasted text #1 +N lines]" pill, and Claude passed it to the model as quoted material the user "did not write", so the model could ignore instructions in it. MonoCode now pastes each message as several small pieces, which Claude inserts as plain typed text. Very long messages (about 240+ lines) still fold.
- Why: Found during the prompting review; the user asked to fix it. Cause: Claude folds any single paste over 800 characters or 2 line breaks, and MonoCode sent everything after the first letter as one paste.
- Files: [interactive_delivery.rs (chunks, payload)](src-tauri/src/interactive_delivery.rs:22), [interactive-pty-host.py (chunks)](src/integrations/harness/providers/claude/fixtures/interactive-pty-host.py:51), [claudeInteractiveCli.test.ts (fold check)](src/integrations/harness/providers/claude/claudeInteractiveCli.test.ts:673)
- Commit: 01c4636e (in 0.16.0-local74)
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
- Commit: 01c4636e (in 0.16.0-local74)
- Verified: tsc ✅ expo lint ✅ (0 errors; 2 old warnings) vitest ✅ 245/245 (`../tests/mobile/watchFrames.test.ts` fails to load, pre-existing) · the old skip/"2 of 2" test was rewritten for the new design · phone check manual

## 2026-11-11 18:31 IST — Hari: reopened long chats no longer spin until you scroll (L-248)
- Type: fix
- What: Reopening a chat with long messages showed blank, then a spinner that kept going until you scrolled. The chat now goes straight to its newest messages.
- Why: Report on local36 with a screenshot. Cause: the desktop sends the latest 30 turns, the list draws only its first 25 on opening, so the newest rows were never drawn and the chat waited for them forever. It now scrolls to the end once when that happens, which draws them.
- Files: [Transcript.tsx (INITIAL_ROWS, update)](mobile/src/features/sessions/Transcript.tsx:263), [Transcript.test.tsx](mobile/tests/Transcript.test.tsx)
- Commit: 01c4636e (in 0.16.0-local74)
- Verified: tsc ✅ expo lint ✅ (0 errors; 2 old warnings) vitest ✅ 245/245 (watchFrames load failure pre-existing) · new test fails without the fix · phone check manual

## 2026-11-11 17:01 IST — Hari: Live Updates no longer close the app (L-247)
- Type: fix
- What: With Live Updates on and sessions running, Hari closed on every launch until the sessions ended. Now, if the running-session card can't be shown, Hari turns Live Updates off and the notice says Android's reason, instead of closing.
- Why: Report on local36 with the Xiaomi crash report: `ForegroundServiceDidNotStartInTimeException` from `HariLive.start`. `startForegroundService` lets Android close the app if the service doesn't reach the foreground in time, past any try/catch. The service is now started plainly and goes to the foreground itself, or stops.
- Files: [HariLive.kt](mobile/modules/hari-live/android/src/main/java/expo/modules/harilive/HariLive.kt), [HariLiveService.kt](mobile/modules/hari-live/android/src/main/java/expo/modules/harilive/HariLiveService.kt), [LiveUpdates.tsx](mobile/src/features/liveUpdates/LiveUpdates.tsx), [liveService.test.ts](mobile/tests/liveService.test.ts)
- Commit: 01c4636e (in 0.16.0-local74)
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
- Commit: 01c4636e (in 0.16.0-local74)
- Verified: tsc ✅ expo lint ✅ (0 errors; 2 old warnings) vitest ✅ 241/241 (`../tests/mobile/watchFrames.test.ts` fails to load, pre-existing) · both new tests fail without their change · phone check manual

## 2026-11-11 10:22 IST — Hari look fixes: wallpaper edge to edge, accent switches, readable text (L-245)
- Type: fix
- What: On the phone, the wallpaper now shows under the header, the composer and the navigation bar instead of plain strips; switches and sliders are wholly in the accent colour; text over a wallpaper is easier to read (stronger default dim, darker grey text in light mode); the transcript no longer shows through the composer when photos are attached or a draft is long.
- Why: Feedback on local35: top and bottom looked bad, switches had a green thumb, light mode was hard to read, and typed text sat over chat text.
- Files: [Backdrop.tsx](mobile/src/features/wallpaper/Backdrop.tsx), [GradualBlur.tsx](mobile/src/ui/GradualBlur.tsx), [SessionScreen.tsx](mobile/src/features/sessions/SessionScreen.tsx), [_layout.tsx](mobile/src/app/_layout.tsx), [reading.ts](mobile/src/features/wallpaper/reading.ts), [wallpaper.ts](mobile/src/features/wallpaper/wallpaper.ts), [theme.ts](mobile/src/ui/theme.ts), [AccentSwitch.tsx](mobile/src/ui/AccentSwitch.tsx), [appearance.tsx](mobile/src/app/settings/appearance.tsx), settings index/models and ModelPicker (switch swap), [systemBars.ts](mobile/src/ui/systemBars.ts), [hari-system-bars module](mobile/modules/hari-system-bars), [with-system-bars.js](mobile/plugins/with-system-bars.js), [app.config.js](mobile/app.config.js), tests (look, SessionScreen)
- Commit: 01c4636e (in 0.16.0-local74)
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
- Commit: 01c4636e (in 0.16.0-local74)
- Note: the wallpaper is softened once by the image view (no live blur), so screens slide as cheaply as with a photo. Code, diffs and bottom sheets stay solid. No reduce-transparency fallback: React Native has no Android API for it.
- Verified: mobile tsc ✅, expo lint ✅ (2 old warnings in dictation.ts), vitest ✅ 237/237 (`tests/mobile/watchFrames.test.ts` fails to load as before, unrelated); Kotlin built in CI; phone check manual

## 2026-11-11 08:22 IST — Hari running-project row height; Notes listener rejections
- Type: fix
- What: In the Hari side menu, a project with running chats no longer sits taller than the other projects (its row is now 52dp like the rest). On the desktop, Notes no longer leaves an unhandled error behind when it listens for notes saved from the phone outside the app (tests showed "transformCallback" errors).
- Why: User report (screenshot of the running card's extra padding) and question about the Notes test errors.
- Files: [WorkspaceDrawer.tsx (lines 758–761)](mobile/src/features/workspace/WorkspaceDrawer.tsx:758), [NotesView.tsx (lines 196–204)](src/features/notes/ui/NotesView.tsx:196)
- Commit: 01c4636e (in 0.16.0-local74)
- Verified: mobile tsc ✅ expo lint ✅; root tsc ✅; vitest notes 65 ✅

## 2026-11-11 07:49 IST — Remove Antigravity ACP (L-244)
- Type: refactor
- What: Antigravity through Google's ACP runtime (`agy_acp_server`) is gone from the desktop app, the phone app and the remote host: its provider, Providers setup panel, models, MCP rows, AI-helper option and settings. Antigravity CLI (`agy`) stays and is unchanged. Imported Antigravity conversations now open in Antigravity CLI.
- Why: User request (chose to remove it completely, including the `antigravity` id). The ACP runtime started a large tree of MCP servers and was no longer used.
- Files: deleted `src-tauri/src/antigravity_acp.rs`, `src/integrations/harness/core/antigravity*.ts`, `AntigravitySetupPanel.tsx`, `host/antigravity.ts`, `host/antigravity-browser.mjs`; [antigravity_cli.rs](src-tauri/src/antigravity_cli.rs) (`antigravity_helper_directory` moved here), [harness.rs](src-tauri/src/harness.rs), [mcp.rs](src-tauri/src/mcp.rs), [controls.rs](src-tauri/src/mcp/controls.rs), [lib.rs](src-tauri/src/lib.rs), [main.rs](src-tauri/src/main.rs), [session.ts](src/features/sessions/model/session.ts), [sessionImport.ts](src/integrations/harness/core/sessionImport.ts), [ModelPicker.tsx](src/features/sessions/ui/ModelPicker.tsx), [SettingsView.tsx](src/features/settings/ui/SettingsView.tsx), [McpSettings.tsx](src/features/settings/ui/McpSettings.tsx), [providers.ts](host/providers.ts), [server.ts](host/server.ts), [types.ts](mobile/src/features/workspace/types.ts) and their tests; [spec](docs/specs/remove-antigravity-acp.md)
- Commit: 01c4636e (in 0.16.0-local74)
- Note: a remote host only lists harnesses the desktop knows, so remote Antigravity ACP is gone too. An `agy_acp_server` tree that is already running is not stopped; end it from the process monitor.
- Verified: root tsc ✅, vitest ✅ (740 files, 8037 passed); host tsc ✅, host vitest ✅ (103 passed); mobile tsc ✅, expo lint ✅; cargo test --lib ✅ except 2 pre-existing macOS-only `fs` tests (`/opt/homebrew/bin`); clippy no new warnings; rustfmt clean on changed lines; no root ESLint config (web lint = tsc); desktop check manual

## 2026-11-11 07:22 IST — Hari Tasks: Focus a task and Carry over (L-243)
- Type: feature
- What: On the phone, tapping a task shows a "Focus today" chip that pins it to today's Focus (tap "In Focus" to unpin). With Focus on, a bar lists how many unfinished tasks are left from an earlier day's Focus, and its Carry over button pins them to today, like the desktop.
- Why: User request: put a task in Focus from the phone, and the desktop's Carry over button.
- Files: [mobile_tools.rs](src-tauri/src/mobile_tools.rs) (`tasks.update` takes `focusDate` + `today`, `focus_change`, new test), [tools.ts](mobile/src/features/tools/tools.ts) (`updateTask`, `carryOverTasks`), [tasks/index.tsx](mobile/src/app/tasks/index.tsx) (`focusTasks`, Focus chip, Carry over bar), [tools.test.ts](mobile/tests/tools.test.ts), [LOCAL-FEATURES.md](docs/LOCAL-FEATURES.md), [spec](docs/specs/hari-sidebar-tasks-live-fixes-plan.md)
- Commit: 01c4636e (in 0.16.0-local74)
- Note: needs the desktop from this release; an older desktop leaves the task as it was and the phone asks to update MonoCode.
- Verified: cargo test mobile_tools ✅ (4/4); mobile tsc ✅, expo lint ✅, vitest tools ✅ (18/18; full run 230/230, `tests/mobile/watchFrames.test.ts` fails to load as before, unrelated); phone check manual

## 2026-11-11 01:16 IST — Interactive Claude forks show their replies again (L-242)
- Type: fix
- What: A chat forked in Interactive Claude (also when forked onto another Claude account) now shows Claude's replies and finishes its turn. Before, the chat stayed empty while the terminal had the full reply.
- Why: User report. Claude 2.1.322 creates the forked conversation file about half a second after it reports the first prompt; MonoCode looked for the file only at that moment, never found it, and kept skipping the transcript for the whole chat.
- Files: [claude_interactive.rs](src-tauri/src/claude_interactive.rs) (`fork_since`, `handle_hook`, `claude_interactive_poll`, `fork_turn_offset`, new test), [LOCAL-FEATURES.md](docs/LOCAL-FEATURES.md)
- Commit: 01c4636e (in 0.16.0-local74)
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

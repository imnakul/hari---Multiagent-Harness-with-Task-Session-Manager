# Progress — Share chat, PC control, usage and file browsing (L-290 to L-297)

Created: 2026-11-15 02:10 IST. Branch `nakul/windows-support-upstream-0.16.0`, base `fc6dbc6c`
(0.16.0-local46). One agent, overnight, release `0.16.0-local47` at the end (user asked: "push new
release build on github for both mobile and Desktop app … Hibernate PC after u r done").

Decisions came from two Discuss rounds (session 9d4155c2, 2026-11-15 ~01:10 IST, and this session).
They override the earlier "no commits until tested on Hari Dev": the user asked for a release tonight.

## Idea

1. **Share becomes a WhatsApp-style chat** on both devices: pictures keep their shape, links show
   previews, text is Markdown, files wait in the box until Send and go as one group, messages can be
   pinned (bar at the top) and saved (never roll off), storage per device and Delete all.
2. **Desktop:** Share leaves the sidebar and the full view; the title-bar phone button (also in Zen) opens a
   right slide-in panel (Monos panel frame). "Send to Share" in right-click menus.
3. **Phone:** side-menu row renamed Share; composer lag fixed; Control tab gains Mic, Camera, Bluetooth,
   Media (now playing, play/pause, volume, output device) and Hibernate on idle; Lock removed; Apps and
   Running apps fold (closed by default, animated); actions show a spinner; Network on one line.
4. **Usage:** Command Code usage (5-hour, weekly, monthly) on the desktop bottom bar and the phone; phone
   Settings → Usage lists every enabled provider and account with refresh.
5. **Files:** up to 1 GB with resume and a space check; from the computer, files over 10 MB wait for a
   Download tap. Browse the PC's drives from the phone (download); browse the phone's storage from the PC.
6. **Hibernate on idle** from the phone and the desktop: once no MonoCode session has been working for
   2 minutes (waiting for approval counts as idle), the PC hibernates.

## Locked decisions

- Pins and saves sync to both devices. Pinned messages: a bar at the top; tap to jump, steps through pins.
- Full Share view removed; desktop Share is only the side panel (drag wider).
- Delete all keeps pinned and saved messages (no tick box); those are removed one by one.
- Files up to 1 GB, with resume, a space check and the existing progress ring.
- From the computer, files over 10 MB wait for a tap (Download); smaller ones arrive automatically.
  Phone → computer stays automatic.
- System-tray apps: left out ("leave them").
- Bluetooth: on/off and paired devices with connected state; no Connect button (no public API).
  Choosing headphones as the sound output is in Media.
- Camera: flips Windows' "Let apps access your camera" privacy switch (per user). Apps that already hold
  the camera may keep it until they close it.
- Everything at once (4-B), including phone browsing from the PC.
- Hibernate on idle also on the desktop.
- Phone actions on Apps / Running apps show the existing spinner beside the row until done.

## Plan (by area)

### A. Share protocol (Rust `mobile_share.rs`, phone `share/`)

- **One id per message on both sides.** Phone text sends carry `entryId` (its outbox id); the computer
  uses it when valid. Files already share `fileId`.
- **Groups:** a send of several files/pictures (+ caption) gets one `groupId` on every item; the caption is
  a text item with the same `groupId`. Bubbles group consecutive items with one `groupId`.
- **Meta items** on the same `share` channel: `{ type: "meta", action: "pin"|"unpin"|"save"|"unsave"|
  "remove"|"clear", ids?: [] }`. Applied on receipt, never shown. `clear` = Delete all on the other side.
- **Rollover:** at 100 entries the oldest *unpinned, unsaved* go first.
- **1 GB:** `MAX_FILE_BYTES` 1 GiB. Upload resume: a retry first asks `share.uploadStatus` → `received`
  and continues from there (the part file stays 24 h). Download resume: the phone keeps its partial file
  and continues from its size. Space check before receiving (Rust `fs2`-free: `GetDiskFreeSpaceExW`;
  phone: `Paths.availableDiskSpace`).
- **Tap to download:** the phone auto-fetches offers ≤ 10 MB; bigger stay `offered` with a Download button.
- **Storage:** each device counts its history JSON + files it received into its own Downloads/Hari folder
  still listed in the history. Delete all removes unpinned, unsaved entries and their received files on
  this device, then sends `clear` so the other device does the same.

### B. Desktop Share UI

- Remove the `share` app view (sidebar item, rail, title-bar tab, `ShareView` page). Title-bar phone button
  toggles `SharePanel` (right slide-in, `MonoSidebar`-style frame, resizable, close button). Zen gets the
  button; there the panel overlays.
- Bubbles: WhatsApp look — pictures keep aspect ratio (max 280 wide / 360 tall), time inside the corner,
  thin edge, Markdown via the chat renderer, link cards (L-119), copy icon always visible below, faint ×
  on hover, one way to open (click the picture/file), Show in folder as an icon; pin/save in a small menu.
- Composer: attachments wait as thumbnails with ×; Send sends them as one group with the text as caption;
  "Send and open there" for a link.
- Pinned bar at the top, Saved filter, storage line + Delete all in the header menu.
- "Send to Share" in the chat selection context menu, link/image menus and the Browser's context menu
  (background send + toast).

### C. Phone Share UI

- Side menu row "Share" (tabs Share | Control stay). Bubbles: aspect-ratio pictures, grouped grid, Markdown
  (existing renderer), link cards (asks the computer, like chat replies), pin bar, Saved filter, storage +
  Delete all, Download button for big offers, attach-then-send group, Send and open there.
- Composer lag: uncontrolled input (session composer), measuring stops once clearly multi-line.

### D. Phone Control tab (`pc/`), desktop `mobile_pc.rs`

- Spinner beside an app row while its action runs; Network stat on one line; Apps and Running apps fold
  (closed by default, chevron, ~200 ms height animation, count in the header); Lock removed.
- `pc.audio`: mic mute get/set (Core Audio `IAudioEndpointVolume` on the default capture device),
  speaker volume/mute, output devices list + set default (`IPolicyConfig`).
- `pc.media`: now playing (GSMTC: title, artist, app, playing) and play/pause/next/previous.
- `pc.camera`: get/set the per-user privacy switch (HKCU `CapabilityAccessManager\ConsentStore\webcam`).
- `pc.bluetooth`: radio state get/set (`Windows.Devices.Radios`), paired devices with connected state.
- `pc.idleHibernate`: get/arm/disarm; the desktop watches sessions (no session `working` for 2 min →
  30 s notice → hibernate; one-shot). Desktop bottom bar toggle too.

### E. Usage

- Command Code: Rust reads `~/.commandcode/auth.json` `apiKey`, calls the CLI's own endpoints
  (`/alpha/usage/summary`, `/alpha/billing/subscriptions`, `/alpha/billing/credits`, base
  `https://api.commandcode.ai` as the CLI does), returns 5-hour / weekly / monthly percent and resets.
  The key never leaves the PC. Shown as a chip in the bottom bar and in the phone's usage.
- Phone Settings → Usage: every enabled provider and account (from the desktop's `usage` answer), bars
  for 5-hour and weekly (monthly for Command Code), reset times, refresh icon.

### F. File browsing

- Phone → PC drives: `pc.files.list { path }` (folders first, 200 per page, hidden/system skipped),
  `pc.files.offer { path }` offers the file through Share (tap-to-download rules apply). Read-only.
- PC → phone storage: Android "All files access" (`MANAGE_EXTERNAL_STORAGE`, sideloaded APK). Desktop asks
  the phone over the link (`phone.files.list`, `phone.files.send`); the phone answers while Hari runs and
  sends a file with the normal Share upload. Desktop: a "Phone files" browser in the Share panel.

## Todos

- [x] A Share protocol (ids, groups, meta, rollover, 1 GB, resume, space, tap-to-download, storage, clear)
- [x] B Desktop Share panel + bubbles + composer + pins/saves + Send to Share
- [x] C Phone Share UI + composer lag
- [x] D Control tab: spinner, Network, folding, Lock, audio/media/camera/bluetooth, idle hibernate (+desktop)
- [x] E Usage: Command Code (desktop + phone), phone Usage settings page
- [x] F File browsing both ways
- [x] Records: LOCAL-FEATURES rows L-290+, changelog, SPECS row, version 0.16.0-local47, tag, push

## Issues and fixes

- Each workspace window runs its own idle watcher and only sees its own chats. With two windows, one could count down while the other has a working chat. Accepted for now (one window is the usual case).
- The default sound output is set with `IPolicyConfig`, which Windows doesn't document (the same interface sound-switcher apps use). If a Windows update breaks it, the chips stay and the change fails with an error.
- Bluetooth on/off uses `Windows.Devices.Radios`; Windows may refuse it until radio access is allowed for desktop apps (Settings → Privacy → Radios). The phone then shows the error.
- The camera switch is the per-user "Let apps access your camera" setting; a policy set by an administrator wins over it.
- `IdleHibernate.tsx` first imported `isTauri` from `@tauri-apps/api/core`; tests mock that module without it, so 27 bottom-bar tests failed. It now checks `__TAURI_INTERNALS__` like `backendTiming.ts`.
- The Mono panel left room for 4 title-bar buttons, but the Share button (L-279) made 5. Fixed to 12.5rem; the test now names both Share and Notifications.
- Rust: `fs::tests::read_only_git_cmd_path_adds_fixed_dirs_to_inherited_path` and `local_git_never_resolves_login_shell_path` fail on Windows (macOS paths); they were failing before this work.

## Learnings

- Shell code that tests render (bottom bar, title bar) must not import anything from `@tauri-apps/api/core` beyond what the test mocks expose; check `window.__TAURI_INTERNALS__` instead of `isTauri`.
- Phone → computer methods that change a device should call `fresh()` (the same gate as Lock and Hibernate); reading state shouldn't.

## Done

2026-11-15 02:59 IST. Built in 0.16.0-local47 (L-290 to L-297). Manual checks:

**Desktop**
- [ ] Title-bar phone button opens Share as a side panel; it also opens over Zen.
- [ ] Pictures keep their shape; 3+ pictures in a row form a grid; pin bar steps through pins; Delete all keeps pinned and saved.
- [ ] Right-click "Send to Share" in a chat selection, a link, the Browser and the Files tree.
- [ ] Share panel → Phone files lists the phone's storage (after granting All files access in Hari) and pulls a file over.
- [ ] Bottom bar: Command Code usage chip; moon button arms Hibernate when idle, the 30-second notice appears after 2 minutes with no chat working, Cancel disarms.
- [ ] A Mono panel's header no longer slides under the title-bar buttons.

**Phone (Hari)**
- [ ] Share: same bubbles, pins and saves synced both ways, a file over 10 MB from the computer waits for Download, a 1 GB upload resumes after a drop.
- [ ] Control: spinner beside Open/Stop/Close; Network on one line; Apps and Running apps fold; no Lock.
- [ ] Sound: mic mute, volume −/+, tap to mute, switch output; Now playing controls work with Spotify or a browser video.
- [ ] Camera switch blocks the camera in the Windows Camera app; Bluetooth on/off and the paired list with connected devices.
- [ ] Hibernate when idle switch matches the desktop moon button.
- [ ] Control → Files: browse drives and folders, Show more, send a file to Share.
- [ ] Settings → Usage lists every provider and account and refreshes.

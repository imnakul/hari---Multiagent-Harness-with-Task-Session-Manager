# Progress — Hari notifications: always-on watcher and Notifications screen (L-275)

Branch: `nakul/windows-support-upstream-0.16.0`
Base: `62a2a762` (plus uncommitted L-265 to L-274)
Created: 2026-11-14 14:29 (IST)
Tier: Large (new phone screen, new phone link methods, Android service change)

## Idea
Hari's alerts almost never arrive. The phone only posts alerts while it is out of view, but
it only asks the computer while it is in view, so the two never overlap (except while a Live
Update runs). Nakul asked for the desktop's notification panel (the title-bar bell) on the
phone: every entry posted in Android's notification panel, kept watching in the background,
and a Notifications screen in Hari with swipe to dismiss and tap to open the chat. No Live
Update or Super Island for this; a quiet always-running entry is fine.

- User story: As Nakul away from my desk, I want my phone's notification panel to show what
  MonoCode's bell shows (replies ready, approvals, questions, automation runs), so I know when
  to come back or answer from Hari.
- Fork-only (not in upstream).

## Research
- The bell's history is `notificationCenter.ts` (localStorage `monocode.notificationCenter.v1`,
  100 entries, shared by every workspace window). `recordSessionNotification` skips a chat
  that is open in the focused window, so walking away from an open chat recorded nothing.
- The phone link is a direct encrypted QUIC connection (`mobile_access.rs`, quinn) from the
  phone to the computer, on the LAN or a router-opened or Tailscale address. No cloud relay,
  no cost; a check is a few KB.
- `HariLiveService` (L-239) already runs a foreground service with 15 s ticks and a screen-on
  receiver that wake the app's JS, which asks the computer. It only runs while a Live Update
  card is shown. JS timers pause in the background, but native events and link calls work.
- Android won't start a foreground service from the background (Android 12+), so it starts
  when Hari is opened. It survives swiping Hari from recents; not a force stop or a reboot.
  HyperOS needs Autostart on and battery "No restrictions".

## Plan
- Desktop
  - `notificationCenter.ts`: entries may carry `seenOnDesktop` (recorded while the chat was
    open in the focused window). The bell hides them; the phone can show them.
    `markCenterNotificationsRead(ids?)`, `dismissCenterNotifications(ids)`.
  - `mobileNotifications.ts` (pure): the phone's view of the history (adds `projectId`,
    `projectName`), and applying the phone's dismiss / read / clear.
  - Every workspace window publishes the list to Rust on change (`mobile_notifications_publish`).
  - `src-tauri/src/mobile_notifications.rs`: `notifications.list` answered from that copy at
    once; `notifications.dismiss` / `notifications.read` / `notifications.clear` change the
    copy and tell the windows, which change the history (so the bell matches).
- Phone
  - `HariLive`: a "watching" mode. The service also runs when watching, with a quiet,
    minimum-importance "Watching your computer" entry (own channel, no sound, no Live Update).
    A Live Update card, when one shows, takes the service's place as before.
  - `NotificationFeed` provider: asks for the list on each tick, on opening and every catalog
    poll; posts each new unread entry as a normal notification (Session alerts channel, one per
    entry, replaced when the entry updates), removes posted ones the computer dismissed or
    read; first fetch after pairing posts nothing (history is not news). Old guessed alerts
    stop once the computer answers `notifications.list`.
  - Notifications screen (`/notifications`): newest first, unread dot, kind, chat, project,
    time; swipe to dismiss; tap marks read and opens the chat (automations without a chat stay);
    Mark all read, Clear all (confirmed). Bell button with unread dot on the home header.
  - Settings → Notifications: "Keep watching in the background" (on), "Also chats open on the
    computer" (on), Automations category, battery settings hint.

## Todos
- [x] Spec
- [x] Desktop store + model + tests
- [x] Rust feed + tests
- [x] Phone native watching mode
- [x] Phone feed, screen, settings
- [x] Records (LOCAL-FEATURES, changelog)
- [ ] Desktop and phone check (manual, see below)

## Issues and fixes
- `NotificationFeed.tsx` next to `notificationFeed.ts` collides on Windows (case-insensitive names): the component is `NotificationFeedSync.tsx`.

## Learnings
- The root cause of missing alerts: posting ran only out of view, asking only in view. The watcher's 15 s tick now drives the ask while out of view.
- Changed from the plan: the Notifications button sits in the home footer (beside the other round buttons) and in the drawer with an unread count, not in the home header.

## Manual check (desktop + phone)
1. Settings → Notifications on Hari: "Keep watching in the background" on; a quiet "Watching
   your computer" entry appears in the panel (no sound, no island).
2. Lock the phone; finish a chat on the computer: within ~15 s a "Reply ready" notification
   shows with the chat name; tap opens that chat in Hari.
3. Approval and question in a chat: "Needs approval" / "Has a question" arrive.
4. Swipe Hari away from recents; repeat 2. (HyperOS: Autostart on, battery No restrictions.)
5. Hari → bell: list matches the desktop bell; swipe one away and it leaves the desktop bell;
   Clear all empties both.
6. Open the desktop bell: the phone's posted notifications for those entries go away.
7. Chat open on the computer while you walk away: the phone still gets it; the desktop bell
   does not show it. Turn "Also chats open on the computer" off: the phone skips it.

## Done

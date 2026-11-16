# Review — Phone notifications in desktop Share (L-325)

Branch `nakul/windows-support-upstream-0.16.0`, base `01df26a5`. Tier: Large (new protocol
method, native Android service, new desktop view).

## Idea

The phone's notifications show in the desktop app, in a Notifications view of the Share
panel, so the user doesn't reach for the phone while working.

- User story: As Nakul at the computer, I want to see (and clear) my phone's notifications
  in Hari, so I can stay on the keyboard.
- Locked decisions (2026-11-16, "2: A A A"):
  - Android NotificationListenerService sends app, title, text and the app icon over the
    paired, encrypted link.
  - All apps except an editable skip list, pre-filled with banking, UPI, OTP and password
    apps.
  - See and dismiss; dismissing on the computer also clears it on the phone.
  - Keep what is on the phone now plus the last 24 hours.
  - OTP-looking codes hidden on the computer until clicked.
  - No offline queue: on (re)connect the phone sends what is on it now.

## Research

- `NotificationListenerService` (API 18+): the user grants "Notification access" in system
  settings; `getActiveNotifications()` lists what is showing, `cancelNotification(key)`
  clears one, `onNotificationPosted/Removed` report changes. Android 15+ redacts OTPs for
  untrusted listeners, so some codes arrive hidden already.
- App names and icons of other apps need package visibility on Android 11+; a
  `<queries>` entry for launcher apps covers them without `QUERY_ALL_PACKAGES`.
- The link today: the phone calls the computer (requests, like `share.upload`); the
  computer reaches the phone by items on the event stream (like `files.list`). A direct
  request fits "no offline queue": a failed send is simply dropped and the next connect
  sends the current list.

## Plan

**Phone (native, `modules/hari-live`)**
- `HariNotifications.kt`: `HariNotificationListener` service (manifest: bind permission,
  intent filter) plus helpers: access granted, open the access page, the active list as
  JSON (clearable, not ongoing, not group summaries, not Hari's own), dismiss by key, app
  icons (48 px PNG, base64) and app names by package. Changes dispatch
  `{ action: "notifications" }` (not queued while the app isn't listening).
- `HariLiveModule.kt`: the functions above; `AndroidManifest.xml`: the service and the
  launcher `<queries>`.

**Phone (JS)**
- `features/phoneNotifications/noticeModel.ts`: parse the native list, the default skip
  list, filter, and pick which icons still need sending. Tests.
- `features/phoneNotifications/preferences.ts`: `{ enabled, skip }` (off until turned on;
  skip pre-filled).
- `features/phoneNotifications/PhoneNotificationsSync.tsx` (mounted beside ShareSync):
  while on, allowed and connected, sends `phone.notifications` with the list (and icons
  the computer hasn't had this connection) on connect and on each change (debounced);
  turning off sends an empty list once. Runs the computer's `notifications.dismiss` items.
- `app/settings/phone-notifications.tsx`: switch (opens Notification access when needed),
  and the skip list as per-app switches (skipped apps plus apps seen recently). Row in
  Settings → Share.

**Computer (Rust)**
- `mobile_phone_notifications.rs`: `phone.notifications` from the phone replaces the "on
  phone" list; ones that left the phone stay as earlier for 24 hours; memory only (not
  written to disk). Commands: list, dismiss (pushes `notifications.dismiss` to the phone
  when it is still there), clear earlier. Emits `monocode-phone-notifications-changed`.
- Routed off the host lock in `mobile_access.rs`; commands registered in `lib.rs`.

**Computer (UI)**
- `model/phoneNotifications.ts`: parse the list, OTP detection, time labels. Tests.
- `ui/PhoneNotificationsView.tsx`: On phone / Earlier sections, app icon and name, time,
  title, text (codes masked until clicked), dismiss; loading, error, empty, not paired.
- `SharePanel.tsx`: a bell button in the header opens the view (like Phone files).

## Acceptance criteria

- With the phone switch on and access granted, a new phone notification shows in the
  desktop view within a few seconds; one cleared on the phone moves to Earlier.
- A skipped app's notifications never leave the phone.
- Dismiss on the computer clears it on the phone and removes it from the view.
- Earlier entries older than 24 hours disappear; restarting the desktop app forgets all.
- A 4–8 digit code in the text shows as dots until clicked.
- Phone away: nothing queues; on reconnect the view shows what is on the phone then.
- Turning the phone switch off empties the desktop view.

## Out of scope

Replying or running notification actions; desktop toasts for phone notifications; iOS;
history across desktop restarts.

## Todos

- [x] Native listener, module functions, manifest
- [x] Phone model, preferences, sync, settings page
- [x] Rust module, routing, commands
- [x] Desktop model, view, Share header button
- [x] Tests, checks, records

## Issues and fixes

- Live Updates' event handler read `sessionId` from the new `notifications` event: it now ignores it, as it does Share's.
- The OTP pattern missed codes like `G-582014` (a hyphen before the digits): the hyphen is allowed before a code.

## Learnings

- Phone → computer requests are not capped like computer → phone items (64 KB), so icons can ride the list; the computer still checks each is a PNG and caps size and count.

## Done

- Built 2026-11-16. Desktop and phone checks are manual (see the changelog entry).

# Review — Hari: running sessions as an Android Live Update (L-239)

Created 2026-11-09 15:40 IST. Status: **Review** (built; phone check manual).

## Goal

While a session runs, Hari shows it the Android 16 way (Live Update): a chip in the status bar,
the Super Island on HyperOS, a card at the top of the notification shade and on the lock screen.
From the card the user can watch it and Stop it, or Approve / Deny what it asks, without opening
the app.

## Locked decisions

- Sessions: every session the user started, from the phone or the computer. A Mono's sessions
  (`monoId`) are left out.
- Cards: Settings choice between one combined card (default) and one card per session.
- Chip: one session shows the time running (chronometer); several show "N busy"; a session that
  needs the user shows "Approve" or "Reply".
- Buttons: working → Stop, Open. Waiting on an approval → Approve, Deny, Open, and the card names
  what is asked ("Needs approval: Run: npm test"). A question → Reply (opens the chat). The
  combined card for several working sessions has Open only (no Stop for all).
- Settings → Live Updates: "Show running sessions" (off by default), "One card per session",
  a line plus link when Android has Live Updates off for Hari, and a battery note plus link
  (HyperOS: Battery "No restrictions" and Autostart).

## I'll handle (as built)

- Stop, Approve and Deny ask for unlock first (`setAuthenticationRequired`).
- Lock screen follows the phone's private-content setting: `VISIBILITY_PRIVATE` with a public
  version ("Hari — 1 session running" / "A session needs you").
- A foreground service (type `specialUse`) runs only while a card shows; it ticks every 15 s and
  when the screen comes on, and the app asks the computer again on each tick while out of view.
  React Native's own timers pause in the background, so the tick comes from Android.
- A swiped-away card stays away until that session stops running.
- A finished session's card closes; the existing "finished" alert still shows.
- Contact lost: "Reconnecting…" with Open only; after 2 minutes the cards close and
  "Lost connection to your computer" is posted once.
- Progress is an indeterminate bar with "Thinking…".
- Android below 16 shows a normal pinned notification with the same buttons.
- Limitation: Android 12+ lets the service start only while Hari is open; once started it keeps
  going with the phone locked.

## Wire

- `SessionSummary.approval?: { requestId: number; label: string }` beside `waiting: "approval"`
  (desktop `mobileWaiting` in `src/features/mobile/model/mobileApproval.ts`).
- New phone command `session.approve` `{ conversationId, requestId, decision: "allow" | "deny" }`,
  allow-listed in `mobile_access.rs`; the desktop checks the request is still waiting
  (`checkMobileApproval`) and answers it as the approval toast does (`onApproval`).
- Stop uses the existing `session.cancel`.

## Android Live Update rules followed

Ongoing, has a title, `Notification.ProgressStyle` (API 36) or BigText below, not colorized, no
custom views, not a group summary, channel `hari-live` at default importance (silent),
`POST_PROMOTED_NOTIFICATIONS` in the manifest, the promoted request via the
`android.requestPromotedOngoing` extra (the setter is API 36.1+), `setShortCriticalText` for the
chip. Settings link: `ACTION_APP_NOTIFICATION_PROMOTION_SETTINGS`.

## Files

- Desktop: `src/features/mobile/model/{mobileApproval.ts,mobileApproval.test.ts}` (new),
  `mobileWorkspace.ts`, `src/app/App.tsx`, `src-tauri/src/mobile_access.rs`.
- Phone native: `mobile/modules/hari-live/` (new Expo module: `HariLive.kt`, `HariLiveService.kt`,
  `HariLiveReceiver.kt`, `HariLiveModule.kt`, manifest, icon).
- Phone JS: `mobile/src/features/liveUpdates/{liveCards.ts,nativeLive.ts,LiveUpdates.tsx}` (new),
  `mobile/src/features/settings/liveUpdates.ts` (new), `mobile/src/app/settings/index.tsx`,
  `mobile/src/app/_layout.tsx`, `mobile/src/features/workspace/types.ts`,
  `mobile/tests/liveCards.test.ts` (new).

## Phone check (manual)

1. Settings → Live Updates → turn on; allow notifications if asked.
2. Start a session (phone or computer), then leave Hari: chip with time in the status bar, Super
   Island, card at the top of the shade and on the lock screen.
3. Stop from the card: asks for unlock, then the card reads "Stopping…" and closes.
4. Make a session ask for approval: chip "Approve", card names the command; Approve and Deny work
   after unlock.
5. Two sessions: one card "2 sessions running", chip "2 busy"; turn on One card per session → two
   cards, each with Stop.
6. Swipe a card away: it stays away until that session stops.
7. Quit the computer app: "Reconnecting…", then after 2 minutes the cards close and "Lost
   connection to your computer" shows.
8. Lock screen with "Hide sensitive content" on: shows only "Hari — 1 session running".
9. Battery: Settings → Apps → Hari → Battery "No restrictions", Autostart on; check battery use
   after an hour of running sessions.
10. If the island doesn't show: Settings → Live Updates line "Live Updates are off for Hari" →
    Turn on.

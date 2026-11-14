# Draft — Hari link: always-open stream, outboxes, Share, stats and PC control

Branch: `nakul/windows-support-upstream-0.16.0`
Base: `62a2a762` (plus uncommitted L-265 to L-276)
Created: 2026-11-14 15:36 (IST) · Updated: 2026-11-14 (scope added, Share choices answered)
Tier: Large (protocol change on the phone link, new phone and desktop screens, Android service change)
Status: Draft — direction agreed with Nakul. Build local first, in the phases below.

## Idea
Today the phone asks the computer on a timer (every 5 s in view, every 15 s in the background
through the L-275 watcher). Nakul wants the two devices to talk like Telegram does with
Madhav: things arrive at once, nothing is lost while one side is away, and either side can
send. Telegram does this with an always-on server that stores and forwards. Hari has no
server, so the computer plays that part.

Nakul also runs a Telegram bot every day (`E:\Developed\Personal\telegram-pc-control`) to
check PC status, turn the monitor off, hibernate, open/close apps and talk to Antigravity CLI
from bed, plus a separate WOL app to wake the PC. Hari can take over most of that from one app.

- User story: As Nakul, I want to send a file, a link or copied text from my phone to my
  computer (and back) and see it arrive within a second, with a notification on the other
  side, so I stop mailing things to myself.
- User story: As Nakul in bed hearing the PC's fans, I want to see the PC's stats and close
  the app that is working it hard, then turn the monitor off or hibernate, from Hari.
- User story: As Nakul away from my desk, I want replies, approvals and questions to reach my
  phone the moment they happen, and to approve, deny or reply from the notification itself.
- Fork-only (not in upstream). Upstream takes no new providers or big protocol changes.

## Decided with Nakul (2026-11-14)
- **Local first.** Build and test the direct phone↔computer version first. No cloud.
- **Outbox on both sides** ("Outbox thing is best"). Each side queues what it sends; an item
  stays until the other side confirms it; missed items go across on reconnect, in order,
  without duplicates.
- **No live clipboard sync.** Instead "send to clipboard": after copying, a Send to clipboard
  action on either device puts the text on the other device's clipboard, and the receiving
  side shows a notification (the phone too).
- **Share:** files, text and links, both ways.
- **Received files** go to `Downloads\Hari` on the computer and `Downloads/Hari` on the phone.
- **History:** the last 100 items per side.
- **Cloud mailbox later.** Nakul has a spare Convex account set aside for this, "more than
  enough for personal usage". It would hold the outboxes while the computer is off or
  unreachable. Not now: only after the local version is built and tested.
- **Telegram bot stays** as the backup for now; Hari does not replace or change it.

## Scope (local build)

### 1. Always-open event stream
- The phone already dials the computer over QUIC (quinn, TLS 1.3, pinned fingerprint;
  `mobile_access.rs` and `crates/mobile-link`). Add one long-lived two-way stream per
  connection that carries events both ways (`notifications.changed`, `share.item`,
  `clipboard.item`, `notes.changed`, `tasks.changed`, `stats.phone`, acks). Request/reply
  calls stay as they are.
- **Keep-alive.** An open connection still needs a small "still here" packet now and then:
  routers and phone networks forget a quiet connection (often after 30 s to a few minutes),
  and without traffic neither side notices when Wi-Fi drops silently. Today it is every 4 s
  with a 12 s idle limit (`tls.rs`), tuned for the screen in view. In the background use a
  longer interval (target 25–60 s, measured), with the idle limit above it.
- **Phone service.** The L-275 watcher (foreground service, quiet "Watching your computer"
  entry) holds the connection in the background instead of waking JS every 15 s. Native code
  reads the stream and posts notifications without waking JS for each one.

### 2. Outbox protocol
- Every item has an id, a sequence number per sender and a created time. The receiver acks by
  sequence; the sender drops acked items. On reconnect each side sends its last acked sequence
  and the other resends what follows. Receivers ignore ids they have seen.
- **Commands never wait in the outbox.** Power and app actions (monitor off, hibernate, close
  an app) are sent only while connected and are refused on the computer if older than a short
  limit (the Telegram bot does the same with `MAX_COMMAND_AGE_SECONDS`), so a backlog can never
  hibernate the PC hours later.

### 3. Notifications by push, with actions
- The desktop pushes `notifications.changed`; the 15 s tick becomes a fallback only.
- **Approve, Deny and Reply buttons** on the Android notification for approvals, questions and
  replies ready. Reply uses Android's inline reply box. The action goes to the computer over
  the link; the notification updates to show it was sent or failed.

### 4. Share panel (phone and desktop)
- Send files, text and links both ways; history of 100; open, copy, save, share onward.
- **Send to clipboard** both ways, with a notification on arrival.
- **Quick Settings tile "Send clipboard"** on the phone. Android only lets the app in view read
  the clipboard, so the tile opens a tiny see-through screen for a moment, reads, sends, closes.

### 5. Stats (in the Share panel)
- **PC:** CPU and RAM use, GPU use and temperature where Windows exposes them, disk space,
  network up/down, uptime. Built on Windows APIs already in the app (`windows-sys`
  Performance and ProcessStatus), no new dependency.
- **Running apps:** every app with a window, with its CPU and RAM, sortable. **Close** asks the
  app to close (like clicking X); **End** stops it and all its processes (confirmed).
- **Phone:** battery level and charging, temperature, free storage, network type. Read through
  Hari's own native module (no new dependency); also shown on the desktop.
- Refreshes while the panel is open; nothing is sampled in the background.

### 6. PC control (from the Telegram bot)
- A **Controls** panel of buttons; each tap shows its result on the button's card (done,
  failed and why, or the screenshot).
- Monitor off, Hibernate (confirmed), Lock, Screenshot (saved through Share).
- Open, Close, Minimize, Maximize, Restart for chosen apps (Hari, Claude, ChatGPT,
  Antigravity, Aside Browser); the list is editable in Settings.
- Not now: Hibernate in N minutes, wake timer, screen recording, terminals.
- **Wake-on-LAN** from the phone. WOL does not use the Hari link (the PC is off, so there is
  none). The phone sends a "magic packet" (a UDP broadcast holding the PC's network card
  address) on the home Wi-Fi; the card listens while the PC sleeps or hibernates and powers it
  on. Hari learns the card's address (MAC) and broadcast address whenever it is connected and
  keeps them, so the button works with the PC off. Sent from Hari's native Android module (no
  new dependency). Works on the home network; from outside it needs a router or an always-on
  Tailscale device at home that forwards it (later). The PC's BIOS and adapter settings are
  already set up (Nakul's WOL app works today).
- **Find my phone** from the desktop: the phone rings at full volume, even on silent, until
  stopped.

### 7. Notes and tasks sync
- The desktop pushes changes; the phone keeps a cache and shows it at once, even offline.
- Edits made on the phone while offline wait in the outbox and go across on reconnect.
- Conflicts: newer edit wins, per note or task (`updatedAt`). A deleted item stays deleted.

## Build order
Proposed 2026-11-14 (awaiting Nakul's go): one continuous build of all five, in this order, without waiting for
approval between them; checks pass at the end of each before the next starts; one manual
check list at the end.
1. Stream + outbox + notifications by push (proves the link).
2. Notification actions (approve, deny, reply).
3. Share panel + send to clipboard + Quick Settings tile.
4. Stats + PC control + Wake-on-LAN + Find my phone.
5. Notes and tasks sync.
Each phase gets its own records and manual check; a full spec section (protocol, screens,
tests) is written before each phase starts.

## Later (not in the local build)
- **Reminders** (needed for sure): set on either device, delivered on the phone at the time,
  even if the computer is off by then (the phone schedules it locally once it has it).
- **AI in the Share panel:** talk or type to an AI helper there ("remind me at 9 to call…",
  "close Chrome", "how hot is the PC?"); it suggests the action and Nakul confirms before
  anything runs. Uses the existing AI helper accounts through the computer.
- Presence: buzz the phone only when the computer has been idle for a while.
- Open a link on the other device; continue a chat on the phone.
- Phone camera straight into a chat.
- Task reminders pushed to the phone.

## Later: cloud mailbox (Convex)
- When the computer is off or the link is down, each side writes its outbox to Nakul's own
  Convex deployment; the other side reads it when it can. End-to-end encrypted with a key
  made at pairing, so Convex only sees ciphertext.
- Needs its own spec: Convex schema, auth, size limits for files, cleanup.

## Risks and costs
- Android shows a permanent notification for the foreground service (already true with the
  L-275 watcher). HyperOS needs Autostart on and battery "No restrictions".
- Battery: one tiny keep-alive every 25–60 s in the background; expected about the same or
  less than the 15 s JS wake-up. Measure before and after.
- Works only while the computer and Hari desktop run, until the cloud mailbox exists
  (Wake-on-LAN is the exception: the phone sends it directly).
- PC control is remote control of a signed-in PC: only the paired phone (pinned key) can send
  it, power actions are confirmed, and stale commands are refused.

## Todos
- [x] Share choices answered
- [ ] Phase 1 full spec, build, records, manual check
- [ ] Phase 2
- [ ] Phase 3
- [ ] Phase 4
- [ ] Phase 5

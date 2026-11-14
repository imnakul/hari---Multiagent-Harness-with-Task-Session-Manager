# Progress — Hari link: always-open stream, outboxes, Share, stats and PC control

Branch: `nakul/windows-support-upstream-0.16.0`
Base: `62a2a762` (plus uncommitted L-265 to L-276)
Created: 2026-11-14 15:36 (IST) · Updated: 2026-11-14 (scope added, Share choices answered)
Tier: Large (protocol change on the phone link, new phone and desktop screens, Android service change)
Status: Progress — Phases 1–3 built (L-277, L-278, L-279); Phases 4–5 next.

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
Decided 2026-11-14 ("yes, you can build in order and keep committing, but push for release only once"): one continuous build of all five, in this order, without waiting for
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

## Phase 1 — built (L-277)
- Protocol: `events.watch {epoch?, after?}` (a watch). The computer sends `{type:"hello",epoch,last,resume}` first, then `{type:"item",item:{seq,id,kind,at,payload}}` in order and `{type:"signal",kind,payload}` (latest value only, not kept). The phone acks with `events.ack {epoch,seq}` and sends its own outbox with `events.send {items:[{id,kind,at,payload}]}` → `{accepted:[id],rejected:[{id,error}]}`; ids are deduped (last 500). Phase 1 refuses every item kind ("Unsupported item"); kinds arrive with their phases.
- Computer outbox: per paired phone, `mobile-events.json` in app data, 200 items, 64 KB per payload, 7 days. A new epoch when the file is lost or the phone re-pairs; the phone resets its cursor on a new epoch. Forgotten on revoke and leave.
- Quiet watch: in the background the link asks for a 20 s heartbeat on its own connection with longer timeouts (`quiet_client`), so the radio sleeps between pings. In view it shares the usual pooled connection with a 5 s heartbeat.
- Phone: `runLinkStream` holds one watch per paired computer, reopens on in-view/background change, retries 1 s → 30 s, and asks an older computer again every 5 minutes. While live, the Android watcher ticks every 120 s when no session card is shown, and the notifications poll drops to once a minute.
- Notifications: the computer sends the bell's list as the `notifications` signal whenever it changes, so the phone's panel updates within about a second.

Manual check (phone + computer; not for an agent inside MonoCode):
1. Hari in view, paired: let a chat finish on the computer. Hari's panel notification appears within about 2 s.
2. Hari in the background with "Keep watching in the background" on: the same, within about 2 s.
3. Swipe a notification away on the phone → it leaves the computer's bell; clear the bell on the computer → it leaves the phone.
4. Turn the computer's mobile access off and on: Hari reconnects by itself within about 30 s.
5. Leave Hari in the background for an hour: Hari's battery use stays about where it was before this build.
6. Restart the computer's app with notifications waiting: nothing shows twice on the phone.

## Phase 2 — built (L-278)
- Data: the computer's notification list carries `requestId` on approvals and questions (read from the bell entry's key `<session>:<kind>:<request>`; Rust `sanitize` passes it only for those kinds).
- Phone: three Android categories (`hari_approval` Approve/Deny, `hari_answer` Answer box, `hari_reply` Reply box), none opening Hari. A panel post gets the category its entry can take (approval or question with a request and chat; finished chat).
- Taps: `PanelActions` listens for button taps (deduped), sends `session.approve`, `session.answerQuestion {reply:{kind:"text",text}}` or `conversation.send` directly (not the outbox: an answer must not arrive late), then removes the notification and marks it read on the computer. A failure posts it again on the quiet `panel-results` channel: "Couldn't approve: <why>" over the original text, buttons kept.
- Typed answers (computer): one-question prompts only. Text naming a choice (any case) picks it; otherwise it is the typed answer where the question allows one, or fills its "Other" choice; a question with several parts says "Open the chat to answer these questions", one with only fixed choices says to open the chat.
- Changed from the plan: a sent action removes the notification instead of showing "Sent", the usual Android pattern; a failure stays.

Manual check (phone + computer; not for an agent inside MonoCode):
1. Let a chat ask for approval on the computer. The phone's notification shows Approve and Deny; Approve → the computer goes on, the notification leaves, the bell entry is read.
2. Same with Deny → the computer shows the denial.
3. A one-question prompt with choices: Answer with a choice's name (e.g. "blue") → that choice is picked. Answer with other text → the typed answer (or "Other").
4. A question with several parts: Answer → the notification stays with "Couldn't send the answer: Open the chat to answer these questions".
5. A finished chat: Reply "now add tests" → it arrives in that chat on the computer as a follow-up (queued if a turn is running).
6. With the computer's app closed: tap Approve → the notification stays with the reason and its buttons; open the app and tap again → it works.
7. Answer an approval on the computer first, then tap Approve on the phone → a "Couldn't approve" note, nothing else happens.
8. Tap a notification's body (not a button) → it still opens the chat as before.

## Phase 3 — Share (L-279)
- **Text, links, clipboard** travel as outbox items of kind `share`, both ways:
  `{type:"text"|"link"|"clipboard", text}` (≤ 30,000 characters). A `clipboard` item goes on
  the receiving device's clipboard and shows a notification there; `text` and `link` only
  join the history and notify.
- **Files, PC → phone:** the computer queues `{type:"file", fileId, name, mimeType, size}`
  for each paired phone. The phone fetches it with `share.download {fileId, offset}` in 1 MB
  pieces (`{data, size}`, base64), writes it to its cache, then saves it to `Download/Hari`
  through Android's MediaStore (Hari's own module). The computer reads the file from where
  the user picked it, for 7 days.
- **Files, phone → PC:** `share.upload {fileId, name, mimeType, size, offset, data}` in 1 MB
  pieces, in order (a piece at the wrong offset is refused; offset 0 starts over). The last
  piece moves the file into `Downloads\Hari` under a free name. Not through the outbox:
  the phone keeps a failed send in its history with Retry.
- **Limits:** 100 MB per file, 100 history items per side, 20 files per send.
- **Computer:** `share-history.json` in app data; a phone icon beside the bell opens Share:
  a box (Send / Send to clipboard), Send clipboard, Send files…, and the history (copy,
  open, show in folder, remove, clear). Off with no paired phone. A toast on arrival;
  clicking it opens Share.
- **Phone:** a Share screen (Home footer): the same box, Send clipboard, Photos, Files
  (expo-file-system's picker), and the history (copy, open, share again, retry, remove).
  Android's share sheet lists "Hari" for text and files; a Quick Settings tile
  "Send clipboard" opens a see-through screen for a moment, reads the clipboard and queues
  it. Both wait in Hari's module until the app's code takes them (at once when running).
- **No new dependency.** Not now: live clipboard sync, folders, iOS share target.

## Phase 3 — built (L-279)
- Computer: `src-tauri/src/mobile_share.rs` (history, offers, `share.upload` / `share.download`, toast); a phone icon beside the bell (`ShareButton.tsx`) with the box, Send clipboard, Files…, To clipboard and the history (copy, open link, open, show in folder, remove, clear; a dot for unseen arrivals).
- Phone: Share screen from the Home footer (`src/app/share`), `ShareSync` takes `share` items off the stream and sends what the share sheet or the tile left; files move one at a time (`shareTransfers.ts`); history of 100 on the phone (`shareStore.ts`).
- Android (`HariShare.kt`): "Hari: send to computer" in the share sheet (any text or files, up to 20 and 100 MB each, copied into Hari's cache), the "Send clipboard" Quick Settings tile, saving into `Download/Hari` through MediaStore (Android 10 and later), opening a saved file.
- Changed from the plan: no separate Photos button (the file picker shows photos too) and no "share again"; a failed row is tapped to try again. A file restarts from the beginning when tried again.

Manual check (phone + computer; not for an agent inside MonoCode):
1. Computer: click the phone icon beside the bell, type text, Send → the phone shows a "Text from your computer" notification; Hari → Share lists it; tap it → copied.
2. Computer: copy something, "Send clipboard" → it is on the phone's clipboard with a "Copied from your computer" notification.
3. Computer: Files… → pick a PDF and a photo → both arrive in the phone's `Download/Hari` with a notification; tapping the row opens the file.
4. Phone: Share screen → type a link, Send → the computer shows a toast; the popover lists it as a link; Open link works.
5. Phone: Files → pick two files → progress shows, then both are in `Downloads\Hari` on the computer; "Show in folder" opens them.
6. Phone: in another app, Share → "Hari: send to computer" with text, then with a photo → both reach the computer (with Hari closed, Hari's Share screen opens and sends them).
7. Phone: add the "Send clipboard" Quick Settings tile, copy text, tap the tile → it reaches the computer's clipboard.
8. Turn the computer's app off, send a text from the phone → "waiting"; open the app → it arrives and the row turns done. Send a file while off → failed; tap it after the app is back → it goes.
9. Remove a row by swiping, then Clear all on both sides; saved files stay.

## Todos
- [x] Share choices answered
- [x] Phase 1 full spec, build, records (L-277)
- [ ] Phase 1 manual check (list in "Phase 1 — built")
- [x] Phase 2 build, records (L-278)
- [ ] Phase 2 manual check (list in "Phase 2 — built")
- [x] Phase 3 build, records (L-279)
- [ ] Phase 3 manual check (list in "Phase 3 — built")
- [ ] Phase 4
- [ ] Phase 5

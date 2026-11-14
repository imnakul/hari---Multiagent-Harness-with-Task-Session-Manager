# Review — Share as a sidebar view, phone Computer hub (L-287, L-288)

Created: 2026-11-14 21:49 IST. Asked in the session: "We asked for a Sidebar Panel, where proper chats,
media, and everything we can see and use it", then "do it / And reuse existing components".

- Goal: Share (L-279) is a small title-bar popover; the user wants a full place to see and use everything
  that moved between the phone and the computer.
- User story: As the user, I want a Share view in the sidebar that reads like a chat with my phone, with
  pictures shown, files openable and links usable, so I can move things both ways without hunting.

## Desktop (L-287)

- **Share** is an app view like Whiteboard: sidebar page (inset sidebar, compact rail, project rail),
  title-bar tab in the inset layout, Back/close like the other views.
- The title-bar phone icon opens the Share view (the popover is gone); the unseen dot stays. A clicked
  arrival toast opens the view too.
- Layout: header (title, phone status line, Find my phone, Clear history), filter chips (All, Media, Files,
  Links, Text), a chat-style timeline (from the phone on the left, to the phone on the right, day
  separators), a composer at the bottom (text, Files…, Send clipboard, To clipboard, Send).
- Pictures and videos show inline (reusing `LocalMedia` and `ImageLightbox`); other files show name, size,
  Open and Show in folder. Links: Open here, Open on phone, Copy. Text: Copy. Every bubble: Remove.
- Drop files anywhere on the view to send them; paste an image or file into the composer to send it.
- **Open on phone:** sends the link with `open: true`; the phone opens it when Hari is in front, otherwise
  its notification opens the link when tapped.

## Phone (L-288)

- Share and Computer become one **Computer** screen with two tabs, Share | Control. The home footer's two
  buttons become one; `/share` still works (opens the Share tab).
- The Share tab uses the same chat-style timeline: left/right bubbles, image thumbnails for received
  pictures, tap to open/copy, swipe to remove.

## States

Not paired (pairing notice, composer hidden), empty history, sending (buttons disabled), send failed
(inline error), queued ("waiting for the phone"), files moving (phone: progress), filter with no matches.

## Out of scope

Grouping by conversation, search, message editing, sending folders, multi-phone targeting (sends still go
to every paired phone).

## Checks

Typecheck, lint on changed files, vitest for the touched models, `cargo test --lib mobile_share`.
Desktop and phone UI checks are manual (repo `AGENTS.md`).

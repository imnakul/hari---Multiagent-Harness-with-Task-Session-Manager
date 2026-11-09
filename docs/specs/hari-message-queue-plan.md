# Review — Hari: the message queue on the phone (L-238)

Created 2026-11-09 11:19 IST. Status: **Review** (built; phone check manual).

## Goal

A message sent from the phone while the agent works is queued on the desktop. The phone now
shows that queue in a strip attached above its message box, as the desktop does, with the same
controls: edit, send now (steer), delete, and resume a paused or held queue.

## Locked decisions

- Full control (1A): see, edit, delete, send now, resume. Same actions as the desktop composer.
- Placement: a strip attached above the composer, under any question or usage-limit card.
- The blank-chat fix ships in the same build (scroll snaps back to the end when the list
  shrinks past it; going back to a chat hands the watch back to it).

## Wire

The desktop adds `queue` to `conversation.read` results and to watch frames (sent with the first
frame, then only when it changes; `null` when empty):

```ts
type MobileQueue = {
  status: "active" | "paused" | "resuming" | "steering" | "held";
  holdReason?: string;
  sendingId?: string;
  steer: "steer" | "send-now" | null; // null: no send-now (a Mono's queue)
  messages: { id: string; label: string; text: string; attachments: number; error?: string; canEdit: boolean }[];
} | null;
```

A Mono's queue carries only its session-finished notices, as its desktop pane shows; its own
queued messages are already bubbles in the transcript.

New phone commands (routed by `conversationId`, allow-listed in `mobile_access.rs`):

| Method | Params | Desktop action |
|---|---|---|
| `session.queueDelete` | `messageId` | `onDeleteQueuedMessage` |
| `session.queueEdit` | `messageId`, `text` | `onEditQueuedMessage` |
| `session.queueSteer` | `messageId` | `onSteerQueuedMessage` |
| `session.queueResume` | — | `onResumeQueue` |

Each refuses with a plain message when the item is gone ("This message was already sent") or
the queue is mid-steer. `conversation.send` also returns `queued: <id>` when the message was
queued, so the phone drops its local bubble once the strip shows it.

## Phone

- `QueueStrip` above the composer on session and Mono screens.
- Edit opens an inline box; a failed save keeps the text and shows the reason.
- Controls are disabled while disconnected, while the queue steers, and on the item sending.
- Older desktops send no `queue`: nothing shows, as before. The iOS native transcript path is
  not wired (Android-only fork build).

## Checks

- Gates: mobile `tsc`, `expo lint`, `vitest`; root `tsc -p .`, vitest for the new model files;
  `cargo check`, `rustfmt --check` on `mobile_access.rs`.

## Manual checklist (phone, not for the implementing agent)

1. Send from the phone while a turn runs (a provider that queues): the message shows in the strip,
   not as a bubble; it becomes a bubble when it sends.
2. Edit it on the phone: the desktop strip shows the new text.
3. Send now: the turn steers (or stops and sends, for interactive Claude).
4. Delete: it leaves both strips.
5. Stop the turn from the phone with messages queued: "Queue paused" + Resume works.
6. Go back from a running chat to another running chat: the chat shows, no blank space.

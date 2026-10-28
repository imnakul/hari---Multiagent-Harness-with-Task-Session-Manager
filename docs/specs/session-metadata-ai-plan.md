# Progress — AI session metadata and cover on open (L-190)

- Branch: `nakul/windows-support-upstream-0.16.0`, base `c3e96c4d`.
- Created: 2026-10-28 15:12 IST.
- Desktop check: manual, by people (see Checklist). Not an implementation-agent task.

## Goal

Glance at any chat and know what it covered, what was decided and where it stopped, without
writing the notes by hand. An AI helper writes the label and keeps the notes; the idle cover
also greets you when you come back to a chat you have not looked at for a while.

## Locked decisions (Discuss, 2026-10-28)

1. **Cover on open.** A chat with metadata that you have not looked at for longer than the idle
   wait opens already covered (also chats that were closed). A chat hidden only briefly opens as is.
   Idle cover blur 14px → 6px.
2. **Two AI buttons** in the Session metadata dialog: one beside Label, one beside Notes. Their
   output fills the form; Save keeps it, as for typed text.
3. **Notes only grow.** The helper reads the chat plus the existing notes (typed or written
   earlier by AI) and adds only what is new and worth keeping, at outcome level: many small
   tweaks to one thing become one point. Nothing new → nothing added. No separate AI block.
4. **Grouping by append.** New points that continue the last heading go right under it. A topic
   that returns after another one gets a new heading at the end, "<Topic> (continued)".
5. **Left off.** The notes end with one `**Left off:** …` line; each run replaces it (the only
   line ever replaced).
6. **Auto mode** (notes only, never the label): a per-chat switch in the dialog, default from
   Settings. Runs once a turn has ended and the chat has been quiet for 60 s; sends only the new
   turns plus the notes.
7. **Settings → Session metadata** under AI helper: model ("Same as AI helper" or a chosen
   model), editable notes instructions (default = style A, grouped by thread with a kind tag),
   Reset to default, and the Auto notes default.
8. Splitting sessions into panes: dropped.

## Plan

**Model** `sessions/model/sessionMetadataAi.ts` (pure, tested):
- Settings `monocode.sessionMetadataAi` `{ helper: AiHelperTarget | null, instructions, autoDefault }`
  with load/save/subscribe; empty instructions use `DEFAULT_NOTES_INSTRUCTIONS`.
- Per chat `monocode.sessionAutoNotes` `{ [sessionId]: { on?: boolean, after?: blockId } }`:
  `autoNotesOn`, `setAutoNotes`, `markAutoNotesDone`, `blocksAfter`.
- Prompts: `buildLabelPrompt`, `buildNotesPrompt` (fixed rules + style instructions + notes +
  transcript); parsers `parseLabelReply`, `parseNotesReply` (`NOTHING_NEW` → no change);
  `appendSessionNotes(notes, addition)` removes the old Left off line, then appends.

**Helper** `integrations/harness/core/sessionMetadataHelper.ts`: target order = chosen model,
then AI helper settings, then the chat's provider, then the rest; each through
`runHelperPipeline` with `continueHelperAvailable`; transcript from `continueTranscript`
("long" for buttons, "short" for Auto).

**Dialog** `SessionMetadataDialog.tsx`: sparkle buttons with spinner and Stop; Auto notes switch;
reads blocks from `SessionStateContext`; error line keeps the text untouched.

**Auto writer** `SessionMetadataAutoWriter` (mounted beside the dialog host): observes the store,
schedules per chat on busy → idle, cancels on busy; skips Monos, chats whose dialog is open, and
saves that would pass `SESSION_NOTES_MAX`; one run per chat at a time; failures stay quiet.

**Cover on open** `model/sessionLastSeen.ts` (`monocode.sessionLastSeen`, newest 300):
`useIdleCover(root, idleMs, enabled, seenKey)` starts covered when the key was last seen longer
than `idleMs` ago, and records the time when the pane stops being eligible (hidden, closed or
switched): the last activity if it was covered, else now.

## Files

`sessions/model/sessionMetadataAi.ts` (+test), `sessions/model/sessionLastSeen.ts` (+test),
`integrations/harness/core/sessionMetadataHelper.ts` (+test), `sessions/ui/SessionMetadataDialog.tsx`,
`sessions/ui/SessionMetadataAutoWriter.tsx`, `sessions/ui/SessionIdleCover.tsx`,
`sessions/ui/SessionPane.tsx`, `settings/ui/SettingsView.tsx`, `settings/model/settings.ts`
(search row), `app/App.tsx` (mount), `styles/index.css` (blur).

## Risks

- Auto mode costs one helper call per quiet turn; it is off by default.
- A model may reword old points; the rules forbid it, and the dialog lets you edit.
- Dialog open during an Auto run: the run is skipped, so a later Save cannot drop it.

## Checklist (manual desktop)

- [ ] Close a chat with notes, wait past the idle time, reopen it: it opens covered.
- [ ] Switch away and back quickly: no cover. Cover blur is lighter.
- [ ] Label button writes a short label; Notes button appends grouped points and one Left off line.
- [ ] Notes button twice in a row: the second adds nothing or only a new Left off line.
- [ ] Auto notes on: a minute after a turn ends, new points appear; tiny tweaks fold into one.
- [ ] Settings: change the model and instructions, Reset restores the default.
- [ ] Dialog opened from a chat that is not open: AI buttons are disabled with "Open this chat first".
- [ ] Stop during a run keeps the form as it was; Save is blocked while a run is going.

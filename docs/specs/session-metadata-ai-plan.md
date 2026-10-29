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
- [ ] The sparkle icons sit inside the Label and Notes boxes, top-right; notes text (Live, Preview, Source) never runs under the icon.
- [ ] Label button writes a short label; Notes button appends grouped points and one Left off line.
- [ ] Notes button twice in a row: the second adds nothing or only a new Left off line.
- [ ] Auto notes on: a minute after a turn ends, new points appear; tiny tweaks fold into one.
- [ ] Settings: change the model and instructions, Reset restores the default.
- [ ] Dialog opened from a chat that is not open: AI buttons are disabled with "Open this chat first".
- [ ] Stop during a run keeps the form as it was; Save is blocked while a run is going.

## Session panel (L-191)

Built directly (Do mode), no separate spec. Decisions locked in Discuss on 2026-10-28:

- **Layout 1A:** docked glass panel on the right of each chat pane; composer button and Ctrl+Shift+O; width dragged and remembered; folds into a button (opens as an overlay) when the chat would get narrower than 440 px.
- **Content 2A:** one AI run writes tagged points (event, decision, found) linked to their message, plus one Left off line. Tabs: Timeline, Decisions, Files (from edit tool calls, no AI), Notes (the existing notes), Bookmarks.
- **Key terms 3A:** later.
- **Bookmarks 4A:** pin a message with a short line; click jumps there; no file restore.
- Auto notes now updates the panel; notes stay the user's. AI runs read only blocks after `after`; user edits and deletes persist. Monos, inbox asks and remote chats get no panel. Compacted messages show "Earlier in this chat".

### Checklist (manual desktop)

- [ ] Composer button and Ctrl+Shift+O open and close the panel; the button shows accent while open.
- [ ] Glass looks like the other popovers in light and dark; drag the left edge to resize; width survives a restart.
- [ ] Split the workspace until a pane is narrow: the panel folds into a top-right button that opens it over the chat; X closes the overlay.
- [ ] Update with AI: a spinner, then points with icons (flag decision, bulb found, dot event) and a Left off card; a second run adds nothing or a new Left off.
- [ ] Click a point, a Left off card, a file row and a bookmark: the chat scrolls to that message, also for an old turn not yet loaded.
- [ ] Edit and delete a point and a bookmark; they stay after reload.
- [ ] Bookmark button under a reply: turns accent, panel opens on Bookmarks; clicking it again removes the bookmark.
- [ ] Files tab lists edited files newest first; the open button opens the file.
- [ ] Notes tab shows the notes; Edit notes opens the Session metadata dialog.
- [ ] Auto notes on: a minute after a turn, new points appear in the Timeline; notes unchanged.
- [ ] No panel or button in a Mono chat or an inbox ask.

## Session overview (L-192)

Built directly after Discuss, no separate spec. Decisions locked on 2026-10-28/29 (replace parts of L-190 and L-191):

- **Name and tabs:** Session overview with Summary (default) | Bookmarks | Files changed. Timeline, Decisions and AI points are removed. (Timeline came back on 2026-10-29: see below.)
- **Header:** label input (placeholder the chat title) with its own sparkle that always rewrites the label; Auto switch for this chat; main sparkle adds what is new to the Summary and writes the label only when it is empty; ✕.
- **Summary:** the notes, grouped by heading, collapsed, newest first, Left off card on top; points plain text; Edit summary opens Live Markdown in the panel.
- **Bookmarks:** reply button stays; Bookmark in the selected-text menu saves the quote, kept apart from the whole-reply bookmark.
- **Removed UI:** Session metadata dialog and idle cover. Menus say Open Session overview; the hover card shows label, Left off and the Summary headings.
- **Coming back:** after the wait in Settings → General (Off, 2–30 min, default 5), a chat with a Summary opens the overview on Summary.
- **Settings:** group renamed Session overview; Effort picker (Automatic, Low, Medium, High; Claude and Codex); Antigravity allowed as the Notes model with a tools warning.
- **Resize edge:** invisible until hover, then a thin line.
- **Data:** keep both tables; delete nothing. Old AI points in saved panels are ignored and dropped on the next bookmark save.
- **Timeline (added 2026-10-29 00:36):** a tab after Summary (Summary | Timeline | Bookmarks | Files changed). AI points (decision, found, event) grouped by day, newest first; each shows the time its message was sent (the turn's user message), with the full date on hover; edit, delete, click to jump. The main sparkle and Auto run the Summary update, then the Timeline update. Left off stays on Summary only. Old saved points are read again.
- **Search, Expand all, smooth jumps, tint (added 2026-10-29 08:07):** search button at the end of the tab row filters every tab with counts on the labels and the words highlighted, switching to the first tab with matches; Expand all / Collapse all icon button on Summary only (hidden while searching); label sparkle only while the label box is focused; jumps and chat find scroll smoothly, then pulse; selection bookmarks stay accent-tinted in the chat.

### Checklist (manual desktop)

- [ ] Panel title reads Session overview; tabs Summary, Bookmarks, Files changed; opens on Summary.
- [ ] Label input: type and blur saves; its sparkle replaces the label; empty label shows the chat title as placeholder.
- [ ] Main sparkle: Summary gains a new group; label filled only when it was empty.
- [ ] Auto switch per chat: on, a minute after a turn the Summary grows; off, nothing changes.
- [ ] Summary groups start collapsed, newest first, open with a short slide; Left off card on top.
- [ ] Edit summary: Live Markdown editor, Save, Cancel, Ctrl+Enter, Esc.
- [ ] Select text in a reply → Bookmark: panel opens on Bookmarks with the quote; add a note; click jumps to the message.
- [ ] Sidebar, tab and pane menus say Open Session overview; no Session metadata dialog anywhere; no blur cover on return.
- [ ] Hover card on a chat shows label, Left off and the headings.
- [ ] Leave a chat with a Summary for longer than the wait (set 2 min), come back: the overview opens on Summary.
- [ ] Settings → Session overview: Effort picker saves; Antigravity selectable as Notes model with the warning.
- [ ] Resize edge hidden until hover, a thin line on hover, accent while dragging.
- [ ] Timeline tab after Summary; sparkle adds Summary groups and then Timeline points; spinner covers both runs.
- [ ] Timeline days read Today / Yesterday / date, newest first; each point shows its message's time, hover shows the full date and time.
- [ ] Timeline point: click jumps to its message; pencil edits (meta shows "edited"); bin deletes.
- [ ] A chat with L-191 points (not re-saved under local18) shows them in the Timeline.
- [ ] Label sparkle hidden until the label box is clicked; shows while focused, hides on blur (stays while running).
- [ ] Summary: Expand all opens every heading and becomes Collapse all; hidden on other tabs and while searching.
- [ ] Search button: box opens focused; typing shows counts on every tab, highlights words, Summary opens matching headings; an empty tab moves to the first tab with matches; Esc or ✕ closes and clears.
- [ ] Click a bookmark, Timeline point and changed file far up the chat: smooth scroll, then a pulse where it lands (a selection bookmark pulses the quote).
- [ ] Chat find (Ctrl+F) next/previous scroll smoothly; with Windows animations off, jumps are instant.
- [ ] Select text → Bookmark: the text stays accent-tinted in the chat, also after scrolling away and back; a whole-reply bookmark adds no tint; deleting the bookmark removes the tint.

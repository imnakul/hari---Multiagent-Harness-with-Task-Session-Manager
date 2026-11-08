# Progress — Hari phone: Tasks, Notes, reply buttons, link cards (L-236)

- Tier: Large · Branch: `nakul/windows-support-upstream-0.16.0` · Base: `b6954b53` · Created 2026-11-08 14:04 IST
- Builds on [hari-phone-updates-plan.md](hari-phone-updates-plan.md) (L-235). Same release pipeline.

## Idea

The phone (Hari) can chat with the desktop's sessions but can't see or change the desktop's
Tasks and Notes, can't save a reply as a note or task, and shows web links as plain text.

## Locked decisions (2026-11-08, Nakul: "4-Do at once right now")

- **Tasks screen:** tasks grouped by project; tick to complete; change status; quick add with
  title, project and tags.
- **Notes screen:** list, read and edit (title, text, tags), new note. If the note changed on
  the computer since the phone opened it, saving stops and shows "Changed on your computer" with
  **Reload** / **Keep mine**.
- **Reply footer:** "Add to notes" and "Add task" buttons under a finished reply, as on the desktop.
- **Link cards:** the same as the desktop's: the desktop fetches the page, and the phone follows
  the desktop's Link previews mode (Always shows cards; Off and Hover show plain links, as a
  phone has no hover) and card style (compact, wide, large, large-side).
- No Automations.

## Research

- Tasks and notes live in the desktop database (`src-tauri/src/tasks.rs`, `notes.rs`) with
  blocking helpers (`tasks_*_blocking`, `notes_*_blocking`). Desktop windows refresh tasks on the
  Tauri event `monocode://tasks-changed`; notes only on a DOM event, so a Tauri event
  `monocode://notes-changed` is added.
- Phone requests reach `mobile_access::handle`, which sends most methods to the window that owns
  the project or session. Tasks, notes and link previews belong to no window, so the desktop
  service answers them itself (new `src-tauri/src/mobile_tools.rs`).
- Link preview mode and card style live in the desktop window's localStorage
  (`linkPreviewSettings.ts`), which Rust can't read. The window adds them to the catalog it
  publishes; `workspace.list` passes them on with `phoneTools: true`.
- `fetch_link_preview` returns the page image as a data URL up to 1 MB; the desktop shrinks it in
  the webview. The phone shows it as is and keeps the last 30 previews in memory.

## Plan

1. **Desktop service** — `mobile_tools.rs`: `tasks.list`, `tasks.create`, `tasks.update`,
   `notes.list`, `notes.read`, `notes.save`, `link.preview`. Runs off the lock in a blocking
   thread; emits the changed events. `notes.save` takes the `updatedAt` the phone started from
   and answers `{conflict, note}` instead of saving when it differs, unless `force`.
2. **Desktop window** — catalog adds `linkPreviews: {mode, cardStyle}`; Notes view listens to
   `monocode://notes-changed`.
3. **Phone** — `features/tools/` (API, task and note helpers), routes `/tasks` and `/notes`
   (list + note editor) as modals, drawer rows for both, reply footer buttons, link cards in
   finished replies.

## Todos

- [x] Desktop service and routing
- [x] Desktop catalog + notes refresh
- [x] Phone API and helpers with tests
- [x] Tasks screen
- [x] Notes list and editor with the changed-on-computer guard
- [x] Reply footer buttons
- [x] Link cards
- [x] Records, gates, release
- [ ] Manual phone + desktop checks (separate follow-up; see Done)

## Issues and fixes

- A desktop window editing the same note keeps its own copy: if it saves after the phone, the
  phone's change is overwritten. The phone side is guarded; the desktop side isn't (out of scope).

## Learnings

- A bare `cargo fmt` reformats unrelated files in this crate; check only touched files with `rustfmt --edition 2021 --check <files>`.
- The phone's lint (React Compiler rules) rejects a ref written during render and a sync `setState` inside an effect: keep the save function in a ref set by an effect, and load lists with `.then` inside the effect.

## Done

- 2026-11-08 14:25 IST. Gates: mobile tsc ✅, expo lint 0 errors, mobile vitest 208/208 (34/35 files; `tests/mobile/watchFrames.test.ts` fails to load, as before), root tsc ✅, root vitest 8059 passed with 1 load flake (`iconCatalog.test.ts`, passes alone), `cargo check` ✅, `mobile_tools` tests 3/3, rustfmt check on touched files ✅.
- Manual follow-up (phone + desktop): side menu shows Tasks and Notes; tick, status change and quick add show on the desktop's Tasks at once; a note edited on the phone shows on the desktop; edit the same note on the desktop while it is open on the phone, then type on the phone → banner, Reload and Keep mine both work; + makes a note that stays after leaving; Add to notes and Add task under a reply; link cards in replies with Link previews Always in each Card style, none with Off or Hover.

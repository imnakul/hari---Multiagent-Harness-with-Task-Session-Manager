# Progress — Share polish, background send, phone composer and notifications (L-299 to L-305)

Created: 2026-11-15 09:55 IST. Branch `nakul/windows-support-upstream-0.16.0`, base `07bd20a5`
(0.16.0-local47, plus the uncommitted L-298 and Antigravity-usage fixes). One agent. Release
`0.16.0-local48` at the end, bundling L-296 (Antigravity), L-298 and this spec.

Decisions came from three Discuss rounds in session b2fe32b4 (2026-11-15 09:10–09:50 IST).

## Locked decisions

1. **Android share sheet sends in the background.** With Hari's code not running, the share target starts
   it with no window (Headless JS task) and sends; Hari never comes to the front and nothing lands in a
   composer. Offline → the item waits in the outbox, toast "Sends when your computer is reachable".
2. **Windows right-click "Share with Hari"** in the classic menu (Windows 11: "Show more options") and in
   "Send to". Files only. Never shows or focuses MonoCode; a closed MonoCode starts minimised. Several
   files picked together go as one group (gathered for ~500 ms). Over 1 GB → a Windows notification.
3. **Phone loading cover** is clear over the wallpaper (the chat's own background), not `colors.background`.
4. **Phone Share draft:** text kept across restarts (like chat drafts), attached files kept while Hari runs.
   Attaching in the app puts files in the composer; they go only on Send.
5. **Phone "Claude is busy on your computer"** shows the native terminal's last lines (read-only) with
   Return to chat, Esc, Enter and Stop Claude.
6. **Desktop Share panel** keeps today's width slide; history and images load after the slide (a skeleton
   meanwhile), on open and close alike.
7. **Skills and saved prompts in the phone composer:** later, not in this spec.
8. **Notifications:** title "Project · Chat"; first line the action and the model ("Finished · Opus 5.5",
   "Needs approval · Opus 5.5"), then the reply's start; expanded shows the full text. Swiping one away
   marks it read on the phone's Notifications page and on the computer's bell.
9. **Phone Share:** no swipe-to-delete. Under each message: Copy, Notes, Task, Pin, Save. Remove only in
   the hold menu.
10. **Desktop Share messages** use the chat's parts (markdown renderer, action icons). Copy always shows;
    Notes, Task, Pin, Save slide in from the right on hover and slide back out on leave. Right-click opens
    a context menu with all of them plus Remove.
11. **Uncontrolled phone composer** (the field holds its own text) now, without waiting for a trace.

## Plan

### A. Phone fixes and polish (L-299)
- `DitherLoading` cover in `SessionScreen`: transparent ground over the wallpaper.
- Composer attachment chip: tap opens images in the sent-message `ImageViewer`, files via `HariShare.open`.
- Computer hub Files page: glass background like Share (`sheetScreenLayout` → wallpaper ground).
- Copy under the user's own messages; Notes = notebook-pen icon, Task = checklist icon.
- `+` button: a drop-up menu anchored on the button (Photos, Camera, Files), keyboard easing, no sheet.

### B. Phone composer uncontrolled (L-300)
- `TextInput` with `defaultValue`; text in a ref; React state only for derived flags (has text, wraps).
- Code-set text (dictation, clear after send, restore after a failed send, draft restore) goes through one
  `setFieldText` helper (`setNativeProps({ text })` / `clear()`).

### C. Phone Share (L-301)
- Draft store (`shareDraft.ts`): text persisted, files in memory.
- No swipe; footer row Copy, Notes, Task, Pin, Save under every message; Remove in the hold menu.

### D. Desktop Share panel (L-302)
- Glass background (`GlassBackdrop`), filters as `SegmentedSwitch`, content mounts after the slide.
- Messages through the chat's markdown renderer; action row: Copy always; Notes, Task, Pin, Save slide
  in from the right on hover (transform + opacity); right-click context menu with everything plus Remove.
- Copy on images copies the picture; one icon size (14px) and colour.

### E. Background send (L-303)
- Android: `HariShareActivity` starts a Headless JS task when Hari's code isn't running; the task opens
  the link, sends pending shares, and ends.
- Windows: HKCU `*\shell\ShareWithHari` + a Send to shortcut run `Hari.exe --share <path>`. The
  single-instance callback (and first launch) gathers paths and calls the Share send without showing
  the window.

### F. Claude busy on the phone (L-304)
- New mobile ops: terminal snapshot (last lines), Return to chat, send key (Esc / Enter). Phone notice card
  shows the lines and the four buttons.

### G. Notifications (L-305)
- Desktop feed items carry the model; phone formats title / first line / big text; a dismiss marks the
  item read on both devices.

## Todos

- [x] A Phone fixes and polish
- [x] B Uncontrolled composer
- [x] C Phone Share
- [x] D Desktop Share panel
- [x] E Background send (Android, Windows)
- [x] F Claude busy on the phone
- [x] G Notifications
- [x] Tests, typecheck, lint; records; release local48

## Issues and fixes

- Composer tests stopped loading once the composer imported the drop-up (worklets) and the attachment viewer (Expo runtime); mocked them, made the test field uncontrolled with `clear` / `isFocused`, and rewrote the old attachment-sheet test for the drop-up.
- `Object.hasOwn` and `Array.at` aren't in the desktop's TypeScript target; plain checks instead.
- Known limits, not fixed here:
  - A share from Explorer while MonoCode is closed can flash its window for a moment before it minimises (the window is visible from the start).
  - Android's background share task gets 10 minutes; a larger send continues the next time Hari opens.
  - A phone note made from a picture lists its name rather than embedding the picture.
  - A swipe-away is noticed on the next feed check (stream push or poll), not instantly; clearing all notifications or a reboot also counts as read.

## Learnings

- Writing edits as Node scripts (Write tool, then `node`) avoids shell quoting breaking backticks, `--flags` and NSIS paths.
- expo-notifications has no dismiss callback on Android; comparing posted ids with `getPresentedNotificationsAsync` finds swiped ones.

## Done

2026-11-15 10:25 IST. All of A to G built; records L-299 to L-305 and the changelog entry written; release 0.16.0-local48.

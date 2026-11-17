# Review — Hari: task editor, side menu on the right, Share background (L-327, L-328)

Branch: `nakul/windows-support-upstream-0.16.0`
Tier: Medium. Phone app (`mobile/`) plus one desktop link method and the release workflow.

## L-327 — Tasks on the phone, and the update fallback

- Goal: Tasks on the phone can be fully edited, and the status and project choices fit the screen.
- User story: As a Hari user, I want to change a task's status and project from a short list, and open the task to edit its title, tags and Markdown details, as on the desktop.
- Acceptance criteria:
  - Status and project are one pill each (the Sound output picker's pattern: `ChoiceMenu`), in the Tasks filter, an expanded task and the add card. "Blocked" is no longer cut off.
  - An expanded task has **Edit**, which slides up a sheet (`ModalSheet`, as the Mono profile) with title, status, project, tags and a **Write | Preview** Markdown body.
  - Closing the sheet (Done, Close, a tap above it or Back) saves only what changed (`taskChanges`); an emptied title keeps the old one.
  - The desktop answers `tasks.read` (the task with its body) and `tasks.update` takes `body`. An older desktop says "Update MonoCode on your computer to edit tasks from the phone."
  - Update fallback: `hari-android.json` carries `apkBackup` (the release's own APK). The phone tries Pages first, then the backup. This only works on phones running a build that has this change (local56 and later).
- States: loading (spinner), computer offline or task deleted (message in the sheet), save error (alert).

## L-328 — Side menu on the right, sidebar order, Share background

- Goal: the phone can be used one-handed. The menu opens from the right, a session swipes back to its project's list, and Share can have its own background.
- Acceptance criteria:
  - The side menu (`WorkspaceDrawer`) is on the right. Swipe left to open it (on a project, past the sessions page). Swipe right or tap the scene to close it. The motion and spring are the same as before, mirrored.
  - Android, in a session: swipe left opens the side menu, and swipe right goes back to the project with its sessions page showing (`useBackSwipe`, `showProjectSessions`). iOS keeps its own swipe back.
  - Side menu order: Notifications, then Monos and Projects, then Share (Wake computer), Tasks, Notes, Settings, and the search at the bottom. Settings moved from the round footer button to a row.
  - Settings → Appearance → **Share background**, with the wallpaper's own tiles and sliders: Same as app (default), None, the presets, or a photo, plus dim and softness. Card opacity stays the app's. Drawn behind the Share chat only (`ShareBackdrop`).
  - The menu button is at the top right, where the menu opens (2026-11-17). On a project, Settings moves to the left. In a mono chat, the mono's own button moves to the left.
- Open questions:
  - Monos and Projects keep their order. The request named Projects only.

## Phone check (manual)

1. Tasks: the status and project pills fit, and each opens a list. Edit slides up, and its changes are saved on close. Check that Preview shows checkboxes.
2. Side menu: swipe left opens it from the right, and swipe right closes it. In a session, swipe left opens the menu, and swipe right lands on the project's sessions list.
3. Side menu order matches the list above. Settings opens.
4. Appearance → Share background: pick a preset or a photo and check that it shows behind Share only. Same as app goes back.
5. Update fallback: needs a release after this change.

# Progress — Attachment storage page (L-273)

Branch: `nakul/windows-support-upstream-0.16.0`
Base: `62a2a762` (plus uncommitted L-265 to L-272)
Created: 2026-11-14 10:49 (IST)
Tier: Large (new Settings page, new backend commands, deletes files)

## Idea
Every pasted or attached file is saved by MonoCode and never cleaned up. Nakul asked
for a place to see them and free the space: a gallery in Settings, grouped by chat or
project, with delete for one image, a chat's files, a project's files, or all.

- User story: As a MonoCode user, I want to see every image I pasted into chats, open
  the chat it came from, and delete the ones I no longer need, so the saved files do
  not grow without bound.
- Fork-only (not in upstream).

## Research
- Pasted files: `write_attachment` (`src-tauri/src/fs.rs`) saves to
  `%TEMP%\monocode-attachments\<pid>-<nanos>-<name>`. Chats keep only the `path`
  (`persistableAttachment`), so old chats show their images from these files. On this
  computer: 449 files, 70 MB.
- Interactive Claude copies: `claude_interactive_attachments` saves to
  `<app data>\interactive-attachments\<Claude session uuid>\<uuid>.<ext>` (148 MB here).
  The chat shows the pasted file, not this copy; the copy is what Claude read.
- Map to chats: `sessions.blocks_json` holds the pasted paths; `sessions.provider_session_id`
  is the Claude session uuid.

## Plan
- Backend `src-tauri/src/attachment_storage.rs`:
  - `attachment_storage_scan` lists both folders, links files to chats (paths found in
    `blocks_json`, copies by `provider_session_id`), returns files, the linked chats
    and the two folder paths.
  - `attachment_storage_delete(paths)` deletes only files directly in the pasted
    folder or in a uuid folder under the interactive folder (checked after resolving
    the real path; never a link, never a folder), removes emptied uuid folders, and
    reports what was deleted, the bytes freed and what failed.
- Frontend: Settings → Workspace → Storage (`StorageSettings.tsx`). Totals, open the
  folder, views By chat / By project / All, newest first. Thumbnails load only when
  visible. Click opens full size; buttons on each image (hover or focus): Copy
  image, Show in folder, Delete; the group title opens the chat. Delete buttons per chat, per project and for everything shown, each
  confirmed with the count, the size and "these images disappear from those chats".
- Pure grouping model `attachmentStorage.ts` with unit tests.
- Date filter (asked after the first build): presets All time / Today / Last 7 days /
  Last 30 days / Older than 30 days / Custom dates (native date inputs, From and To,
  either end optional). Local calendar days; groups, totals and every delete cover only
  the files shown, and confirmations say "saved in the chosen dates".

## Todos
- [x] Spec
- [x] Backend scan + delete + Rust tests
- [x] Model + tests
- [x] Settings page
- [x] Records (LOCAL-FEATURES, changelog)
- [x] Date filter + tests
- [ ] Desktop check (manual, see below)

## Issues and fixes
- The Settings search test requires every `data-setting-id` on a page to have a `SETTINGS_INDEX` entry; added `storage-attachments`.

## Learnings
- A file used by several chats (forks, copies) is filed once, under the chat updated last, so totals never count it twice; the delete confirmation says how many are shared.
- Settings → Storage is not a separate window, so drag onto a composer works only where a composer is visible beside Settings.

## Manual desktop check
1. Settings → Workspace → Storage: totals show; By chat / By project / All switch.
2. Thumbnails load as you scroll; click opens full size; Copy puts the image on the clipboard; folder button opens Explorer with the file selected.
3. Click a chat title: the chat opens.
4. Delete one image, then reopen its chat: the image shows as a file chip with no preview.
5. Delete a group: confirmation lists the count and warning; the status line reports files deleted and space freed.
6. Saved → Today / Last 7 days: only those files show and "Showing N of M files" appears; Custom dates with one day, then a from–to range; "Delete N shown…" deletes only those (try on a few test pastes, not real ones).

## Done

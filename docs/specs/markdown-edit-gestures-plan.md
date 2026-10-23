# Review — Double-click to edit and Ctrl+E in Markdown views (L-182)

Created 2026-10-23 09:36 IST. Tier: Medium. All platforms.
Branch `ccr-b2ff3f4a-btpy2f`, base `23320ae8` (`nakul/windows-support-upstream-0.16.0`).

## Goal

Notes, Tasks and Session metadata show Markdown as Preview/Source tabs. Switching means
reaching for the tab strip, and Source then opens at the top, not where you were reading.
Make the switch a keystroke, and make double-clicking what you read open it for editing.

## Acceptance criteria

1. Ctrl+E (Cmd+E on macOS) toggles Preview and Source in Notes, Tasks and the Session
   metadata dialog, while focus is in the Markdown area (the Source field, or the preview
   after clicking it).
2. Ctrl+E from Source to Preview focuses the preview, so Ctrl+E again works; back in Source
   the caret returns to where it was.
3. Double-clicking text in Preview opens Source with the caret on the clicked line, at the
   clicked word, and scrolls that line into view.
4. Double-clicking a link, checkbox, button, image or video keeps its own behaviour.
5. Double-clicking empty preview space opens Source with the caret at the end.
6. The Preview and Source tabs show the shortcut in their tooltip and `aria-keyshortcuts`.

## Plan and files

- `src/features/sessions/model/markdownPreviewSource.ts` (new, pure, tested): the preview
  renderer (Streamdown) keeps no source positions, so the click is matched by text. The
  clicked block's first rendered line is found among the source lines with syntax removed
  (exact, then prefix, then substring; the n-th same-text block picks the n-th match), the
  line inside the block is added (`<br>` count, or newlines in code), and the clicked word
  sets the column.
- `src/features/sessions/ui/useMarkdownEditGestures.ts` (new): reads the click target from
  the DOM, handles the shortcut, and places the caret after Source mounts.
- `MarkdownSourceEditor.tsx`: highlight rows carry `data-source-line` for scrolling.
- `MarkdownDetailTabs.tsx`: tooltip and `aria-keyshortcuts`.
- `NotesView.tsx`, `TaskEditor.tsx`, `SessionMetadataDialog.tsx`: wire the hook; the
  preview is wrapped in a focusable `div` (`tabIndex=-1`).

## Out of scope

- Markdown files in the file viewer (CodeMirror source, separate toggle): follow-up.
- Editing inside the preview (Tiptap/Milkdown or CodeMirror live preview): separate decision.

## Risks

- Text matching can pick the wrong line when two different blocks render the same first
  line in different kinds of blocks; the caret is then on a same-text line nearby.
- Ctrl+E only works once focus is inside the Markdown area; a freshly opened note in Preview
  needs one click first.

## Checklist

- [x] Pure mapping + 12 unit tests
- [x] Hook wired into Notes, Tasks, Session metadata
- [x] tsc, full vitest
- [ ] Desktop check

## Desktop check (manual, not for the implementation agent)

1. Note in Preview: double-click a word in a paragraph, a list item, a heading, a table cell
   and a code line; Source opens with the caret on that word.
2. Long note: double-click near the bottom; Source scrolls to that line.
3. Ctrl+E in Source → Preview; Ctrl+E again → Source with the caret where it was.
4. Double-click a link and a task checkbox in Preview: they behave as before.
5. Same in a task and in the Session metadata dialog (Esc still closes the dialog).

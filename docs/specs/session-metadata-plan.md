# Review — Session metadata: a label and notes for any chat (L-181)

Created 2026-10-22 19:02 IST. Tier: Large (new table, new commands, new feature area).
All platforms. Branch `nakul/windows-support-upstream-0.16.0`, base `c017dcf8`.

Named "session metadata", not "notes", so it is never confused with the Notes page.

## Idea

Chat titles come from the first prompt and say little once many chats are open. Let the user
give any chat a short **label** (one line) and free **notes** (markdown), then:

- show the label in place of the chat title wherever chat cards and tabs show the title
  (setting 1), and
- show the label and notes when hovering a chat card or tab (setting 2).

## Research

- Session titles render through `sessionDisplayTitle(title, harness)` in ~40 places. Cards
  and tabs that show it: sidebar `SessionCard` (Sidebar.tsx, dense inset and classic),
  `features/sessions/ui/SessionCard.tsx` (Chats panel, Monos, provider lists),
  `BoardSessionCard`, Focus pane headers and chat tabs (`FocusView.tsx`), title-bar tabs
  (`toTitleTab` in App.tsx → `TitleBar.tsx`).
- Hover today: dense sidebar rows open `SessionCardPreview` (model, status, title, branch,
  worktree or directory, changes); classic cards, Focus tabs and title-bar tabs use the native
  `title` tooltip.
- Storage: the `sessions` table is upstream's. Fork tables live in their own modules
  (`prompts.rs`, `tasks.rs`) and are created from `SessionStore` setup. Saved prompts are the
  closest model: one table, list/upsert/delete commands on the store pool, a change event to
  all windows.
- Editing UI to reuse: Notes' `MarkdownDetailTabs` + `MarkdownSourceEditor` (source) and
  `AgentMarkdown` (preview); the `SavePromptDialogHost` pattern (one host per window, opened
  by a window event) for the dialog; `ExplorerMenu` items for context menus.
- Settings booleans: localStorage key + change event + `useSyncExternalStore`
  (`compactModelLabels`). Global rows live in Settings → General → Workspace.

## Plan

### Storage (Rust)

- New `src-tauri/src/session_metadata.rs`: table
  `session_metadata(session_id TEXT PRIMARY KEY, label TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL)`, created next to the other
  fork tables. No foreign key (an upstream `INSERT OR REPLACE` on `sessions` would cascade);
  `delete_session` removes the row in its transaction instead (one fork line).
- Commands: `session_metadata_list` (all rows), `session_metadata_upsert {sessionId, label,
  notes}` (trims the label, newlines become spaces; both empty deletes the row),
  `session_metadata_delete`. Event `monocode:session-metadata-changed` to every window.
- Limits: label ≤ 120 characters, notes ≤ 100,000 bytes, session id checked by `validate_id`.

### Client

- `src/features/sessions/model/sessionMetadata.ts`: types, `parseSessionMetadataRows`
  (narrows the command result; bad rows dropped), invoke wrappers, a small store (loaded once
  on first subscriber, refreshed on the event) and `requestSessionMetadataEdit(sessionId)`.
- `src/features/sessions/ui/useSessionMetadata.ts`: `useSessionMetadata(id)`,
  `useSessionLabel(id)` (label only when setting 1 is on), `useSessionHoverMetadata(id)`
  (metadata only when setting 2 is on and it has a label or notes).
- `src/features/sessions/ui/SessionMetadataDialog.tsx`: host mounted once in App; Modal with
  Label input and Notes (Edit / Preview tabs, Notes' editor). Save, Cancel, Clear. Ctrl/Cmd+Enter
  saves; errors inline.
- `src/features/sessions/ui/SessionMetadataHoverCard.tsx`: the hover body (label in accent,
  notes rendered, clamped and scrollable) and a hover hook for tabs and classic cards.
- Settings (`settings.ts`, General → Workspace): **Show label where available**
  (`monocode.sessionLabels`) and **Show metadata on hover** (`monocode.sessionMetadataHover`).

### Surfaces

- Context menu item **Session metadata…** in: sidebar session menu, Chats panel menu,
  title-bar tab menu (focused chat of the tab).
- Label in place of the title (accent colour) when setting 1 is on: sidebar cards (both
  layouts), `SessionCard.tsx`, board cards, Focus pane headers and chat tabs, title-bar tabs.
- Hover when setting 2 is on and the chat has metadata: the dense sidebar preview shows label
  and notes in place of branch/worktree; classic cards, Focus chat tabs, Focus pane headers and
  title-bar tabs open a hover card with label and notes instead of the native tooltip.

## Acceptance criteria

1. Right-click a chat in the sidebar, Chats panel or a title-bar tab → **Session metadata…**
   opens the dialog with the saved label and notes.
2. Saving stores both; reopening shows them; another window sees the change.
3. Clearing both fields (or Clear) removes the row; the chat shows its normal title again.
4. Setting 1 on: chats with a label show it in accent colour in place of the title on every
   surface listed above; chats without one show their title. Off: titles everywhere.
5. Setting 2 on: hovering a chat with metadata shows its label and notes (notes as markdown)
   on every surface above; chats without metadata keep today's hover. Off: today's hover.
6. Deleting a chat deletes its metadata.
7. A label over 120 characters or notes over 100,000 bytes are refused with a clear message.
8. Search, notifications, toasts and window titles keep the real chat title.

## States

Dialog: loading (fields disabled until the row is known), editing, saving (buttons disabled),
save error (inline, retry by saving again). Hover: metadata / none (fallback to today's hover).
Store load failure: logged once; labels simply do not show.

## Out of scope

"Draft from chat" auto-summary, the phone app, per-sidebar toggles, search by label, label on
notifications and window titles, remote-host sessions' metadata on the remote machine
(metadata is local to this PC for every session id).

## Todos

- [x] Rust module, commands, delete hook, tests
- [x] TS model + store + tests
- [x] Settings toggles + search entries
- [x] Dialog + context menus
- [x] Labels on cards and tabs
- [x] Hover metadata on cards and tabs
- [x] Gates: tsc, vitest, `npm run check`, cargo fmt/check/clippy/test
- [x] Records: changelog, LOCAL-FEATURES

## Issues and fixes

- Hover cards render in a portal, and React bubbles portal events to the anchor's tree, so a
  click inside a card opened the chat (board card) or started a tab drag. The card stops
  click, pointerdown, mousedown and contextmenu at its root.
- A card's focusable element is often a child (the sidebar card's inner button), so the
  focus check reads `event.target`, not `currentTarget`.

## Learnings

- Tabs and Focus panes are rendered inside `map`, where a hook can't run:
  `SessionMetadataHover` is a render-prop wrapper around `useSessionMetadataHoverCard`.

## Done

Implemented 2026-10-22, awaiting the desktop check below. Hover covers sidebar cards (the
dense card's preview shows metadata in place of branch and folder), Chats panel and Monos
lists (`SessionCard`), board cards, Focus chat tabs and pane titles, and title-bar tabs.

## Desktop check (manual, not for the implementation agent)

1. Sidebar right-click → Session metadata…: set label "Auth spike" and notes with a list; Save.
2. With Show label on: the sidebar card, Chats panel, Focus pane header and chat tab, and the
   title-bar tab show "Auth spike" in accent. Turn it off: titles return.
3. With Show metadata on hover on: hover the card (both sidebar layouts), the Focus chat tab
   and pane header, the title-bar tab: label and rendered notes show. A chat without metadata
   shows the old hover. Turn it off: old hover everywhere.
4. Clear the metadata: the title and old hover come back.
5. Delete the chat, restart: nothing left behind (no errors).
6. Quick Composer window open while editing: no errors.

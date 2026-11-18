# Review — Hari: block actions, Select text, bookmarks; Command Code keeps working; Share link menu (L-351 to L-355)

Branch: `nakul/windows-support-upstream-0.16.0` · Base: `8dc0c748` · Created: 2026-11-19 00:42 IST

## Idea

User report 2026-11-18 (two screenshots). Locked decisions (discuss round, 2026-11-18):

- **2A** Phone code blocks wrap to the screen (tables still scroll sideways), with a wrap button in the block's action row.
- Phone code blocks, tables and quotes get the desktop's block actions: Add task, Add to notes, Copy, in the desktop's order. Add Draft to Sessions stays on the desktop. Hidden while the reply streams.
- **1A** A "Select text" button under each reply opens it as one selectable page (plain text, code in monospace). A selection shows Hari's own bar: Copy, Bookmark, Add to notes, Add task.
- **3A** Command Code turns carry a standing line: keep working until the task is done; don't end a turn by announcing the next step.
- Desktop Share panel: right-click on a link shows Open in default browser, Open in MonoCode browser, Copy link first, then the usual items. Left-click still follows Settings → Web links.
- **4A** A bookmark button under each phone reply saves to the desktop's session Bookmarks list (set = accent colour); a bookmarked selection saves the quote. Hidden in Mono chats and when the desktop is too old.

## Research

- Command Code log (`~/.commandcode/projects/.../67a332a8-….jsonl`): each turn did one step and ended with text only ("Now creating …"); nothing runs between messages. The model chooses to stop. `cmdc` 1.88.5 print mode has no system-prompt flag, so the line goes in the message.
- Desktop bookmarks live in the `session_panel` table (`session_panel.rs`), JSON shaped by `sessionPanel.ts`. Phone `Turn.id` is the desktop block id of the turn's first block, which the desktop's bookmark `blockId` uses.
- React Native `Text` gives no selection range, and Android selection stops at each `Text`; a `TextInput` that never takes typing gives one selectable page with `onSelectionChange`.

## Plan

| ID | Where |
|---|---|
| L-351 | `mobile/src/features/sessions/SelectTextSheet.tsx`, `selectableText.ts`, footer button in `TranscriptTurn.tsx` |
| L-352 | `mobile/src/features/sessions/Markdown.tsx` (`CodeBlock`, `BlockActions`), `markdownParser.ts` (`blockCopyText`), `tools/ReplyTools.tsx` (`BlockToolButtons`) |
| L-353 | `src/integrations/harness/providers/command-code/commandCodeProtocol.ts` (`commandCodeTurnText`), `commandCode.ts` |
| L-354 | `src-tauri/src/mobile_bookmarks.rs` (`bookmarks.list/toggle/quote`), `mobile_access.rs` (routing, `catalog.bookmarks`), `sessionPanel.ts` (re-read an unwatched copy before saving), phone `ReplyTools.tsx` (`BookmarksProvider`), `TranscriptTurn.tsx` (`BookmarkButton`) |
| L-355 | `src/features/mobile/ui/ShareBubble.tsx` |

## Edge cases

- A reply still streaming shows no block actions; a fold's muted prose shows none.
- Mono chats and desktops without `catalog.bookmarks`: no bookmark button, no Bookmark in the selection bar.
- The same quote bookmarked twice moves to the end instead of doubling; at most 300 bookmarks, as on desktop.
- A desktop window that has the chat's panel open reloads on the phone's save; one that loaded it earlier but isn't watching re-reads before its next save, so the phone's bookmark isn't overwritten.
- Plan turns and AI helper turns in Command Code don't get the keep-working line.
- A right-click on a non-web link (file path) keeps its own menu.

## Manual checklist (not for the implementing agent)

Phone:
1. A reply with a long code line: it wraps; the wrap button (accent when on) turns it into a sideways scroll.
2. Code block, table, quote: Add task, Add to notes, Copy at the top right; each ticks and lands on the desktop.
3. While a reply streams, no block actions; they appear when it finishes.
4. Footer → Select text: the whole reply opens; drag across paragraphs and code; bar shows Copy, Bookmark, Add to notes, Add task; no keyboard appears.
5. Footer bookmark: tap → accent; the desktop's session panel Bookmarks lists it; tap again → removed on both. Reopen the chat: state kept.
6. Mono chat: no bookmark button.
7. Long links and paths in normal text wrap.

Desktop:
8. Share panel → right-click a link: the three link items first; each works. Left-click follows Web links.
9. Command Code (Muse Ember) on a multi-step task: it carries on instead of stopping after "Now doing X".

## Issues and fixes

- My edit helper's heredoc lost backslashes in regexes twice (ShareBubble, markdownParser); fixed by editing those lines directly.
- `tests/ProjectScreen.test.tsx` needed an `expo-clipboard` mock once reply tools copied.

## Learnings

## Done

2026-11-19, built in one session; see the changelog entry for the commit. Phone and desktop checks (checklist above) still to do.

Differences from the plan:

- A set bookmark shows in the accent colour, as Share's saved items do; Hari's icon set has no filled bookmark.
- Normal text already wraps long words in React Native; the overflow was the code blocks.

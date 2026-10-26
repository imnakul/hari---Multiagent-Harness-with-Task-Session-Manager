# Review — Markdown Live mode, everywhere Markdown is edited (L-183)

Created 2026-10-26 07:58 IST. Tier: Medium. All platforms.
Branch `nakul/windows-support-upstream-0.16.0`, base `9a146b6c`. Changes L-182.

## Goal

L-182's double-click opened Source at the clicked line, but Source is raw text and reading
needs another switch back. Add an Obsidian-style **Live** view (formatted while you type,
Markdown symbols only on the caret's line) and make it the default way to edit, in every
editable Markdown view, through shared components rather than per screen.

## Decisions (agreed 2026-10-26)

1. Tabs **Live | Preview | Source**; Live is the default for editable Markdown.
2. Double-click in Preview opens **Live** at the clicked line and word. Source keeps its
   normal double-click (select a word).
3. Ctrl+E (Cmd+E) toggles Live ↔ Preview (from Source it goes to Preview).
4. Applies globally: Notes, Tasks, Session metadata, `.md` files from the explorer, plan
   panes. Read-only views (Skills) keep Preview | Source.

## Plan and files

- `files/editor/markdownLive.ts` (+ test): CodeMirror extension. `collectLiveSpecs` (pure,
  tested) walks the Lezer Markdown tree (GFM base) and returns specs: heading line styles,
  bold/italic/strike/code marks, links (Ctrl/Cmd+click opens), bullets → dots, task markers →
  clickable checkboxes, quotes, rules, note images, code blocks and tables styled; syntax hidden
  except on lines touched by the selection while focused.
- `sessions/ui/MarkdownLiveEditorView.tsx`: controlled CodeMirror editor (history, list
  continuation from `@codemirror/lang-markdown`, Ctrl/Cmd+Enter left to the host form).
  `MarkdownLiveEditor.tsx` lazy-loads it (`lazySurface`) and surfaces preload it on mount.
- `sessions/ui/markdownCaret.ts`: `MarkdownCaretTarget` (selection + focusAt) for textarea,
  Live and the file editor; `useMarkdownImages` inserts images through it in any mode.
- `sessions/ui/MarkdownEditorPanel.tsx`: the one body for Notes/Tasks/Session metadata
  (Live/Preview/Source + gestures). `MarkdownDetailTabs` shows three tabs.
- `MarkdownModeToggle.tsx`: `MarkdownViewMode` adds `live`; `MarkdownViewShell` takes `live`
  (a node, or `"source"` when the source editor turns itself into Live) and owns the gestures.
- `useMarkdownEditGestures.ts`: double-click → Live, Ctrl+E Live ↔ Preview; waits for the
  lazy editor before placing the caret.
- `FileEditor.tsx`: Live = same CodeMirror with `markdownLive` and no gutters (compartments);
  search navigation from Preview opens Live. `fileViewMode.ts` stores `live`, default Live.
- `FilePane.tsx`: plan panes get a Live view (read-only while streaming/building).
- `editorLanguage.ts`: Markdown files parse with the GFM base (tables, strike, task lists).

## Out of scope / later

- Tables and Mermaid drawn in Live (shown as styled text; Preview renders them).
- Images other than Notes/Tasks note images (project-relative images in `.md` files stay text).

## Risks

- Cursor jumps when a line's symbols appear on focus (standard for this style).
- IME and very long documents (CodeMirror only decorates the visible part).
- File editor Live typography sits on top of the code theme; check fonts visually.

## Checklist

- [x] Live extension + 12 rule tests; panel gesture tests (3); file view mode tests (2)
- [x] Notes, Tasks, Session metadata, file editor, plan pane
- [x] tsc, full vitest (7,727 passed), `vite build` (Live chunk ≈ 12 KB gzip)
- [ ] Desktop check

## Desktop check (manual, not for the implementation agent)

1. Note in Live: type `## Plan`, `**bold**`, `- item`, `- [ ] todo`, a link; formatting
   appears when the caret leaves the line; Enter continues lists; clicking a checkbox ticks it.
2. Preview: double-click a word → Live with the caret there. Ctrl+E back and forth.
3. Paste an image in Live: it inserts at the caret and shows inline.
4. Open a `.md` file from the explorer: opens in Live, no line numbers, autosave works, Source
   shows line numbers again; search result jumps still land on the line.
5. Session metadata dialog: Ctrl+Enter still saves, Esc still closes.
6. Tasks: Ctrl+Enter still creates the next task while typing in Live.

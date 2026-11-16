# Review — Remove Markdown Live mode (L-324)

Branch: `nakul/windows-support-upstream-0.16.0`
Tier: Medium. Removes L-183.

- Goal: Markdown has two views again, Preview and Source. The formatted Live editor goes.
- User story: As a Hari desktop user, I want Markdown to open as a clean preview and edit as plain source, without a third Live view.
- Acceptance criteria:
  - Notes, Tasks, Session summary, `.md` files and plan panes show **Preview | Source** tabs only.
  - Opening defaults to Preview. Blank new notes and tasks, and the Session summary editor, open in Source, ready to type.
  - Ctrl+E (Cmd+E on macOS) switches Preview and Source wherever the body can be edited. Double-clicking text in Preview opens Source with the caret on that line.
  - A file view saved as `live` by an older build opens in Preview.
  - A jump to a line in a `.md` file switches from Preview to Source.
  - The Live editor code is gone: `markdownLive.ts` (+ test), `MarkdownLiveEditor.tsx`, `MarkdownLiveEditorView.tsx`. The `.md` source highlighter is upstream's again.
- States: no network or async states. Read-only views (diff tabs, SVG, locked plans) show the tabs without the shortcut.
- Out of scope: the phone app (it never had Live).
- Open questions: none.
- Desktop check (manual, not for the implementation agent): open a note, a task, a `.md` file and a plan; check the two tabs, Ctrl+E, double-click into Source, and that a blank note opens in Source.

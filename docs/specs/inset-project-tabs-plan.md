# Review — Inset sidebar: project tabs with Ctrl+click (L-130)

Created 2026-10-20 15:55 IST. Status: Review (desktop check manual).

- Goal: keep a few projects one click apart in the inset layout, without changing how a plain click works.
- User story: As someone working across a few projects, I want to Ctrl+click projects in Switch project so they sit as tabs beside the current project's name, and click a tab to switch.
- Acceptance criteria:
  - A plain click on a project in Switch project still switches to it and closes the menu.
  - Ctrl+click (⌘+click on macOS), or Ctrl+Enter on the highlighted row, adds that project as a tab and keeps the menu open. The current project is added with it, so you can switch back. Ctrl+clicking a project that is already a tab removes it. Ctrl+clicking the current project does nothing.
  - Rows that are tabs show a "Tab" label. Each row's tooltip names the Ctrl+click shortcut.
  - The tabs sit right of the project name in the inset sidebar's top row, in the order they were added. The current project keeps its place among them, marked selected, so switching never reorders the tabs.
  - Clicking a tab switches to that project. Its × button or a middle-click removes it; a right-click opens the project's menu.
  - Tabs show a working project's mascot animating, like the rail.
  - Tabs are remembered across restarts. Projects removed from the app drop out.
  - Hover glides between the tabs, like the menus.
- States: no tabs (row looks as before), one or more tabs, narrow sidebar (tabs scroll sideways; names truncate), project removed.
- Out of scope: showing two projects' sessions at once; tabs in the classic layout; drag to reorder.
- Open questions: none.

## Files

- `src/features/projects/model/projectTabs.ts` (+ test): toggle, close, visible list, storage.
- `src/features/projects/ui/ProjectTabs.tsx`: the tab row.
- `src/features/projects/ui/SearchableProjectPicker.tsx`: Ctrl+click and Ctrl+Enter, "Tab" label.
- `src/app/shell/Sidebar.tsx`: state, wiring into the inset header.

## Manual desktop check

1. Inset layout: open the project menu, then Switch project; plain click switches and closes.
2. Ctrl+click two other projects: the menu stays open, both rows show "Tab", tabs appear beside the name.
3. Click a tab: the project switches, that tab shows selected, and no tab moves.
4. × and middle-click remove a tab; right-click opens the project menu.
5. Restart: tabs are still there.
6. Narrow the sidebar: tabs scroll, nothing overflows the search icon.

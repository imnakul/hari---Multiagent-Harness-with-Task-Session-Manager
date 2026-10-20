# Review — Focus mode: every running chat side by side, across projects (L-123)

- Tier: Large · Branch: `nakul/windows-support-upstream-0.14.0` · Base commit: `a53e2f3e` · Created 2026-10-20 03:37 IST
- Skills: `frontend-ui`; `testing` for the model tests.
- Desktop UI checks are Nakul's. The implementer finishes with the manual checklist at the end.

## Idea

- **Goal:** work on several projects at once. Watch every running chat and keep working in each without switching projects or tabs.
- **User story:** As someone running chats in 3 projects, I want one button that hides the chrome and tiles all my running chats, so I can watch and answer each one in place.
- **Acceptance criteria**
  1. A **Focus** button sits at the top left of the title bar. Clicking it enters Focus mode. Clicking it again (or Esc when no field or menu is focused) leaves Focus mode and restores the previous layout exactly.
  2. Focus mode hides the left sidebar, the project rail, the project tab strip and the right panels. It keeps the title bar (window controls, Focus button, the Focus top bar below) and the slim bottom bar (usage, CPU).
  3. On entry, Focus shows every running session in any project: `isSessionWorking` (L-122), so local turns and external turns both count. Ephemeral sessions are excluded.
  4. **Grid:** columns fill first, up to 4. Columns 1–4 each hold one chat. The 5th chat splits column 1 into two rows (it goes in the bottom row), the 6th splits column 2, and so on, up to 8 chats (4 × 2). One chat fills the screen.
  5. **Stable placement:** a chat never moves on its own. A new chat goes into the next free place by the rule above. Closing a chat removes it from its column. A column left empty is removed, and the other columns keep their order. Nothing reorders because of status changes.
  6. **Chats stay** after their turn ends. A chat leaves the grid only when the user closes it (pane X), or leaves Focus and declines to keep it (see Open questions).
  7. A session that starts running while Focus is open (from the phone, an automation, a queued send) is added by the same rule.
  8. **Pane header:** project icon and name, chat title, and a status tag (Working, Needs attention with the reason Permission or Question, Done, Failed, Stopped). Reuse `boardCardTag` tones from the Session Manager.
  9. **Drag to reposition:** drag a pane by its header onto another pane. Dropping on an edge places it beside or above/below that pane. Dropping in the centre swaps the two. Drops that would make a 5th column or a 3rd row are refused (no drop indicator).
  10. **Top bar "New" split button** (shown in Focus mode). The main click starts a new chat. The arrow opens three options: **Start new**, **Continue**, **Import**.
      - **Start new:** inline controls appear beside the button: project picker, model, effort (and permission mode if it fits). **Start** adds an empty chat pane with those settings and focuses its composer.
      - **Continue:** a searchable dropdown of sessions in Done, Needs attention and Draft (Session Manager lanes), grouped by lane with project labels. Picking one adds it to the grid.
      - **Import:** opens the existing Resume session dialog (L-71). Resumed sessions join the grid.
  11. **Empty state:** when Focus has no chats, the whole screen shows the new-session screen with the same three choices as large options. Start new shows the project, model and effort controls and the composer.
  12. The Focus grid (columns and the session in each place) is saved across restarts. Sessions that no longer exist are dropped on load.
- **States:** empty; 1 chat (full screen); 2–4 columns; 5–8 with split columns; full (8, see Open questions); a chat working, needing attention, done, failed; a session deleted or archived while shown (pane removed); drag in progress, drop refused; narrow window (below ~1100 px wide, see Open questions).
- **Out of scope:** changing the Session Manager or Task Manager; auto-sorting by status; more than 8 panes on screen; a Focus mode in the phone/remote client; per-pane resize memory beyond the session (sizes reset to equal when the grid changes).
- **Open questions** (defaults the implementer uses unless Nakul says otherwise)
  1. A 9th running chat: default, it goes into a "+N more" menu in the top bar; picking one swaps it with the pane the user chooses. Alternative: allow a 3rd row.
  2. Leaving Focus: default, the grid is kept for next time; nothing opens in project tabs.
  3. Shortcut to toggle Focus: default `Ctrl+Alt+F` if free (check the shortcut list); otherwise pick a free one and record it.
  4. Narrow windows: default, at most 2 columns below 1100 px and 1 below 700 px; the rest go into the "+N more" menu.
  5. Should automation-started chats join automatically? Default yes, matching rule 7.

## Research

Starting points found in the code (verify before relying on them):

- **Split panes:** `src/features/workspace/model/layout.ts`: `LayoutNode` is a tree of `leaf` and `split` (`right`/`down`) nodes; `splitPane` adds a pane. `src/features/workspace/ui/PaneTree.tsx` renders the tree, has pane drag (`startPaneDrag`) and drop zones (`src/features/workspace/model/paneDrop.ts`). A Focus grid can be built as a `LayoutNode` (root `right` split of columns; a two-row column is a `down` split) and rendered with `PaneTree`.
- **Tabs belong to a project:** `workspaceTabCwd` (`workspaceTabGroups.ts:22`) takes the first session's cwd, and `filterTabsForProject` hides other projects' tabs. So Focus must not be a normal workspace tab. Make it an app-level view (see `src/features/workspace/model/appViewTabs.ts`, like Task Manager and Session Manager), or a separate mode in `App.tsx`.
- **Chat pane:** `src/features/sessions/ui/SessionPane.tsx` (`SessionPane`), the full chat with composer used inside `PaneTree`.
- **Working check:** `src/features/sessions/model/workingSessions.ts` → `isSessionWorking` (L-122).
- **Status tags and Continue lists:** `src/features/session-board/sessionBoard.ts` → `boardLane`, `boardCardTag`, `BOARD_LANES`, `visibleBoardCards`, `boardSnapshot`/`subscribeBoard`.
- **Start new controls:** Quick Composer pieces in `src/features/quick-composer/ui/` (`QuickModelSelector`, `QuickPermissions`, `QuickProjectIcon`, `QuickWorkspaceControls`). They run in the floating window today; check they work in the main window. `src/shared/ui/SearchableSelect.tsx` for the Continue dropdown.
- **Empty state:** `src/features/sessions/ui/EmptySession.tsx` (the existing new-session screen).
- **Import:** `MigrationView` (`onImportSessions` in `App.tsx`), the Resume session flow (L-71).
- **Title bar:** `src/app/shell/TitleBar.tsx`; bottom bar visibility rules from L-93.

## Plan

1. **Model (pure, tested):** `src/features/focus/model/focusGrid.ts`
   - `FocusGrid = { columns: string[][] }` (each column has 1–2 session ids).
   - `addToFocusGrid`, `removeFromFocusGrid`, `moveInFocusGrid(grid, id, target, edge | "swap")`, `focusGridLayout(grid): LayoutNode`, `pruneFocusGrid(grid, sessionIds)`, `FOCUS_GRID_MAX = 8`.
   - Storage: localStorage `monocode.focusGrid.v1`, validated with Zod on load; malformed data is ignored.
2. **Mode state** in `App.tsx`: `focusMode` on/off, saved layout to restore on exit, and the effect that adds newly working sessions (rule 7).
3. **UI:** `src/features/focus/ui/FocusView.tsx` (grid via `PaneTree`, or a thin wrapper if `PaneTree` is too tied to `WorkspaceTab`); `FocusTopBar.tsx` (New split button and inline Start new controls, Continue dropdown, "+N more"); `FocusPaneHeader` (project label and status tag); empty state reusing `EmptySession`.
4. **Title bar:** Focus button at the top left, and hiding the sidebars, rail and tab strip while Focus is on.
5. **Records:** LOCAL-FEATURES L-123 (index, detail, Last updated), changelog entry, this spec's Todos.

**Risks**
- Up to 8 chats streaming at once all re-render. Measure with the existing streaming performance work (`streamingPerformance.ts`) before raising the cap.
- A session open in a project tab and in Focus at once: only one view is mounted at a time, but check composer drafts and scroll position survive the switch.
- `PaneTree` drop zones allow any split; Focus must restrict them (4 columns, 2 rows).
- Keyboard focus between panes and Esc handling must not steal Esc from the composer, menus or dialogs.

## Todos

- [x] `focusGrid.ts` and tests: add order (columns first, then bottom rows from column 1), remove (empty column collapses, nothing else moves), move and swap, refused moves, prune, layout output, storage validation.
- [x] Focus mode state, entry/exit restore, auto-add of newly working sessions.
- [x] `FocusView` grid rendering and pane close.
- [x] Pane header with project label and status tag.
- [x] Drag to reposition with restricted drops.
- [x] Top bar New split button: Start new (project, model, effort), Continue, Import.
- [x] Empty state.
- [x] Narrow-window and 9th-chat behaviour (Open questions 1 and 4).
- [x] Gates: typecheck, full test suite; records.
- [x] Hand over the manual desktop checklist (below).

## Manual desktop checklist (Nakul)

1. Run chats in two projects, press Focus: both show side by side, with sidebars and the tab strip hidden.
2. Start chats until there are 5, then 6: column 1 then column 2 split into two rows; nothing else moves.
3. Close a pane in a split column and a pane alone in its column: the grid closes the gap without reordering.
4. A chat finishes: it stays, with its tag changed to Done. A permission prompt shows Needs attention.
5. Drag a pane onto another's edge and centre; try making a 5th column (refused).
6. New → Start new (pick project, model, effort), Continue (pick a Done chat), Import (resume a CLI conversation).
7. Close every pane: the full-screen new-session screen shows.
8. Leave Focus: the previous project, tabs and sidebars come back. Restart the app: the Focus grid is restored.

## Issues and fixes

Deviations from the plan, decided while building (2026-10-20 04:20 IST):
- **Grid rendering:** a flat keyed list on a CSS grid with explicit grid lines, not `PaneTree`. `PaneTree` renders a nested split tree, so moving a pane would remount its chat; keyed panes keep their transcript, composer draft and scroll. Panes past the visible cap ("+N more") are unmounted.
- **No Zod:** the repo has no Zod dependency, so `parseFocusGrid` validates stored data by hand (malformed data is ignored).
- **No saved layout to restore:** the workspace stays mounted (hidden and `inert`) under Focus, so leaving Focus shows it exactly as it was; nothing is saved or restored.
- **Start new** picks the project only; model and effort are chosen in the new pane's composer, like any new chat.
- **"+N more":** picking a chat there trades places with the focused pane, which moves into "+N more".
- **Esc does not leave Focus** (it belongs to the composer, menus and dialogs); the Focus button and Ctrl+Shift+E do. Esc cancels a pane drag.
- **Opening a diff leaves Focus**, since reviews open in the workspace. Other workspace links from a Focus pane (plans, files) open in the hidden workspace until Focus is left. Second opinion and Handoff are hidden in Focus panes.
- **Workspace shortcuts** are off in Focus except New chat (Ctrl+T, in the focused pane's project) and Close (removes the focused pane).
- **Drag has no keyboard alternative** yet; panes keep their order and can be removed and re-added.
- **Picker group headings** (Needs attention, Done, Draft) are presentation-only rows inside the listbox.
- **macOS:** the Focus button placement and traffic-light spacing are unverified.

## Learnings

- To move a mounted chat without remounting it, place keyed siblings by grid lines; a split tree remounts on every restructure.

## Done

—

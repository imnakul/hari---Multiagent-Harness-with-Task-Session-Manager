# Review — Zen mode (L-230)

- Branch: `nakul/windows-support-upstream-0.16.0`, base `c471e6fc`
- Tier: Large (new feature area, Rust window code)
- Created: 2026-11-01 14:08 IST

## Idea

A Zen mode turns the MonoCode window into a narrow side panel: one chat (or two stacked),
nothing else, so a browser, Figma or a Teams meeting gets most of the screen. A Target button
beside Focus and Ctrl+Alt+Z enter and leave it. Tasks, Notes, Automations and Monos are
reachable from its top bar as slim lists; a picked item opens in the bottom half.

## Locked decisions (Discuss round, 2026-11-01)

1. Window docks to the right edge of its screen, full work-area height, about 25% wide; a
   Zen size and place the user sets is remembered and reused when it still fits a screen.
2. Both directions animate the real window, ~250 ms, ease-out; instant with reduced motion.
   Fallback to instant if Windows stutters (manual check).
3. Slim top bar: Exit (far left), tool switcher (Chat, Tasks, Notes, Automations, Monos),
   Split, Pin. Each chat pane has its own chat dropdown.
4. Pin keeps the window on top; off by default, remembered.

I'll-handle items: name "Zen mode" + Target icon; Ctrl+Alt+Z; exit restores the exact
bounds and maximized state and returns to the view you were in (Focus included); the 800 px
minimum width drops to 360 only in Zen; reuse Focus panes, sash, picker, Tasks List/Table
(no Board), Notes/Automations lists, Mono chat.

## Research

- Window: `tauri::Window` `outer_position`/`outer_size`/`current_monitor().work_area()`;
  on Windows one `SetWindowPos` per frame moves and sizes together (no two-step jitter).
  Window is `decorations: false`, `shadow: true`, so outer bounds are the visible bounds.
- The window-state plugin saves bounds on close, so a close during Zen would keep the narrow
  bounds: the pre-Zen bounds are kept in localStorage and restored at the next start.
- Commands take `tauri::Window` (L-218 guard, `windowArgs.test.ts`).
- Focus (L-123) already hides the workspace chrome and renders chats with `SessionPane`;
  Zen runs on top of `focusMode` with its own grid so every "Focus covers the workspace"
  branch applies unchanged.

## Plan

- `src-tauri/src/zen_window.rs`: `zen_window_enter(window, remembered)` → returns the
  pre-Zen restore record; `zen_window_exit(window, restore, animate)` → returns the Zen
  bounds to remember; `zen_window_pin(window, on)`. Pure `dock_bounds`, `ease_out`,
  `frame_bounds`, `fits_work_area` with unit tests. Windows: `SetWindowPos`; others:
  `set_position` + `set_size`.
- `src/features/zen/model/zenPanes.ts`: pure pane state (1–2 ids, focused id), show in slot,
  split, close, prune; storage for pinned / remembered bounds / pending restore / tool.
- `src/features/zen/model/zenWindow.ts`: invoke wrappers.
- `src/features/zen/ui/ZenView.tsx`: top bar, panes with per-pane chat dropdown, row sash,
  tool host. `ZenSlimSplit.tsx`: list on top, item editor sliding up as bottom half.
- Tasks/Notes/Automations: `slim` prop (no header, no board, toolbar wraps, editor below).
- Monos: Zen-only list; a picked Mono's chat opens below.
- App: `zenMode` state, enter/exit, shortcut, startup restore, button beside Focus.

## Todos

- [x] Spec + SPECS row
- [x] Rust module + tests, register commands, capability not needed (custom commands)
- [x] Pane model + tests
- [x] ZenView, slim split, slim tools
- [x] App wiring, shortcut, title-bar button (also a Zen button in Focus's top bar)
- [x] tsc, vitest, cargo fmt/check/clippy/test (see Issues)
- [x] Records: LOCAL-FEATURES row + Index, changelog
- [ ] Manual desktop checklist below (user)

## Issues and fixes

- `cargo fmt` on the crate rewrites many files that were never formatted; only
  `zen_window.rs` is formatted (`rustfmt --check` clean). `cargo fmt --check` and
  `cargo clippy -D warnings` still fail on older files (`harness.rs`,
  `claude_interactive.rs`, `mobile_router.rs`, Rust 1.95 lints), not on Zen code.
- Full vitest: one timeout in `iconCatalog.test.ts` under load; it passes alone.
- The Tasks view's window-wide Escape handler fired while it was hidden under Zen;
  it now takes `active` (false in Zen), as Notes already did.

## Learnings

- Zen is Focus mode with its own grid: `focusGrid` reads `zenGrid` while Zen is on and
  `setFocusGrid` writes it (kept to one column of two), so Focus's upkeep (load a
  restored chat, drop a deleted one, close a pane) runs on Zen unchanged.
- The window-state plugin saves whatever size the window closes at, so the pre-Zen
  size is kept per window label in localStorage and put back at the next start.
- Mod+Alt shortcuts match `event.code`: Option changes `event.key` on macOS.
- Tools are new slim instances in Zen, not the workspace ones: they stay independent
  of the workspace's open views.

## Follow-up: accent dividers, recent chats, four chats (Discuss, 2026-11-01)

Locked: a 1px soft accent line between chats (2px, full accent on hover or drag), a
faint accent tint on the focused chat's header with 2+ chats; the dropdown lists the
12 most recent chats grouped by project (projects by newest chat, a heading with
icon and a line between groups, no status groups, no project on the card's second
line), search covers every saved chat; up to 4 chats as rows (at most 2 rows of 1–2,
a lone chat spans its row); dragging a chat onto a chat's right half opens it beside,
onto its lower half in a new row below; the panel widens leftward to 720px while a
row has two chats and goes back after. Focus mode unchanged.

- Grid: `zenPanes.ts` rows in `FocusGrid.columns` (`zenRows`, `zenPlace`,
  `zenCanPlace`, `zenSplitPlace`, `zenPut`, `zenNormalize`); App's `setFocusGrid`
  tidies with `zenNormalize` instead of flattening.
- Chats: `zenRecent.ts` merges history, open sessions and board cards (hidden,
  archived, workers, hidden runs and Monos dropped; working spinner, waiting dot).
- Width: Rust `zen_window_widen` / `zen_window_narrow` keep the right edge; narrow
  only when the width is unchanged; leaving or a restart saves the one-column width
  (`narrowedZenBounds`, per-window widen record).

## Manual desktop checklist (not an agent task)

- Enter from workspace, Focus and maximized: docks right, animation smooth or instant.
- Exit restores size, place and maximized state; Focus returns if it was on.
- Move/resize the Zen panel, exit, re-enter: same place.
- Pin keeps it above a browser; exit clears it.
- Split into two chats, dropdown per pane, drag the divider.
- Tasks/Notes/Automations/Monos: list, item opens below, close slides back.
- Close the app during Zen, reopen: normal size.
- Accent line between chats both ways; brighter on hover and while dragging.
- Dropdown: 12 recent chats by project, headings and lines, search finds older ones.
- Drag a chat onto a right half (beside) and a lower half (below); 4 chats max.
- A second column widens the panel leftward; back to one column narrows it.

## Done

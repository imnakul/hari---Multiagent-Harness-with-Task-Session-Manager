# Review — Focused pane styles: gliding everywhere, gradient, status ring, dimming (L-184)

Created 2026-10-26 08:39 IST. Tier: Medium. All platforms.
Branch `nakul/windows-support-upstream-0.16.0`, base `16714bb9`. Changes L-137, L-144, L-151.

## Goal

The focused pane only had a static accent border (L-137 workspace, L-144/L-151 Focus mode,
gliding only in Focus). Make it glide in workspace splits too, and let the user pick how it
looks, including a ring that shows the chat's state.

## Decisions (agreed 2026-10-26)

- Glide everywhere: one ring over the focused pane in workspace splits and Focus mode.
- Settings → Appearance: **Focused pane style** menu: Static border (default, today's look) /
  Gradient border / Status ring; and **Dim other panes**: Off (default) / Subtle / Strong,
  which combines with any style.
- Dropped: arrival pulse, edge bar, header emphasis, number quick-switch (two tabs stacked in
  one column make header-only cues ambiguous).

## Plan and files

- `settings.ts`: `storedChoice` helper; `monocode.activePaneStyle`, `monocode.inactivePaneDim`
  (+ search entries, tests).
- `sessions/model/paneStatus.ts` (+ test): attention (permission/question) > working >
  error (last turn ended on an error notice) > idle. `sessionNeedsInput` takes only the
  fields it reads.
- `workspace/ui/PaneRing.tsx` (+ test): `PaneFocusRing` (the gliding ring; `inset` for
  workspace, `card` for Focus), `PaneStatusEdge` (thin edge on unfocused panes in the status
  style), `paneDimAttribute`, live hooks for both settings. A green flash marks a turn
  finishing, keyed per pane so focus moves never flash.
- `PaneTree.tsx`: one `[data-pane-ring]` ring positioned from the focused leaf's rect, moved by
  `previewLayout` during a divider drag (`data-pane-resizing` turns the glide off); per-pane
  `ActivePaneRing` removed (file deleted). Panes get `pane-dimmable` + `data-pane-dim`.
- `FocusView.tsx`: the existing `[data-focus-ring]` is now `PaneFocusRing`; status edges and
  dimming on panes.
- `index.css`: styles. Gradient/status draw a masked edge so the border can be a gradient;
  working animates one registered angle; attention pulses opacity twice; reduced motion off.

## Follow-up 2026-10-26 (after the first desktop look)

- Gradient border removed (not useful); a stored `gradient` reads as `static`.
- Workspace split panes became rounded cards with 3 px margins like Focus mode; the ring
  matches them.
- Right and bottom edges looked doubled: the focused card's own grey border showed beside the
  ring on fractional pixels. The focused card's border is now transparent (both views).
- Status colours: accent only while working (moving light on the focused pane), green done
  (persistent), red failed or stopped, amber needs you (also a paused or held queue). The
  finish moment is a pulse, no longer a colour of its own.

## Risks

- `mask-composite` and `@property` need current WebView2/WebKit (supported; older WebKit shows
  the edge without the travelling light).
- Dimming uses opacity on whole panes; hover or keyboard focus inside restores it.

## Checklist

- [x] Settings + tests; paneStatus + tests; PaneRing + tests
- [x] Workspace splits glide; Focus mode uses the shared ring
- [x] tsc, full vitest (7,743 passed), vite build
- [ ] Desktop check

## Desktop check (manual, not for the implementation agent)

1. Split the workspace (side by side and two stacked in one column): click between panes; the
   ring glides. Drag a divider: the ring follows without lag.
2. Each style in Settings → Appearance → Focused pane style, in Focus mode and splits, light
   and dark.
3. Status ring: send a prompt (light travels), trigger a permission (amber, two pulses), let
   it finish (green flash), unfocused panes show a thin edge.
4. Dim other panes Subtle/Strong: hover a dimmed pane, it brightens.
5. Reduced motion (Windows animation effects off): no animation, colours still show.

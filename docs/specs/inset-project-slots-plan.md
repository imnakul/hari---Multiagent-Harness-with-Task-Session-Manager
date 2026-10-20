# Review — Inset sidebar: project slots (L-132)

Created 2026-10-20 18:25 IST. Status: Review (desktop check manual). Replaces L-130's Ctrl+click tabs ([inset-project-tabs-plan.md](inset-project-tabs-plan.md)).

- Goal: keep up to four projects one click apart in the inset layout, with no hidden shortcut to learn.
- User story: As someone working across a few projects, I want to add projects as slots beside the current one and click a slot to switch, so that moving between them is one click.
- Acceptance criteria:
  - By default there is one slot, which looks like before: project icon, name and ⌄.
  - A + button after the slots opens the project picker. The chosen project goes into a new slot and becomes current. Picking a project that already has a slot switches to that slot instead. The + hides at four slots.
  - The current slot shows icon, name and ⌄; its ⌄ opens the same project menu as before (worktree, Switch project, project settings, settings). Other slots show their icon and name, muted, all on one row; names truncate when space runs out.
  - Clicking a slot switches to its project. With several slots they sit in a segmented track styled like Settings → Theme: bordered track, selected pill (`bg-selection`) that glides between slots (instant with reduced motion), and the shared hover highlight. Inactive slots are 56–176 px wide; + sits outside the track.
  - The project slide follows the slots: a slot to the left comes in from the left, one to the right from the right. Only the project's content below the nav (Inbox, Notes, Task Manager, Automations, Session Manager) slides; the top row, search and nav stay still. Swipes keep following the rail order.
  - Switching project any other way (Switch project in the menu, rail, palette, swipe) puts that project in the current slot, unless it already has one, which then becomes current.
  - × on hover or a middle-click closes a slot; closing the current one switches to its neighbour. The last slot cannot be closed. Right-click on a slot opens that project's menu.
  - Busy projects keep their animated mascot in their slot. Slots persist across restarts; removed projects drop out.
  - Ctrl+click and Ctrl+Enter in Switch project no longer exist (a click just switches).
- States: one slot (no glide, no ×), several, full (no +), busy, removed project, switching in flight.
- Out of scope: reordering slots by drag; slots in the classic layout; a second row.
- Open questions: none.

## Desktop check (manual)

1. Inset layout, one slot: header looks as before; + sits after it.
2. + → pick a project: a second slot appears and becomes current; the first stays with icon and muted name.
3. Several slots look like the Theme switch (border, selected pill, hover glide); click between slots: the pill glides; with Windows animations off it jumps. Clicking a slot to the left slides the sessions in from the left; the top row and nav stay still.
4. Current slot's ⌄ → Switch project → another project: that slot changes, others stay.
5. Close a slot with × and with middle-click; close the current one (moves to a neighbour); the last slot shows no ×.
6. Add four: + disappears. Pick a project already in a slot from +: that slot becomes current.
7. Restart: the slots come back.

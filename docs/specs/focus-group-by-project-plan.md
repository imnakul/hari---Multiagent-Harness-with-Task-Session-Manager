# Review — Focus mode: group by project (L-128)

Created: 2026-10-20 15:41 IST · Builds on [Focus mode (L-123)](focus-mode-plan.md).

- Goal: with chats from several projects in Focus, the grid gets crowded and mixes projects. Let the user look at one project at a time and switch between projects quickly.
- User story: As a developer running chats in several projects, I want Focus to group chats by project as tabs, so that I can switch projects side by side and see that project's running chats.
- Acceptance criteria:
  - A "Group by project" button sits in the Focus top bar, next to New. It is a toggle (`aria-pressed`) and its state survives restarts (localStorage `monocode.focusGroupByProject.v1`).
  - When on, two tab rows appear below the top bar:
    - Row 1, projects: one tab per project that has a chat in Focus, in the order its first chat appears in the grid. Each tab shows the project's mark (logo or mascot, name) and its chat count.
    - Row 2, chats: one tab per chat of the selected project, with its title and status tag (Working…, Question, …).
  - The grid shows only the selected project's chats, in their usual places (other projects' chats keep their places and come back when grouping is turned off). Free places are filled from that project's waiting chats.
  - The selected project is the focused chat's project. Choosing a project tab focuses the chat last focused in that project (else its first chat).
  - Choosing a chat tab focuses that chat. If it is not on screen ("+N more"), it trades places with the focused pane.
  - While grouped, dragging a pane header onto another pane swaps the two (no side drops; they would move chats of hidden projects).
  - Both rows are WAI-ARIA tablists: one tab stop each, Left/Right/Home/End move and select.
  - Turning grouping off shows the full grid unchanged.
- States: empty Focus (no rows, empty screen as today); one project (rows still shown); chat still loading (title "Chat", no tag); long names truncate; a chat whose project is unknown groups under "Other".
- Out of scope: per-project saved layouts; side drops while grouped; closing chats from a tab; a sliding tab indicator (no motion library in the repo).
- Open questions: none blocking. Assumed: choosing a chat tab focuses that pane (it does not hide the project's other chats).

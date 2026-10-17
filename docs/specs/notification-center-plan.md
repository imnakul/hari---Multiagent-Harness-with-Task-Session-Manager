# Notification center (L-91)

- Goal: after time away, see in one place what finished (chat replies, approvals, questions, automation runs).
- User story: As a user coming back after 10 minutes, I want a bell in the title bar that lists what happened so I can review and open each item.
- Acceptance criteria:
  - A bell sits before minimize/maximize/close wherever `WindowControls` renders; a dot shows while any entry is unread.
  - Clicking opens the glass `Popover` panel ("Notifications", a Dismiss all X at top right). Closing it marks all entries read.
  - Each card shows kind, title, project, harness · model and age. Click expands the full body and an Open chat button (when the entry has a chat). Hover/focus shows a dismiss X.
  - Entries come from chat replies, approvals and questions when the user is not watching that chat (independent of the OS banner setting), and from automation runs that succeed or fail (not cancelled).
  - One entry per chat reply / pending request (same key replaces it); history capped at 100; stored in localStorage `monocode.notificationCenter.v1`; malformed entries ignored.
- States: empty ("No notifications"), unread, read, expanded, long list (scrolls, max 480px).
- Out of scope: macOS title bar (no `WindowControls`), task-completion events (tasks change only from the UI), grouping, sync across devices.
- Open questions: none.

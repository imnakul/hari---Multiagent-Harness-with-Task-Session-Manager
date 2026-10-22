# Review — `#` task picker in the composer (L-180)

Created 2026-10-22 19:02 IST. Tier: Medium. All platforms.
Branch `nakul/windows-support-upstream-0.16.0`, base `c017dcf8`.

## Goal

Starting work on a task means opening Tasks, copying the title and description, and pasting
them into a chat. Typing `#` in a composer should list your Todo tasks and insert one, the same
way `!` inserts a saved prompt (L-60).

## User story

As a MonoCode user, I want to type `#` in the chat composer and pick a Todo task, so that its
title and description go into my prompt without leaving the chat.

## Acceptance criteria

1. In the chat composer and the Quick Composer (Session mode), `#` at the start of the text or
   after whitespace opens a task list above the composer.
2. The list shows tasks with status Todo that are not archived: tasks of the composer's
   project first ("This project"), then Personal tasks (no project) under "Personal". Tasks of
   other projects never show.
3. Typing after `#` filters by title (prefix, then substring, then fuzzy), then by
   description and tags. At most 8 rows.
4. Enter, Tab or a click inserts the task as `taskWorkPrompt(task)`: `Task: <title>`, its tags
   line when it has tags, and its description — the content, not only the heading. The `#query`
   token is replaced; the caret lands after the inserted text.
5. The list closes on a space (`# Heading` stays markdown), on `##`, on a query with no match
   (`#123`, `#fff`), on Escape (until a new `#` is typed), and when the caret leaves the token.
6. Empty states: `#` alone with no Todo tasks shows one hint line ("No Todo tasks for this
   project or Personal. Add them in Tasks."); with a query and no match the list stays closed.
7. Tasks load on the first `#` only, and refresh when tasks change in any window.
8. `!` saved prompts keep working unchanged.

## States

Closed; loading (first `#`, nothing shown until loaded); results; empty hint; load failure
(list stays closed, warning logged — no toast for a picker).

## Plan and files

- `src/features/prompts/model/savedPrompts.ts`: `promptTokenAt` takes an optional `trigger`
  (default `!`), so both pickers share one tokenizer and `insertSavedPrompt`.
- `src/features/tasks/taskPicker.ts` (new, pure; next to the other task models): `TASK_TRIGGER = "#"`,
  `pickerTasks(tasks, cwd)` (Todo, not archived, this project + Personal) and
  `rankPickerTasks(tasks, query, cwd, limit)` returning rows with their group.
- `src/features/tasks/ui/useTaskPickerMenu.ts` (new): the `useSavedPromptMenu` shape
  (`sync`, `onKeyDown`, `close`, `open`, `matches`, `active`, `pick`), lazy load through
  `loadTasks()`, refresh on `TASKS_CHANGED_EVENT` and `TASKS_CHANGED_TAURI_EVENT`.
- `src/features/tasks/ui/TaskPickerMenu.tsx` (new): listbox like `SavedPromptMenu`, group
  labels, status icon, title and two-line description.
- `src/features/sessions/ui/Composer.tsx`, `src/features/quick-composer/ui/QuickComposer.tsx`:
  wire the hook next to the `!` menu (sync, keys, render).

## Out of scope

Automation instruction fields (`SkillPromptField`), the phone app, other statuses (In
progress, Blocked…), and linking the chat to the task (Work on… already does that).

## Risks

- `#` is common in markdown and issue refs. Mitigated by closing on space, `##` and no-match.
- Enter on an open list inserts instead of sending; the same rule as `!`, Escape dismisses.

## Checklist

- [x] Tokenizer trigger param + tests
- [x] `taskPicker.ts` + tests
- [x] Hook + menu component
- [x] Composer and Quick Composer wired
- [x] Changelog, LOCAL-FEATURES row, tsc, vitest

## Desktop check (manual, not for the implementation agent)

1. In a project with Todo tasks and Personal tasks, type `#` in the chat composer: both groups
   show, this project first; tasks of another project do not.
2. Pick one with Enter: title, tags and description are inserted; caret is after it.
3. Type `# Heading`, `##`, `#123`: no list stays open.
4. Escape closes the list; typing on keeps it closed until a new `#`.
5. Add a task in Tasks while the composer is open, type `#` again: it is listed.
6. Quick Composer Session mode: same behaviour. `!` still works in both.

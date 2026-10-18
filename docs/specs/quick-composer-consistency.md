# Progress — Quick Composer matches the chat composer (L-110)

Created 2026-10-19 01:59 IST. Amends L-46 and L-57.

## Goal
The floating Quick Composer and the embedded one ("Add Draft to Sessions", "Edit Draft", "Work on…")
looked unlike the chat composer and were hard to use:
- The floating window used the system font at the default size and ignored the workspace theme.
- The footer pickers collapsed: the model showed as "G…", and in the 560px dialog the model label
  disappeared and Start was clipped.
- The pickers used a plain text style, while the Antigravity agent control beside them used the
  chat composer's pill, so one row mixed two styles.
- The dialog had two close buttons.

## Root causes
1. `src/features/quick-composer/main.tsx` applies only the theme: no `applyUiFont`,
   `applyUiFontSize` or `applyWorkspaceTheme`.
2. The footer is one row with no wrap and no scroll. The right group (key hints and buttons) cannot
   shrink, so every `min-w-0` picker shrinks towards zero width.
3. The picker triggers are hand-written (`CONTROL_CLASS`) rather than the chat composer's pill classes.
4. `SessionTodoComposer` uses the 560px `md` modal; the floating window is 680px wide.

## Plan
- The floating window applies the UI font, UI font size and workspace theme on every show, as the
  workspace window does. UI scale stays out, because the window has a fixed native width.
- Share the chat composer's pill trigger class (`composerPillClass`) between the model picker, the
  access picker and the Quick Composer's project, model and permissions triggers.
- The footer controls sit in the chat composer's `composer-toolbar` container, which scrolls
  sideways instead of crushing its pickers.
- The key hints show only when the composer itself is at least 600px wide. This is a container
  query, so the narrow dialog hides them too; before, they depended on the viewport.
- The prompt uses the chat composer's typography: `font-sans text-sm leading-5.5`.
- `SessionTodoComposer` uses the `lg` modal and Modal's own `description`. The embedded composer
  hides its own close button, because the modal's button and Escape already close it.

## Files
`src/features/quick-composer/main.tsx`, `src/features/quick-composer/ui/QuickComposer.tsx`,
`src/features/sessions/ui/composerControls.ts` (new), `src/features/sessions/ui/ModelPicker.tsx`,
`src/features/sessions/ui/AccessPicker.tsx`, `src/features/session-board/ui/SessionTodoComposer.tsx`.

## Risks
- The floating window height follows its content, so a larger UI font size makes it taller. This is
  intended, and matches the chat composer.
- The model picker and access picker produce exactly the same class strings as before.

## Checklist
- [ ] Tests: the embedded composer has no second close button; the floating one keeps it.
- [ ] Gates: tsc and the full vitest suite.
- [ ] Desktop check (manual, by a human): floating composer font and size, a long model name, the
  Antigravity agent pill, the Add Draft dialog at a normal and a narrow window width, light theme.

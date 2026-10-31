This repository is indexed with SocratiCode. Follow the global SocratiCode
usage rules.

This is a fork of MonoCode with Windows support and local features. Before any change,
read `docs/WORKING-AGREEMENT.md` (short: rules, task tiers, tests, records). Then open only
the docs the task needs, using the map below. Do not read whole large files; search them by
keyword (`grep -n`) and open the matching section.

Every feature or fix that exists only in this fork (not in upstream MonoCode) gets a row in
`docs/LOCAL-FEATURES.md` in the same task, plus its one-line Index entry. Every change gets a
short entry in the Current changelog file.

## Docs map — what to open, and when

| Open this | When | Notes |
|---|---|---|
| `docs/WORKING-AGREEMENT.md` | Always, once per session | Rules, tiers, test gates, record templates |
| `docs/LOCAL-FEATURES.md` | Before changing or merging anything that could remove fork behaviour; after adding one | What this fork has that upstream does not. Read the Index at the top, then search for one ID (`grep -n "L-43" docs/LOCAL-FEATURES.md`) |
| `docs/changelog/CHANGELOG.md` | To add an entry (every change), or to look up history | Index; open only the file marked Current, and search it by keyword or date |
| `docs/specs/SPECS.md` | Medium or Large tasks, or when resuming planned work | Index with status; open the one spec you need. Done specs are in `docs/specs/archive/`: open only when a task needs that history |
| `docs/WINDOWS-CHANGES.md` | Windows-specific work, builds, installers, CRLF/console/PTY issues | Read the index table at the top, then jump to one section |
| `docs/NOTES.md` | Taking upstream changes in (intake runbook); product calls (§0) are decided and not reopened | |
| `docs/notes/archive/upstream-merge-*.md` | During an upstream merge, for past conflict decisions | |
| `docs/PLANNED.md` | Roadmap or "what next" questions | |
| `docs/FEATURES.md` | Comparing with the T3 reference app | |
| `docs/notes/…` | Only when a spec or changelog entry links to a file there | Large research records and logs; never browse |
| `docs/remote-access.md` | Remote host questions | Upstream's own file: never edit, so merges stay clean |

## Tauri windows: never `WebviewWindow` for workspace windows (L-218)

The Browser adds its pages as extra webviews inside the main window. From then on
Tauri stops treating that window as a `WebviewWindow`: a command that takes one fails
with "current webview is not a WebviewWindow" (every chat turn broke, and "Couldn't
load reminders" appeared), and `get_webview_window` / `webview_windows()` skip it.

- Commands that a workspace window can call take `tauri::Window` (or `Webview` when
  they need the page). Lookups of workspace windows use `get_window` / `windows()`.
- `WebviewWindow` stays only for the quick composer and its Git popup (their own
  windows), for startup in `lib.rs`, and in macOS-only files (not converted: they are
  not built on this fork).
- Upstream adds and changes these freely. On every upstream merge, run
  `npx vitest run src/platform/tauri/windowArgs.test.ts`; if it fails, convert the new
  code, don't widen the allowlist unless the command is composer-only.

## Desktop UI verification from MonoCode

Do not assign native desktop UI inspection or smoke tests to an agent running
inside MonoCode. This includes trying to drive the Tauri window with
computer-use tools. The MonoCode agent should complete source review,
automated tests, and builds, then report the desktop behaviors still to check
as a short manual checklist. We run those checks ourselves or in a separate
Codex session with desktop access. Specs and handoff prompts must keep that
desktop check as a separate follow-up, not an implementation-agent task.

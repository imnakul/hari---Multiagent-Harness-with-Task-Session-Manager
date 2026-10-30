# Review — Whiteboard tab with a drawing agent chat (L-194)

Created: 2026-10-30 00:58 IST. Locked in the session: 4A (Excalidraw, MIT) plus the user's list, then
"Directly build it out … as a tab, like Task Manager, Session Manager … a sidebar where we can talk with
agents, and they can draw".

## What the user gets

- **Whiteboard** is an app tab like Task Manager and Automations: View menu, sidebar page, rail button,
  a title-bar tab in the inset layout. It sits on the same background as a chat (wallpaper, blur, glass).
- **Sheets:** a sheet menu in the top bar lists saved sheets, makes a new one, opens, deletes (moves to
  `.trash`) and shows the folder. The sheet name in the top bar is renamed in place (click, type, Enter).
  Sheets save to `~/.monocode/whiteboards/<id>.excalidraw` by themselves a moment after each change.
- **Top bar instead of a context menu:** font picker (Excalifont, Virgil, Nunito, Comic Shanns, Helvetica,
  Cascadia, plus Kalam, Shantell Sans, Caveat, Geist, Geist Mono), hand / select tools, lock (view only),
  grid, snapping, zoom out / level / in / fit, select all, icon library, export (PNG, SVG, `.excalidraw`),
  clear canvas (asks first, Ctrl+Z undoes), chat toggle.
- **Right-click** opens a round tool picker (radial menu) around the pointer instead of Excalidraw's menu.
- **Icon library:** the Hugeicons free set, searchable; a click places the icon in the middle of the view.
- **Agent chat sidebar:** pick an AI helper (the providers that can run as AI helper), type, and the agent
  answers and draws: it sees a short list of what is on the sheet and replies with a `whiteboard` JSON
  block (add shapes, text, arrows between shapes, move / recolour / relabel, remove, clear). Each drawing
  is one undo step. The chat is kept per sheet.

## How (I'll handle)

- `@excalidraw/excalidraw` 0.18, lazy loaded with the tab. Its own fonts are served from
  `/excalidraw/fonts/` (copied from the package by a Vite plugin, CJK Xiaolai left out) because the app's
  CSP only allows local fonts. Extra fonts are `@fontsource/*` packages; they are added to Excalidraw's
  exported `FONT_FAMILY` map (ids 101–105) so its text renderer finds them by name. SVG export does not
  embed these five; PNG does.
- Drawing path: the AI helper pipeline (`runHarnessHelperPrompt`, no tools), not Operator. Reason
  (*My take*): every helper provider can answer text, it needs no app connection or project, and a reply
  format is easy to test. `monocode app whiteboard` via Operator is a later option.
- New Rust commands: `ensure_whiteboard_dir`, `write_base64_file` (PNG export to a picked path).
- Code: `src/features/whiteboard/` (model: sheets, fonts, agent prompt/parse, scene ops; ui: view, top
  bar, radial menu, chat, icon picker), `src/integrations/harness/core/whiteboardHelper.ts`, App wiring
  mirrors Automations.

## Edge cases

- Locked sheet: view only; the agent chat still answers but its drawing is not applied (says so).
- Agent reply without a valid block → shown as text only. Unknown shape types are skipped.
- Agent ids that clash with existing ones get new ids. Arrows between two new shapes are bound to them;
  an arrow to a shape already on the sheet is drawn edge to edge but not bound (it stays put if the
  shape is moved later).
- A sheet file that fails to load shows the error and is never saved over (saving is held for that sheet).

## Tests

Model tests for sheets, fonts map, prompt/parse and scene ops; helper test with an injected runner.

## Status

Built 2026-10-30 (tab, top bar, sheets, radial menu, icon library, agent chat, App / sidebar / rail /
View menu / Focus header wiring). Review: the desktop check below is still to run.

## Desktop check (manual, not for an agent)

Open the tab from the View menu and the sidebar; draw; rename; new sheet; reopen app → sheets come back;
fonts change selected text; right-click radial menu; icon insert; export PNG/SVG/.excalidraw; lock; grid;
snapping; zoom; clear + Ctrl+Z; chat "draw a login flow" with Claude and Codex; light and dark theme;
wallpaper with blur shows behind the canvas.

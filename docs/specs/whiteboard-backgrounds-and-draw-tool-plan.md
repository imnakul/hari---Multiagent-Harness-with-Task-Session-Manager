# Review — Whiteboard: blank canvas fix, sheet backgrounds, draw from any chat (L-392 to L-394)
- Tier: standard (L-392, L-393) · complex (L-394: async hand-off between chat and Whiteboard) · Snapshot: b07b76c1, 2026-11-24
- Built in the same session as this spec; status Review until the desktop checks below pass.

## In plain words
- Before: the Whiteboard chat could say "Drew 24" while the sheet stayed empty, and asking again drew nothing new. Sheets had only Grid on or off.
- After: drawings land on the sheet, including ones made before it finished opening. Each sheet has a background button beside Grid: Default (as today), a fill colour with opacity, and a pattern (dots, grid, lines, graph paper).
- New: the composer's + menu has **Whiteboard**. A chat sent with it on draws its answer on a new Whiteboard sheet, which opens on its own. Any harness can do this, since it is an app CLI action like the other MonoCode actions.

## L-392 — blank canvas after "Drew N"
- Root cause (inferred from code, not seen in the UI): Excalidraw calls `excalidrawAPI` from its constructor. The view adopted that API at once, so drawings went to an editor that was not mounted yet and were dropped, while the chat already said "Drew 24". The fix adopts the API on the editor's first `onChange`, which only a mounted editor fires (`adoptWhenMounted` in `whiteboardApi.ts`).
- Second race: just after a sheet switch, effects ran once with the old editor's API and the new sheet id. A `WeakMap` from API to sheet stops either effect acting on the wrong sheet.
- Queued drawings: a sheet that is not open now keeps every queued drawing in order (`takePending` returns a list). Before, a second drawing replaced the first.

## L-393 — sheet backgrounds
- Stored per sheet as `background` in the Whiteboard `index.json`: `{ pattern: none|dots|grid|lines|graph, color: string|null, opacity: 0..1 }`. Default removes the key, so old sheets are unchanged.
- Drawn as a layer behind the transparent Excalidraw canvas. Patterns move and scale with the canvas (offset `scroll × zoom`).
- An opaque fill sets the Excalidraw theme to match it (light fill → light theme), because the dark theme inverts ink colours.
- Changes show at once and are saved after 300 ms; switching sheets saves any change still waiting.
- UI: a paint bucket button after Grid opens a popover with a pattern `SegmentedSwitch`, fill swatches (none, presets, custom colour), an opacity slider, and Reset to default.

## L-394 — Whiteboard tool for chats
- Flow: + menu › Whiteboard (or `/whiteboard`) → the message is sent as `/whiteboard …`. This gives the thread app access, the same as `/operator`, and adds `<monocode_whiteboard>` instructions to that turn → the agent runs `app whiteboard.draw` → the desktop opens the Whiteboard, creates the sheet, switches to it and draws → the CLI returns `{sheetId, name, created, note}`.
- Later turns keep app access (the same rule as Operator). The Whiteboard instructions are added only to turns sent with the item on. The general app context also names `whiteboard.draw`, so Operator chats can draw when asked.
- `sheetId` draws on an existing sheet. A missing or locked sheet returns an error the agent can read.
- The Whiteboard mounts on first open, so a draw sent before that waits up to 20 s for it to start serving, then fails with "The Whiteboard didn't open in time…".
- Input checks: `parseWhiteboardDrawInput` (sheet id pattern, name a string, ops through `parseWhiteboardOps`, at least one change). Limits come from the ops parser, including at most 60 new elements.

## Acceptance criteria
- AC-1: a Whiteboard reply that says "Drew N" shows N elements on the sheet, including on the first open of the Whiteboard.
- AC-2: two drawings queued for a closed sheet both show, in order, when it opens.
- AC-3: a pattern, fill and opacity picked for a sheet show at once, survive a restart, and stay with that sheet only. Reset to default removes them.
- AC-4: picking Whiteboard in + shows a teal Whiteboard pill. Sending clears it, and the message reaches the agent with the Whiteboard instructions.
- AC-5: `whiteboard.draw` with `name` creates and opens a new sheet with the drawing. With `sheetId` it changes that sheet. A locked sheet returns an error and changes nothing.
- AC-6: `whiteboard.draw` is refused by the orchestration control CLI; it is an app-only action.

## Test matrix
| AC / risk | Test |
|---|---|
| AC-1 adopt only a mounted editor | `whiteboardApi.test.ts` |
| AC-2 queued drawings in order | `whiteboardRuns.test.ts` "keeps every queued drawing in order" |
| AC-3 parse, patterns, theme | `sheetBackground.test.ts` |
| AC-4 `/whiteboard` command | `operatorCommand.test.ts` |
| AC-5 input checks, wait for open, timeout, errors | `whiteboardTool.test.ts` |
| AC-6 app-only action, help text | `control_cli.rs` `app_mode_exposes_whiteboard_draw_and_documents_its_ops` |

## Manual checks (desktop)
1. Whiteboard chat: "draw a login flow" → the shapes appear, also on a fresh app start with the Whiteboard closed first.
2. Background button: dots, grid, lines and graph paper. Fill swatch plus opacity, and a custom colour. Pan and zoom keep the pattern aligned. Restart keeps it. Another sheet is unaffected. Reset works. Dark app theme with a white fill shows dark ink.
3. Composer + › Whiteboard → pill → "draw our deploy pipeline" with Claude, Codex and one other harness → a new sheet opens on the Whiteboard with the drawing, and the chat shows the "Draw on the Whiteboard" tool row.
4. Ask the same chat to "add a rollback step" → it changes the same sheet (`sheetId`).
5. Lock that sheet and ask again → the agent reports the sheet is locked.

## Decisions and assumptions
- Decision: an app CLI action, not an MCP tool, so it works with every harness (the user picked this).
- Assumption: a draw opens the Whiteboard view, which takes the user away from the chat. A "draw in the background" option can follow if this gets in the way.
- Assumption: the L-392 root cause is inferred from Excalidraw's lifecycle and not confirmed in the UI.

## Handoff retro
(None: built in the same session.)

# Progress — Browser: frozen page under overlays, MonoCode right-click menu, size presets, link cards, WebviewWindow fix, panel slides (L-214 to L-219)

Created 2026-10-31 10:02 IST. Amends L-203, L-207 (Browser) and L-212 (link chips).

## Goal
- A toast, menu or dialog over the Browser no longer blanks the page: the page freezes as a picture.
- Right-clicking a page opens MonoCode's own menu (not Edge's), with page, link, image, selection and
  developer actions, and "Add to chat" items. Its hover highlight glides between items.
- Page size presets the user makes (name, width, optional height), saved and removable.
- In "Always" link-preview mode, a web link shows as a preview card where it sits in the text.

## Root cause (blanking)
The page is a native child webview (`add_child`), which always paints above MonoCode's HTML.
`coveringLayer` in `BrowserView.tsx` hides the page whenever a body-level layer overlaps it, so any
toast or popover leaves an empty grey box.

## Locked decisions (user, 2026-10-31)
- 1A: keep the top-bar tools and add the right-click menu.
- Toasts and other unexpected layers: freeze, not blank.
- Right-click menu: whatever is useful for development work, plus a smooth gliding hover.
- Custom size presets.
- Always mode: the link itself renders as a card, not a card at the end of the paragraph or on hover.

## Plan
### L-214 Freeze
- When an overlap starts, `browser_screenshot` (CDP `Page.captureScreenshot`, viewport only) takes a
  picture; it shows as an `<img>` filling the page box, then the native page hides. Capture first,
  hide second, so the swap does not flash.
- While the capture is running the native page stays visible for at most ~250 ms; if it fails or
  takes longer, hide anyway (old behaviour) with a plain surface.
- When the overlap ends: show the native page, then drop the picture on the next frame.
- Clicking the frozen picture brings the live page back (the covering layer may stay, e.g. a sticky
  toast; the page then stays live until the next overlap starts).
- Non-Windows (no CDP): unchanged.

### L-215 Right-click menu
- Rust: in `native::setup`, `ICoreWebView2_11::add_ContextMenuRequested`. When the target is
  editable (text boxes), leave Edge's menu (spelling, paste). Otherwise `SetHandled(true)` and emit
  `browser://context-menu` with `{tab, x, y, kind, pageUrl, linkUrl, linkText, sourceUrl,
  selection}` (x, y in physical pixels; text capped).
- Frontend: freeze the page, then open `ExplorerMenu` at the page-box offset + (x, y) /
  `devicePixelRatio` (`menuPoint`).
- Items, grouped:
  - Link: Open in new tab · Open in default browser · Copy link · Add link to chat.
  - Image: Open image in new tab · Copy image address · Add image to chat.
  - Selection: Copy · Search the web · Add selection to chat.
  - Page: Back · Forward · Reload · Reload without cache.
  - Tools: Pick and comment · Screenshot (visible page) · Add page to chat.
  - Developer: Copy element selector · Copy element HTML · Add element to chat · Add console
    errors to chat · Clear site data and reload · Inspect. (View page source dropped: Inspect
    covers it.)
  - Copy address · Open in default browser · Print.
- Element items: an init script records the right-clicked element
  (`window.__monocodeContextTarget`); `browser_context_element` runs the picker's
  `describeContext()` through CDP `Runtime.evaluate` (selector, rect, text, HTML up to 20,000
  chars). `browser_page_action` handles Print and Clear site data (`Storage.clearDataForOrigin`).
- Glide: `ExplorerMenu` gains an opt-in `glide` prop: one absolutely positioned highlight that moves
  to the active item (transform + height, ~160 ms strong ease-out), instant under reduced motion.

### L-216 Size presets
- Presets are `{id, name, width, height?}` in the browser store, saved in localStorage.
- More menu: built-ins (Fit, Phone, Tablet, Laptop) + user presets + "New size…" (name, width,
  height) + remove on each user preset. Height, when set, fixes the page box height (centred);
  scaling to fit applies to both sides.

### L-217 Link cards in Always mode
- `AgentMarkdown` link renderer: in Always mode a web link renders a compact card in place
  (`data-link-card`): image, site line, title, description. Loads when near the screen; same-size
  skeleton while loading; falls back to the existing chip when no data comes back.
- Links inside a sentence stay chips (a card would split the line); a link that is the only thing
  in its paragraph or list item becomes a card.

## Found during this work: "Couldn't load reminders" (fixed in L-218)
- Root cause: Tauri 2.11 treats a window as a "webview window" only while every webview in it has
  the window's own label (`Window::is_webview_window`). Once a Browser page is added
  (`add_child`, label `monocode-browser-<n>`), the main window stops qualifying, so:
  - every command with a `WebviewWindow` argument fails with "current webview is not a
    WebviewWindow" (reminders `reminder_register_window` / `reminder_take_open` → the toast;
    also `control.rs`, `mobile_access.rs`, `window.rs`, `webview_recovery.rs`, lib.rs window
    helpers);
  - `get_webview_window(label)` and `webview_windows()` skip that window (22 + 5 call sites).
- Also broke every chat: `control_authorize_turn` runs before each turn.
- Decision (user, 1-A): switch to `Window`. Commands reachable from a workspace window take
  `tauri::Window` or `Webview`; workspace lookups use `get_window` / `windows()`. Kept as
  `WebviewWindow`: quick composer and Git popup commands (own windows), startup in `lib.rs`,
  macOS-only files (not built on this fork; a gap if macOS builds return).
- Guard: `src/platform/tauri/windowArgs.test.ts`. Rule in `AGENTS.md` ("Tauri windows") and
  `docs/NOTES.md` §0 item 11, so upstream merges keep it.

## L-219 Panel slides (user, 2026-10-31; 3-A)
- The Browser panel and the Session overview slide in from the right; the chat narrows with
  them (width animates). In 220 ms, out 180 ms, strong ease-out; toggling mid-slide reverses.
- Browser: the page shows as a still picture during the slide (native views cannot follow it
  frame by frame); a slow picture gives way after ~150 ms. Live again once the panel rests.
- Resizing stays instant. Reduced motion: no slide. A chat that opens with the overview
  already open does not slide it.

## Edge cases
- Overlay opens while the page is loading → picture of whatever is drawn; fine.
- Tab switch while frozen → drop the picture; the new tab follows the same rules.
- Page zoom ≠ 100% → menu position is divided by zoom only for CDP coordinates, not for placement.
- Context menu on a frozen page cannot happen (native page hidden).

## Tests
- `browserTabs` presets: add, remove, persistence, bad input.
- Context-menu item builder: per-kind item lists.
- `AgentMarkdownLinkPreviews.test.ts`: Always mode block link → `data-link-card`; inline link stays
  `data-link-chip`.
- `cargo check`; Rust tests not run on this PC.

## Desktop check (manual)
1. Open a page; trigger a toast → page shows as a picture, not grey; it returns when the toast ends.
2. Right-click a page, a link, an image, selected text and a text box (Edge menu there).
3. Hover through the menu: highlight glides; reduced motion → no glide.
4. Developer items: copy selector/HTML of the clicked element; add console errors to chat.
5. Make, use and remove a size preset; restart → preset kept.
6. Always mode: a link on its own line shows as a card; a link in a sentence stays a chip.
7. Open a Browser tab, then send a chat message in this and another session → it runs; no
   "Couldn't load reminders". Glass on/off, hide/quit, mobile access still work.
8. Toggle the Browser panel and the Session overview: both slide, the chat narrows smoothly,
   the Browser page is a picture while moving and live after; toggle mid-slide reverses.

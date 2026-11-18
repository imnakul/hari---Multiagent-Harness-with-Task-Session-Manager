# Review — Hari: places, remembered state and global swipes (L-346 to L-349)

Branch: `nakul/windows-support-upstream-0.16.0` · Base: `76b7c524` · Created: 2026-11-18 10:00 IST

## Idea

User report 2026-11-18: in Hari, Tasks, Notes, Share/Control and Notifications open as pop-up sheets (modals), so the side menu (sidebar) can't open from them, swipes don't work there, and every place forgets where you were. Locked decisions (discuss round, 2026-11-18):

- **1A** Tasks, Notes, Computer (Share | Control) and Notifications become main screens (places), like a project.
- **2A** Each place remembers where you were (open session, note, tab, folder) and rebuilds there on return.
- **3A** Swipe from the right opens the sidebar everywhere; swipe from the left goes back one step. Over sliders and wide tables both work only from the screen's edge.
- **4A** "Send to phone" in the computer's files saves straight to Downloads/Hari, progress on the row, one line in Share's history.

Done before this spec (same report): L-343 switches clear old layers (`placeStack.ts`), L-344 menu shuts on minimise, L-345 back goes up a folder.

## Research

- Root stack: places are `index`, `project/[projectId]/index`, `mono/[monoId]`; Tasks, Notes, Notifications, Share, Computer are `presentation: "modal"` with their own nested stacks (`src/app/<name>/_layout.tsx`). On Android a modal renders inside the slid-aside scene (L-235), so the drawer shuts before one opens.
- `ScenePagerHost` (`src/ui/ScenePager.tsx`) owns one pan for pages, drawer (`useDrawerSwipe`) and back (`useBackSwipe`, L-328). Only project, session (Android) and Mono screens opt in.
- `ComputerHub` has its own pager pan (not ScenePager) and a module-level tab store; closing forgets the tab.
- `lastPlace.ts` remembers project or Mono per desktop, read by `app/index.tsx` at launch.
- PC to phone: `pc.files.offer` (Rust `mobile_share::offer_file`) streams the original file, no copy on the PC; the phone auto-downloads ≤ `AUTO_DOWNLOAD_BYTES`, larger waits for a tap in Share. Saved via MediaStore into Download/Hari.

## Plan

1. **Places (L-346).** New root option `place` (no modal, `animation: "none"`, header hidden; the nested stack keeps its header). Tasks, Notes, Computer, Share and Notifications use it. Their root header's ✕ becomes the sidebar button (the project header's `sidebar` icon, unread dot). The drawer opens them with `closeThen` → `clearToPlace` → `router.replace` (as projects). `Place` kinds grow: tasks, notes, computer, notifications; the app reopens there. Settings, models, new Mono and sheets stay modal (detours).
2. **Memory (L-347).** `placeMemory.ts`, kv per desktop: project → open session id; notes → open note id; computer → tab and files folder. Written as screens focus, cleared on leaving back to the place's root. `showPlace` rebuilds: replace the place, then push the remembered child if it still exists (session in the catalog). Picking the active place in the sidebar only closes it.
3. **Swipes (L-348).** `useDrawerSwipe` on every place screen and nested screen; `useBackSwipe` on nested ones (note → Notes, files → up a folder then the hub, session already). A swipe starting in the right edge strip always opens the drawer, even with a page to the right. ComputerHub's pager moves onto `useScenePager` so pages, drawer and back share one pan (its header switch follows `progress`). `TileSlider` marks its touches like `SideScroll` so the menu and back take only edge swipes there.
4. **Send to phone (L-349).** The offer from the file browser asks the desktop for an auto download (`auto: true` in `pc.files.offer` params → `auto` in the share event); the phone then downloads at any size. The browse row shows progress from the Share history entry, then Open. Older desktops ignore the flag (waits in Share, as now).

## Todos

- [x] 1 Places
- [x] 2 Memory
- [x] 3 Swipes
- [x] 4 Send to phone
- [x] Tests (placeMemory, placeStack showPlace, swipe precedence where testable), tsc, lint, vitest; cargo check for 4
- [x] Records: LOCAL-FEATURES L-346..L-349, changelog, this spec Done

## Edge cases

- Swipe back on a place's root does nothing; the right swipe opens the sidebar.
- A swipe during a switch is ignored until the next screen shows (the cover is up).
- A remembered session or note that no longer exists: a note goes back to Notes by itself; a session opens empty over its list (the poll lists only recent sessions, so it can't be checked first), and Back returns to the list.
- Unpairing clears the memory (kv keys are per desktop fingerprint).

## Manual phone checklist (not for the implementing agent)

1. Open Tasks, Notes, Share, Control, Notifications from the sidebar: full screens, sidebar button top right, right swipe opens the sidebar.
2. Share → Browse files → a subfolder → sidebar → a project → sidebar → Share: back in that folder.
3. Project A session → project B → back to A: A's session is open.
4. Left swipe: session → sessions, note → notes, subfolder → parent.
5. Control's volume slider drags without opening the sidebar; from the very edge it opens.
6. Browse files → tap a large file → Save: progress on the row, then Open; it is in Download/Hari and listed in Share.

## Issues and fixes

## Learnings

## Done

2026-11-18 10:15 IST, not committed yet. Phone check (checklist above) still to do.

Differences from the plan:

- Memory is written as you leave a place (read from the navigation state), not as screens focus; one write per switch.
- The hub keeps its own page swipe and leaves the right edge to the side menu, rather than moving onto `useScenePager`; same result, smaller change.
- The app still reopens at launch on the last project or Mono only (`lastPlace.ts`); Tasks, Notes and the rest are not launch places.
- Notification rows (swipe to remove) are edge-only too, through `SideSwipeArea`.
- A file name can change on the phone: characters Android and Windows can't keep in a name (such as `:`) become `_`, and a name already in Download/Hari gets " (1)".

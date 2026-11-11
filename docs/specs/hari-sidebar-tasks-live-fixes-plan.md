# Hari: running projects in the side menu, Tasks filters, colour logo, Live Update fixes (L-241)

Status: Review — built 2026-11-11 (L-243 added 2026-11-11); phone and desktop checks below are manual.

## Goal

The user reported that Hari crashed in a loop ("Hari keeps stopping") after a Live Update card stayed on screen indefinitely, and that the Super Island showed the whole session title. They also asked for:

- A side menu that shows which projects are running and their sessions.
- Filters on Tasks.
- The real colour logo.
- Activity site time that includes their browser (Aside) and shows time per tab.

## Acceptance criteria

**Live Updates (L-239 fixes)**
- Errors no longer crash the app:
  - When posting the card fails, the app clears every Hari card, stops the service and turns Live Updates off.
  - The phone then gets a notice that says how to turn Live Updates back on.
- No card is left over:
  - A launch with no service clears any Hari card that is still showing.
  - The first empty update reaches the native side.
  - Each card times out after 2 minutes unless it is re-posted. The service's tick re-posts it while the app runs, so a card left by a killed app goes away on its own.
- The status-bar chip always has a short label: "Approve", "Reply" or "Working". HyperOS therefore never fills the Super Island with the session title.

**Side menu**
- Project names shimmer while sessions run in them (the desktop's `.shimmer-text`, through the phone's `Shimmer`).
- The number of running sessions sits at the right end of the project row. It turns amber when one is waiting on the user.
- Tapping the count (a 48dp target) expands the row, rotates the chevron and fades in the running sessions, with those waiting on the user listed first. Tapping a session opens its chat over its project.
- The "Working now" filter keeps a project that has running sessions.

**Tasks**
- **Focus** shows today's Focus as the desktop defines it (`inFocusOn`: pinned to today, recorded today, or created today and not planned later). The desktop now sends `createdAt`, `focusDate` and `focusDays`.
- **Group by** Status (the default, in the desktop's status order) or Project.
- A project chip row (All projects, each project that has tasks, No project) narrows the list to one project. A picked project whose last task goes away reads as All projects.
- Empty states name the reason: nothing in Focus today, or no tasks for this project.
- (L-243) Tapping a task shows a **Focus today** chip that pins it to today; when pinned it reads **In Focus** and a tap unpins it. Every change sends the phone's day, as the desktop requires.
- (L-243) With Focus on, a bar reads "N unfinished from earlier focus" with a **Carry over** button that pins those tasks to today (the desktop's rule: pinned to an earlier day, not completed, not archived, not in today's Focus). It shows a spinner while saving; failures roll back with an alert.
- (L-243) A desktop older than local35 ignores the pin; the phone sees the task come back unchanged, rolls back and asks to update MonoCode.

**Logo**
- The side menu header, the empty chat, the connect screen and the Mono home header show `public/monocode.png` in full colour, untinted.
- The silhouette stays for the carved background mark, which needs a mask.

**Activity (L-240 fixes)**
- `aside` is a recognised browser app, so web events from the Aside browser are no longer dropped.
- Sites list up to 8 tabs, each with its own time.

## Out of scope

- Expanding idle projects to list their past sessions.
- Persisting the Tasks filters across launches.

## Desktop check (manual)

- Activity → Day → Sites lists Aside sites. Each tab title shows its time, right-aligned.

## Phone check (manual)

1. With one session working, the chip and the island read "Working", not the title.
2. Force-stop Hari while a card shows. The card disappears within about 2 minutes, and reopening Hari clears it at once.
3. No crash loop. If the card can't post, Live Updates turns itself off with a notice.
4. Side menu: a running project's name shimmers, and its count shows at the right. Tapping the count reveals the sessions, and tapping a session opens it.
5. Tasks: Focus, the Status/Project switch and the project chips behave as above.
7. Tasks (L-243): pin a task with Focus today, see it under Focus on the desktop; unpin it. Leave a task pinned to yesterday unfinished, turn on Focus, tap Carry over: it moves to today on both.
6. The colour logo shows in the side menu, the empty chat and the connect screen.

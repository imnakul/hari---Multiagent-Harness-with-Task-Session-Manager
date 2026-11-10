# Review — Activity tracker (L-240)

Branch: `nakul/windows-support-upstream-0.16.0`. Base: `cb15ab86` (0.16.0-local33 record).
First commit `bb8d8383`; this spec covers it and the follow-up (own `activity.db`, Day/Week/Month).

## Idea

An always-on, lightweight record of the working day inside Hari: every prompt and finished agent
turn (project, branch, agent time), desktop context (active time, apps, meetings, websites), short
AI notes written by the Antigravity CLI, and weekly/monthly views with an on-demand AI summary.

Locked decisions (user, 2026-11-09/10):
- Inside Hari, not a separate app; a records view next to Notes.
- Desktop context from ActivityWatch (local, MPL-2.0) when it runs; no own window watcher.
- AI engine: Antigravity CLI only, headless `agy -p … --output-format json`, after every prompt/turn.
- The AI sees prompt text, a ≤600-char code-free reply excerpt, repo, branch, app names, website
  domains, meeting times. Never code, tool output, window/tab titles or full URLs.
- Stored in its own `activity.db`, not `monocode.db`.
- Settings master switch; Process Monitor shows the tracker's own usage.
- Day / Week / Month views, date picker, week/month AI summary.

## Research

- `agy` headless: answer in `response` (or `result.response` in stream output); quota is shared with
  interactive use; rapid calls can hit 429 (Google AI forum). Docs: antigravity.google/docs/cli/headless.
- ActivityWatch REST: `GET /api/0/buckets/`, `GET /api/0/buckets/{id}/events?start&end&limit=-1`;
  bucket types `currentwindow`, `afkstatus`, `web.tab.current`. v0.14 adds sync, so filter by hostname.
- Windows: `CreateProcess` command lines max 32,767 chars, and Rust refuses newline arguments to
  `.cmd`/`.bat` shims, so prompts stay small and are flattened for shims.

## Plan

- Rust `src-tauri/src/activity/`: `store.rs` (`ActivityDb`, own file, WAL), `agent.rs` (notes
  worker: debounce 4 s / max 20 s, 25 events per call, backoff 30 s→15 min, pause when missing or
  signed out, `AGY_GATE` so calls never overlap), `aw.rs` (read-only client and aggregation),
  `summary.rs` (period prompt, ≤20k chars), `time.rs` (ISO and local-day helpers).
- Commands run through `background_work::store`. `session_store.rs` is untouched.
- Frontend `src/features/activity/`: recorder hook (diffs live sessions; prompt fresh ≤2 min, turn
  on busy→idle; Rust dedupes by block id), view with PeriodNav, DayTimeline, DailyBars, breakdowns,
  log feed, PeriodSummaryCard and PeriodNotes.
- Process Monitor: `ActivityUsage` (phase, today's calls/notes/failures, live `agy` tree).

## Todos

- [x] Rust module, commands, tests (store, aw, agent, summary, time).
- [x] Own `activity.db`; remove the `monocode.db` table hook.
- [x] Records view, rail/sidebar/compact rail/title tab entries, master switch, notes switch.
- [x] ActivityWatch sites (domains + local tab titles), focused-browser and not-AFK counting.
- [x] Process Monitor row and totals.
- [x] Day / Week / Month, date picker, per-day bars, notes by day, period summary card.
- [ ] Desktop check (manual, below).

## Issues and fixes

- 0.16 reorganised the frontend (`src/features`, `src/app`); the first build was re-fitted, not merged.
- A schema version bump broke session-store tests and the fork rule that feature tables do not
  bump the shared version; replaced by the separate `activity.db`.
- The store-command guard test requires `background_work::store`; record/list/summary use it.
- `harness::tests::kill_all_reaps_term_ignoring_children_before_return` failed once under full-suite
  load and passes alone (timing; it also failed before this change).

## Learnings

- Keep fork storage out of upstream files: a separate database file keeps merges clean and stops
  activity writes from waiting on the chat-save lock.
- Meetings are not intersected with "active": the AFK watcher marks calls as away.
- ActivityWatch only sees the focused window, so a call in a background window is missed.

## Desktop check (manual — not for an agent inside MonoCode)

1. Settings → General: Activity tracker on, Activity notes on. Activity shows on the rail.
2. Send a prompt; Activity → Day shows it, then a "finished" row when the turn ends.
3. With `agy` signed in: the pill says Live and a note appears seconds later. Sign out or rename
   `agy`: pill says Paused with Retry; prompts keep logging.
4. Start ActivityWatch (+ browser extension): You/Meetings lanes, Apps and Sites fill within a minute.
5. Week and Month: bars per day; click a bar → that day. Calendar button → pick a past date.
6. Write summary on a week with notes → summary appears, Rewrite replaces it.
7. Process Monitor: Activity tracker row with counts; CPU/RAM while `agy` runs.
8. Activity tracker off → Activity leaves the rail, no new rows are logged.
9. `activity.db` exists beside `monocode.db` in the app data folder.

## Done

Not yet: awaiting the desktop check.

# Review — Backend responsiveness: saves never wait for git, store work off the shared workers (L-166, L-167, L-168)

Created 2026-10-21 22:59 IST. Tier: Medium. All platforms; the slowdown was measured on Windows.

Research behind it: [Performance patterns from T3 Code and Orca](../notes/perf-patterns-t3-orca.md)
(patterns 0 to 4 and 6). L-163 already moved git out from under the database lock; this
finishes the job.

## Goal

Clicks across the app (minimize, New task, Delete, project switch) lagged by seconds. Three
causes remain after L-163:

1. Every database command is `#[tauri::command(async)]` with a blocking body, so it runs on the
   same small pool of tokio workers that window commands (minimize, maximize) need. While saves
   queue on the database lock, those workers are all parked and the window stops answering.
   `control_save`, `control_load` and six `provider_sessions_*` commands are plain sync
   commands, so they run on the main thread itself.
2. Each save and project list asks git for the branch and repo: up to three `git` processes,
   0.3 to 0.6 s on Windows (antivirus scans every launch), with no timeout and no sharing
   between callers that miss the 3 s cache at the same moment.
3. List reads queue behind writes on the one connection, although WAL and a query-only read
   connection already exist (used only by search).

## User story

As a MonoCode user with several agents running, I want window buttons and chat actions to
respond at once, so that the app never feels frozen while it saves.

## Acceptance criteria

L-166, store commands off the shared workers:

- Every command that takes `State<SessionStore>` runs its body on the blocking pool
  (`background_work::store`), so it never occupies a tokio worker or the main thread. This
  includes `control_save`, `control_load` and the plain `provider_sessions_*` commands.
- JS command names, arguments and results do not change. The bodies move unchanged into
  `<name>_blocking` functions, so a review sees signatures change and bodies stay put.
- `perf_ping_db` (L-161) takes the lock the same way, so the Performance log measures what a
  real command waits for.

L-167, git info without blocking:

- `git_info_for` reads the branch and repo from `.git` files first: HEAD (`ref: refs/heads/X`),
  `commondir` for linked worktrees, `config` for `[remote "origin"] url`. Same results as the
  git path for a normal repo, a linked worktree, a submodule, no origin, and not a repo.
- When the files cannot decide (detached HEAD, reftable, `include`/`includeIf` or `url.*`
  rewrites in the config), it returns the last known value (or the partial file result) at once
  and refreshes with git on a background thread. A save never waits for git.
- At most one background refresh runs per folder; callers that miss the cache meanwhile share
  its result (coalescing).
- Every `git_stdout` and `git_output` read has a timeout: 5 s for the branch lookup, 30 s for
  other reads, 120 s for `fetch`. A timed-out git is killed and treated as no answer.

L-168, read lane:

- Pure list and page reads use a second query-only connection, kept apart from the search
  connection so a long search does not block them (in-memory test stores fall back to the writer):
  `session_list_by_project`, `session_list_scratch`, `session_list_sidechats`,
  `session_list_linked`, `session_get`, `session_tool_detail`, `mono_session_page`,
  `mono_session_find`, `tasks_list`, `notes_list`. They no longer wait for a write in progress.
- `mono_session_get` stays on the writer: it migrates legacy transcripts.
- `mono_session_page` first checks whether the session still needs migration; if it does, it
  uses the writer as today.

## States

Backend only. The only visible change is speed. A branch label can lag one save behind a
`git checkout` done outside MonoCode when the files cannot decide it (detached HEAD and the
other cases above); the next save carries the refreshed value.

## Out of scope

- A separate backend process (T3): a rewrite of the Tauri layer; the blocking-pool move gets
  most of the benefit.
- Per-key locks instead of the one store lock (T3 `KeyedLock`): a larger refactor; revisit if
  the L-161 log still shows long lock waits.
- The other plain or async sync commands without a store (harness, file listing). Follow-up,
  guided by the L-161 log. `pty_spawn` and `claude_copy_session` moved to the blocking pool
  (L-171).
- A git process cap and priority scheduler (pattern 5), and the other leftovers: tracked in
  `docs/PLANNED.md` under "Responsiveness follow-ups".

## Follow-ups done (2026-10-22)

- L-170: worktree removal takes the store lock only for its database steps, not while
  `git worktree remove` runs. The removal journal and spawn reservation cover the gap; a
  process-wide mutex keeps removals one at a time.
- L-171: `pty_spawn` and `claude_copy_session` run on the blocking pool.
- L-172: a unit test scans every `#[tauri::command]` and fails if one touches the
  `SessionStore` without `background_work::store`.

## Open questions

None blocking. Upstream merges will conflict on the changed command signatures; resolve by
keeping the wrapper and taking upstream's body into the `_blocking` function.

## Desktop check (manual, not for the implementation agent)

1. With two agents streaming, minimize and restore the window: it responds at once.
2. New task, Delete and switching projects respond without a pause.
3. In a linked worktree chat the branch label shows the worktree's branch.
4. Check out another branch in a terminal, send a message: the label follows within a save.
5. Ctrl+Alt+Shift+P Performance log while working: no long `pool` or `db` pings.

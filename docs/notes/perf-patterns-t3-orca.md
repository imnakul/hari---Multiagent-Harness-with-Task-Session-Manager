# Performance patterns from T3 Code and Orca

Research record, 2026-10-21. It asks how two other multi-agent harnesses keep the app
responsive, and which of their patterns fit MonoCode after the L-163 slowdown (git ran while
holding the one database lock).

Sources read (local copies, code only, nothing run):

- T3 Code: `E:\Developing\OpenSource\hari-orchaestrator-t3code` (commit bd9ed2b4, 2026-08-24)
- Orca 1.4.214: `E:\Developing\OS Contribution\orca-personal-clone\orca-personal-clone` (commit 1855ba49ba, 2026-10-16)

Rechecked the same day against fresh shallow clones in `E:\tmp-research` (see
"Latest code" below):

- T3 Code: commit 680152e2, 2026-10-21. Large changes since August.
- Orca: commit 84a9f995, 2026-10-21. The files cited below are byte-identical to the Oct 16
  copy; the newest commit adds one relevant pattern.

## What each app does

| Concern | MonoCode today | T3 Code | Orca |
|---|---|---|---|
| Where heavy work runs | Tauri commands inside the app process; blocking bodies run on the same tokio workers as window commands | A separate backend process that the desktop shell spawns (`apps/desktop/src/backend/DesktopBackendManager.ts:488`); UI talks to it over WebSocket | Electron main, but every synchronous process launch is a CI failure (`config/scripts/check-main-sync-spawn-ratchet.mjs`). Its comment says each one freezes every window, and on Windows antivirus slows every launch |
| Getting the branch | Starts up to 3 git processes per lookup; 3 s cache per folder; no timeout | The thread's branch is stored data, set by an explicit command with a compare-and-set (`orchestration/decider.ts:814`). Saving never asks git | Reads `.git/HEAD`, `commondir` and the loose ref as files (`git/source-control/worktree-diff-stamp.ts:131`), with no git process |
| Same lookup asked twice at once | Each caller misses the cache and starts its own git processes | Effect `Cache.makeWith` shares one in-flight lookup; status cached 1 s, failures not cached (`git/GitManager.ts:891`) | `runCoalescedProbe` joins an in-flight probe (`git/coalesced-probe.ts`); `GitStatusReadLeaseOwner` shares status reads |
| How many git processes at once | Unlimited | Latest: one global cap of 8 git processes, 4 for status fetches (`vcs/GitVcsDriverCore.ts:54,925`). August copy: mostly unbounded | Admission scheduler: 2 to 4 general, 3 network, at most 10 children; tiers interactive > status > background; waiters age up after 15 s (`shared/git-admission-state.ts`) |
| Timeouts | None on the branch lookup | Latest: 30 s default on every git call, 5 s for branch and status reads (`vcs/GitVcsDriverCore.ts:53,1388`); 60 s default for any child process (`processRunner.ts`) | 120 s default for reads (`shared/git-command-timeout.ts`) |
| Saving state | One SQLite write connection behind one Mutex, shared by every feature; a query-only read connection used only by search | SQLite event store plus projection tables; messages are rows, so a turn appends rather than rewrites | JSON snapshot files. `AtomicSnapshotWriter`: one async write at a time, newer requests merge into the next write, unchanged bytes are skipped (`persistence/atomic-snapshot-writer.ts`) |
| Guarding the rules | Review only | Type system (Effect services) | CI "ratchets" that count risky calls per file and fail when a count goes up |

## Latest code (2026-10-21)

**T3 Code (680152e2).** The server was rebuilt around `apps/server/src/orchestration-v2`
(event store, projection store, effect outbox and worker, command receipts). What matters here:

- Separate read and write lanes on SQLite: one writer semaphore plus a reader connection with
  its own semaphore; read-only work is routed to the reader (`packages/shared/src/nodeSqliteClient.ts:1066`).
  Writes yield after every 16 borrows so a long burst cannot hold the writer.
- Per-key locks (`packages/shared/src/KeyedLock.ts`) for sessions, threads and workspaces,
  instead of one lock for everything.
- Git is capped (8 at once) and timed out (30 s default, 5 s for branch reads). The branch is
  still read with `git symbolic-ref`, not from files.
- Repository identity (remote URL) is cached for 15 minutes, failures for 1 minute
  (`project/RepositoryIdentityResolver.ts:23`). The comment says it exists so background sweeps
  stop starting git every minute.
- Claude history parsing runs in its own worker process (`claude-history-worker.ts`).
- The desktop shell still spawns a separate backend process.

**Orca (84a9f995).** The scheduler, coalesced probe, sync-spawn ratchet, snapshot writer and
`.git` file reads are unchanged. The newest commit (#31513) makes the sidebar list come from
cached git scans joined with stored metadata at read time: "a metadata write publishes without
waiting on git; scans refresh apart" (`main/runtime/sidebar-inputs/workspace-rows-producer.ts:69`).
That is the exact shape of MonoCode's problem: a session save should not wait for git either.

## Patterns worth taking, ranked by payoff for effort

0. **A save never waits for git.** Save with the last known branch and repo for that folder
   (from the cache, or the value already on the row), and refresh git in the background; write
   the new values only when they change. Orca's newest commit and T3's 15-minute identity cache
   both do this. With it, patterns 2 to 4 stop being on the save path at all. *Small to medium
   effort.*
1. **Keep blocking work off the shared workers.** Route database and git commands through
   `spawn_blocking`. MonoCode already has `background_work::read` (4 permits plus
   `spawn_blocking`, used in 13 places), but the session store commands use
   `#[tauri::command(async)]` with blocking bodies, so they still run on tokio workers. With
   this, minimize and the other window commands cannot be starved. *Medium effort, mechanical.*
2. **Read the branch and repo from files, not git.** HEAD, `commondir` for worktrees, and
   `config` for the origin URL; fall back to git only when the files don't decide it (packed
   refs, reftable). This takes microseconds instead of 0.3 to 0.6 s, and avoids the Windows
   antivirus cost on every process launch. *Small effort.*
3. **Share in-flight lookups.** Change `git_info_for` so callers that miss the cache at the
   same moment wait for one lookup instead of each starting git. *Small effort.*
4. **Put a timeout on every git call.** A hung git (credential prompt, network drive, lock
   file) currently holds its caller forever. T3 uses 5 s for branch reads and 30 s otherwise.
   *Small effort.*
5. **Cap and prioritise git processes.** A small Orca-style scheduler: user-clicked actions
   first, status next, background last. Worth it only if the L-161 log still shows git storms
   after 1 to 4. *Medium effort.*
6. **Serve list reads from the read connection.** WAL is already on, so `session_list_by_project`
   and similar reads could use the query-only connection and stop waiting for writes. Note
   that the read connection is itself one Mutex. Latest T3 does exactly this split.
   *Small to medium effort.*
7. **Guardrail test.** One Rust test or script that fails when a plain sync command takes the
   store lock or starts a process (the `control_save`/`control_load` case). *Small effort.*

## Already in place, or not worth copying

- Coalesced, fingerprinted saves: `enqueueSessionWrite` plus `persistFingerprint` already
  match Orca's "one write in flight, skip unchanged".
- Append-only transcripts: `mono_session_upsert` already writes only the changed suffix.
- T3's separate backend process: the strongest isolation, but a rewrite of the Tauri layer.
  Not worth it; pattern 1 gets most of the benefit.
- Branch as stored data (T3): changes upstream behaviour (the branch shown on old chats).
  Leave it to upstream.

## Upstream note

Patterns 0 to 4 fix code that MonoCode upstream also has (git under the lock since 0.1.0).
They are candidates for an upstream issue, not only fork rows.

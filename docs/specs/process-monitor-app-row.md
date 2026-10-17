# Review — Process monitor: MonoCode app row

Extends L-84 (`interactive-lifecycle-and-process-monitor-plan.md`). Medium task.

## Goal

The monitor counts only chats and terminals MonoCode starts, so with nothing running it shows
`CPU 0.0% · 0 MiB` and an empty list. Users expect what Orca shows: the app's own cost too.

- User story: As a MonoCode user, I want to see how much CPU and memory MonoCode itself uses
  (host process plus its WebView2 browser processes), so the chip reflects the real cost of the app.

## Acceptance criteria

- The popover shows one **MonoCode app** row first, outside the project groups: CPU %, working-set
  memory, process count. No Stop button and never part of "Stop all idle".
- The app row is the app process tree **minus** every chat/terminal tree already listed. A process
  is counted once, under its nearest listed owner (existing `tree` rule).
- The chip total = app row + live chat/terminal rows.
- If some app processes can't be read (for example a sandboxed WebView2 process), the row sums the
  readable ones and says how many were unreadable; the total still shows.
- First sample shows "Measuring CPU…" for the app row (CPU needs two samples), as for other rows.
- Empty text becomes "No chats or terminals running." because the app row is always present.
- Off state is unchanged: no sampler, timers or IPC.

## Plan

1. `src-tauri/src/process_stats.rs`: the command returns `{ app, owned }`. Add the app pid
   (`std::process::id()`) as one more root in the same single snapshot, so nested chat roots
   win their own subtrees. Pure helper `app_usage(...)` for unit tests. Rename the command to
   `process_monitor_stats` because the shape changed (only two web call sites use it).
2. `src/app/shell/processMonitorModel.ts`: `AppProcess` and `ProcessMonitorStats` types;
   `processTotals(app, rows)` for the chip.
3. `src/app/shell/ProcessMonitor.tsx`: render the app row, use totals, update empty copy, read
   `owned` in the bulk-stop recheck.
4. Tests: Rust `app_usage` (excludes chat subtree, counts unreadable, partial sums); React
   (app row shown without Stop, chip includes app memory, empty copy, bulk stop unaffected).

## States

Loading, measuring CPU, partial (unreadable processes), stats unavailable (snapshot error),
no chats/terminals. App row never shows "exited".

## Risks

- On Windows each terminal's `conhost.exe`/`OpenConsole.exe` is a child of the app, not of the
  shell, so it counts under the app row, not the terminal. Small; noted as a follow-up.
- In `tauri dev` the tree starts at `monocode.exe`; cargo/vite are its parents, not counted.

## Out of scope

Other, unrelated system processes; history sparklines; disk usage ("Space" in Orca).

## Follow-up: expandable process lists

User asked to see the processes inside each row (the app's 11 processes, a chat's tools).

- Every row (app, chat, terminal) gets a disclosure button (`aria-expanded`), collapsed by default.
  Expanded, it lists each process in tree order, indented by depth: name, PID, CPU %, memory.
- View only: no per-process Stop. Killing one WebView2 process can crash the window, and killing a
  chat's tool behind the chat confuses it. The row's existing Stop remains the way to stop.
- Names come from the snapshot MonoCode already takes (Windows Toolhelp exe name, Linux `stat`
  comm, macOS bsd info name). No new API or crate.
- `msedgewebview2.exe` labels: "Web view (main)" when its parent is the app, "Web view helper"
  otherwise. Renderer/GPU/network types need each process's command line (a lower-level Windows
  API); not worth it for a label.
- States: unreadable process shows "unavailable"; first sample "Measuring…"; an exited row shows no
  list. Expanded state survives refreshes (keyed by row id + PID).
- Checklist: [x] names in snapshots · [x] `children` on rows + DFS order tests · [x] expandable UI +
  tests · [x] checks · [x] records · [ ] manual desktop check (human): the app row expands to
  monocode.exe plus web view processes; a terminal row expands; lists stay open across refreshes.

## Checklist

- [x] Rust command + unit tests
- [x] Model/UI + React tests
- [x] tsc, full web suite, Rust tests/Clippy for changed crate
- [x] Changelog, LOCAL-FEATURES L-84 row
- [ ] Manual desktop check (human): app row appears with nothing running; opening a terminal adds a
      row and the app row does not double-count it

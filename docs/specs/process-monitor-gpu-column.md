# Review — Process monitor: GPU column and hover Stop icon (L-101)

Created: 2026-10-18 12:28 IST · Tier: Medium · Builds on [process-monitor-app-row.md](process-monitor-app-row.md)

- Goal: show GPU use next to CPU and RAM, and keep the process list calm by hiding Stop until it is wanted.
- User story: As a MonoCode user, I want to see CPU | RAM | GPU per process tree, and a Stop icon only on the row I point at, so the monitor is easy to scan and hard to misclick.

## Acceptance criteria

1. Every row (MonoCode app, chats/terminals, expanded process lists) shows three aligned columns: CPU, RAM, GPU, under a small header.
2. The bottom-bar chip reads `CPU x% · mem · GPU y%`; the GPU part is left out while GPU is unknown.
3. GPU comes from the Windows "GPU Engine" counters, using Task Manager's rule: sum engines per type, report the busiest type, cap at 100%. Totals are summed and capped at 100%.
4. The first reading only primes the counter (it is a rate), so GPU shows "—" for one refresh. Machines without the counters (and non-Windows) keep showing "—", with a screen-reader label "GPU not measured".
5. Stop is a square icon button (`aria-label="Stop <title>"`, tooltip "Stop"), invisible until the row is hovered or the button has keyboard focus. While stopping, a spinner with `role="status"` replaces it. Exited rows keep the empty slot so columns stay aligned.
6. Unknown values show "—" with a screen-reader reason (measuring, unavailable, not measured).

## Design notes

- Rust: `process_gpu.rs` keeps one PDH query open in `ProcessStats` (behind its mutex), opened lazily on the first sample and closed on drop. Sampling only happens while the monitor is enabled, as before.
- Terminals drawn with WebGL (L-99) render in the WebView2 GPU process, so their GPU use appears on the MonoCode app row, not the terminal's row. Agent CLIs normally show 0%. The footer note says this.
- `windows-sys` gains the `Win32_System_Performance` feature (same crate, no new dependency).

## States

Measuring (first sample), known value, unavailable/not measured, stopping (spinner), exited (empty slot), hover/focus (Stop visible).

## Out of scope

- Per-terminal GPU attribution (not possible: one shared GPU process).
- GPU on macOS/Linux.
- GPU memory.

## Verification

- `cargo test --lib process_` (9 pass, including GPU parsing and a live prime-then-read sample).
- `ProcessMonitor.test.ts` (9 pass: GPU chip and row values, hover-only Stop icon).
- Full web suite 6,964 passed, 2 skipped; `tsc` clean.
- Manual desktop check (human): GPU column fills in on Windows after one refresh; Stop appears on hover and on Tab focus; spinner while stopping; columns line up in expanded lists.

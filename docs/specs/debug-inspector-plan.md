# Review — Debug Inspector

Branch: `nakul/windows-support-upstream-0.10.0`  
Starting commit: `79cb6f4d` (local and fetched `nakul-fork` identical, 2026-10-12).  
Tier: Large. Existing Cargo.toml worktree line-ending change is preserved. No upstream intake, publication or installer.

## Idea

Give developers evidence for headless Claude quota investigations across providers without causing provider activity. As a developer, I want correlated metadata, token/cache provenance, local records and dated account quota observations so I can distinguish extra work from billing assumptions.

### Acceptance criteria
- Settings has a separate Debug Inspector page with Overview, Timeline, Local evidence and Quota views.
- Opening/refreshing performs no provider launch, prompt, resume, compaction or quota probe.
- Separate submission, dispatch, response, tool, process and helper identities; streaming deltas never count as requests.
- Observe live harness boundaries across providers; explicitly label coverage gaps and opaque CLI retries.
- Preserve unknown usage and provider semantics; never sum message, turn, cumulative and SDK-result aggregates.
- Explicit local read supports validated Claude/Codex native identities and accounts with bounded pure reads, malformed/partial handling and no credentials or arbitrary paths.
- Pause/clear affect diagnostics only. Copy/export is metadata allowlisted and pseudonymizes identities.
- Retention, file reads and UI notifications are bounded. Diagnostic exceptions cannot change execution.
- Meaningful regression tests and full Large-task gates; live desktop/provider tests remain human follow-up.

## Research

- Registry owns serialized dispatch, compaction, cancellation, isolated text helpers and title generation. App owns accepted local turn generation; queues/steering remain untouched.
- Shared child bridge owns actual spawn PID/exit matching. Never interpret stdout chunks as requests.
- Claude assistant IDs deduplicate live usage; result usage may replace a turn aggregate. Diagnostic raw fields must preserve missing values before normal accounting fills defaults.
- Codex normalized usage has inclusive cached input and cumulative/turn snapshots; local JSONL token_count exposes total and last separately.
- Existing quota cache publishes dated account snapshots; inspector observes successful publications, never calls loadRateLimits.
- Existing native source keys bind provider/root/native ID; local read reuses account-root resolution and validates containment/identity.
- SocratiCode tools unavailable in this session; targeted source inspection used.

## Plan

1. Metadata model/store and provenance rules: `src/features/debug-inspector/model/`.
2. Passive hooks: App submission, harness registry/events, shared child process lifecycle, provider raw usage metadata and quota-cache publication.
3. Bounded native reader: Rust command using existing account/source identity, with reader security/parsing tests.
4. Settings navigation/page: shared SegmentedSwitch, SearchableSelect, SecondaryButton, Settings scrolling/tokens and semantic tables.
5. Focused tests, full TypeScript/web/Rust/host/build gates; primary review, records and manual handoff.

Design contract: restrained technical workspace using existing fonts/tokens. Primary action is selecting a session and reading evidence; timeline/coverage are focal. Responsive controls wrap, details remain readable, tables scroll within their region. Empty, paused, unavailable, loading, stale/error and successful states are explicit. No new dependencies.

## Todos

- [x] Inspect status/branch/remotes, fetch fork, establish actual base and preserve existing work.
- [x] Read agreement, profile and relevant indexes; write this spec before implementation.
- [x] Metadata store, deduplication, bounded retention and sanitized reports.
- [x] Submission/harness/helper/process/RC/usage observation.
- [x] Explicit bounded local evidence reader and isolation tests written; Rust execution remains blocked below.
- [x] Settings page and live/historical quota interval comparison.
- [x] TypeScript/web and production/host builds; confirm existing Antigravity host parity failure.
- [ ] Rust format, workspace check, Clippy and tests — Windows Application Control blocks every installed Rust executable (OS error 4551).
- [x] Primary source review, local feature L-80 and current changelog.
- [ ] Separate human Windows/provider verification.

## Issues and fixes

Risks: replay and mixed aggregates; opaque CLI activity; process helper ownership; quota window reset/account-wide activity; growing transcripts and symlinks; diagnostic overhead. Mitigations: explicit scope/identity, replacement snapshots, conservative coverage labels, no inferred request counts, bounded reads/retention and metadata allowlists.

Primary review corrections: raw Claude message/SDK-result fields bypass normal display accounting (which fills missing fields with zero); normalized zeros are treated conservatively as unknown. Later Claude records replace earlier same-message measurements. Codex exact replay snapshots deduplicate without adding cumulative and last-response data. RC model/settings live on their external turn and never inherit a local prompt's effort. Native ID and account/path failures fail closed. SDK-result snapshots without an identity are labeled and never totaled in the local view.

Final review added a metadata-only SQLite identity command: it selects only bounded provider/native/account columns and never calls the full session loader or Mono transcript migration. Saved Mono Codex evidence fails explicitly instead of falling back to ordinary storage. Fresh submissions use a diagnostic sequence independent of resettable App turn generations; queued IDs remain stable. Response/item identities, provider turn IDs and unexposed request IDs are separate. Authorship and mirrored subagent tool metadata are categorical; tool text/results remain excluded. The host engine explicitly drops diagnostic-only records, including nested external diagnostics, before session state or persistence; its targeted 28-test suite passes.

Quota interval totals require terminal lifecycle evidence with covered start/end; a recreated completion after Clear cannot assign a pre-interval aggregate to the interval. Timestamped local evidence remains separate. Two overlapping build/full-web runs had untouched CRLF editor test timeouts in separate cases; isolated and subsequent non-overlapping full runs passed without any test or timeout changes. This is recorded as a timing limitation, not a waived assertion or a confirmed provider regression.

The first full web run found an expected navigation fixture update and a timeout in untouched `FileEditorCrlfGit.test.ts`. The fixture now includes the new section. The CRLF test passed a focused rerun and the subsequent full web suite without changes. Existing submission-source extraction tests gained diagnostic bindings while retaining all cancellation/resume assertions.

Rust command/tests received static review, but **the backend has not compiled or run**: Cargo, rustfmt and the direct stable-toolchain binaries are all denied by Windows Application Control; an escalated agent attempt also failed. No security policy, test or compiler setting was weakened. Rerun the Rust gates in a permitted environment before treating the native reader as verified.

## Learnings

Implemented source uses no new dependencies or provider probes. Capture is on by default, window-local and memory-only: 2,000 trace rows, 6,000 dedup identities, 200 quota observations, bounded process/session/helper correlation and 250 ms UI notifications. Streaming text/arguments/results are ignored; safe tool names/categories and lifecycle transitions are observed. Metadata copy/export removes free-form text and paths and replaces session/account/request/tool/model identities with report-local aliases. Known safe effort/runtime/settings and numeric measurements remain available.

The reader scans only existing account-root `projects` (Claude), or `sessions`/`archived_sessions` (Codex), with 20,000 entries, depth 8 and 1.5 s scan caps. Reads are at most 2 MiB head/tail including alignment, 128 KiB per line, 50,000 complete lines and 1,000 measurements. Inconclusive scans, identity mismatch, symlinks/junctions and duplicate native paths fail closed. Partial, malformed, oversized and changing files have explicit coverage flags. Re-reading replaces a UI snapshot and never feeds live usage totals. Local IPC responses are allowlisted and timed out after 15 s; stale selections cannot replace current evidence.

Live subscriptions are account-wide; comparable reported tokens cannot establish equivalent subscription weighting. Desktop activity is comparable only when the same native store is actually accessible. Claude Desktop outside the Claude Code JSONL store, compressed/database Codex history, Mono's private Codex store, other-provider local formats, remote-host/cloud execution, hidden CLI retries/network calls and exact subscription weighting are unsupported. Normalized counters can lack raw-field provenance; their zero values remain unknown. Shared helper process correlation is withheld when ownership is ambiguous. Remote-host capture is not transported into this Settings page.

| Provider/evidence | Supported observations | Explicit limitations |
|---|---|---|
| All local live harnesses | Submission/dispatch/helper boundaries, process PID/exit where shared child backend is used, tool lifecycle/categories, adapter-reported usage/model/context | No invented response IDs, raw request count, hidden retries or unsupported counters |
| Claude live | Assistant IDs, raw uncached/output/cache-read/cache-write and reported TTL partitions; SDK-result cost/aggregate; native binding/resume intention/launch, compaction confirmation and RC external model/effort | Message and SDK result never added together; cache misses not inferred; subagent messages labeled separately |
| Codex live | Completed agent item IDs, native thread binding, raw cumulative and separate normalized turn usage, inclusive cached-input semantics | Item completions are observations, not network requests; absent raw fields and normalized zeros unknown |
| Claude/Codex local | Explicit account-scoped JSONL metadata, source/time/coverage, Claude message reconciliation and separate SDK-result snapshots; Codex cumulative/last snapshots | Supported native header required; no credentials/provider commands; bounded region only; no guaranteed Desktop visibility |
| Existing quota cache | Successful dated account observations for Claude, Codex, OpenCode, Antigravity CLI and Devin when normal app activity obtains them | No inspector quota refresh; mismatched/unknown reset windows do not produce a comparable delta; other apps/devices may contribute |

## Done

Source is implemented, uncommitted on the requested branch. Status is Review; required Rust execution and human desktop/provider checks remain. No publication, upstream merge or installer was performed; the original Cargo.toml worktree change remains preserved.

### Automated verification

- Inspector focused suite: 33 tests / 5 files passed (dedup/replay, streaming/completed records, scopes/unknowns, process/resume, RC model ownership, bounded retention/notifications, metadata isolation/sanitization, explicit read/stale results, historical interval/account selection, interval lifecycle bounds, subagent tools, and capture-on/off submission/launch/event invariance).
- Full web suite and TypeScript: **6,761 tests / 611 files passed** in the final `npm run check:web` run after the final UI/report/RC/interval adjustments and metadata-only saved identity boundary.
- Production web build: passed; existing bundle-size/dynamic-import warnings remain.
- Host build: passed. Final full host suite: 101 passed, 1 failed, 15 skipped / 23 files. Sole failure is unchanged `host/providers.test.ts:14`, `REMOTE_PROVIDERS` versus `HARNESSES` missing the local-only `antigravity-cli`. Both contract files and the test remain unchanged; unsupported remote capabilities were not added.
- `npm run check`: web passed, then Rust format could not start (OS error 4551). Separate workspace cargo check, fmt, Clippy and cargo test all fail at executable launch for the same reason. Twelve platform-applicable native file/metadata reader tests are written but unrun.
- Lint: no repository lint script/configuration exists. New TS files formatted with the installed Prettier; `git diff --check` passed. Formatting is not claimed as lint.

### How to compare Claude headless with interactive/Desktop

1. Open Settings → Debug Inspector before the headless run. Leave capture on and choose its session. Opening the page does not start or contact a provider.
2. Use Overview and Timeline to inspect distinct submissions versus dispatches, title/helper work, tools, process launches/resume, compaction and RC turns. Compare actual model/settings and individual raw message/cache measurements; do not infer requests from chunks or duplicate prompts.
3. After a normal run, choose Local evidence → Read local metadata for the saved chat. For an interactive/Desktop comparison, choose Exact native session, the same provider/account and a known accessible native ID. Release its writer normally when required by the provider; the inspector does not resume it.
4. In Quota, choose two existing observations from the same account/reset window. Live activity wholly inside the interval and timestamped local evidence are shown separately. Claude local message measurements may be totaled; Codex cumulative snapshots remain separate. Missing timestamps or incomplete coverage are unknown, never assigned the file-read time. Normal quota controls elsewhere may obtain readings as usual; the inspector cannot request them.
5. Compare equivalent model/effort, workloads and intervals. Extra submissions, helpers, tools, restarts and cache writes are observed facts where captured. Provider-side weighting, other devices and hidden requests are possible explanations or unavailable information. Comparable tokens with different quota consumption are evidence for further investigation, not exact billing attribution.
6. Copy/export a sanitized report after reviewing coverage. Models and tool identities are aliased in reports; actual known metadata remains visible in the inspector.

### Separate manual Windows/provider checklist

- [ ] After Rust gates pass, run `npm run tauri dev` in a permitted environment. Verify the sidebar item, keyboard tabs/selectors, visible focus, scrolling/narrow windows and empty/loading/error states; no browser/native automation was run here.
- [ ] Open, switch, pause, clear and copy/export while idle. Confirm no provider process/prompt/resume/compaction/quota request occurs. Confirm normal live agents continue while capture is paused/cleared.
- [ ] Claude: one send, queued follow-up, native resume, process parking/restart, title/helper, cancellation and manual/provider compaction. Compare trace with native metadata and preserve approvals/queue behavior.
- [ ] Claude RC: phone work beside a local queued turn; verify external IDs/model/effort and source labels, without assigning phone output to the local submission.
- [ ] Claude cache: compare message IDs and raw read/write/TTL fields across repeated turns. Verify SDK aggregates are separate and low reuse is not labeled a cache miss.
- [ ] Codex: inclusive cache semantics, native thread binding, cumulative/last snapshots, missing-field rendering and repeated local reads.
- [ ] Local reader: default and separate accounts, custom roots, archived/uncompressed records, wrong/native IDs, large/partial files and symlink/junction denial. Verify no transcript or credential changes. The linked-path native test depends on OS permission to create its fixture.
- [ ] Quota: same versus changed reset windows; timestamped historical comparison, missing dates, other-account evidence and coverage gaps.
- [ ] Sanitized reports: verify absence of prompts, titles, arguments/results, paths, RC URLs and credentials; confirm aliases preserve relationships. No automated test proves real subscription behavior.

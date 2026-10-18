# Upstream main intake — 2026-10-18 / 0.14.0

Status: all six choices applied; conflicts resolved and source preservation reviewed; full automated gates pass. Local merge committed, publication and human Windows/provider verification separate.

## Pinned scope

- New branch: `nakul/windows-support-upstream-0.14.0`.
- Latest fork 0.10.0: `b344c56b2e355cd2e3fa55f41b537701cb029533` (16 commits after initial checkout `123e8adf`).
- Upstream main: `a90c558d7b1c7955a641a970c1ce10f5ba7df828`; package version 0.14.0, including unreleased changes after the tag.
- Common ancestor: `7d099eb8e1d3a544a9221cda66de251f25e6c4a0`.
- Incoming: 208 commits / 429 paths. Fork: 869 paths changed since base. Overlap: 111 paths.
- Original 0.10.0 branch is untouched. No upstream writes; origin remains the fork.
- User requests all main changes; post-tag changes are included, not a separate scope question.
- Full lifecycle/spec: [upstream-0.14.0-sync-plan.md](../../specs/upstream-0.14.0-sync-plan.md).

## Conflict approval contract

`docs/WORKING-AGREEMENT.md` says: “Merge conflicts: STOP. Explain incoming-vs-ours,
consequences and a suggestion in simple language, file by file. Never auto-decide.”
The user approved all six choices presented directly in chat on 2026-10-18,
including the keep-both technical resolution policy below. Product choices from NOTES §0 remain fixed: keep local Stop,
Queue/Steer, visible menu, shared Antigravity ACP plus separate CLI/Cline, durable
queues, lazy terminal cleanup, wallpaper/hover behavior and unified usage accounting.
L-90 stays removed by L-94. Never discard newer L-93–L-104 work.

## Approved integration policy

- Optional upstream New layout remains opt-in; classic stays the default. Preserve
  local features in classic and wire them into the optional layout where applicable.
- Keep the local default-off native-API process monitor, GPU/partial totals, app and
  owned-process rows; combine useful upstream resource-pressure controls without
  duplicate displays or a second competing process owner. Off-mode sampling cost
  is preserved; upstream pressure sampling is mounted only while the monitor is enabled.
- Keep local Claude continuation confirmation, exact native history, switch-back,
  account rebind and live-process safety; incorporate upstream Codex continuation.
  Avoid two competing account-transfer paths or silent summary fallback for Interactive.
- Keep Interactive's conservative idle shutdown and per-session steer restrictions;
  upstream idle-agent limits must not bypass those checks or kill background work.
- Preserve local provider, queue, task/session manager, notifications, hover, wallpaper,
  usage-polling and Windows containment contracts while adding upstream performance,
  code/diff, Mono, media/artifact, terminal-link and remote-host changes.
- Use upstream version 0.14.0 in source metadata while retaining the dev profile and
  fork build scripts; no installer build or new local installer number is requested.
- Union upstream editor/emoji/link dependencies with local xterm WebGL; no sysinfo.

## Actual merge conflicts

The noncommitting merge of pinned main reported **54 files / 178 conflict hunks**.
The preview merge was aborted for the approval handoff. After the user approved all six
choices, the pinned merge was restarted and all 54 files were resolved. The table below
is the approved resolution contract used for implementation. Dropping either side wholesale would remove the local or incoming
behavior described in the corresponding row.

### Approved product choices

1. **Layout:** retain upstream's opt-in New layout and default classic layout; carry
   local Tasks, Session Manager, usage, notifications and composer actions into both.
   Accept incoming Mono overview behavior; preserve local per-turn sessions/activity
   access through it rather than maintaining a second competing overview.
2. **Resources:** recommend one combined process view backed by local native APIs,
   retaining GPU, partial totals, app row, descendant ownership and Stop controls.
   Put incoming resource-pressure sampling/indicator under the same default-off
   Experimentation toggle. This preserves zero monitor cost when off, but upstream's
   always-on pressure warning then requires opting in. Incoming per-tool Stop must
   be adapted to verified local ownership on Windows; never enable an unverified PID stop.
3. **Accounts:** recommend retaining local Claude confirmation, exact transcript copy,
   rebind/switch-back and busy/background/live-Interactive safety. Add incoming Codex
   continuation. If exact native history cannot be copied, show an error and offer an
   explicit handoff choice; do not silently substitute a summary or discard a binding.
4. **Idle:** accept incoming generic three-minute park/warm-owner limit while retaining
   local Interactive idle rules and desired Remote Control exemptions in every eviction
   path. Generic limits must not shorten Interactive's configured quiet period.
5. **Metadata/dependencies:** use 0.14.0 source version across manifests, keep the local
   dev profile and dependency union. No installer or new local build number yet.

### File-by-file proposals

| File | Local behavior | Incoming behavior | Proposal and consequence | Approval |
|---|---|---|---|---|
| `Cargo.lock` (2 hunks) | Local release number and Interactive HTTP-hook dependency. | 0.14.0 and async/batched-output dependencies. | Use 0.14.0 source version; retain tiny_http and all local dependencies, add incoming dependencies, regenerate/verify lock without dropping Windows patches. | Approved 2026-10-18 |
| `Cargo.toml` (1 hunks) | 0.10.0-local2-upstream-sync workspace version. | 0.14.0 workspace version. | Use 0.14.0 for the integration source; keep fork workspace/patch settings. No installer requested. | Approved 2026-10-18 |
| `package-lock.json` (4 hunks) | Local release number and xterm WebGL renderer. | 0.14.0 and terminal hyperlinks/editor/emoji additions. | Union both dependency sets and verify lock consistency; keep WebGL and add web-links. | Approved 2026-10-18 |
| `package.json` (2 hunks) | Dev-profile script, local version and WebGL dependency. | 0.14.0 and new language/emoji/hyperlink dependencies. | Use upstream source version, keep dev-profile/build scripts and WebGL, add incoming packages. | Approved 2026-10-18 |
| `src-tauri/Cargo.toml` (1 hunks) | toml_edit for account/config work and Windows/native metric features. | tokio synchronization plus Windows single-instance plugin. | Keep both dependency/feature sets and native API metrics; do not add sysinfo. | Approved 2026-10-18 |
| `src-tauri/src/fs.rs` (4 hunks) | Managed wallpaper and canonical project-contained image reads/tests. | Document-relative image reads and scoped video streaming. | Keep wallpaper and both image callers; add video streaming with incoming scope checks. Retain both path-containment/symlink/size test families. | Approved 2026-10-18 |
| `src-tauri/src/harness.rs` (4 hunks) | Windows job ownership, activity timestamps and durable Windows PATH discovery. | Process identities, batched stdout and cached GUI PATH for Git. | Keep job containment and touch activity before batching; add process identities and nonblocking cached PATH without bypassing Windows discovery. | Approved 2026-10-18 |
| `src-tauri/src/lib.rs` (3 hunks) | Task/prompt/provider-history/Interactive modules and image commands. | Account transfer, deferred tool detail and new media commands. | Register both feature sets exactly once; retain existing fork commands and Windows setup. Reconcile account/resource ownership under approved product choices. | Approved 2026-10-18 |
| `src-tauri/src/session_store.rs` (2 hunks) | Queue-status-aware persistence and durable queue timestamps. | Optimized prior-block retrieval and tool-output storage. | Keep queue contents/status in change detection while adopting incoming block storage; verify every SQL tuple, column and mapping and restart durability. | Approved 2026-10-18 |
| `src-tauri/tauri.conf.json` (2 hunks) | Local version and blob connections needed by local previews. | 0.14.0 plus sandboxed monoartifact frames. | Use 0.14.0; retain required blob connection support and add only upstream artifact frame origins. Keep separate dev profile and Windows config. | Approved 2026-10-18 |
| `src/app/App.tsx` (36 hunks) | Task/Session managers, durable queues, provider/Interactive controls, notification center, usage, linked chats and L-102 account rebind. | New optional layout, session external-store/performance plumbing, Mono overview, resource pressure, account transfer and new tab lifecycle. | Combine at each hook/render path; keep fork managers, all-account footer and local callbacks in both layouts. Preserve queue persistence/removal and Interactive no-steer/helpers/idle protections; reconcile resources/accounts as proposed below. | Approved 2026-10-18 |
| `src/app/shell/MonoRailSection.tsx` (1 hunks) | One-time inline Mono introduction. | Per-project Mono lists in the new layout. | Retain the introduction and dismissal state; apply project filtering for the new layout. | Approved 2026-10-18 |
| `src/app/shell/ProjectRail.tsx` (2 hunks) | Shared hover highlight and existing title/navigation. | Headerless/new-layout support, fullscreen window-control insets and reorder. | Keep hover behavior while accepting upstream layout/reorder/inset support. | Approved 2026-10-18 |
| `src/app/shell/Sidebar.tsx` (18 hunks) | Task/chat mode, Drafts, provider panel, linked sidechat/fork trees, Remote Control markers and dismiss-working controls. | New-layout sidebar/right panel, project spaces, animated rows and operator-started child groups. | Retain all fork entry points and local child relationships; integrate upstream operator children without duplicate rows or replacing local tree links. Keep classic sidebar behavior and new right-panel wiring. | Approved 2026-10-18 |
| `src/app/shell/TitleBar.tsx` (7 hunks) | Task/Session-manager actions and embedded tab-only strip. | Optional-layout navigation, right-panel toggle and Mono overview/settings. | Keep embedded manager strip and task actions; add incoming layout controls with correct close/archive actions and window-control placement. | Approved 2026-10-18 |
| `src/app/shell/UsageFooter.tsx` (5 hunks) | Grouped all-account usage, Antigravity quotas, automatic/forced/per-account refresh and local process monitor. | Reusable usage chips, new-layout footer, terminal toggle and resource-pressure slot. | Keep local account/poll/refresh and provider coverage; add upstream variants and terminal toggle. Retain footer in Task/Session managers; one resource view under the agreed opt-in policy. | Approved 2026-10-18 |
| `src/app/shell/UsageProviderChip.tsx` (3 hunks) | In-use account highlight, Antigravity family windows and per-account Refresh. | Shared footer/composer/new-layout variants. | Preserve highlights, family details and Refresh in every relevant variant; add incoming reusable styling. | Approved 2026-10-18 |
| `src/features/automations/ui/AutomationsView.test.ts` (1 hunks) | Custom cron/Operator editing regressions. | Project-scoped automation list regression. | Keep both test families; do not weaken custom schedule persistence or incoming scoping. | Approved 2026-10-18 |
| `src/features/files/editor/editorGit.ts` (1 hunks) | CRLF decoding/encoding for edit/stage parity. | Shared editor line-height metrics. | Keep both imports and behavior; validate partial staging with CRLF. | Approved 2026-10-18 |
| `src/features/files/ui/FilePane.tsx` (3 hunks) | Local pane-surface selection and full-row/deleted-file Git review. | Mounted review tabs preserve state; deferred body and faster diff surface. | Move local diff kinds into retained incoming tab surfaces; preserve deleted-file/full-row navigation and state across switches. | Approved 2026-10-18 |
| `src/features/monos/model/monoFiles.ts` (1 hunks) | Monos know Tasks and project-scoped task CLI access. | Emoji reaction guidance and HTML artifact rules. | Keep Tasks instructions and project alias, add reaction and safe HTML artifact instructions. | Approved 2026-10-18 |
| `src/features/monos/model/monoMessaging.ts` (1 hunks) | Durable queue append helpers. | Dispatch eligibility checks for queued Mono messages. | Keep append durability and add eligibility checks; do not bypass local holds or Interactive no-steer. | Approved 2026-10-18 |
| `src/features/notes/ui/NotesView.tsx` (3 hunks) | Local optional recents, hover, table/image actions. | Active-project note scoping. | Add scopeProject and required imports; retain optional recents compatibility for local callers and all note actions. | Approved 2026-10-18 |
| `src/features/quick-composer/main.tsx` (1 hunks) | Windows platform/glass support. | Native context-menu guard. | Keep Windows platform wiring and add incoming context-menu guard. | Approved 2026-10-18 |
| `src/features/sessions/data/sessionHistory.test.ts` (2 hunks) | Scratch-chat history coverage. | Summary equality/clock stabilization coverage. | Retain both independent test suites and imports. | Approved 2026-10-18 |
| `src/features/sessions/hooks/useTranscriptSelection.ts` (1 hunks) | Response ID retained for sidechat/source actions. | Clamp whole-last-paragraph selection correctly. | Use clamped incoming range while retaining the response ID and local source recovery. | Approved 2026-10-18 |
| `src/features/sessions/ui/AgentMarkdown.tsx` (9 hunks) | Table actions, wrap toggle, note/task/project images and local lightbox. | Document images, local video/media, visibility-aware smooth reveal and render workers. | Preserve local actions/image validation and add incoming media/document/reveal support, using separate validated image contexts rather than broadening file access. | Approved 2026-10-18 |
| `src/features/sessions/ui/AgentTranscript.inlineWork.test.ts` (1 hunks) | Show sessions/activity actions with local note/copy controls. | Revised compact Mono turn actions. | Preserve functional action coverage; update only approved visual/order expectations and add new overview behavior tests. | Approved 2026-10-18 |
| `src/features/sessions/ui/AgentTranscript.test.ts` (1 hunks) | Mounted-root cleanup and local transcript rendering regressions. | Mid-turn message clock regression. | Keep both setup and clock tests; preserve original full-turn duration and external completion timing. | Approved 2026-10-18 |
| `src/features/sessions/ui/AgentTranscript.tsx` (7 hunks) | Sidechat/branch, scoped approvals, review-fix actions, saved notes and per-turn sessions. | Mono reactions, hover actions, local media and revised activity/overview. | Retain local actions/approval scope and turn metadata while adding reactions/media/overview; avoid duplicate controls. | Approved 2026-10-18 |
| `src/features/sessions/ui/Composer.tsx` (1 hunks) | Unified Task/Session composer and project/checkout controls. | New-layout workspace bar placement. | Retain task/session/Interactive/account/saved-prompt/Stop controls and move the workspace bar only for incoming layout variants. | Approved 2026-10-18 |
| `src/features/sessions/ui/ContextMeter.tsx` (3 hunks) | Detailed provider-sourced context/cost inspection and compact controls. | Known-empty ring for a fresh conversation. | Add empty-state support without replacing detailed local usage/cost popover or inventing provider numbers. | Approved 2026-10-18 |
| `src/features/sessions/ui/EmptySession.tsx` (1 hunks) | Provider/native-resume notices. | Responsive initial-composer layout on short/narrow panes. | Retain notices in the incoming responsive placement so input remains accessible. | Approved 2026-10-18 |
| `src/features/sessions/ui/MarkdownModeToggle.tsx` (1 hunks) | Copy Markdown action. | Ref-based state for the incoming preview/source choice. | Keep Copy Markdown and incoming preview/source persistence. | Approved 2026-10-18 |
| `src/features/sessions/ui/ModelPicker.tsx` (3 hunks) | Structured/Interactive choice, account selector, effort/Speed pills and full-row hover. | More precise model labels and text-control variants/provider groups. | Keep local selectors and Speed behavior in all variants, add version-aware upstream labels/grouping without duplicate settings. | Approved 2026-10-18 |
| `src/features/sessions/ui/SessionPane.tsx` (1 hunks) | Read-only native history, Interactive diagnostics/terminal, account and local pane actions. | Stable empty state and settled edit-path computation. | Keep native-history exclusion from send/save/counting; integrate incoming derived state and retained transcript/performance surface. | Approved 2026-10-18 |
| `src/features/settings/model/appearance.ts` (3 hunks) | Fonts, wallpaper/effects, menu surfaces and Windows acrylic controls. | Optional layout palettes/glass, persisted theme and native tint. | Retain local preferences; keep incoming layout palettes independent and macOS blur changes platform-gated. Do not erase saved wallpaper/font choices. | Approved 2026-10-18 |
| `src/features/settings/model/settings.ts` (2 hunks) | Local/Remote/Cloud defaults, startup provider check and local experiments. | Keep idle agents ready setting. | Keep both setting sets. Apply upstream idle limits only to eligible generic owners; exclude protected Interactive and desired Remote Control sessions. | Approved 2026-10-18 |
| `src/features/settings/ui/SettingsView.test.ts` (2 hunks) | Local preferences, platform filtering and explicit Mono sidebar toggle. | Layout-dependent settings and new Mono defaults. | Keep local tests; apply both platform and layout filters and update only the explicitly approved upstream default/sidebar semantics. | Approved 2026-10-18 |
| `src/features/settings/ui/SettingsView.tsx` (13 hunks) | Local helper/provider/MCP/experimentation and wallpaper/menu/font settings. | Layout/glass controls, smooth reveal and idle-agent limit. | Keep both settings sets and their search entries; retain useful local controls in both layouts rather than silently hiding fork settings. | Approved 2026-10-18 |
| `src/features/source-control/ui/GitChangesPanel.tsx` (1 hunks) | Outside-click cleanup for commit/model menu. | Abort generated commit text on checkout change/unmount. | Keep both cleanup effects and local helper-model selection. | Approved 2026-10-18 |
| `src/features/source-control/ui/WorkingTreeDiff.tsx` (2 hunks) | Separator-safe full-row focus path matching. | Stable diff caches and hidden-tab lifecycle. | Retain focus-path matching and incoming visibility/caching without stale selection when focusPath changes. | Approved 2026-10-18 |
| `src/features/terminal/ui/TerminalView.test.ts` (2 hunks) | Lazy terminal startup and explicit lifecycle reset. | HTTP(S)/OSC terminal-link regressions. | Keep lazy-start/cleanup and add hyperlink test fixtures; account for both addons without weakening assertions. | Approved 2026-10-18 |
| `src/features/terminal/ui/TerminalView.tsx` (1 hunks) | GPU renderer toggle, typography updates and lazy-start lifecycle. | Clickable links via opener and xterm addon. | Keep local effects/lifecycle and add links; hidden terminals still release GPU contexts and do not start processes. | Approved 2026-10-18 |
| `src/integrations/harness/core/apply.ts` (1 hunks) | Live usage cleanup and local confirmed/external turn duration accounting. | Stamp duration on stop from the actual turn start. | Keep local event reconciliation and usage cleanup; adopt stop timing without generating duplicate user turns or resetting joined-turn clocks. | Approved 2026-10-18 |
| `src/integrations/harness/core/child.test.ts` (1 hunks) | Explicit provider identity passed for helper isolation. | Updated bridge/spawn expectations. | Retain provider identity and local isolation coverage; update compatible batched-bridge fixtures. | Approved 2026-10-18 |
| `src/integrations/harness/core/registry.test.ts` (1 hunks) | Rechecked native ownership and Remote Control idle exemption tests. | Idle-limit/LRU policy tests. | Keep both and add overlap cases proving limits cannot stop protected Interactive/Remote Control owners. | Approved 2026-10-18 |
| `src/integrations/harness/core/registry.ts` (2 hunks) | canIdlePark checks and desired Remote Control exclusions. | Three-minute generic park and configurable warm-owner limit. | Accept generic upstream timer/limit policy, recheck local exemptions at schedule and stop time and in LRU eviction. Interactive retains its own conservative 5–60 minute setting. | Approved 2026-10-18 |
| `src/integrations/harness/providers/claude/claude.ts` (2 hunks) | Fork identity, diagnostic measurements and Remote Control consent handling. | Ignore replayed background-task results on resume. | Add replay guard in the correct order while retaining local fork/provider identity and scoped measurement events. | Approved 2026-10-18 |
| `src/integrations/harness/providers/claude/claudeProtocol.test.ts` (1 hunks) | Newest-model default alias regression. | Concrete alias-target metadata regression. | Retain both test cases; newest discovery and saved-version settings must both work. | Approved 2026-10-18 |
| `src/integrations/harness/providers/codex/codexProtocol.ts` (2 hunks) | Scoped diagnostic usage evidence and provider context numbers. | Whole-turn token totals across multiple requests. | Use incoming turn accumulation for metrics while keeping context based on actual provider context readings and raw diagnostic evidence separate. | Approved 2026-10-18 |
| `src/platform/tauri/fs.ts` (1 hunks) | Canonical contained-project image wrappers. | Relative document-image wrapper with remote support. | Keep both callers with their distinct path contracts and add incoming remote-safe wrapper. | Approved 2026-10-18 |
| `src/shared/ui/Popover.tsx` (1 hunks) | Relative stable frame for glass wash and shared hover. | Context for stacking popovers above dialogs. | Keep stable relative frame, transparent moving layer and local dialog semantics; add incoming dialog context without duplicate Escape handling. | Approved 2026-10-18 |
| `src/styles/index.css` (1 hunks) | Local font, scrollbar, hover/wallpaper/acrylic rules. | New-layout styles and scrollbar/reveal performance rules. | Retain local font/effect settings and add scoped upstream layout rules; update stale comment to describe final platform behavior, audit unconflicted CSS overlaps too. | Approved 2026-10-18 |

### Cleanly merged path review

There are 111 same-path overlaps in total; automatic text merging does not validate
wiring. In particular review `pty.rs` output batching against ConPTY flush/handshake,
`main.rs` single-instance handling against hidden helper/quick-composer launches,
control/task schema and CLI compatibility, notifications, account transfer backend,
model/context structures, and local native/history tests. Upstream's `resources.rs`
uses macOS process identities and `/bin/ps`; its process actions cannot be treated
as Windows-compatible just because its module merged cleanly. The native sampler
and PID-reuse protections remain authoritative for local Windows process controls.

## Local feature preservation audit

All 104 IDs remain registered, including the intentional removal of L-90 by L-94.
All 373 fork-added source/test paths are still present. The 111 overlapping paths
were inspected for lost local additions as well as textual conflicts; replacements
were checked against both sides. The rows describe source preservation, not proof
of native Windows/provider behavior. Automated gates and human-only checks are
recorded separately below. Existing feature-specific tests remain in the full suite;
no native quota/cache-consumption claim is inferred from a source merge.

| ID | Baseline behavior | Status for this integration |
|---|---|---|
| L-01 | Stop stays visible while busy; send becomes Queue/Steer | Source retained; automated gate below; native/desktop checks separate |
| L-02 | Menu bar visible by default; Alt+O toggles it | Source retained; automated gate below; native/desktop checks separate |
| L-03 | Antigravity via Google's shared ACP runtime | Source retained; automated gate below; native/desktop checks separate |
| L-04 | Cline provider | Source retained; automated gate below; native/desktop checks separate |
| L-05 | Queued messages survive restart | Source retained; automated gate below; native/desktop checks separate |
| L-06 | Held/paused/steering queue never auto-sends | Source retained; automated gate below; native/desktop checks separate |
| L-07 | Removing a chat drops its queue and terminals | Source retained; automated gate below; native/desktop checks separate |
| L-08 | Terminals start lazily | Source retained; automated gate below; native/desktop checks separate |
| L-09 | Wallpaper with effects; Wallpaper & menus settings | Source retained; automated gate below; native/desktop checks separate |
| L-10 | Sliding hover highlight in menus and lists | Source retained; automated gate below; native/desktop checks separate |
| L-11 | One shared token/cost calculation | Source retained; automated gate below; native/desktop checks separate |
| L-12 | Usage footer can show % left | Source retained; automated gate below; native/desktop checks separate |
| L-13 | No console flash; child processes tied to the app (Windows) | Source retained; automated gate below; native/desktop checks separate |
| L-14 | ConPTY terminal with timed output flushing and stalled-output replay (Windows) | Source retained; automated gate below; native/desktop checks separate |
| L-15 | Reveal in Explorer without false error or console | Source retained; automated gate below; native/desktop checks separate |
| L-16 | Import and resume provider CLI conversations | Source retained; automated gate below; native/desktop checks separate |
| L-17 | Settings → Skills page | Source retained; automated gate below; native/desktop checks separate |
| L-18 | Honest provider errors and CLI update notice | Source retained; automated gate below; native/desktop checks separate |
| L-19 | Model choice for commit and PR text | Source retained; automated gate below; native/desktop checks separate |
| L-20 | Clear approvals: Allow once and Always for chat | Source retained; automated gate below; native/desktop checks separate |
| L-21 | Session grants never auto-answer in Plan mode or after stop | Source retained; automated gate below; native/desktop checks separate |
| L-22 | Live model/permission switch for running Claude chats | Source retained; automated gate below; native/desktop checks separate |
| L-23 | Typed forms for Codex MCP input | Source retained; automated gate below; native/desktop checks separate |
| L-24 | Context meter uses provider numbers | Source retained; automated gate below; native/desktop checks separate |
| L-25 | Branch uses provider's native fork | Source retained; automated gate below; native/desktop checks separate |
| L-26 | Sidechat | Source retained; automated gate below; native/desktop checks separate |
| L-27 | CRLF kept in editor and partial staging | Source retained; automated gate below; native/desktop checks separate |
| L-28 | Human-typed messages marked for Claude | Source retained; automated gate below; native/desktop checks separate |
| L-29 | Busy-chat keyboard: Enter / Ctrl+Enter / Shift+Enter | Source retained; automated gate below; native/desktop checks separate |
| L-30 | Settings → Experimentation page | Source retained; automated gate below; native/desktop checks separate |
| L-31 | Source Control full-row diff, deleted files open | Source retained; automated gate below; native/desktop checks separate |
| L-32 | Providers page shows Checking providers… | Source retained; automated gate below; native/desktop checks separate |
| L-33 | Model lists keep the newest model | Source retained; automated gate below; native/desktop checks separate |
| L-34 | Repair legacy e%3A project paths | Source retained; automated gate below; native/desktop checks separate |
| L-35 | Tab strip edge fade | Source retained; automated gate below; native/desktop checks separate |
| L-36 | Compact rail uses the sliding highlight | Source retained; automated gate below; native/desktop checks separate |
| L-37 | Acrylic window glass strength and font choices | Source retained; automated gate below; native/desktop checks separate |
| L-38 | .cmd/.bat provider launchers found and started | Source retained; automated gate below; native/desktop checks separate |
| L-39 | NSIS installer build and local versioning | Source retained; automated gate below; native/desktop checks separate |
| L-40 | Antigravity temp files under ~/.monocode; Downloads lookup | Source retained; automated gate below; native/desktop checks separate |
| L-41 | Task Manager (tasks, filters, Operator tasks.*, Copy Markdown) | Source retained; automated gate below; native/desktop checks separate |
| L-42 | Task Manager views: List/Table/Board, peek pane, task tabs | Source retained; automated gate below; native/desktop checks separate |
| L-43 | Session Manager: 4 columns, tags, 2×2, sidebar counts | Source retained; automated gate below; native/desktop checks separate |
| L-44 | Session Manager drafts and Operator session_manager.* | Source retained; automated gate below; native/desktop checks separate |
| L-45 | File/session tab-opening preferences | Source retained; automated gate below; native/desktop checks separate |
| L-46 | Quick Composer on Windows, global shortcut, glass | Source retained; automated gate below; native/desktop checks separate |
| L-47 | Markdown table icon actions | Source retained; automated gate below; native/desktop checks separate |
| L-48 | Wallpaper Haze effect | Source retained; automated gate below; native/desktop checks separate |
| L-49 | Compact model labels experiment | Source retained; automated gate below; native/desktop checks separate |
| L-50 | Queue holds independent of quota notice | Source retained; automated gate below; native/desktop checks separate |
| L-51 | Reply header/footer layout | Source retained; automated gate below; native/desktop checks separate |
| L-52 | Gliding hover in Notes, Automations, managers, project Sessions | Source retained; automated gate below; native/desktop checks separate |
| L-53 | Performance overlay and log recording | Source retained; automated gate below; native/desktop checks separate |
| L-54 | Speed pill beside Effort | Source retained; automated gate below; native/desktop checks separate |
| L-55 | Model picker full-row hover and selected fill | Source retained; automated gate below; native/desktop checks separate |
| L-56 | Task Manager Focus, Archive, task menu, board drag | Source retained; automated gate below; native/desktop checks separate |
| L-57 | One composer: Task/Session switch, Save to Draft + Start, Work on… | Source retained; automated gate below; native/desktop checks separate |
| L-58 | Drafts group in the project Sessions list | Source retained; automated gate below; native/desktop checks separate |
| L-59 | MCP Enable/Disable switches for coding providers | Source retained; automated gate below; native/desktop checks separate |
| L-60 | Saved prompts: Settings → Prompts, `!` picker in every composer, Add to Prompts (also offered upstream on branch `feature/saved-prompts`) | Source retained; automated gate below; native/desktop checks separate |
| L-61 | Read-only local Claude/Codex discovery, strict native resume and MonoCode-only archive backend | Source retained; automated gate below; native/desktop checks separate |
| L-62 | Local Claude Remote Control lifecycle, remembered choices, isolated phone transcript routing and hidden-chat retention | Source retained; automated gate below; native/desktop checks separate |
| L-63 | Provider cloud launch, retained IDs and supported CLI actions (backend) | Source retained; automated gate below; native/desktop checks separate |
| L-64 | Provider conversations UI: refresh-safe ten-row paging, one refresh control, per-chat RC status, native resume/archive/history, Local \| Cloud launch and retained cloud tasks | Source retained; automated gate below; native/desktop checks separate |
| L-65 | Advanced custom cron schedules with field editor, examples, validation, plain-language meaning and local next-run preview | Source retained; automated gate below; native/desktop checks separate |
| L-66 | Automation Operator switch, persistent saved-chat chip with Off/re-enable controls and single-send prompt preparation | Source retained; automated gate below; native/desktop checks separate |
| L-67 | Remote Control PC icon, Cloud session in the + menu, Session Manager run icons and one-close pane; "Work in" chip turns Remote Control on for existing Claude chats | Source retained; automated gate below; native/desktop checks separate |
| L-68 | Global Local / Remote / Cloud new-chat default, visible composer choice and preserved per-chat overrides | Source retained; automated gate below; native/desktop checks separate |
| L-69 | Separate Antigravity CLI alongside ACP: streaming, resume, quotas/credits, MCP switches and custom agents | Source retained; automated gate below; native/desktop checks separate |
| L-70 | Task Manager week strip inline beside Focus in the toolbar centre (3·Focus·3 + All, gliding hover/selected pill, sliding weeks, keyboard), Focus = Today with jump-to-today, focus-day history recorded when a day passes in focus, "Focus on" submenu (Today/Tomorrow/+2/+3, Remove), Since/Done card chips, Timeline in task details, day view with Completed/In focus groups and archived included; Review is shown as "Verify" and focus history records a day only for worked statuses; board columns use the Settings card surface (no blur). Partly reverses `a07c7af`: the Menu backdrop-blur slider no longer affects board columns | Source retained; automated gate below; native/desktop checks separate |
| L-71 | Native Resume session (Settings → Migration, auto-loading; was "Import session"; compaction summary hidden) for Claude Code and Codex; full Claude saved titles and dialog-layer menus; cloud access retained | Source retained; automated gate below; native/desktop checks separate |
| L-72 | Monos keep the user's to-dos in Tasks: instructions plus a `project` alias on `tasks.list` / `tasks.write` | Source retained; automated gate below; native/desktop checks separate |
| L-73 | Light provider check 2 s after launch (opt-out) with title-bar indicator, shared with Settings → Providers, plus Refresh all | Source retained; automated gate below; native/desktop checks separate |
| L-74 | Busy project conversation cards can be dismissed from the current run's display without stopping, archiving or deleting the chat | Source retained; automated gate below; native/desktop checks separate |
| L-75 | New task picker is the searchable project list (same as All projects); TaskPeekPane offers New task; Ctrl/Cmd+Shift+Enter saves before creating/focusing a same-project task | Source retained; automated gate below; native/desktop checks separate |
| L-76 | Sidechats persist as separate Chats with their own provider identity and bounded source recovery while keeping project cwd and per-send context | Source retained; automated gate below; native/desktop checks separate |
| L-77 | Claude Remote Control displays activity on its actual external turn and known model/effort; imported native Claude history seeds only known composer metadata | Source retained; automated gate below; native/desktop checks separate |
| L-78 | Wrap tool output and code fences while preserving exact Copy/line behavior; show validated local-project Markdown images with existing preview/lightbox and safe fallback | Source retained; automated gate below; native/desktop checks separate |
| L-79 | Second-opinion chats use the title `Second opinion — <source chat title>` | Source retained; automated gate below; native/desktop checks separate |
| L-80 | Settings → Debug Inspector: read-only cross-provider metadata trace, scoped token/cache evidence, bounded Claude/Codex local reads and account quota comparison | Source retained; automated gate below; native/desktop checks separate |
| L-81 | Native Claude/Codex history status sits beside Show earlier above the transcript, without a moving notice after replies | Source retained; automated gate below; native/desktop checks separate |
| L-82 | Claude Code Interactive in the existing model picker: native PTY, transcript chat, native resume, matching-ID folded-paste acceptance, full-turn timing, process-local suggestion suppression and retained recovery diagnostics | Source retained; automated gate below; native/desktop checks separate |
| L-83 | Separate local dev profile: `npm run tauri:dev-profile` uses MonoCode Dev app data and webview storage | Source retained; automated gate below; native/desktop checks separate |
| L-84 | Opt-in bottom-bar CPU/memory monitor for MonoCode itself and its owned process trees, grouped by project, with Stop controls and expandable per-process lists | Source retained; automated gate below; native/desktop checks separate |
| L-85 | Experimentation toggle "All accounts usage": configured-account chips with "+N" overflow, plus the installed Antigravity CLI saved-account chip across chats | Source retained; automated gate below; native/desktop checks separate |
| L-86 | Automations list is resizable by dragging its edge (like Notes); double-click resets | Source retained; automated gate below; native/desktop checks separate |
| L-87 | Chat code blocks have a wrap-lines toggle (on by default) | Source retained; automated gate below; native/desktop checks separate |
| L-88 | Forks, sidechats and second opinions nest under their source chat in the sidebar; empty sidechats are kept | Source retained; automated gate below; native/desktop checks separate |
| L-89 | Paste, drop or Insert image in Notes and Task markdown; task delete removes its images | Source retained; automated gate below; native/desktop checks separate |
| L-90 | Removed by L-94 (was the Task editor "Add more" toggle) | Removed by L-94; remains removed |
| L-91 | Title-bar notification bell and panel (chat replies, approvals, questions, automation runs) | Source retained; automated gate below; native/desktop checks separate |
| L-92 | Foreground account usage refresh every 15 minutes, with five-minute stale-on-focus refresh and staggered shared-cache reads | Source retained; automated gate below; native/desktop checks separate |
| L-93 | Bottom bar (usage, CPU, terminals) stays visible in Task Manager and Session Manager | Source retained; automated gate below; native/desktop checks separate |
| L-94 | Task editor header on one row: no "Task" label, no Add more, no duplicate New task button | Source retained; automated gate below; native/desktop checks separate |
| L-95 | The bottom-bar usage chip of the open chat's account is highlighted | Source retained; automated gate below; native/desktop checks separate |
| L-96 | Model picker offers an Account choice when the chat's provider has more than one account | Source retained; automated gate below; native/desktop checks separate |
| L-97 | Antigravity CLI usage chip shows each model family's 5-hour quota inline when no family is selected | Source retained; automated gate below; native/desktop checks separate |
| L-98 | Each usage card in the bottom bar has its own Refresh button, so one account can be re-read without refreshing every account | Source retained; automated gate below; native/desktop checks separate |
| L-99 | Experimentation toggle draws visible terminals on the GPU (WebGL) instead of the CPU | Source retained; automated gate below; native/desktop checks separate |
| L-100 | Interactive Claude follow-ups sent mid-turn always queue instead of steering and failing the turn | Source retained; automated gate below; native/desktop checks separate |
| L-101 | Process monitor shows CPU, RAM and GPU columns; Stop is a hover/focus-only icon | Source retained; automated gate below; native/desktop checks separate |
| L-102 | Continue a Claude chat on another account with its full history (copies the native transcript) | Source retained; automated gate below; native/desktop checks separate |
| L-103 | Process monitor totals count readable processes instead of blanking when one helper cannot be read | Source retained; automated gate below; native/desktop checks separate |
| L-104 | Interactive Claude explains a native dialog (such as a new account's folder trust question) anywhere on screen | Source retained; automated gate below; native/desktop checks separate |

## Same-path overlap forecast

These are paths changed on both sides, not necessarily actual conflicts.

- `Cargo.lock`
- `Cargo.toml`
- `package-lock.json`
- `package.json`
- `src-tauri/Cargo.toml`
- `src-tauri/src/checkpoint.rs`
- `src-tauri/src/control.rs`
- `src-tauri/src/control_cli.rs`
- `src-tauri/src/fs.rs`
- `src-tauri/src/harness.rs`
- `src-tauri/src/lib.rs`
- `src-tauri/src/main.rs`
- `src-tauri/src/pty.rs`
- `src-tauri/src/session_store.rs`
- `src-tauri/src/skills.rs`
- `src-tauri/tauri.conf.json`
- `src/app/App.tsx`
- `src/app/model/quickLaunchSession.test.ts`
- `src/app/model/quickLaunchSession.ts`
- `src/app/shell/MonoRailSection.tsx`
- `src/app/shell/ProjectRail.tsx`
- `src/app/shell/Sidebar.tsx`
- `src/app/shell/SidebarRename.test.ts`
- `src/app/shell/TitleBar.test.ts`
- `src/app/shell/TitleBar.tsx`
- `src/app/shell/UsageFooter.tsx`
- `src/app/shell/UsageProviderChip.tsx`
- `src/features/agent-app/model/agentApp.ts`
- `src/features/automations/ui/AutomationsView.test.ts`
- `src/features/automations/ui/AutomationsView.tsx`
- `src/features/files/editor/editorDoc.ts`
- `src/features/files/editor/editorGit.test.ts`
- `src/features/files/editor/editorGit.ts`
- `src/features/files/ui/FileEditor.tsx`
- `src/features/files/ui/FilePane.tsx`
- `src/features/files/ui/FilePaneNavigation.test.ts`
- `src/features/files/ui/FileTree.tsx`
- `src/features/inbox/ui/InboxView.tsx`
- `src/features/monos/model/monoFiles.ts`
- `src/features/monos/model/monoMessaging.ts`
- `src/features/notes/ui/NotesView.test.ts`
- `src/features/notes/ui/NotesView.tsx`
- `src/features/notifications/model/notifications.ts`
- `src/features/projects/ui/SearchableProjectPicker.tsx`
- `src/features/quick-composer/main.tsx`
- `src/features/search/ui/SearchView.tsx`
- `src/features/sessions/data/sessionHistory.test.ts`
- `src/features/sessions/data/sessionHistory.ts`
- `src/features/sessions/data/sessionStore.ts`
- `src/features/sessions/hooks/useTranscriptSelection.ts`
- `src/features/sessions/model/models.test.ts`
- `src/features/sessions/model/models.ts`
- `src/features/sessions/model/session.ts`
- `src/features/sessions/model/transcriptActivity.test.ts`
- `src/features/sessions/model/transcriptActivity.ts`
- `src/features/sessions/ui/AgentMarkdown.test.ts`
- `src/features/sessions/ui/AgentMarkdown.tsx`
- `src/features/sessions/ui/AgentTranscript.inlineWork.test.ts`
- `src/features/sessions/ui/AgentTranscript.test.ts`
- `src/features/sessions/ui/AgentTranscript.tsx`
- `src/features/sessions/ui/Composer.tsx`
- `src/features/sessions/ui/ContextMeter.tsx`
- `src/features/sessions/ui/EmptySession.tsx`
- `src/features/sessions/ui/HighlightedCodeBlock.tsx`
- `src/features/sessions/ui/MarkdownModeToggle.tsx`
- `src/features/sessions/ui/MessageQueue.tsx`
- `src/features/sessions/ui/ModelPicker.test.ts`
- `src/features/sessions/ui/ModelPicker.tsx`
- `src/features/sessions/ui/SessionPane.tsx`
- `src/features/sessions/ui/SessionReview.tsx`
- `src/features/settings/model/appearance.test.ts`
- `src/features/settings/model/appearance.ts`
- `src/features/settings/model/displayPrefs.ts`
- `src/features/settings/model/settings.test.ts`
- `src/features/settings/model/settings.ts`
- `src/features/settings/ui/SettingsView.test.ts`
- `src/features/settings/ui/SettingsView.tsx`
- `src/features/source-control/ui/GitChangesPanel.test.ts`
- `src/features/source-control/ui/GitChangesPanel.tsx`
- `src/features/source-control/ui/SourceControl.tsx`
- `src/features/source-control/ui/SwitchBranchDialog.tsx`
- `src/features/source-control/ui/WorkingTreeDiff.tsx`
- `src/features/terminal/ui/TerminalView.test.ts`
- `src/features/terminal/ui/TerminalView.tsx`
- `src/features/workspace/ui/PaneTree.tsx`
- `src/features/workspace/ui/PaneTreeEnter.test.ts`
- `src/integrations/harness/core/apply.test.ts`
- `src/integrations/harness/core/apply.ts`
- `src/integrations/harness/core/child.test.ts`
- `src/integrations/harness/core/child.ts`
- `src/integrations/harness/core/registry.test.ts`
- `src/integrations/harness/core/registry.ts`
- `src/integrations/harness/index.ts`
- `src/integrations/harness/providers/claude/claude.ts`
- `src/integrations/harness/providers/claude/claudeCatalog.ts`
- `src/integrations/harness/providers/claude/claudeLive.test.ts`
- `src/integrations/harness/providers/claude/claudeProtocol.test.ts`
- `src/integrations/harness/providers/claude/claudeProtocol.ts`
- `src/integrations/harness/providers/codex/codex.ts`
- `src/integrations/harness/providers/codex/codexLive.test.ts`
- `src/integrations/harness/providers/codex/codexProtocol.test.ts`
- `src/integrations/harness/providers/codex/codexProtocol.ts`
- `src/integrations/harness/providers/opencode/opencodeProtocol.ts`
- `src/main.tsx`
- `src/platform/tauri/fs.test.ts`
- `src/platform/tauri/fs.ts`
- `src/shared/lib/paths.ts`
- `src/shared/ui/Modal.tsx`
- `src/shared/ui/Popover.tsx`
- `src/shared/ui/icons.tsx`
- `src/styles/index.css`

## Full incoming path inventory

Status is relative to the common ancestor, not a resolution decision.

| Change | Path |
|---|---|
| M | `.github/workflows/ci.yml` |
| M | `CHANGELOG.md` |
| M | `CONTRIBUTING.md` |
| M | `Cargo.lock` |
| M | `Cargo.toml` |
| M | `README.md` |
| A | `docs/agent-access.md` |
| A | `docs/building.md` |
| A | `docs/install.md` |
| A | `docs/providers.md` |
| M | `docs/remote-access.md` |
| M | `host/service.test.ts` |
| M | `host/service.ts` |
| M | `package-lock.json` |
| M | `package.json` |
| M | `src-tauri/Cargo.toml` |
| M | `src-tauri/src/artifacts.rs` |
| A | `src-tauri/src/background_work.rs` |
| M | `src-tauri/src/checkpoint.rs` |
| M | `src-tauri/src/checkpoint/turn.rs` |
| M | `src-tauri/src/checkpoint/turn/tests.rs` |
| M | `src-tauri/src/codex_mono_store.rs` |
| M | `src-tauri/src/control.rs` |
| M | `src-tauri/src/control_cli.rs` |
| M | `src-tauri/src/fs.rs` |
| M | `src-tauri/src/harness.rs` |
| M | `src-tauri/src/lib.rs` |
| M | `src-tauri/src/macos.rs` |
| M | `src-tauri/src/main.rs` |
| M | `src-tauri/src/mono_chat.rs` |
| M | `src-tauri/src/pasteboard.rs` |
| A | `src-tauri/src/provider_session_transfer.rs` |
| M | `src-tauri/src/pty.rs` |
| A | `src-tauri/src/resources.rs` |
| M | `src-tauri/src/session_store.rs` |
| M | `src-tauri/src/skills.rs` |
| A | `src-tauri/src/tool_detail.rs` |
| M | `src-tauri/src/worktrees.rs` |
| M | `src-tauri/tauri.conf.json` |
| M | `src/app/App.tsx` |
| M | `src/app/hooks/useMonoHabits.test.ts` |
| M | `src/app/hooks/useMonoHabits.ts` |
| M | `src/app/model/harnessFlush.test.ts` |
| M | `src/app/model/harnessFlush.ts` |
| A | `src/app/model/navigationPerformance.ts` |
| A | `src/app/model/newWorkspaceSession.test.ts` |
| A | `src/app/model/newWorkspaceSession.ts` |
| M | `src/app/model/quickLaunchSession.test.ts` |
| M | `src/app/model/quickLaunchSession.ts` |
| A | `src/app/model/sessionState.test.ts` |
| A | `src/app/model/sessionState.ts` |
| M | `src/app/shell/MonoRailSection.test.ts` |
| M | `src/app/shell/MonoRailSection.tsx` |
| A | `src/app/shell/NewLayoutNotice.tsx` |
| M | `src/app/shell/PiUsage.tsx` |
| M | `src/app/shell/ProjectRail.tsx` |
| A | `src/app/shell/ProjectSpaces.tsx` |
| A | `src/app/shell/RailTooltip.tsx` |
| M | `src/app/shell/Sidebar.tsx` |
| M | `src/app/shell/SidebarRename.test.ts` |
| M | `src/app/shell/TitleBar.test.ts` |
| M | `src/app/shell/TitleBar.tsx` |
| M | `src/app/shell/TitleBarMenu.test.ts` |
| M | `src/app/shell/TitleBarPaneDrop.test.ts` |
| M | `src/app/shell/UsageFooter.test.ts` |
| M | `src/app/shell/UsageFooter.tsx` |
| A | `src/app/shell/UsageFooterProjectAccount.test.ts` |
| M | `src/app/shell/UsageProviderChip.tsx` |
| A | `src/app/shell/startedSessions.test.ts` |
| M | `src/app/shell/useProjectMenu.tsx` |
| A | `src/debugMonoScroll.ts` |
| M | `src/features/agent-app/model/agentApp.test.ts` |
| M | `src/features/agent-app/model/agentApp.ts` |
| M | `src/features/artifacts/artifacts.ts` |
| M | `src/features/artifacts/ui/ArtifactCard.tsx` |
| M | `src/features/artifacts/ui/ArtifactContent.tsx` |
| M | `src/features/artifacts/ui/ArtifactPanel.test.ts` |
| M | `src/features/artifacts/ui/ArtifactPanel.tsx` |
| A | `src/features/artifacts/ui/HtmlArtifactFrame.tsx` |
| M | `src/features/automations/ui/AutomationsView.test.ts` |
| M | `src/features/automations/ui/AutomationsView.tsx` |
| M | `src/features/connections/model/remoteProjects.test.ts` |
| M | `src/features/connections/model/remoteProjects.ts` |
| M | `src/features/connections/ui/AddRemoteProjectDialog.tsx` |
| M | `src/features/connections/ui/ConnectionsSettings.test.ts` |
| M | `src/features/connections/ui/ConnectionsSettings.tsx` |
| A | `src/features/files/editor/codeHighlight.worker.ts` |
| A | `src/features/files/editor/codeHighlightEngine.ts` |
| M | `src/features/files/editor/codeHighlightPlugin.test.ts` |
| M | `src/features/files/editor/codeHighlightPlugin.ts` |
| A | `src/features/files/editor/codeHighlightWorker.test.ts` |
| M | `src/features/files/editor/editorChrome.ts` |
| M | `src/features/files/editor/editorDoc.ts` |
| M | `src/features/files/editor/editorGit.gutter.test.ts` |
| M | `src/features/files/editor/editorGit.test.ts` |
| M | `src/features/files/editor/editorGit.ts` |
| M | `src/features/files/editor/editorLanguage.test.ts` |
| M | `src/features/files/editor/editorLanguage.ts` |
| A | `src/features/files/editor/editorMetrics.ts` |
| M | `src/features/files/editor/syntaxTokens.test.ts` |
| M | `src/features/files/editor/syntaxTokens.ts` |
| M | `src/features/files/model/fileIndex.test.ts` |
| M | `src/features/files/model/fileIndex.ts` |
| M | `src/features/files/model/fileMentions.test.ts` |
| M | `src/features/files/model/fileMentions.ts` |
| M | `src/features/files/model/filePreview.test.ts` |
| M | `src/features/files/model/filePreview.ts` |
| A | `src/features/files/model/fileViewMode.ts` |
| M | `src/features/files/ui/BinaryFileView.test.ts` |
| M | `src/features/files/ui/BinaryFileView.tsx` |
| M | `src/features/files/ui/FileEditor.tsx` |
| M | `src/features/files/ui/FilePane.agent.test.ts` |
| A | `src/features/files/ui/FilePane.reviews.test.ts` |
| M | `src/features/files/ui/FilePane.tsx` |
| M | `src/features/files/ui/FilePaneNavigation.test.ts` |
| M | `src/features/files/ui/FileTree.tsx` |
| A | `src/features/files/ui/FileViewMode.test.ts` |
| M | `src/features/inbox/hooks/useInboxUnseen.test.ts` |
| M | `src/features/inbox/hooks/useInboxUnseen.ts` |
| M | `src/features/inbox/ui/InboxView.tsx` |
| M | `src/features/monos/floatingMain.tsx` |
| M | `src/features/monos/model/mono.ts` |
| M | `src/features/monos/model/monoFiles.ts` |
| M | `src/features/monos/model/monoHabits.ts` |
| M | `src/features/monos/model/monoMessaging.ts` |
| A | `src/features/monos/model/monoReaction.test.ts` |
| A | `src/features/monos/model/monoReaction.ts` |
| M | `src/features/monos/model/monoSpawnedSessions.test.ts` |
| M | `src/features/monos/model/monoSpawnedSessions.ts` |
| M | `src/features/monos/model/monoUsageLimit.test.ts` |
| M | `src/features/monos/model/monoUsageLimit.ts` |
| M | `src/features/monos/ui/FloatingMonoChat.test.ts` |
| M | `src/features/monos/ui/FloatingMonoChat.tsx` |
| A | `src/features/monos/ui/HabitsList.test.ts` |
| A | `src/features/monos/ui/LaunchedSessionCard.tsx` |
| D | `src/features/monos/ui/MonoActivityPanel.tsx` |
| R085 | `src/features/monos/ui/MonoActivityPanel.test.ts` → `src/features/monos/ui/MonoActivityView.test.ts` |
| A | `src/features/monos/ui/MonoActivityView.tsx` |
| D | `src/features/monos/ui/MonoChangesPanel.tsx` |
| R050 | `src/features/monos/ui/MonoChangesPanel.test.ts` → `src/features/monos/ui/MonoChangesView.test.ts` |
| A | `src/features/monos/ui/MonoChangesView.tsx` |
| M | `src/features/monos/ui/MonoComposer.test.ts` |
| M | `src/features/monos/ui/MonoComposer.tsx` |
| D | `src/features/monos/ui/MonoDetails.test.ts` |
| D | `src/features/monos/ui/MonoDetails.tsx` |
| M | `src/features/monos/ui/MonoFilePages.tsx` |
| M | `src/features/monos/ui/MonoHabits.tsx` |
| M | `src/features/monos/ui/MonoHeader.tsx` |
| M | `src/features/monos/ui/MonoIntro.test.ts` |
| M | `src/features/monos/ui/MonoIntro.tsx` |
| A | `src/features/monos/ui/MonoMemoryPage.test.ts` |
| A | `src/features/monos/ui/MonoOverview.test.ts` |
| A | `src/features/monos/ui/MonoOverview.tsx` |
| D | `src/features/monos/ui/MonoPreferencesPage.tsx` |
| M | `src/features/monos/ui/MonoProjectCommit.tsx` |
| M | `src/features/monos/ui/MonoProjects.tsx` |
| A | `src/features/monos/ui/MonoSessionList.test.ts` |
| A | `src/features/monos/ui/MonoSessionList.tsx` |
| D | `src/features/monos/ui/MonoSessionsPanel.test.ts` |
| D | `src/features/monos/ui/MonoSessionsPanel.tsx` |
| A | `src/features/monos/ui/MonoSettingsDialog.test.ts` |
| A | `src/features/monos/ui/MonoSettingsDialog.tsx` |
| D | `src/features/monos/ui/MonoSettingsPage.test.ts` |
| D | `src/features/monos/ui/MonoSettingsPage.tsx` |
| M | `src/features/monos/ui/MonoSidebar.tsx` |
| M | `src/features/monos/ui/MonoUsageLimitNotice.tsx` |
| M | `src/features/monos/ui/PanelStack.tsx` |
| M | `src/features/monos/ui/monoPanelParts.tsx` |
| M | `src/features/notes/ui/NotesView.test.ts` |
| M | `src/features/notes/ui/NotesView.tsx` |
| M | `src/features/notifications/hooks/useInputNotifications.test.ts` |
| M | `src/features/notifications/hooks/useInputNotifications.ts` |
| M | `src/features/notifications/model/notificationDelivery.test.ts` |
| M | `src/features/notifications/model/notifications.ts` |
| A | `src/features/notifications/model/resourcePressure.test.ts` |
| A | `src/features/notifications/model/resourcePressure.ts` |
| A | `src/features/notifications/ui/ResourcePressureNotice.test.ts` |
| A | `src/features/notifications/ui/ResourcePressureNotice.tsx` |
| M | `src/features/orchestration/ui/OrchestrationSidebarAgents.tsx` |
| A | `src/features/projects/hooks/useProjectAppearance.ts` |
| M | `src/features/projects/model/projectGroups.test.ts` |
| M | `src/features/projects/model/projectGroups.ts` |
| A | `src/features/projects/model/projectScope.test.ts` |
| A | `src/features/projects/model/projectScope.ts` |
| A | `src/features/projects/ui/CurrentProjectIcon.tsx` |
| M | `src/features/projects/ui/ProjectBackgroundDialog.tsx` |
| M | `src/features/projects/ui/ProjectGroups.test.ts` |
| M | `src/features/projects/ui/RemoveProjectDialog.tsx` |
| M | `src/features/projects/ui/SearchableProjectPicker.tsx` |
| M | `src/features/quick-composer/hooks/useQuickComposerLaunches.ts` |
| M | `src/features/quick-composer/main.tsx` |
| M | `src/features/search/ui/SearchView.tsx` |
| M | `src/features/sessions/data/monoSessionStore.test.ts` |
| M | `src/features/sessions/data/sessionCache.ts` |
| M | `src/features/sessions/data/sessionHistory.test.ts` |
| M | `src/features/sessions/data/sessionHistory.ts` |
| M | `src/features/sessions/data/sessionStore.ts` |
| M | `src/features/sessions/data/sessionStoreRestore.test.ts` |
| M | `src/features/sessions/hooks/useBottomChatMotion.test.ts` |
| M | `src/features/sessions/hooks/useBottomChatMotion.ts` |
| M | `src/features/sessions/hooks/useTranscriptSelection.ts` |
| A | `src/features/sessions/hooks/useUnseenReplyCounts.ts` |
| M | `src/features/sessions/model/checkpoint.test.ts` |
| M | `src/features/sessions/model/checkpoint.ts` |
| A | `src/features/sessions/model/checkpointEdits.test.ts` |
| A | `src/features/sessions/model/checkpointEdits.ts` |
| M | `src/features/sessions/model/composerResize.ts` |
| M | `src/features/sessions/model/emojiMessage.ts` |
| M | `src/features/sessions/model/models.test.ts` |
| M | `src/features/sessions/model/models.ts` |
| M | `src/features/sessions/model/projectSessionDefaults.test.ts` |
| M | `src/features/sessions/model/session.ts` |
| M | `src/features/sessions/model/sessionDone.test.ts` |
| M | `src/features/sessions/model/sessionDone.ts` |
| M | `src/features/sessions/model/sessionFilters.ts` |
| A | `src/features/sessions/model/sessionReviewCache.ts` |
| A | `src/features/sessions/model/sessionStateStore.test.ts` |
| A | `src/features/sessions/model/sessionStateStore.ts` |
| A | `src/features/sessions/model/streamingPerformance.test.ts` |
| A | `src/features/sessions/model/streamingPerformance.ts` |
| M | `src/features/sessions/model/transcriptActivity.test.ts` |
| M | `src/features/sessions/model/transcriptActivity.ts` |
| M | `src/features/sessions/model/transcriptTurnCache.test.ts` |
| M | `src/features/sessions/model/transcriptTurnCache.ts` |
| M | `src/features/sessions/model/usageLimit.test.ts` |
| M | `src/features/sessions/model/usageLimit.ts` |
| M | `src/features/sessions/ui/AgentMarkdown.test.ts` |
| M | `src/features/sessions/ui/AgentMarkdown.tsx` |
| A | `src/features/sessions/ui/AgentMarkdownPresentation.test.ts` |
| M | `src/features/sessions/ui/AgentTabView.test.ts` |
| M | `src/features/sessions/ui/AgentTabView.tsx` |
| M | `src/features/sessions/ui/AgentTranscript.inlineWork.test.ts` |
| M | `src/features/sessions/ui/AgentTranscript.performance.test.ts` |
| M | `src/features/sessions/ui/AgentTranscript.promptRise.test.ts` |
| M | `src/features/sessions/ui/AgentTranscript.test.ts` |
| M | `src/features/sessions/ui/AgentTranscript.tsx` |
| M | `src/features/sessions/ui/AgentTranscriptPacing.test.ts` |
| M | `src/features/sessions/ui/AgentTranscriptScroll.test.ts` |
| M | `src/features/sessions/ui/Composer.tsx` |
| M | `src/features/sessions/ui/ComposerRunner.test.ts` |
| M | `src/features/sessions/ui/ComposerRunner.tsx` |
| M | `src/features/sessions/ui/ContextMeter.tsx` |
| A | `src/features/sessions/ui/DocumentImage.test.ts` |
| A | `src/features/sessions/ui/DocumentImage.tsx` |
| M | `src/features/sessions/ui/EmptySession.tsx` |
| M | `src/features/sessions/ui/HighlightedCodeBlock.tsx` |
| A | `src/features/sessions/ui/HistoryTurn.tsx` |
| A | `src/features/sessions/ui/LocalMedia.tsx` |
| M | `src/features/sessions/ui/MarkdownDocumentPreview.test.ts` |
| M | `src/features/sessions/ui/MarkdownDocumentPreview.tsx` |
| M | `src/features/sessions/ui/MarkdownModeToggle.tsx` |
| M | `src/features/sessions/ui/MessageQueue.tsx` |
| M | `src/features/sessions/ui/ModelPicker.test.ts` |
| M | `src/features/sessions/ui/ModelPicker.tsx` |
| M | `src/features/sessions/ui/PromptOutline.tsx` |
| A | `src/features/sessions/ui/SessionCardPreview.tsx` |
| M | `src/features/sessions/ui/SessionFiltersMenu.tsx` |
| M | `src/features/sessions/ui/SessionPane.tsx` |
| M | `src/features/sessions/ui/SessionPaneMessaging.test.ts` |
| M | `src/features/sessions/ui/SessionPaneScroll.test.ts` |
| M | `src/features/sessions/ui/SessionReview.test.ts` |
| M | `src/features/sessions/ui/SessionReview.tsx` |
| M | `src/features/sessions/ui/TranscriptPool.test.ts` |
| M | `src/features/sessions/ui/TranscriptPool.tsx` |
| A | `src/features/sessions/ui/UsageLimitAccountPicker.tsx` |
| A | `src/features/sessions/ui/documentImageSources.ts` |
| A | `src/features/sessions/ui/transcriptVisibility.ts` |
| A | `src/features/sessions/ui/useMeasuredHistory.ts` |
| A | `src/features/sessions/ui/useReplyReflowAnchor.test.ts` |
| A | `src/features/sessions/ui/useReplyReflowAnchor.ts` |
| A | `src/features/sessions/ui/useToolDetail.test.ts` |
| A | `src/features/sessions/ui/useToolDetail.ts` |
| M | `src/features/sessions/ui/wordFade.test.ts` |
| M | `src/features/sessions/ui/wordFade.tsx` |
| M | `src/features/settings/model/appearance.test.ts` |
| M | `src/features/settings/model/appearance.ts` |
| M | `src/features/settings/model/displayPrefs.ts` |
| M | `src/features/settings/model/nativeGlass.test.ts` |
| M | `src/features/settings/model/settings.test.ts` |
| M | `src/features/settings/model/settings.ts` |
| M | `src/features/settings/model/sounds.test.ts` |
| M | `src/features/settings/model/sounds.ts` |
| A | `src/features/settings/model/workspaceThemes.test.ts` |
| A | `src/features/settings/model/workspaceThemes.ts` |
| M | `src/features/settings/ui/SettingsView.test.ts` |
| M | `src/features/settings/ui/SettingsView.tsx` |
| A | `src/features/source-control/hooks/useDiffViewport.ts` |
| A | `src/features/source-control/model/diffHighlight.test.ts` |
| A | `src/features/source-control/model/diffHighlight.ts` |
| A | `src/features/source-control/model/diffHighlight.worker.ts` |
| A | `src/features/source-control/model/diffWorker.test.ts` |
| A | `src/features/source-control/model/diffWorker.ts` |
| M | `src/features/source-control/model/gitGraph.test.ts` |
| M | `src/features/source-control/model/gitGraph.ts` |
| A | `src/features/source-control/model/unifiedDiff.worker.ts` |
| A | `src/features/source-control/model/unifiedDiffDocument.test.ts` |
| A | `src/features/source-control/model/unifiedDiffDocument.ts` |
| M | `src/features/source-control/model/unifiedDiffWindow.ts` |
| M | `src/features/source-control/model/worktrees.test.ts` |
| M | `src/features/source-control/model/worktrees.ts` |
| M | `src/features/source-control/ui/CommitDiff.tsx` |
| M | `src/features/source-control/ui/GitChangesPanel.test.ts` |
| M | `src/features/source-control/ui/GitChangesPanel.tsx` |
| A | `src/features/source-control/ui/GitHistoryGraph.test.ts` |
| M | `src/features/source-control/ui/GitHistoryGraph.tsx` |
| A | `src/features/source-control/ui/ReviewDiffCaching.test.ts` |
| M | `src/features/source-control/ui/SessionChangesDiff.tsx` |
| M | `src/features/source-control/ui/SidebarWorktreeSwitcher.tsx` |
| M | `src/features/source-control/ui/SourceControl.tsx` |
| M | `src/features/source-control/ui/SwitchBranchDialog.tsx` |
| A | `src/features/source-control/ui/UnifiedDiffView.expansion.test.ts` |
| M | `src/features/source-control/ui/UnifiedDiffView.markers.test.ts` |
| M | `src/features/source-control/ui/UnifiedDiffView.tsx` |
| A | `src/features/source-control/ui/WorkingTreeDiff.test.ts` |
| M | `src/features/source-control/ui/WorkingTreeDiff.tsx` |
| A | `src/features/source-control/ui/unifiedDiff.css` |
| A | `src/features/source-control/ui/workingTreeDiffSurface.ts` |
| M | `src/features/terminal/ui/TerminalGridBackground.tsx` |
| M | `src/features/terminal/ui/TerminalView.test.ts` |
| M | `src/features/terminal/ui/TerminalView.tsx` |
| M | `src/features/workspace/hooks/useTabCloseMotion.ts` |
| A | `src/features/workspace/model/appViewTabs.test.ts` |
| A | `src/features/workspace/model/appViewTabs.ts` |
| A | `src/features/workspace/ui/AppViewSurface.tsx` |
| M | `src/features/workspace/ui/PaneTree.tsx` |
| M | `src/features/workspace/ui/PaneTreeEnter.test.ts` |
| M | `src/features/workspace/ui/TabCloseMotion.test.ts` |
| M | `src/features/workspace/ui/WorkspacePicker.tsx` |
| M | `src/integrations/harness/core/apply.test.ts` |
| M | `src/integrations/harness/core/apply.ts` |
| M | `src/integrations/harness/core/child.test.ts` |
| M | `src/integrations/harness/core/child.ts` |
| A | `src/integrations/harness/core/providerNames.ts` |
| M | `src/integrations/harness/core/registry.test.ts` |
| M | `src/integrations/harness/core/registry.ts` |
| M | `src/integrations/harness/index.ts` |
| M | `src/integrations/harness/providers/claude/claude.ts` |
| M | `src/integrations/harness/providers/claude/claudeCatalog.ts` |
| M | `src/integrations/harness/providers/claude/claudeLive.test.ts` |
| M | `src/integrations/harness/providers/claude/claudeProtocol.test.ts` |
| M | `src/integrations/harness/providers/claude/claudeProtocol.ts` |
| M | `src/integrations/harness/providers/codex/codex.ts` |
| M | `src/integrations/harness/providers/codex/codexLive.test.ts` |
| M | `src/integrations/harness/providers/codex/codexProtocol.test.ts` |
| M | `src/integrations/harness/providers/codex/codexProtocol.ts` |
| A | `src/integrations/harness/providers/cursor/cursorCatalog.test.ts` |
| M | `src/integrations/harness/providers/cursor/cursorCatalog.ts` |
| M | `src/integrations/harness/providers/hermes/hermesProtocol.test.ts` |
| M | `src/integrations/harness/providers/hermes/hermesProtocol.ts` |
| M | `src/integrations/harness/providers/opencode/opencodeCatalog.ts` |
| M | `src/integrations/harness/providers/opencode/opencodeProtocol.ts` |
| M | `src/integrations/harness/providers/pi/piCatalog.test.ts` |
| M | `src/integrations/harness/providers/pi/piCatalog.ts` |
| M | `src/integrations/harness/providers/pi/piFamily.ts` |
| M | `src/integrations/harness/providers/pi/piProtocol.test.ts` |
| M | `src/integrations/harness/providers/pi/piProtocol.ts` |
| M | `src/integrations/harness/providers/pi/piSubagents.test.ts` |
| M | `src/integrations/harness/providers/pi/piSubagents.ts` |
| M | `src/main.tsx` |
| M | `src/platform/tauri/fs.test.ts` |
| M | `src/platform/tauri/fs.ts` |
| A | `src/platform/tauri/useTrafficLightsVisible.ts` |
| M | `src/shared/hooks/useAnimatedReorder.test.ts` |
| M | `src/shared/hooks/useAnimatedReorder.ts` |
| M | `src/shared/hooks/useDragResize.ts` |
| M | `src/shared/hooks/useLockOverscroll.test.ts` |
| M | `src/shared/hooks/useLockOverscroll.ts` |
| A | `src/shared/hooks/useStableValue.test.ts` |
| A | `src/shared/hooks/useStableValue.ts` |
| A | `src/shared/lib/emojiData.test.ts` |
| A | `src/shared/lib/emojiData.ts` |
| M | `src/shared/lib/layers.ts` |
| A | `src/shared/lib/layoutTransition.ts` |
| A | `src/shared/lib/nativeContextMenu.test.ts` |
| A | `src/shared/lib/nativeContextMenu.ts` |
| M | `src/shared/lib/paths.test.ts` |
| M | `src/shared/lib/paths.ts` |
| M | `src/shared/lib/popover.test.ts` |
| M | `src/shared/lib/popover.ts` |
| M | `src/shared/ui/ColorPickerPopover.tsx` |
| A | `src/shared/ui/EmojiPicker.tsx` |
| M | `src/shared/ui/Modal.tsx` |
| A | `src/shared/ui/PaneHeader.tsx` |
| M | `src/shared/ui/Popover.tsx` |
| A | `src/shared/ui/RevealHeight.tsx` |
| M | `src/shared/ui/TabLabel.tsx` |
| A | `src/shared/ui/focusVisibleHas.test.ts` |
| M | `src/shared/ui/icons.tsx` |
| M | `src/shared/ui/lazySurface.test.ts` |
| M | `src/shared/ui/lazySurface.tsx` |
| M | `src/styles/index.css` |
| A | `tests/browser/app-view-tabs.spec.ts` |
| A | `tests/browser/emoji-picker.html` |
| A | `tests/browser/emoji-picker.spec.ts` |
| A | `tests/browser/emoji-picker.tsx` |
| A | `tests/browser/fixtures/preview.mp4` |
| A | `tests/browser/fixtures/resource-load.py` |
| A | `tests/browser/layout-opt-in.spec.ts` |
| A | `tests/browser/performance.config.ts` |
| A | `tests/browser/readerAnchor.ts` |
| A | `tests/browser/resource-pressure.spec.ts` |
| A | `tests/browser/right-panel-graph.spec.ts` |
| A | `tests/browser/session-completion.spec.ts` |
| A | `tests/browser/session-pane.html` |
| A | `tests/browser/session-pane.tsx` |
| A | `tests/browser/session-performance.html` |
| A | `tests/browser/session-performance.spec.ts` |
| A | `tests/browser/session-performance.tsx` |
| A | `tests/browser/tab-revisit.html` |
| A | `tests/browser/tab-revisit.spec.ts` |
| A | `tests/browser/tab-revisit.tsx` |
| A | `tests/browser/tauriFixture.ts` |
| A | `tests/browser/theme-transparency.spec.ts` |
| A | `tests/browser/title-bar-layout.spec.ts` |
| A | `tests/browser/title-tab-reorder.html` |
| A | `tests/browser/title-tab-reorder.spec.ts` |
| A | `tests/browser/title-tab-reorder.tsx` |
| M | `tests/browser/transcript-scroll.spec.ts` |
| M | `tests/browser/transcript.tsx` |
| A | `tests/browser/unified-diff.html` |
| A | `tests/browser/unified-diff.spec.ts` |
| A | `tests/browser/unified-diff.tsx` |
| A | `tests/browser/video-preview.html` |
| A | `tests/browser/video-preview.spec.ts` |
| A | `tests/browser/video-preview.tsx` |
| A | `tests/browser/workspace-performance.html` |
| A | `tests/browser/workspace-performance.spec.ts` |
| A | `tests/browser/workspace-performance.tsx` |
| M | `vite.config.ts` |

## Validation and handoff

Baseline on unchanged application source `b344c56b`:

- The initial full `npx vitest run` passed 620 files / 6,824 tests. Thirteen files
  were blocked by the workspace missing locked `@xterm/addon-webgl` 0.19.0; one
  native opt-in file / two tests were skipped. All reported failures were import
  resolution for that missing package, not code changes from this task.
- `npm ci` restored dependencies using the existing lock without tracked changes.
  The thirteen affected files then passed all 156 tests. Strict `npx tsc --noEmit`
  passed after installation. Logs: `/tmp/monocode-014-baseline-vitest.log`,
  `/tmp/monocode-014-baseline-webgl-recheck.log`,
  `/tmp/monocode-014-baseline-tsc-after-ci.log`, `/tmp/monocode-014-npm-ci.log`.
- `git diff --check` passed for the preparation documents. No application code
  or conflict resolution had been committed at that preparation checkpoint.
  Baseline runs do not count as the merged result's full gate.

Integration gates are recorded below, with source review and human desktop/provider
checks kept separate. No installer was requested or produced. The local merge commit
will have both pinned parents; publication is a separate explicit instruction.


## Implemented combinations and repair evidence

- **Layout and managers:** classic remains the default. The optional New layout has
  local Task Manager and Session Manager navigation, title tabs, active/close behavior
  and footer access. A shared footer predicate and seven regressions preserve the
  classic manager exception as well as inset app-tab behavior. Local sidebar card order, drafts, linked chats, Remote Control,
  working-chat dismissal, provider conversations and notifications remain wired.
  The upstream Mono overview replaces competing panels; per-turn sessions/activity
  open its existing tabs, and Mono instructions keep `tasks.list` / `tasks.write`.
- **Resources:** the one mounted view is local `ProcessMonitor`. CPU/RAM/GPU,
  partial totals, app row and 10s/3s cadence stay; off means no sampler/timer/IPC.
  Incoming pressure detection is under that toggle and shrinks the transcript pool.
  OS pressure readings are upstream's macOS probe; other platforms retain UI-stall
  detection and explicit unavailable OS readings. The unused upstream compatibility
  notice is not mounted by App. Its `/bin/ps` tool commands are not the Windows UI path.
  The combined view's new `process_stop_tool` verifies root registration, root/tool
  creation identity and descendant ownership, rejects app/agent/other-chat/reused PIDs,
  and stops children first. Windows holds the verified kernel handle through termination;
  no new crate or shell process was added. App/agent Stop still uses existing lifecycle paths.
- **Accounts:** local Claude confirmation/copy/rebind/switch-back safety is retained.
  Incoming Codex native-copy continuation stops and drains its process without forgetting
  the original binding before copy. Copy failure retains that binding; GUI summary fallback
  requires a second explicit confirmation explaining history/cache loss. It is never automatic.
- **Idle:** generic three-minute parking and warm-agent cap recheck Interactive and
  desired Remote Control exemptions on schedule, timer and cap enforcement. A zero
  cap cannot bypass Interactive's readiness/background/quiet-period rules. Native
  Interactive files are unchanged from the latest fork, including suggestions suppression,
  single-send paste matching, timing, attachments, fork/sidechat, compact and buffered polling.
- **Persistence/performance:** session-state observer and upstream tool-output deferral
  preserve queue durability/holds/timestamps. Tool details are restored before saving.
  Per-file Git review and CRLF guards survive lazy retained diff tabs; changing only focus
  no longer reloads Git data. Context diagnostics remain separate from whole-turn metrics.
  Terminal StrictMode setup is deferred once, retaining lazy ownership and safe close/retry.
- **Images/settings:** local canonical project-image guards, table actions and code wrap
  coexist with upstream document images/media, HTML artifacts and Markdown workers.
  Document images retain document-relative resolution before containment checks rather
  than being pre-resolved against project cwd. Both layouts keep local menu controls;
  classic-only tint controls are hidden in the new layout as upstream intends.
- **Windows/build:** Job Object ownership, ConPTY flushing/replay/handshake, hidden
  launchers, Windows Quick Composer, fonts/acrylic/wallpaper and the isolated Dev profile
  remain. Incoming single-instance handling runs only on the GUI path, after CLI early exits.
  Source versions are 0.14.0; local dependencies are unioned, including WebGL/tiny_http.
  The existing native Windows workflow also accepts the new integration branch.

### Gate repairs and attribution

- Initial merged full web run: 9 failures, 7,409 passes. Fixed the actual integration gaps:
  Mono classic cards omitted project labels; Mono Tasks wording changed case; focused-file
  changes reloaded Git; upstream Mono-store subscriptions lacked server snapshots used by
  fork rendering tests; document-image paths were intercepted by local image rewriting.
  Extended the incoming settings-search expectation for the intentionally retained local
  Glass strength row, and restored the matching classic-only Color/Translucency UI gates.
  No assertion was removed to conceal a feature regression.
- Rust formatting drift and three test-only Clippy issues existed in the fork's Debug
  Inspector/partial-totals work. Applied formatting, removed a needless borrow and changed
  two test-only vectors to arrays; behavior and assertions are unchanged. A new native
  identity helper's needless return was fixed. The prior reveal-path test now awaits the
  upstream async command. The Windows-only GPU helper is cfg-gated outside tests.
- The first full Rust test run had one process-group cleanup failure in a Docker container
  without an init/reaper (812 passes, 2 ignored). Repeating the unchanged suite in a
  Docker `--init` container passed all 813 active tests. No process assertion was relaxed.
- Host baseline: an untouched `git archive b344c56b` passed all 14 transport tests and
  failed only the harness-parity assertion. The assertion incorrectly required the
  deliberately local-only Antigravity CLI to be remote. It now explicitly asserts every
  supported handler and that Antigravity CLI is rejected by host descriptor validation;
  remote ACP remains supported. Two effort checks failed under the initial concurrent
  load, then all 14 transport checks passed unchanged on isolated rerun.

- An additional full web pass was green (7,420 tests), before adding the seven
  footer-predicate regressions. A final run concurrent with a production build
  exposed upstream first-paint fixture's 1s polling deadline (19 of 20 historical
  turns had warmed); the source behavior had passed unchanged in the previous
  run. Its bounded wait is now 5s, with the exact first-paint count, full 20-turn
  window, load-earlier and pinned-scroll assertions intact. No application timing
  or behavior changed to satisfy the fixture.

### Human Windows/provider checks (separate from automated gates)

1. Use `npm run tauri:dev-profile`; check both classic and optional New layout.
   Open local Task/Session Managers, draft/start a task, follow linked chats, inspect
   notifications and verify the usage/process/terminal footer stays reachable.
2. In an existing Interactive native session: send a long multiline prompt with an image,
   send a follow-up, approve/answer once, fork/sidechat and compact. Confirm one GUI turn,
   native resume, honest elapsed time and no prompt suggestion/draft misclassification.
3. Verify model/effort/permission controls and native terminal fallback share one process;
   idle shutdown resumes the same session and leaves background work/Remote Control alone.
4. Enable process monitoring: check CPU/RAM/GPU, partial/unavailable/exited states,
   descendant-only Stop, session Stop/resume and zero sampling when disabled. Pressure
   cooldown is automated; visible Windows behavior needs a real desktop.
5. Test Claude exact-history account continuation and switch-back, refused unsafe live/busy
   changes, Codex continuation and copy failure/cancel. Check all-account Antigravity usage,
   manual refresh and foreground refresh on real accounts. Cache/quota effects require
   actual measurements and are not guaranteed by this merge.
6. Check Windows single-instance/tray reopen, lazy terminal links/WebGL, wallpaper/fonts,
   CRLF edit/stage, document/project images and the isolated Dev data profile. No installer
   is built or installed by this task; native workflow execution awaits branch publication.


## Final validation checkpoint

- Full web gate `npx vitest run --maxWorkers=2`: 668 files / **7,427 passed**;
  one native opt-in file / two tests skipped. Strict TypeScript passes.
- Rust format, workspace check and all-target Clippy with warnings denied pass.
  Full `cargo test` with Docker init/reaping: **813 passed / 2 ignored**; bin/doc tests pass.
- Production build and host build pass. Full host tests: **117 passed / 5 skipped**.
  Release-channel tests: **8 passed**. Staged/working whitespace checks pass.
- Full `npm run check` bar was executed in components: Node/web checks on the host,
  Cargo checks in the Linux native-validation container. The final web gate includes
  the seven footer regressions and all first-paint assertions; nothing is filtered out.
- Existing build warnings concern CSS Highlight minifier support and chunk size;
  there are no TypeScript, Clippy, test or build errors.
- Logs and commands are listed in the [spec](../../specs/upstream-0.14.0-sync-plan.md#done).
  Desktop/browser driving, signed-in provider validation and Windows native execution
  were not claimed. No installer built; no upstream writes or remote publication.

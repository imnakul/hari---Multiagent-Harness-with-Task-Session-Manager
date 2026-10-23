# MonoCode — Planned (Nakul fork)

Working roadmap for the personal fork. The north star first, the ladder to reach it second,
current state third, and suggestions/quick wins on top at the end.

## Markdown Live mode (Obsidian-style) — planned 2026-10-23, not started

A third view beside Preview and Source in Notes, Tasks and Session metadata: **Preview | Live |
Source**. Typing shows formatting as you go (`## ` heading, `**bold**`, `- ` bullet, `- [ ]`
clickable checkbox, links, images); the Markdown symbols reappear only on the cursor's line.
Saved text stays exactly the same Markdown, so agents, the `#` picker and copy are unaffected.
Follows L-182 (double-click to edit, Ctrl+E). Chosen over Tiptap/Milkdown, whose
Markdown → editor → Markdown conversion is lossy.

**Size: Medium.** No new packages (CodeMirror 6, `@codemirror/lang-markdown` and
`@lezer/markdown` are installed; lazy-load Live). About 1,000 new lines:
- [ ] CodeMirror editor component kept in sync with the item's text and autosave.
- [ ] Live decorations plugin: headings, bold/italic/strike, inline code, links, quotes, lists,
  task checkboxes, code fences, dividers, images; symbols shown on the cursor line only.
- [ ] Enter continues lists and checklists.
- [ ] Theme matching `AgentMarkdown` typography.
- [ ] Image paste/drop (`useMarkdownImages`): adapter for CodeMirror selection instead of the textarea.
- [ ] `MarkdownViewMode` gains `live`; three tabs; `useMarkdownEditGestures` handles Live.

**Preview-only in the first version:** Mermaid, syntax-highlighted code, table layout,
file-link context menus, link preview cards (they show as tidy plain text in Live).
**Phase 2:** tables and Mermaid in Live; Live for `.md` files in the file viewer.
**Risks to test:** cursor jumps when symbols hide (use atomic ranges), IME input, very long notes.

**Decisions to confirm before building** (recommended):
1. Existing items open in Preview; new or empty items open in Live (instead of Source).
2. Ctrl+E toggles Preview ↔ the last edit mode used (Live or Source); double-click in Preview
   opens that mode at the clicked line.
3. First version covers Notes, Tasks and Session metadata only.

## Responsiveness follow-ups — selected 2026-10-22

Left over from the responsiveness work (L-160 to L-172; spec:
[backend-responsiveness-plan.md](specs/backend-responsiveness-plan.md), research:
[perf-patterns-t3-orca.md](notes/perf-patterns-t3-orca.md)). Ask Claude to "do the Soon
responsiveness items" when there is usage to spare.

**Soon** (real gain, small to medium):
- [x] Git process cap with a fast user lane (pattern 5) — done 2026-10-22 (L-179). Background git reads (branch labels,
  status, diff stats) share a small limit; a git action the user clicked (commit, checkout,
  push) skips the queue. Stops a burst of background git from slowing a click.
- [x] SQLite `synchronous=NORMAL` on the WAL store — done 2026-10-22 (L-178). Fewer disk flushes per save, so saves get
  faster. Tradeoff (your call before doing it): a power cut or OS crash can lose the last few
  saves; an app crash cannot. The database never corrupts either way.
- [ ] Watch L-178 for a few weeks of daily use after the next build: Performance log `perf_ping_db`
  and save timings, plus any lost recent saves after a power cut or Windows crash. Keep it if
  saves are faster and nothing is lost; otherwise revert (steps in the L-178 changelog entry).

**Deferred** (worth it only if the Performance log still shows the problem):
- [ ] WAL checkpoint on its own thread, so a large checkpoint never lands inside a save.
- [ ] Parse provider history (Claude/Codex transcripts) in a worker, not on the command thread,
  for very long sessions.
- [ ] Virtualized transcript: render only the visible messages in very long chats. Risks to
  handle: find-in-page, scroll anchoring when new output arrives, and the PromptOutline jumps.
- [ ] Bounded stream buffers: cap how much unread agent output queues in memory per session, so
  a runaway agent cannot grow memory without limit.

## Antigravity CLI follow-ups — selected 2026-10-06

Keep these items for the separate `antigravity-cli` provider; preserve ACP:
- [x] Usage footer (implemented; Windows format/UI check pending): model quota/credits from read-only CLI reports in the existing usage UI; per-turn token accounting remains separate.
- [x] MCP discovery and native disabled switches (implemented; Windows UI check pending): show CLI-configured servers in the existing MCP panel. Native user/workspace files show Configured/Disabled; JSONC-preserving switches edit the documented disabled flag. Add/remove/OAuth and live connection probes are outside this slice.
- [ ] Remote Control toggle/link (deferred by user 2026-10-06): verify streaming compatibility and phone-originated turns, then add the existing control UI with same-conversation synchronization, approvals, reconnect and duplicate prevention. User reports the CLI test worked; full wire behavior still needs confirmation.
- [ ] Native fork (deferred by user 2026-10-06): verify the provider's fork entry point and new native ID, then wire the existing MonoCode fork action without converting it to a summary transfer.

- [x] Custom agents (implemented; Windows UI check pending): existing selector in chat/Quick Composer/automations; native local/global agent definitions, selection fixed after native bind and preserved across Stop/resume.

Other CLI UI additions discussed in this conversation are dropped from this follow-up scope.
Planning, fast mode, learn and teamwork remain out of scope. Latest implementation checkpoint: [usage/MCP/agents plan](specs/antigravity-cli-usage-mcp-agents-plan.md).

## Where things stand — 2026-10-03

Integration branch `nakul/windows-support-upstream-0.7.0` contains upstream MonoCode 0.7.0 plus the
fork's work: Task Manager, Session Manager, Windows Quick Composer, gliding hover everywhere and the
performance overlay. What changed is in [Changelog 02](changelog/CHANGELOG-02.md); what the fork adds
over upstream is in [LOCAL-FEATURES.md](LOCAL-FEATURES.md). Open items: the Task Manager list FPS drop
seen once (needs a fresh performance log), and fast-forwarding `nakul/windows-support` to the 0.7.0 line.

---

## North star: Hari Orchestrator

One place to talk. Hari sits on top of everything:

- Knows **all projects and all threads**. You give Hari a task; Hari decides the architecture,
  spawns threads (or continues existing ones), picks providers per thread, and manages them.
- A **kanban board**: `Todos → In Progress → Needs Input → Done`. Hari moves work across it and
  pulls anything that needs a human into **Needs Input** — so instead of checking every thread,
  you check one lane. You can also drop ideas into it ("have this idea") and Hari files them to
  the right project and acts when the time is right.
- Ask Hari anything anytime: "where were we last time?", "status of this task?" — answered from
  thread state, not from re-reading transcripts with AI tokens.
- If you're at the screen, you can bypass Hari (normal mode) or just watch threads run — with
  cost and efficiency visible.

Design constraint learned from Munder Difflin: an agent must **not** be locked to one directory
or one provider, and the orchestrator must not swallow everything into one chat. Threads stay
independent; Hari is a manager over them, not a bottleneck relay.

---

## The ladder (in order)

1. **Terminal on Windows** — in progress on a separate thread (`feature/windows-terminal`).
2. **Central MCP hub** — MonoCode owns a collection of MCP servers; any provider runs them from
   MonoCode, no per-provider installs (mirror of what we already do with skills).
3. **Providers end-to-end** — Claude, Codex, OpenCode, Antigravity solid: no hangs, exits,
   auth surprises. (Antigravity ACP: working; review issues pending.)
4. **Standalone chat** — chat without a project, still continuable later.
5. **Scheduled tasks & workflows** — automations like Antigravity's: run a task on a schedule,
   hooks for triggers, results land as threads/notifications.
6. **CodeRabbit bridge** — pull review issues from a raised PR into a chat *without AI cost*
   (harness/`gh` API work, not agent work).
7. **UltraContext** — cross-provider context transfer so a thread can move between providers
   without losing its brain (research done: claude-mem, ultracontext; not implemented).
8. **Codebase graph view** — harness-side index (files/symbols/relations) that hands the agent
   relevant files cheaply, cutting AI cost on orientation work.
9. **Orchestrator mode (Hari)** — everything above converges here.

---

## State on 2026-09-06 (historical)

- **Antigravity ACP**: working end-to-end on `feature/antigravity-acp` — official runtime,
  Google sign-in, shared long-lived runtime (one process for all chats), catalog, resume,
  attachments. Review found ~5-6 issues → to be fixed next.
- **Terminal (Windows)**: separate thread, ongoing.
- **claude-mem / UltraContext**: research done, nothing implemented yet.
- **Image viewing**: broken — no preview thumbnails, no small inline render, not clickable.
- **Documents**: add/view/send not tried yet.
- **Steering**: native steer exists for Claude (stream-json stdin), Codex (`turn/steer`),
  OpenCode (`promptAsync` queue). Antigravity + Grok + Cline + Pi + omp: refuse mid-turn input.

---

## Suggestions on top (ordered by value ÷ effort)

### 1. Harness-level queue + steer (do first — it's the composer everyone described)

Don't implement steering per provider. Implement **one queue at the harness layer** that works
for every provider, native steer or not:

- The composer always accepts input. `Enter` during an active turn **queues** the message
  (bubble appears in the transcript: "queued — will send when the agent finishes").
- A **Steer** button on the queued bubble sends immediately *if* the provider supports native
  steer (Claude/Codex/OpenCode), otherwise performs cancel-and-queue (Antigravity: send
  `session/cancel`, wait for settle within the 15 s grace, then flush the queue as the next
  prompt).
- When a turn ends, the queue **flushes automatically** in order — including across a crash
  (queue is persisted with the session, like resume refs).
- Implementation lives in `registry.ts` (one wrapper around `sendHarnessTurn` + a per-session
  queue map), so adapters stay untouched. Attachments ride along in queue entries.

This gives every provider the same mental model: *type anytime; Steer = now; otherwise next*.

### 2. Antigravity usage meter (~small)

The runtime logs its backend `usageUpdate` frames on stderr — `trajectoryId` equals our ACP
session id, fields `promptTokenCount` / `totalTokenCount` (strings). Parse in the shared
runtime host's stderr path, forward as a synthetic `session/update`, map to
`{type:"context", used}` in `antigravityEvents`. Degrades silently if Google changes the log
format. (Verified live; counts match real turns.)

### 3. Image preview fix (small, frontend-only)

Checked 2026-09-06: the upstream **image viewer already exists in our branch**
(`src/lib/filePreview.ts` + `src/surfaces/BinaryFileView.tsx` with zoom controls, magic-byte
detection, auto-reload) - it is wired into the **FilePane (file explorer)** only. Chat
attachment bubbles never got it: no inline preview, no click-to-open. The fix is wiring the
existing viewer into attachment rendering in the transcript/composer - no new viewer needed.

### 4. CodeRabbit bridge (small, zero AI cost — high value)

A "Pull review" action on a PR-linked thread: fetch CodeRabbit review comments via `gh api`
(reviews + inline comment threads for PR #N), format into the chat as a structured report with
per-issue "fix this" buttons that send the issue text as a normal message. The agent then only
works on fixing — never on fetching/reading the review. Same pattern generalizes to any
review bot.

### 5. MCP hub (medium — bigger than it looks, start narrow)

MonoCode owns one MCP config; providers get it injected:
- Antigravity: the runtime already reads `~/.monocode/providers/antigravity/config/mcp_config.json`
  (seen in its logs) — we own that file today.
- Claude/Codex/OpenCode each have their own MCP config mechanisms — the hub writes into each.
- Phase 1: shared *stdio* server list, one toggle per provider. Phase 2: health/status UI.

### 6. Standalone chat (small-medium)

A "Scratch" root directory (e.g. `~/.monocode/scratch/<id>/`) as the cwd for projectless
chats; resume already works off provider session ids, so continuity is mostly a UI concern
(list scratch threads alongside project threads).

### 7. Branch / fork a thread (ChatGPT/Codex-style clone)

"Branch" on any message (or the thread menu): clone the conversation up to that point into a
new thread; the original stays untouched. Two levels:

- **UI-level fork (do first, works everywhere):** the new thread copies the transcript up to
  the chosen message and starts a **fresh native session** whose first prompt carries a
  compacted transcript ("conversation so far — continue from here"). No protocol needed, every
  provider works; this is the handoff mechanic, and UltraContext later becomes the
  high-fidelity version of the same bundle.
- **Native fork (later, where supported):** clone server-side history where a provider allows
  it. Never let two branches *share* one native session — a fork must copy, or the branches'
  turns interleave into one history.

Pairs well with the rest: a branch optionally carries queued messages; on the kanban a branch
is naturally a "try another approach" card; Hari can fan one task out to N branches and keep
the winner.

### 8. Sidechat — parallel research thread (plan later; likely excellent)

"Ask in Sidechat" on any thread: open a side conversation powered by **any model** (not the
thread's provider), which receives the main thread's context via **UltraContext** — what the
agent is doing, decisions so far, relevant files. You research, compare approaches, ask
"should we do X?" — all without touching the main implementation thread, which keeps working.
Both sides share context; the side chat can promote an outcome back ("tell the main thread to
do it this way") as a normal queued/steered message.

Why it's good: it separates *thinking* from *doing* — research tokens stop polluting the
implementation thread, and any cheap model can answer questions about a thread that a premium
model is executing. Depends on UltraContext for the context bundle; a v0 can ship with a
compacted-transcript seed (same primitive as Branch) before that exists.

### 9. Scheduled tasks (medium)

In-app scheduler (the app is already long-running): a task = cron/human schedule + prompt +
project/thread. Runs create real threads so results appear in the kanban, not in a log.
Hooks (pre/post turn, on-question, on-error) fall out of the same engine — and `Needs Input`
can be one of the hook targets.

### 10. Mode switcher — Projects / Chat / Hari (small, frames everything)

A tab switcher at the **top-left** of the app shell with three modes:

- **Projects** — today's app, unchanged: project threads, file pane, git, notes.
- **Chat** — where standalone chats (#6) live: projectless threads, still continuable.
- **Hari** — the orchestrator surface: kanban board, Needs Input lane, briefing composer.

Design rules: one app shell, three lenses over the **same session store** — switching modes
never stops running threads. A thread that is working shows a presence badge in every mode
(Munder Difflin's "watch the floor" idea, native to MonoCode's workbench instead of avatars).
The switcher itself is dumb view routing over shared state, so it can ship early: Chat tab
arrives with standalone chat, the Hari tab starts as the phase-0 kanban and grows into the
orchestrator without any further shell changes.

### 11. Hari, phase 0 — kanban without AI (medium, and worth doing early)

The kanban does **not** need Hari's brain to be useful on day one:
- `Needs Input` can be fed mechanically from events that already exist: `question.asked`,
  `approval.requested`, `session.error` → card in the lane; resolving the question/approval
  closes the card.
- "Where were we?" = session store query (last activity per thread/project), no AI.
- Only *routing* (which thread next, spawn or continue, which provider) needs the model —
  and by then, the queue, usage meter, and review bridge give Hari cheap tools to work with.

### 12. Later / big: codebase graph, UltraContext, full Hari

- **Code graph**: tree-sitter/ctags-style index built by the harness; expose "relevant files"
  to any provider as attachable context. Pairs with UltraContext (pack a thread's brain into a
  portable bundle so Claude→Codex→Antigravity handoffs don't restart from zero).
- **Full Hari**: autonomous routing and spawning — only after providers are boring-reliable
  and the kanban lanes are fed by real events.

---

## Principles picked up from the other harnesses

- From **Munder Difflin**: never lock an agent to one directory/provider; let humans drop
  ideas into a lane and let the system file them; low-tech (files) beats clever (RPC) for
  coordination.
- From **T3Code**: long-lived runtimes, honest failure, ACP where it exists — already ported;
  next borrowed items are the browser-helper preflight and multiple auth methods per provider.
- From **MonoCode itself**: the differentiator is the integrated workbench — UI, git, file
  explorer, notes, multi-provider in one window. Everything on this ladder should deepen that,
  never require leaving the app.

---

## Appendix: harness landscape (2026-09-06)

Three harnesses, three plumbing philosophies. All drive the same CLIs we already pay for.

| | MonoCode | T3Code | Munder Difflin |
|---|---|---|---|
| Shell | Tauri (Rust + webview) | Electron + Effect-TS (server/web/mobile) | Electron + node-pty/tmux |
| Provider connection | Each provider's own structured channel: Claude stream-JSON stdio, Codex app-server JSON-RPC, OpenCode HTTP/SSE, ACP for Cursor/Grok/Cline/Antigravity | ACP-first where possible + per-provider SDKs; long-lived managed runtimes | None for display - agents are real terminal processes streamed byte-for-byte; structured state via **CLI hook systems** posting to a local hook server |
| Steering | Native in Claude (stdin message), Codex (`turn/steer`), OpenCode (`promptAsync`); Cursor yes; Grok/Cline/Pi/omp/Antigravity refuse | Handled inside its ACP runtime layer | You type into the terminal (`tmux send-keys`) |
| Multi-agent | Threads per project, no cross-thread coordination yet | Not the focus | The killer feature: file-based inbox/outbox "hive" in a git repo + GOD orchestrator agent routes work |
| Memory | Per-provider sessions + notes | Managed by its server | Markdown memory palace with semantic recall |
| UI depth | Deep: tools, diffs, approvals, usage, git, file explorer, notes | Deep but bulky; multi-platform suite | Deliberately shallow: avatars + live terminal; you watch, you type |

One-line summary: **MonoCode translates each agent; T3Code standardizes agents onto a
protocol; Munder Difflin just watches the terminal and lets agents pass notes.**

Steering status in our adapters (verified in code): Claude, Codex, OpenCode, Cursor have real
steering; Antigravity, Grok, Cline, Pi, omp refuse mid-turn input - the harness-level queue
(#1) makes that difference invisible to the user.

Learnings we keep: from Munder Difflin - hook-based lifecycle events as a cheap fallback for
protocol-less providers, file-based coordination, never lock agents to a directory/provider;
from T3Code - long-lived runtimes and honest failure (ported), browser-helper preflight and
multi-auth methods (pending). MonoCode's differentiator stays the integrated workbench:
UI, git, file explorer, notes, multi-provider in one window.

---

## Parking handoff status - 2026-09-30

- Completed the approved parking operation. Hari is preserved on `hari-orchestration-changes-30sept`; the four newer orchestration changes are preserved separately on `park-other-orchestration-mode-changes-30sept`. Both fork tips were fetched and reconstructed before source removal. See [the parking record](notes/orchestration-parking-30sept.md).
- The active `nakul/windows-support` checkout retains only the independent Codex context-count fix, Claude human-origin change, and Antigravity ACP regression tests from this source snapshot. No source commit or push was made.
- Next, confirm that the selected minor scope in `specs/archive/provider-daily-work-improvements-plan.md` is complete, then re-inventory after parking. Collect the target version/build kind and selected upstream features/commits before implementation. Do not start those stages until the details are supplied and reviewed.
- The orchestration follow-up below describes the archived four-feature work. Resume it from its verified fork branch in a clean worktree; do not apply it over a future dirty checkout.

## Next orchestration work — 2026-09-25

Do this after the current Hari implementation turn settles, before adding
orchestration queue delivery or releasing Hari. The current Confirm & start
proposal/review gate stays in place.

1. **Wait/sync efficiency first:** Verify that a lead ending its turn while
   workers run is woken by existing `sync()` for completion and needs-input
   events. Change the lead instructions to use at most one or two useful
   `wait` calls, then end the turn and rely on event-driven wake-up. Keep the
   `wait` command available for an immediate supervised check. Test completion
   before/after lead idle, blocked questions, simultaneous results, and no
   repeated lead turns while workers are quiet.
2. **Tighten task briefs and reports:** Keep one detailed plan with the lead.
   Give each worker a short self-contained assignment with scope, acceptance
   cases, focused checks, and a concise final report keyed to its task ID.
   Do not copy the full lead conversation or every skill into worker context.
3. **Queue integration second:** Put worker result/question events into the
   lead's persisted pending stream and scoped lead assignments into each
   worker's managed pending stream. Default to arrival-order delivery, once
   per item, when that session is eligible. Manual reordering remains deferred.
4. **Short acceptance run:** Use a few small tasks to check idle lead usage,
   completion, a worker question, lead-busy ordering, failure, and duplicate
   prevention. Then decide which Hari UI is included, run its relevant dev
   smoke test, full gates, and the installed-build verification before release.

---

## Deferred ideas — 2026-09-25

These are separate from the current orchestration work. Revisit each as its own
feature when requested.

1. **Draft and queue conversion:** Move a saved draft into the message queue,
   or move a queued message to a saved draft, directly from their previews.
   Preserve attachments and handle an existing draft without overwriting it.
2. **Manual queue reordering:** Let the user reorder pending messages in a
   session queue, with clear behavior if the head is about to auto-dispatch.
3. **Selective context for other features:** Evaluate UltraContext or its
   context-management ideas for Handoff, Second Opinion, Sidechat, Branch from
   Here, and Migration. Keep this outside the orchestration scope; decide on
   data storage and retrieval only when those features are designed.
4. **Advanced orchestration recovery and lead transfer:** Later, add a compact
   run handoff/checkpoint and an explicit way to transfer ownership to a new
   lead after a crash, context limit, or deliberate switch. The current engine's
   existing persisted run and restart/Resume behavior remain in scope for its
   normal tests; this item is the richer cross-lead handoff.
5. **Combined all-thread Kanban:** Later, add one read-only board that shows
   working, queued, blocked, and completed threads across projects and
   providers. Derive it from the existing session/orchestration state. This is
   separate from the current project's Hari Chat/Board view and does not need
   a second orchestration engine.
6. **Queue locally while idle:** In a new or idle chat, offer **Queue locally**
   alongside **Send now**. Queued ideas and attachments persist without calling
   a model or auto-dispatching. A later explicit start action sends the intended
   queued ideas in a clear order; do not silently release them one by one.
   Design that start action and its relationship to manual reordering as a
   separate feature after the current orchestration work.

## Build handoff — 2026-10-02 21:21 IST (historical, 0.6.0)

Reached: unsigned 0.6.0 NSIS installer built from `nakul/windows-support` at `18ab934`, archived and
checksum-verified. Five version files remain uncommitted; no merge or push. Nakul explicitly chose
0.6.0; upstream 0.7.0 has 17 commits absent here and is outside this build task.

Left: manual installed-app checks. Full test gate remains red: two existing Mac shortcut expectations
on Windows and one MCP fixture-ancestor test failure. Other checks and host tests pass; ESLint remains
unavailable. No runtime/test fixes made as part of this version-only task.

Open questions: none for building; Nakul can decide a separate test-fixture cleanup and future 0.7.0
intake. [Build spec](specs/windows-060-build-plan.md) · [artifact and logs](notes/windows-060-build/README.md).

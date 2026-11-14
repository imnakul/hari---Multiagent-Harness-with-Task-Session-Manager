# Progress — Aside link: Ask Aside runs on MonoCode's CLIs ("Hari" in Aside)

- Branch: `feature/aside-hari` (worktree `E:\Developing\OpenSource\mono-clone-aside`)
- Base commit: `62a2a762`
- Created: 2026-11-14 05:56 IST
- Tier: Large

## Idea

Aside's "Ask Aside" side panel only runs Aside's own subscription or API-key models. Nakul already pays for and
runs Claude Code, Command Code and Antigravity CLI inside MonoCode. Let Ask Aside use them: MonoCode serves a
local OpenAI-compatible endpoint, Aside lists its models as "Hari · Claude" and so on, and each Ask Aside chat
becomes a MonoCode session in a project named **CLI**, so it can be read and continued from MonoCode's sidebar.

- User story: As Nakul, I want to pick "Hari · Claude" in Ask Aside so that my Claude Code subscription answers,
  and I can open the same chat later in MonoCode.

## Research

Reverse engineered from Aside 1.26 (daemon `aside-daemon.exe`, a Node SEA bundling pi-mono) with a probe
endpoint (`E:\Developing\Temptesting\aside-bridge-probe\server.mjs`):

- Custom providers live in `~/.aside/u/<n>/models.json` and are picked up live:
  `{ name, baseUrl, apiKey, api: "openai-completions", models: [{ id, name, reasoning, thinkingLevelMap, input,
  cost, contextWindow, maxTokens, compat }] }`. The daemon sends `Authorization: Bearer <apiKey>`.
- Every request resends the whole history; there is no conversation ID. History is a stable growing prefix.
- Three request kinds:
  - **Title**: a chat's first message only. System starts "You name conversations…", no tools, small max.
  - **Memory extraction**: after a chat's first turn; last user message starts "You are now acting as the memory
    extraction subagent".
  - **Turn**: 29k-character "You are Aside…" system prompt, a `<system_message>` user note (page title and URL),
    the user text, an optional `<recalled_memories>` user message, 19 tools, `stream: true`.
- `reasoning: true` shows the Reasoning menu (low/medium/high by default; xhigh and max only when present in
  `thinkingLevelMap`; `null` hides a level). The request carries `reasoning_effort = thinkingLevelMap[level]`.
- Streamed `delta.reasoning_content` shows as thinking.
- Aside's tools (`repl` browser control) are not relayed: the CLIs already reach the browser through `aside mcp`.
  Its `exec` tool would run Aside's own agent and loop back here, so CLI sessions deny `mcp__aside__exec`.

## Plan

Thin Rust transport, all logic in pure TypeScript with tests.

- `src-tauri/src/aside_link.rs` — `tiny_http` server on `127.0.0.1:<port>` (default 4518), bearer key (random,
  kept in app data `aside-link.json`, never sent to the webview). `GET /v1/models`; `POST /v1/chat/completions`
  (16 MB cap, 8 in flight) is emitted as `monocode-aside-request` to the attached workspace window. The reply
  streams from `aside_link_push` / `aside_link_finish` as SSE, with keepalive comments every 5 s. A failed write
  means Aside stopped or closed the chat: `monocode-aside-cancel` reaches the window, which stops the turn.
  `aside_link_write_models` merges `monocode-*` providers into every `~/.aside/u/*/models.json` (one-time
  backup, atomic write). The CLI project folder `<app data>/aside-link/CLI` gets `.claude/settings.json`
  denying `mcp__aside__exec`.
- `src/features/aside-link/model/` — request validation and classification, conversation keys, title answer,
  SSE chunks, reply progress from a session, Aside provider entries from MonoCode's model catalog.
- `src/features/aside-link/hooks/useAsideLink.ts` — attaches the window, answers requests, maps Aside chats to
  sessions, streams progress, stops on cancel.
- `App.tsx` — wires the hook beside `useMobileWorkspace` with start/send/stop callbacks; pins the CLI project.
- Settings card — enable toggle, status, port, "Add models to Aside".

### Acceptance criteria

1. With the link on, `GET /v1/models` with the key lists the models; without the key it is 401.
2. A title request is answered locally from the first words; no session starts.
3. A memory-extraction request is answered "No new memories." locally; no session starts.
4. A first turn starts a new session in the CLI project with the chosen harness, model and effort (Claude in
   Interactive mode) and streams the assistant's text back; tool steps stream as thinking lines.
5. The next turn of the same Aside chat continues the same session; a new Aside chat starts a new session.
6. Editing or regenerating an earlier message, or a chat MonoCode never saw, starts a new session that carries
   the earlier Aside history as context.
7. Stopping in Aside stops the MonoCode turn.
8. "Add models to Aside" adds `monocode-claude`, `monocode-command-code` and `monocode-antigravity-cli` to every
   Aside account's models.json without touching other providers, and replaces older `monocode-*` entries.
9. Turning the link off stops the server; the key never reaches the webview or logs.

### States

Off · starting · listening · port in use (error) · no workspace window (503 to Aside) · busy (429) · turn
streaming · turn failed (error text streamed, then finish) · cancelled.

### Out of scope

Images in Aside messages; relaying Aside's own tools; Aside memories from these chats; Codex and other
harnesses; account switching per model (default account per harness).

## Todos

- [x] Rust transport and models.json writer, with tests (7 pass)
- [x] TS model functions with tests
- [x] Hook and App wiring
- [x] Settings card (Settings → Connections → Aside browser)
- [x] Gates, LOCAL-FEATURES row (L-274), changelog
- [ ] Manual check by Nakul

## Issues and fixes

- 2026-11-14: `cargo test aside_link` found that a provider without `models` panicked in `merge_providers`
  (`map["models"]` on a missing key). Fixed with `map.get("models")`, so it returns an error instead.
- `cargo clippy -- -D warnings` stops on errors in files this branch does not touch (`harness.rs`,
  `claude_interactive.rs`, `mobile_router.rs`); `aside_link.rs` has no clippy findings.
- Computer use: Claude sessions get Aside's `aside-cu` MCP server from the Claude account's own MCP config; the
  CLI project's `AGENTS.md` points to it. Command Code and Antigravity have no Aside MCP servers configured.
- `cargo fmt --check` still reports diffs, but only in files this branch does not touch (`browser_servers.rs`,
  `browser_view.rs`, `claude_interactive.rs`, `fs.rs`, `session_panel.rs`, `webview_recovery.rs`, and the
  base's `mod` order in `lib.rs`). `aside_link.rs` is formatted.

## Learnings

- tiny_http's chunked writer buffers 8 KB before sending, which holds streamed tokens back. The link writes its
  own chunked frames through `into_writer()` instead.
- Aside never sends a conversation ID, so a chat is found by hashing its earlier user texts with the model ID.
  Editing an earlier message changes the hash and starts a new session that carries the history as context.

## Done

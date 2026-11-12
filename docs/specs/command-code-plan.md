# Progress — Command Code provider (L-255)

Branch: `nakul/windows-support-upstream-0.16.0`
Base: `b05b2192` (plus the uncommitted local40 changelog entry)
Created: 2026-11-12 09:49 (IST)
Tier: Large (new harness/provider)

## Idea
Nakul bought a Command Code subscription and installed its CLI (`command-code` on npm,
binary `cmdc`). Use it in MonoCode like any other provider: pick it for a chat, choose
its model and effort, approve its tool calls, resume it later. Also allow it as the
AI helper (titles, commit and PR text, Session overview, Improve prompt, Continue).

- User story: As a MonoCode user with a Command Code plan, I want to chat with its
  models in MonoCode and let it write my session overviews and improved prompts, so
  I can use the plan without leaving the app.
- Fork-only: upstream closes new-provider PRs (`docs/WORKING-AGREEMENT.md`).
- Privacy: prompts, session text and project names go to Command Code's servers
  for chats and helper tasks that use it. That is the user's choice per chat and in
  Settings → AI helper; nothing switches to it by itself.

## Research
Probed on this computer, `cmdc` 1.88.5 (2026-11-12). Auth files were not read.

- **Binary:** npm shim `%APPDATA%\npm\cmdc.cmd`. On Windows `cmd` is the system shell,
  so only `cmdc` / `commandcode` / `command-code` are looked up. `cmdc --version`
  prints only `1.88.5`.
- **ACP (`cmdc acp`):** `initialize` → `agentInfo {name: "Command Code"}`,
  `loadSession: true`, images and embedded context, MCP http (no sse), session
  list/resume/close; one auth method, "Sign in once with `cmd login`".
  `session/new` returns:
  - `modes`: `default` (Standard), `auto-accept` (Accept Edits), `plan`,
    `dont-ask` ("keeping the safety rails on"), `bypass` (skip every check).
  - standard `models {currentModelId, availableModels[{modelId,name,description}]}`
    (97 models: Claude, GPT, Gemini, DeepSeek, Kimi, GLM, Qwen, Muse, Grok…; the
    account default is `stealth/glyph-cluster:free`).
  - `configOptions`: `model` (category `model`) and `effort` (category
    `thought_level`, `low|medium|high|xhigh`, current `low`).
  - `available_commands_update` (slash commands and the user's skills).
  A prompt streams `agent_message_chunk`, then `usage_update {used,size,cost}`;
  the `session/prompt` result has `stopReason` and `usage`.
- **Headless (`cmdc -p … --output-format json`):** NDJSON `event` frames and a final
  `result {subtype, finalText, usage}`; exit codes 3 auth, 5 rate limit, 10 credits.
  Not used: the ACP path covers chat and helper with one runtime.
- **Same shape as Hermes Agent** (upstream ACP provider), so the chat runtime follows
  `providers/hermes/hermes.ts` and reuses the shared ACP parsers in `grokProtocol.ts`.

## Plan
1. New harness id `command-code`, title "Command Code", in every provider list
   (session, models, availability, binary paths, connections protocol, icons, CLI
   versions, skills source list where typed).
2. Rust: `resolve_command_code` (PATH `cmdc`, then `%APPDATA%\npm\cmdc.cmd`, home
   fallbacks), `harness_resolve_command_code`, configured-path names, process
   allowlist, and `command_code_helper_directory` (empty app-data folder).
3. Chat runtime `providers/command-code/commandCode.ts` over `AcpClient`:
   new/load session, model via `session/set_model`, effort via
   `session/set_config_option {configId:"effort"}`, modes
   (supervised→`default`, auto-accept-edits→`auto-accept`, auto→`dont-ask`,
   full-access→`bypass`, plan intent→`plan`), approvals, cancel/stop/forget/bind.
   Sign-in errors say "Run `cmdc login` in a terminal".
4. Catalog probe: `session/new` in the home folder → models with an Effort setting.
   Static fallback `command-code:default` (the account's own default model).
5. AI helper: `runCommandCodeHelperPrompt` runs one ephemeral ACP turn in the empty
   helper folder in plan mode and stops on any tool use (like Antigravity CLI,
   `HELPER_ISOLATION` unverified). Add `command-code` to `AI_HELPER_PROVIDERS`.
6. Tests: protocol (modes, models + effort, auth text), helper (tool use stops,
   text returned, process forgotten), Rust resolver names.

Acceptance criteria:
- Command Code appears in the provider/model picker when `cmdc` is installed, with
  its models and an Effort choice; a chat streams replies, asks for approvals in
  Supervised, and resumes after a restart.
- Settings → AI helper lists Command Code; Session overview and Improve prompt
  work with it; a helper turn that tries a tool fails cleanly.
- Missing `cmdc` shows "Install with `npm i -g command-code`, then run `cmdc login`".

States: not installed, not signed in, out of credits / rate limited (error text from
the CLI), working, approval waiting, cancelled, resumed.

Out of scope: usage footer/quota, Command Code MCP settings UI, skills folder
discovery, session import, Activity notes (stay on agy), Hari phone UI changes.

## Todos
- [x] Provider id in all lists, icon, availability text
- [x] Rust resolver, helper folder, allowlists
- [x] ACP chat runtime, catalog, adapter, registration
- [x] AI helper runner and settings
- [x] Tests, tsc, vitest, cargo check / test, rustfmt
- [x] Records (L-255, changelog)
- [ ] Desktop check (manual, Nakul)

## Issues and fixes
- Full vitest run: 6 failures in 5 files, all from the new provider being in the lists. The model picker's provider rail gets one more tab (+36px: flyout 476→512px, frame 478→514), the npm update channels gain `command-code`, and the AI-helper fallback order (Continue, session overview) ends with `command-code`. Expectations updated; no behaviour weakened.
- `rustfmt --check` on `lib.rs`: `mod command_code;` was out of alphabetical order (after `codex_mono_store`, not before). Fixed. The other diffs it reports (`browser_servers`, `browser_view` order, and files it follows) were already there.

## Learnings
- `cmdc acp` lists about 95 models; ids are bare (`claude-*`, `gpt-*`) or vendor-prefixed (`google/…`, `stealth/…:free`). The account's current model comes first in the picker.
- Effort is an ACP config option (`session/set_config_option`, id `effort`, category `thought_level`), not a model variant. Values differ per model, so a saved value that isn't offered is skipped.
- The Rust `harness::tests` module is `cfg(unix)`; on Windows `cargo test --lib harness::tests` runs 0 tests. `cargo check` and the new `command_code` test cover the Windows build.

## Done
- 2026-11-12 10:02 (IST): code, tests and records complete; uncommitted. Desktop check is the open item (checklist in the changelog entry).

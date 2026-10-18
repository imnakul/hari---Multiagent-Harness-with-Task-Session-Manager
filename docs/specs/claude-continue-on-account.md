# Review — Continue a Claude chat on another account, with full history (L-102)

Created: 2026-10-18 13:53 IST · Tier: Medium · Claude only (Codex deliberately left out)

- Goal: when one Claude account hits its usage limit (or for any reason), carry on the same MonoCode chat on another Claude account without losing context.
- User story: As a MonoCode user with two Claude accounts, I want to switch an ongoing chat to my other account and keep the full conversation, so a usage limit does not force a fresh chat or a lossy summary.

## Background

- Claude Code keeps each chat in its config folder: `<config>/projects/<cwd-slug>/<sessionId>.jsonl`, plus a same-named folder next to it (sub-agent and tool-output files). The default account uses `~/.claude`; added accounts use `AppData/Roaming/com.monocode.desktop/provider-accounts/claude/<accountId>/` (`provider_account_path`, `provider_sessions::root_for`).
- `claude --resume <id>` with `CLAUDE_CONFIG_DIR` pointing at a folder looks for the chat in that folder only. Copying the files to the other account's folder lets that account resume the identical chat: 100% of what the CLI had.
- Today (L-96, `onProviderAccountChange` in `App.tsx`) picking another account on a chat with history opens a new, empty chat.

## Behaviour

1. **Model picker / bottom-bar chip, Claude chat with history, not busy:** picking another account shows a short confirm ("Continue this chat on imnakul?") with the cost note (below) and two choices: **Continue here** (new) and **New chat** (today's behaviour). Empty chats switch in place, as today.
2. **Continue here:**
   - Copies the transcript, and its same-named folder when present, from the current account's folder to the target account's folder, under the same `projects/<slug>/` path and the same session ID.
   - Sets the chat's `providerAccountId` to the target and keeps `providerSessionId`, so the next send resumes the same session on the new login. Works for Structured and Interactive (both resume by ID).
   - The chat stays in its tab; a small system line in the transcript records "Continued on imnakul".
3. **Usage-limit notice (Claude):** when another Claude account exists, add a **Continue on <account>** button (one per other account, or a menu if more than one) that does step 2 and then resends nothing — the user sends the next message.
4. **Resume session dialog:** a conversation row from one account can be opened on another. The row menu gets **Resume on <account>**, which copies as in step 2 and then resumes on that account.
5. **Cost reminder** (shown in every place above, before the action): "The first reply on <account> is not cached, so it uses more of that account's limit once. Later replies are cached as usual." In the confirm and in the row menu as a one-line note; no reminder on later turns.

## Safety rules

- Refuse while the chat is busy (a turn or background task running) or while its Interactive process is live; ask the user to stop or wait.
- Copy only; never delete or edit the source files. The original stays resumable on the old account.
- If the target already has a file with that session ID: when it is byte-identical, reuse it; otherwise stop with an error, never overwrite (that would be a chat that already diverged there).
- Only copy within MonoCode-known Claude roots (default root + `provider-accounts/claude/*`); validate the session ID (UUID) and that the source path is inside the source root's `projects/`.
- Not offered for remote sessions, Monos, or non-Claude providers.
- Rewind checkpoints (`file-history/<id>`) are not copied: rewinding to a turn before the switch is not supported on the new account (state this in the confirm's details, not the main text).

## Implementation sketch

- Rust, `provider_sessions.rs`: `claude_copy_session(app, from_account, to_account, session_id, cwd) -> Result<(), String>`. Find the source under `root_for(from)/projects/*/<id>.jsonl` (prefer the slug folder matching `cwd`); copy file + sibling folder into `root_for(to)/projects/<same slug>/`, writing to a temp name and renaming, so a half copy is never resumable. Tauri command registered in `lib.rs`.
- TS: `features/providers/model/continueOnAccount.ts` (invoke wrapper + Zod-checked result); `onProviderAccountChange` gets the confirm path; `UsageLimitNotice` gets the button; `ResumeSessionDialog` row menu gets **Resume on**.
- Records: LOCAL-FEATURES L-102 (amends L-96), changelog entry.

## Acceptance criteria (become tests)

1. Rust: copies file + sibling folder to the target root under the same slug; target resumes by ID (file present, identical bytes).
2. Rust: refuses an existing different target file; reuses an identical one; rejects non-UUID IDs and paths outside the roots.
3. TS: picking another account on a Claude chat with history shows the confirm with the cost note; **New chat** keeps today's behaviour; **Continue here** calls the copy and keeps `providerSessionId` with the new `providerAccountId`.
4. TS: busy or live-Interactive chats get the "stop or wait" message and no copy.
5. TS: usage-limit notice shows **Continue on <account>** only for Claude with another account.
6. TS: Resume session row menu offers **Resume on <account>** with the cost note.

## Verification before building (probe)

Copy one small real chat from `~/.claude` to the imnakul folder and resume it there with `claude --resume <id>` under `CLAUDE_CONFIG_DIR`, asking "what did we talk about?". Pass = it answers from the history. Run by Nakul or with Nakul's OK (it makes one real request on imnakul).

## States

Confirm open, copying (spinner, controls disabled), done (system line), refused (busy / live / conflict / missing source, each with a plain message), no other account (options hidden).

## Out of scope

- Codex and other providers; cross-provider full transfer (handoff recap stays as is).
- Moving (deleting the source), rewind history, remote hosts, Monos.
- Automatic switching on usage limit without a click.

## Open questions

- None blocking. Desktop check (human): confirm wording, usage-limit button, Resume on menu, and that the resumed chat answers from its history.

## Worker rules

1. **Start:** read `docs/WORKING-AGREEMENT.md` and `docs/LOCAL-FEATURES.md` row L-96 (`grep -n "L-96" docs/LOCAL-FEATURES.md`). Work on `nakul/windows-support-upstream-0.10.0`, the branch this checkout is on (light workflow: no worktree, no new branch, do not switch to `nakul/windows-support`; Nakul fast-forwards it later). Check `git status`: expected leftovers are `opencode.json` and `.opencode.json.lock` (never committed) plus this spec and the `docs/specs/SPECS.md` row move (include both in your feature commit). Anything else is someone else's work: stop and report.
2. **Status:** change this file's heading and its `docs/specs/SPECS.md` row from "Todo —" to "Progress —" (move the row to the Progress section) when you start.
3. **Probe first:** Nakul approved the probe by handing this off; it makes one real request on the imnakul account. Copy one small chat as described above and resume it. If the resumed chat cannot answer from its history, stop, set status to Blocked with what you saw, and report. Do not build on a failed probe.
4. **Build:** follow the Behaviour, Safety rules and Implementation sketch. Each acceptance criterion gets a test (Rust `cargo test --lib provider_sessions`, TS vitest).
5. **Gates before commit:** `npx tsc --noEmit -p .` clean; full `npx vitest run` green; `cargo test --lib` green; `cargo fmt --check` clean for files you touched (existing Debug Inspector drift is known; leave it). Lint: no ESLint config, record "—".
6. **Records:** add L-102 to `docs/LOCAL-FEATURES.md` (Index row, register row noting it amends L-96, and the "Last updated" line). Add a changelog entry at the top of the Current file in `docs/changelog/CHANGELOG.md`, with the real IST time from PowerShell `[TimeZoneInfo]::ConvertTimeBySystemTimeZoneId((Get-Date),'India Standard Time')`.
7. **Commit:** you may commit (not push). One commit: `feat(accounts): continue a Claude chat on another account (L-102)`. Then fill the commit SHA into the changelog entry in a small `docs:` commit.
8. **Finish:** set status to "Review —" (heading and SPECS row, moved to Review / Blocked). Do not drive the desktop app or use computer-use; report the desktop checks above as a manual checklist, plus the gate results.

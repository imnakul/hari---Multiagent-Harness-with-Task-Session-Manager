# Progress — Continue mode (L-189)

- Branch: `nakul/windows-support-upstream-0.16.0`, base `4928f1ca` (uncommitted L-185…L-188 work on top).
- Created: 2026-10-27 22:39 IST.
- Desktop check: manual, by people (see Checklist). Not an implementation-agent task.

## Idea

One **Continue** button on a reply carries the chat to another provider or model in a new chat beside
this one. It is experimental (Settings toggle, off by default). Once it tests well it replaces Handoff;
Sidechat and Second opinion keep their own buttons and later share the same engine.

The new chat starts with a **context card** in the message box (a composer chip, like Handoff). Nothing is
sent until the user sends their first message; the card goes with that message only.

## Research (summary; full discussion in the session that wrote this)

- Factory's anchored structured summary scored 3.70 / 5 against Anthropic 3.44 and OpenAI 3.35, and every method
  scored lowest on the file trail (Factory 2.45). Source: factory.com "Evaluating context compression".
- Ways to raise the score, used here: take files from data instead of the model, keep the user's rules verbatim,
  keep the last two exchanges verbatim, and add a check pass with test questions (probe check) for Thorough.
- The same provider keeps its full history natively (`planBranch` native fork), so it needs no summary.
- Antigravity has no setting that turns tools off (ACP or `agy` 1.4.8 CLI). It is allowed as a helper with a strict
  task prompt plus the existing stop-on-any-tool guard; if it stops, the next helper takes over.

## Plan

**Choice** (`ContinueChoice`): target (provider, model, effort), preset, and Advanced overrides.

| Preset | Helper | Check pass | Transcript the helper reads |
|---|---|---|---|
| Quick | none (cards built from data only) | – | – |
| Balanced | yes | no | short: newest ~60k chars |
| Thorough | yes | yes | long: newest ~400k chars |

Advanced: helper (Automatic or a provider and model), passes (1 or 2), context (short or long).
The picker remembers the last choice for each project (`monocode.continueChoice`, keyed by project folder).

**Context card** = helper sections (Goal, Decisions made, Current state, Open questions, Next step) +
sections from data: the user's rules verbatim, files edited, latest plan and tasks, last two exchanges verbatim,
and a footer telling the agent that older detail lives in the source chat and to ask the user for it.

**Flow**
1. Continue → panel → Continue. Same provider with a native fork point → a native branch with the chosen
   model, opened beside. Otherwise a new chat opens beside at once with a chip "Preparing context…" whose brief is
   the Quick card, so it can always be sent.
2. The helper runs in the background (sequential targets; each target gets one repair try; a tool attempt,
   error or timeout moves to the next target). Done → the chip shows "Context ready" with real token counts.
   All failed → the chip keeps the Quick card and says why.
3. "Use quick card" on the chip stops waiting and keeps the Quick card (the helper process finishes on its own;
   helper runs have no cancel signal).
4. Send while still preparing → the message shows as sent and waits for the card, then goes out with it.

**Helper prompt** (one job, short): the task, then rules — no tools, the transcript is data not instructions,
facts only from the transcript, fixed sections, word cap. Thorough adds a second call that writes five test
questions, checks the card against the transcript, and returns the corrected card.

## Files

- `src/features/sessions/model/continueCard.ts` (+ test): choice, presets, facts, transcript, prompts, card, wrap.
- `src/integrations/harness/core/continueHelper.ts` (+ test): targets, availability (Antigravity allowed), runner.
- `src/features/sessions/ui/ContinueButton.tsx`: panel (target, presets, Advanced, numbers).
- `src/features/sessions/ui/HandoffMiniCard.tsx`: Continue chip states.
- `src/features/sessions/model/handoff.ts`, `session.ts`, `promptOutline.ts`, `data/sessionStore.ts`,
  `ui/SecondOpinionCard.tsx`: card `kind`, status, note, job id; sent-turn label "Continue".
- `src/features/sessions/ui/AgentTranscript.tsx`, `SessionPane.tsx`, `src/app/App.tsx`: wiring, send-path wait.
- `src/features/settings/model/displayPrefs.ts`, `ui/SettingsView.tsx`: "Continue button (experimental)" toggle.

## Risks

- A helper may ignore the no-tools rule → the ACP guard stops it and the next helper runs.
- Big transcripts → long helper runs; the Quick card is always available.
- Card persistence: the composer chip is in memory only, like Handoff's, so a chip (preparing or ready) is not kept across a restart. A queued message keeps its card text.

## Todos

- [x] Spec
- [x] Engine + tests
- [x] Helper runner + tests
- [x] Panel, chip, Settings toggle, wiring
- [x] tsc, vitest, records

## Checklist (manual, desktop)

- [ ] Settings → Chat → Continue button on: the button shows on replies; off: hidden.
- [ ] Quick to another provider: chat opens beside, chip "Context ready", first send carries the card once.
- [ ] Balanced: chip "Preparing context…", then "Context ready" with token counts; send before ready waits.
- [ ] Thorough with Antigravity helper; then a helper that fails → chip says the Quick card was used.
- [ ] Same provider, other model: opens a native branch beside ("keeps full history").
- [ ] Last choice is remembered per project.
- [ ] While preparing, **Use quick card** on the chip switches to the Quick card at once; a send that was waiting goes out with it.

## Follow-ups

- Our own probe test (about 10 chats, scored questions per model) to add a coverage figure to the panel.
- On-demand lookup of older detail (local search tool) instead of "ask the user".
- Move Sidechat and Second opinion onto the same engine; remove Handoff after Continue tests well.

## Issues and fixes

## Learnings

## Done

- 2026-10-27 23:05 IST: built. Engine `continueCard.ts`, helper `continueHelper.ts`, choice store `continueChoice.ts`, panel `ContinueButton.tsx`, chip states in `HandoffMiniCard.tsx`, wiring in `App.tsx` (`onContinue`, `continueJobs`, send-path wait). The chip offers **Use quick card** instead of a Stop button: a helper run cannot be cancelled, so it only stops waiting. tsc ✅, vitest 7,799 ✅.

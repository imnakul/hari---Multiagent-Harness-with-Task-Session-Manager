# Improve prompt in the composer (L-252)

Status: Review — started 2026-11-11 23:25 IST; built 2026-11-11 23:48 IST. Awaits the desktop check below.

## Goal

The user writes fast, short drafts: half-sentences, Hinglish, "same as before", "1-A".
Agents then miss requests or guess. An ✨ button rewrites the draft in place into a clear,
complete prompt, without adding work, and learns how the user writes over time.

User story: As the person typing a prompt, I want one tap to turn my rough draft into a
clear prompt that keeps every request and reference, so the agent does what I meant.

## Decisions (locked with the user)

- Desktop composers first: chat and Interactive chat composer, and the quick composer inside a
  workspace window (Session board draft modal). Hari later.
- The rewrite replaces the text in place. Click **Original** to switch between the original and
  the rewrite; hold it to peek at the original. **Restore original** returns the first draft.
  ✨ again writes a new rewrite.
- Memory, stored on this device with a Clear button:
  - an editable **How I write** profile,
  - a glossary per project,
  - both learned from accepted rewrites and from edits made to a rewrite before sending.
- The helper sees the draft, the last few turns of the chat and the project name.
- When the same standing rule shows up in 3 or more prompts for a project, offer a one-tap
  **Add to AGENTS.md** (appends under `## Standing rules`).
- Settings → Chat → **Improve prompt** mirrors Session overview: model, effort, instructions with
  Reset, plus memory and suggestions.

## Acceptance criteria

- ✨ sits next to Send. It is disabled for empty or very short drafts (under 4 words), with a
  tooltip that says why. Ctrl+Alt+I (Cmd+Option+I) runs it from the composer; the shortcut
  can be rebound in Keybindings.
- While it runs, ✨ shows a spinner with a stop square, and the strip shows **Stop**; Esc, ✨ or Stop cancels; the text stays editable.
- The rewrite appears with the session-title sweep and particle animation (none with reduced motion).
- If the user types while it runs, their text wins. The finished rewrite is offered as
  **Use rewrite** instead of replacing it.
- A failure, timeout or unusable reply leaves the text untouched and shows a short message.
  The next helper in the list is tried first (quota and sign-in fallback).
- Kept exactly: file paths, `@mentions`, URLs, `code`, IDs such as `L-252` or `#123`, image
  references, and a leading `/command` (never sent to the helper; put back in front). A
  rewrite that drops one is rejected and retried.
- Default instructions:
  - keep every request; add nothing; mark guesses "Assumption:";
  - resolve "same as before" from the recent turns;
  - numbered Fix / Build / Question / Decide items;
  - UI items as where › wrong › expected › "Done when";
  - glossary terms; plain English, including for Hinglish drafts; "1-A" answers spelled out;
  - at most about 1.5× the draft's length.
- Sending records what happened: an unchanged rewrite counts as accepted. An edited rewrite is
  kept as a sample (newest 8); the next run learns from the samples.
- Learned lines (`style:`, `term:`, `rule:`) update the profile, the project glossary and the
  rule counts. They are capped, de-duplicated, and editable or clearable in Settings.
- Typecheck and the new unit tests pass.

## States

Idle (enabled or disabled with a reason) · running (cancel) · applied (Original toggle, peek,
Restore) · ready while typing (Use rewrite / Dismiss) · failed (message, text untouched) ·
rule suggestion (Add / Not now / Never) · added or add failed.

## Out of scope

- Hari (phone) composer.
- Remote-host chats: the button is hidden there (the helper runs on this computer).
- Syncing memory between devices.
- The floating quick composer panel (its own window): two helper runs from different windows
  could share a helper process id. A follow-up can route it through a workspace window.

## Desktop check (manual)

1. Type a 2-line Hinglish draft in a chat → ✨ → English, numbered, references kept.
2. Click Original twice; hold it; press Restore original.
3. Start ✨ and type at once → your text stays, **Use rewrite** appears.
4. Esc during a run → nothing changes.
5. Edit a rewrite and send → Settings → Improve prompt shows the sample count; after a few
   runs the profile and glossary fill in.
6. Say the same rule in 3 prompts → **Add to AGENTS.md** appears and appends it.
7. Session board draft modal: ✨ works the same; Esc during a run cancels it without closing
   the modal.
8. Settings → Chat → Improve prompt and How I write: change model, effort and instructions;
   edit the profile and a glossary; Forget a project; Clear memory.
. The rewrite sweeps in left to right while the old draft breaks into particles; with reduced motion it just appears.
11. During a run, **Stop** in the strip and the stop square on ✨ both end it and keep your text.

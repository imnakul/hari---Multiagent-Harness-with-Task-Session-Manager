# Review — Interactive paste acceptance and turn duration

Branch: `nakul/windows-support-upstream-0.10.0`
Base: `757daab45a860d4f8fbcae717a0b855091d2414a`

## Goal

Keep a long Interactive composer message in one GUI turn when Claude represents
its pasted portion as `<pasted_content>`. Preserve the original prompt and its
start time through the real completion. This is a Medium fix on the latest
release; preserve the other agent's features. Prior unpublished runtime
experiments are saved outside the worktree and are not part of this fix.

## Plan

- Reproduce native paste wrapping with the real installed CLI and fake account.
- Recognize only a verified equivalent of our exact typed/pasted payload; reject
  different text, omitted content, arbitrary markup and uncertain submissions.
- Keep native acceptance on the existing pending turn, with one send and one
  acceptance. Do not create an external turn or change its start time.
- Exercise the real session reducer and completion to verify the displayed
  duration spans the original send through completion, not just paste acceptance.
- Cover long/Unicode/multiline prompts, literal wrapper-looking user content,
  genuine mismatches, successive turns and delayed transcript completion.

## Validation

Targeted protocol/adapter/session lifecycle tests; actual CLI loopback capture;
strict TypeScript, full web suite and production build. Native Windows checks
must distinguish this regression from the existing long-history fork and
supervised attachment failures. No new CLI flags, dependencies, installer or
version bump. Human desktop check remains separate.

## Progress

- [x] Fast-forward to the latest published release without overwriting its work.
- [x] Capture the long native prompt and reproduce duplicate/timing behavior.
- [x] Implement strict equivalent-prompt acceptance and lifecycle regressions.
- [x] Complete local gates and document limitations.
- [ ] Separate Windows regression and human desktop verification after publication.

## Evidence and limits

The screenshot supplies the exact `c` plus `<pasted_content id="faa9">` shape.
The old literal equality rejects it, failing the pending GUI turn and importing
an external turn. Matching now follows only the known transport's typed letter
and pasted pieces. Each expected body must match verbatim; user markup remains
data. Unknown shapes and genuinely changed input still fail closed.

The adapter/session regression delays acceptance, then the reply, and confirms
one send, one acceptance, one user block, one reply and the original start time
through completion. Both external-duration cases failed before the reducer fix;
completion now freezes only that turn's boundary and preserves concurrent local
work and already recorded durations.

Both real 2.1.301 loopback permission cases pass the longer multiline probe and
all existing native actions: 11 accepted ordinary prompts, 18 API / 16 primary
requests each, with two native helper requests and no terminal typing. This
fake-account CLI leaves the long hook prompt unwrapped, so it does not establish
the signed-in Windows wrapper behavior; deterministic tests cover the reported
wrapper independently. No subscription requests are made by this fixture.

Focused tests: 135 passed. Strict TypeScript, production web and host builds
pass. Full web: 6,921 passed / 627 files (two opt-in native cases skipped there and passed separately). Rust is unchanged. The new Windows
messages-only step checks acceptance, exact prompt equivalence, no external GUI
turn and no retries before the broad native actions run. Long-history fork
startup and supervised attachments after compact still fail on the release's
existing runtime (39045015840) and are not fixed or hidden by this change.

Already persisted duplicate bubbles/timing are not rewritten. Human follow-up:
rebuild/run the dev profile, send the reported long multiline prompt, verify
one user bubble and reply, then verify the duration includes the whole turn and
stays fixed after completion. Also check a real terminal-originated turn.

# Review — Interactive paste acceptance and turn duration

Branch: `nakul/windows-support-upstream-0.10.0`
Base: `757daab45a860d4f8fbcae717a0b855091d2414a`

## Follow-up — native ID-bearing closing tags (2026-10-17)

Base: `c4288b21`. A second screenshot shows the same duplicate turn with an
image attachment. Inspection of the installed CLI 2.1.301's native paste
formatter/parser confirms the actual closing tag is
`</pasted_content id="…">`, with the opening tag's same ID. The previous
fixtures used an unqualified closing tag, so their passing tests did not cover
this real native representation. This is a concrete gap independent of whether
the screenshot's installed build already includes the earlier fix.
The user subsequently confirmed this occurred after rebuilding from `8f36e078`;
the report is not attributed to an unchanged local2 installer.

Plan: accept matching-ID native closing tags while retaining the prior plain
closing representation. Require the exact typed/pasted body, including saved
attachment paths; reject changed content, truncated bodies and mismatched IDs.
Exercise the adapter and real session reducer with delayed acceptance, a
multi-stage reply and image/text attachment references. Verify one submission,
one acceptance, one original user boundary and full elapsed duration frozen at
completion. No resend, timer-only workaround, Rust, flags or installer changes.

- [x] Reproduce the native closing-tag mismatch with failing regressions.
- [x] Fix the matcher and verify attachment/timing lifecycle regressions.
- [x] Strict TypeScript, full web suite and production build.
- [x] Prepare publication on the authorized branch (this follow-up's commit).
- [ ] Human desktop rebuild/check.

Evidence: six native-format matcher cases and both native-format adapter cases
failed before the change. The corrected matcher passes them; an additional
text-file case and partial-reply snapshot keep attachments and the original
clock intact. All IDs must agree and every body/path must match exactly.
Diagnostics revision is `2026-10-17-native-paste-close-id` to distinguish a
rebuilt app from earlier installers without changing the release version.

The real local CLI's fake-account run retains its unwrapped fallback even with
the paste feature cached on; requiring a wrapped echo there failed because no
wrapped echo was generated. That test-only override was removed. Do not count
the fallback smoke test as proof of signed-in Windows wrapping. The concrete
native format comes from the installed 2.1.301 formatter/parser, with separate
failing-then-passing acceptance and reducer timing regressions. Human validation
must rebuild, send a new long message with an attachment and check one bubble
and full frozen duration; existing saved duplicate turns are not rewritten.

Final automated gates: 71 focused tests; 6,950 full web tests across 627 passing
files (one opt-in native file/two cases skipped); strict TypeScript and the
production build pass. Both opt-in local CLI cases pass separately in supervised
and Full access, including messages, resume, compact, attachments and background
continuation. The built JS contains the new diagnostics revision. No Windows
desktop or subscription-usage equivalence is claimed by those isolated checks.

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
- [x] Targeted native Windows regression after publication (2022/2025, both permissions).
- [ ] Separate human desktop verification.

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

## Publication

Source `8f36e07878108fa93afa138851ab70871ee79b21` is pushed on the authorized
branch and its exact remote SHA was verified. Native run `39049439898` passes
its separate long-paste/single-GUI-turn step on Windows 2022 and 2025, each in
supervised and Full access. The broad actions/diagnostic steps are still running
at this checkpoint; their older fork/attachment failures remain a separate
validation concern. No installer/version bump. The publication record changes
documentation only; the passing 6,921-test source and builds are unchanged.

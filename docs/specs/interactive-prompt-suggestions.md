# Review — Keep native prompt suggestions out of Interactive composer delivery

Branch: `nakul/windows-support-upstream-0.10.0`
Base: `82d12f2cce128a754a1f19a8e68621bea1d2a2b9`
Tier: Medium (launch setting and regression coverage, no new UI option).

## Goal and evidence

The user's screenshots show a faint suggested follow-up, "I started the bridge,
try again", after the native prompt. Diagnostics find the unique ConPTY frame
and prompt but fail `emptyDraft`; subsequent GUI messages never reach Claude.
The preceding MCP lookup's unavailable local bridge is a separate failure.
The screenshot also shows a configured Stop hook referencing a missing external
notification script; do not remove or replace the user's hooks to hide that.

The installed CLI 2.1.301 schema defines `promptSuggestionEnabled: false` as
disabling suggestions; its initialization checks this setting. Its actual
`--help` confirms `--settings <file-or-json>` for additional per-launch settings.
MonoCode already sends its HTTP hooks and Fast setting through this mechanism.

## Plan

- Include `promptSuggestionEnabled: false` in the existing Interactive launch
  settings. Scope it to this process, including resume/fork, without writing the
  user's CLI configuration or changing global defaults.
- Keep all readiness checks, including refusal of faint/undimmed real drafts,
  ownership, dialogs and framed prompts. Never auto-clear or submit terminal text.
- The local GUI owns composing; native automatic next-prompt suggestions should
  neither occupy its hidden input nor launch suggestion helpers.
- Update the isolated real-CLI fixture with the same setting and explicitly
  enable suggestions in its temporary user settings to exercise the override.
- Add the user's exact visible suggested text to draft-protection regressions;
  old processes that still contain it must continue to fail closed until restart.
- Update the diagnostics revision so a rebuilt process is identifiable.

## Files and risks

`src-tauri/src/claude_interactive.rs` (launch settings and Rust regression),
`claudeInteractive.ts` (diagnostic revision only), terminal and opt-in CLI tests,
L-82 and changelog records. No new dependencies, flags, permissions, credentials,
transcript/schema changes or installer/version bump. Existing real drafts are
not erased. A restart/rebuild is needed to apply the setting to existing owners;
the ordinary saved native session identity is retained for resume.

## Checklist

- [x] Verify the installed CLI's supported setting and launch argument.
- [x] Implement local launch override and preserve draft checks.
- [x] Targeted Rust/web regressions and isolated real CLI checks.
- [x] Strict TypeScript, full web suite, production build, cargo check and
      changed-file format; record existing workspace format exceptions below.
- [x] Prepare authorized-branch publication with evidence and limitations.
- [ ] Human rebuilt Windows check: after a reply, send another GUI message; it
      reaches the same native session with no suggestion/draft blocker. Separately
      verify a genuine terminal draft remains protected.

## Verification record

54 focused Interactive tests and nine Rust bridge tests pass. Both isolated
real-CLI cases pass with per-launch suppression while the temporary user's saved
`promptSuggestionEnabled: true` remains unchanged; native resume retains its
system/tool prefix. Strict TypeScript, production build and `cargo check` pass.
The changed Rust file passes rustfmt. Workspace `cargo fmt --check` still reports
the existing drift in `debug_inspector.rs` and `debug_inspector/tests.rs`; both
files are unchanged from the base commit and the same drift is recorded in the
local2 build notes.

The first full web run had one failure in the unchanged editor-navigation blur
test (FilePaneNavigation.test.ts); all nine tests in that file pass on isolated
rerun without edits. Do not modify that separate subsystem. The user also asked
about manual usage refresh during validation; a confirmed fresh-snapshot skip
is corrected in the same publication, documented in the all-accounts spec. Its
76 focused usage/cache/polling tests pass. The final combined full-suite rerun
passes: 6,950 tests / 627 files (two native opt-in cases skipped there and passed
separately). The editor blur test also passes in that full run with no edits to
its source or test. Final combined TypeScript and production build pass. Human
signed-in Windows verification remains separate; no installer/version bump.

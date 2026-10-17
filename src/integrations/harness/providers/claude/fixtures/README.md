`interactive-cli-2.1.301.json` contains raw VT captures (120 columns × 40 rows)
and native user/assistant message rows from a real Claude Code 2.1.301 process.
Keep carriage returns intact when regenerating these strings.

The process ran in a temporary, trusted Linux project with an isolated config,
a fake approved API key, and `ANTHROPIC_BASE_URL` pointing at a loopback server.
The local server returned one fixed Anthropic-compatible assistant response;
no external model was contacted. CLI arguments matched the interactive backend:
`--session-id`, `--model sonnet`, `--permission-mode default`, `--effort medium`,
and `--settings` containing the HTTP hook map and `fastMode: false`.

Startup displayed an undimmed `Try "fix typecheck errors"` placeholder. A single
bracket-pasted multiline message followed by Enter produced one UserPromptSubmit
hook, one Stop hook and one assistant transcript message. No HTTP SessionStart
hook arrived. Two local API requests occurred, including CLI startup activity.
The random paths/UUIDs refer only to that temporary fixture project.

Tests feed the captures through the actual xterm parser and native transcript
renderer. They prove these protocol cases, not the complete signed-in Tauri UI,
Windows ConPTY behavior, or subscription usage.

The second repair adds combined adapter/xterm/PTY tests because checking the screen
alone missed `CSI O` focus replies claiming chat ownership. Normal web tests run
those regressions without installing Claude or making requests.

The lifecycle regressions also use the production registry and Claude transport
router. A synthetic draft blocks sending, then a ten-minute fake-clock wait
checks that idle parking does not kill the recovery owner. Explicit Stop and
native exit retain metadata diagnostics, and Forget clears the report. The
synthetic draft tests delivery safety; it does not reproduce or explain the
automatic `c` reported with the signed-in Windows CLI.

For the opt-in real CLI test on Linux/macOS (Python 3 and an installed CLI required):

```sh
MONOCODE_INTERACTIVE_TEST_CLI="$(command -v claude)" npx vitest run src/integrations/harness/providers/claude/claudeInteractiveCli.test.ts
```

That test runs two chat turns, stops, and resumes the same native session for a
third turn in supervised and Full access modes. It uses the production frontend
adapter, xterm parser and PTY event subscription. `interactive-pty-host.py` only
supplies Unix PTY plumbing; the test substitutes desktop IPC and serves fake model
responses over loopback. Account data lives in a temporary directory with fixture
onboarding/trust/Full access already accepted. No real credentials or external
model requests are used, and no terminal view is mounted. This still does not
exercise Windows ConPTY, the native Rust command boundary or the signed-in GUI.

Windows opt-in runs set `MONOCODE_INTERACTIVE_TEST_PTY_HOST` to the executable
built from `scripts/interactive-pty-host/Cargo.toml`. That host reuses the vendored
ConPTY implementation, production managed-job spawn and timed output pump;
desktop IPC and the hook/transcript polling endpoint remain test plumbing.
The CLI still uses an isolated fake account and loopback API. Optional
`MONOCODE_INTERACTIVE_TEST_CAPTURE_DIR` saves only that fixture's VT stream,
readiness metadata and writes; never enable fixture capture on a real account.

Windows fixture roots use canonical long paths and both project-key spellings.
If the native CLI still asks for trust, test setup approves only the exact
temporary fixture folder in the recognized trust menu, after checking its selected
option. This is not application trust automation or a real-account test.

The temporary fork Windows workflow compares default DA1 replies, omitted DA1
replies, basic-conformance replies, Win32-encoded DA1 replies and Win32-encoded
runtime input on Windows 2022/2025. Those transformations
exist only in the opt-in Rust host (`MONOCODE_INTERACTIVE_TEST_DA1_EXPERIMENT`),
not in MonoCode. They are causal probes, not proposed product behavior. A failed
default run stays a failure; artifacts retain each case for diagnosis. The
workflow pins the user's CLI 2.1.302 and exercises two messages plus native resume
in both permission modes. It does not qualify a signed-in Tauri/WebView workflow
or subscription consumption. Once the defect is reproduced, remove experimental
variants and keep the production regression.

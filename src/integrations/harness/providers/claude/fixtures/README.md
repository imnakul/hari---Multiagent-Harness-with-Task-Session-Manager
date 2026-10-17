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

`interactive-conpty-2.1.302.json` contains real native Windows 2022 captures from
run `38995820658`. Default input has an unsolicited `C`; the empty screen came
from an experimental Win32-encoded runtime-input case. Both park the hidden VT
output cursor outside the input row. They test the framed-row guard, not a fixed
send: the experimental live run still failed, including a truncated prompt.

The temporary Windows workflow now compares unchanged startup replies, omitted
extra DSR, omitted focus, omission of both and Win32-encoded replies. The earlier
DA1 variants had no effect: no DA1 reply reached xterm on either runner. New
transformations exist only in the opt-in Rust host
(`MONOCODE_INTERACTIVE_TEST_INPUT_EXPERIMENT`), not MonoCode. Causal probes run
supervised mode only for speed; the permanent production regression must cover
both permission modes, two messages and native resume. A failed default stays a
failure, and artifacts retain its evidence. These checks do not qualify the
signed-in Tauri/WebView workflow or subscription consumption. Remove experimental
variants after diagnosis and keep the production regression.

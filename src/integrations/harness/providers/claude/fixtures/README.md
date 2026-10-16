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

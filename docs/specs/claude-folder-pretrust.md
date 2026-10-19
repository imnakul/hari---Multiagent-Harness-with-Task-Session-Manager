# Review — Pre-trust the chat folder before Claude Interactive starts (L-115)

Created 2026-10-19 11:57 IST. Amends L-114.

- **Goal:** a chat on an account or folder Claude has never seen stops at Claude's "Do you trust the files in this folder?" dialog. The GUI cannot answer it, so the first message (now on Claude's command line, L-114) waits behind it. After 45 s the user is told to open the native terminal. Orca never shows this dialog because it records the answer before launching Claude. We do the same.
- **User story:** As a MonoCode user, I want a new chat folder to work on the first send, so that I don't have to answer a dialog in a hidden terminal.
- **Behaviour (mirrors Orca `claude-folder-trust-file.ts`):**
  - Runs in `claude_interactive_start`, before the spawn, and only when the setting is on.
  - Config file: `<config dir>/.config.json` if it exists. Otherwise `<config dir or home>/.claude.json`, or `.claude-custom-oauth.json` when `CLAUDE_CODE_CUSTOM_OAUTH_URL` is set. The config dir is the account folder we pass as `CLAUDE_CONFIG_DIR`, else the inherited `CLAUDE_CONFIG_DIR`.
  - Sets `projects[<key>].hasTrustDialogAccepted = true`. There are two keys: the absolute folder path and its real path, both NFC, with `/` separators on Windows and no trailing separator.
  - Never creates the config file, and never rewrites a file that is unreadable, unparsable, has duplicate keys, or whose `projects` is not an object.
  - Already trusted (under either key) means no write.
  - Takes Claude's own lock (the `<file>.lock` directory) and never breaks it. A lock still held after about 0.6 s means skip.
  - Writes a temp file beside the config and renames it over the original.
  - Keeps every other key, its order and its formatting: only the touched objects are rebuilt, and other values are copied byte for byte.
  - Never fails the launch. Any miss means Claude asks as before, and the L-114 45 s message still applies.
- **Setting:** Settings → Experimentation → "Trust chat folders for Claude Interactive", on by default (as Orca's `agentWorkspaceTrustEnabled`). When it is off, Claude asks as usual.
- **Acceptance criteria (tests):**
  - missing file → no file created
  - unparsable file → untouched
  - `projects` not an object → untouched
  - held lock → untouched, and the lock is not removed
  - already trusted → no write
  - new key → added, with other fields, their order and the existing project entry fields kept
  - Windows key form
  - config-file resolution: legacy `.config.json`, `CLAUDE_CONFIG_DIR`, home, custom OAuth
  - the frontend sends `trustFolder` from the setting
- **States:** no UI states beyond the toggle. Trust is silent; a skip falls back to Claude's own dialog.
- **Out of scope:** Codex and other providers, Structured mode (it runs `claude -p`, which does not show the dialog), WSL and remote hosts, and removing trust.
- **Security note:** this answers a Claude security prompt for the user, for folders they chose to open a chat in. It is the same choice Orca makes by default, and the setting turns it off.
- **Desktop check (manual, not for an agent):** a new account's first Interactive chat in a new folder shows no trust dialog and answers the first message. With the setting off, the dialog appears as before.

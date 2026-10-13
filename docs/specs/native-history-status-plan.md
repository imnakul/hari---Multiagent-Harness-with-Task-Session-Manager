# Review — Native history status placement

- Branch/base: `nakul/windows-support-upstream-0.10.0`, `79cb6f4d`; preserve the uncommitted Debug Inspector and existing work.
- Goal: stop native history status looking like part of each new provider reply.
- User story: As a user continuing an imported chat, I want history coverage beside its loading controls so the latest assistant response remains the last transcript item.
- Root cause: both `historyBlocks` and `reconcileNativeHistory` manufacture a system notice; reconciliation appends it after all local/external turns on every render.
- Approach/files: remove manufactured notice blocks in `model/history.ts`; update `ui/useNativeHistory.ts` and its direct callers; show provider/coverage in the existing `SessionProviderStrip.tsx`, wired from `SessionPane.tsx`. Update model and strip regressions, L-81 and current changelog.
- Acceptance: Claude/Codex native blocks contain conversation content only; merged imported and local turns retain exact order and deduplication; adding a local reply leaves it last; one provider-specific status appears above the transcript even when all imported history is visible; incomplete coverage retains Show earlier; loading disables that action; errors/retry and RC stay intact.
- States: no history, full/partial ready history, loading older history, initial read error, older-chunk error. Existing narrow-layout truncation and keyboard buttons are reused.
- Risks: accidentally dropping the final imported item when removing the old divider; hiding source/coverage status when pagination ends. Tests cover both.
- Out of scope: provider execution, saved transcript mutation, native reads/paging/dedup rules, 0.8 backport, installer or publication.
- Open questions: none. Implement on the current requested branch; installed 0.8 remains unchanged.
- Verification: targeted history/strip/transcript/SessionPane suites, TypeScript, full web suite and production web build. No Rust changes or native UI automation. Human check: open an imported Claude/Codex chat, Show earlier, continue the chat and verify status stays above the transcript with no footer.
- Progress: source and primary review complete. Targeted history/strip suites: 44 passed. `npm run check:web`: TypeScript and 6,764 tests / 611 files passed. `npm run build`: passed with existing bundle-size/dynamic-import warnings. `git diff --check`: passed. Lint unavailable (no repository configuration/script). No Rust source changed for this fix; the separate Debug Inspector Rust gate remains blocked by Windows Application Control until resolved.
- Remaining: human desktop check above; no provider prompts or native UI automation performed. Source is uncommitted, with existing work preserved. Installed 0.8 is unchanged.

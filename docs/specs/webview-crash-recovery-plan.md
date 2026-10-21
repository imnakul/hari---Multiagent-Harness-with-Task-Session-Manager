# Review — WebView2 crash recovery and saved composer drafts (L-160)

Created 2026-10-21 16:47 IST. Tier: Medium. Windows only for the recovery; drafts on every platform.

## Goal

On Windows the MonoCode window sometimes goes blank and stays blank, and any unsent prompt is
lost. Evidence on Nakul's PC (21 Oct 2026):

- WebView2 crash dumps in `%LOCALAPPDATA%\com.monocode.desktop\EBWebView\Crashpad\reports`
  (20 Oct 11:15, 20:24; 21 Oct 11:22).
- Windows Application log: `msedgewebview2.exe` and `monocode.exe` faulting with exception
  `0xe0000008` (Chromium's out-of-memory code) on 20 Oct; one `0xc00000fd` (stack overflow)
  on 15 Oct.
- At the time of checking, only 7.6 GB of the 54 GB commit limit was free.

So the page process (the WebView2 renderer) runs out of memory and dies. WebView2 then shows
a blank page and nothing reloads it. Composer drafts live only in a JavaScript `Map`, so they
die with it.

The memory pressure itself is outside the app (the whole system is near its commit limit).
This change makes the crash recoverable; it does not find a renderer memory leak.

## User story

As a MonoCode user on Windows, when the page crashes I want the window to come back by
itself with my unsent prompt still in the composer, so a crash costs seconds, not work.

## Acceptance criteria

1. Typing in any chat composer saves the draft to `localStorage`
   (`monocode.composerDrafts.v1`) within ~400 ms; a reload or crash restores it when that
   chat's composer opens.
2. Sending (or clearing) the composer removes the saved draft.
3. Saved drafts are bounded: at most 50 chats (the most recently edited are kept) and
   100,000 characters each (longer drafts are not saved), and drafts older than 14 days are
   dropped on load. Malformed storage is
   ignored, never thrown.
4. Windows: when the WebView2 page process exits (`RENDER_PROCESS_EXITED`), the window
   reloads its page.
5. Reload is capped: at most 3 automatic reloads per window in 2 minutes; after that it only
   logs, so a page that crashes on load cannot loop forever.
6. Every WebView2 process failure is appended to `webview-crashes.log` in the app's data
   folder (time, window label, kind, exit code, what we did), and printed with `eprintln!`.
7. After an automatic reload the page shows a short notice: "MonoCode reloaded after its
   display crashed. Unsent text was kept." It dismisses on click or after 8 s.
8. macOS and Linux behaviour is unchanged apart from criteria 1–3 and 9.
9. Toggling Focus mode in or out keeps the text typed in a chat's composer. The hidden
   workspace composer never writes its older text over the visible one, and takes up the
   newer text when shown again.

## States

- Recovery notice: shown / dismissed. No loading or error state (it is a one-shot read).
- Draft restore: draft present / absent; storage unavailable (quota, disabled) falls back to
  memory only, silently.

## Plan and files

- `src/features/sessions/model/draftCache.ts`: hydrate `drafts` from storage at module load;
  debounced save after `setComposerDraft` / `clearComposerDraft`; flush on `pagehide`.
  Pure `parseStoredDrafts` / `serializeDrafts` helpers with the bounds above.
- `src/features/sessions/model/draftCache.test.ts`: round trip, bounds, age pruning,
  malformed input.
- `src-tauri/src/webview_recovery.rs` (new, `#[cfg(windows)]`): registers a
  `ProcessFailed` handler on each workspace window's `ICoreWebView2`; on page-process exit
  calls `Reload()` under the rate cap; logs every failure; keeps a per-window "recovered"
  flag for the notice. Pure `decide(kind, recent_reloads)` with unit tests.
- `src-tauri/src/window.rs`, `src-tauri/src/lib.rs`: install the handler where
  `prepare_windows_window` runs; register command `take_webview_recovery`.
- `src-tauri/Cargo.toml`: `webview2-com = "0.38"` under `cfg(windows)`. Already in the
  lockfile through Tauri/wry (same version), so no new code is downloaded.
- `src/app/shell/WebviewRecoveryNotice.tsx` (new) + one line in `App.tsx`.

## Out of scope

- Browser-process exit (`BROWSER_PROCESS_EXITED`): the whole WebView2 is gone and would need
  the window rebuilt. Logged only.
- `RENDER_PROCESS_UNRESPONSIVE`: may recover by itself; reloading could throw away a page
  that was only busy. Logged only.
- GPU process exit: WebView2 restarts it by itself. Logged only.
- `FRAME_RENDER_PROCESS_EXITED`: WebView2 reports it for iframes only; the page itself is
  still there. Logged only.
- Saving attachments and MCP tags of a draft (images can be large).
- Finding why the renderer uses so much memory (needs the dumps analysed).

## Risks

- `Reload()` after a crash loses in-memory UI state (open panels, scroll). Sessions and,
  now, drafts are on disk/storage, so the loss is cosmetic.
- An `0xe0000008` in `monocode.exe` itself (20 Oct 20:24) kills the whole app; this change
  cannot help that case.

## Desktop checklist (manual, not for an agent in MonoCode)

1. Type a prompt, don't send, press Ctrl+R (or reload from the debug inspector): the text
   comes back.
2. Send it: reload again, the composer is empty.
3. Kill the WebView2 renderer for the main window in Task Manager (the `msedgewebview2.exe`
   child with the largest memory, "renderer" in Details > command line): the window reloads
   within a few seconds, the notice shows, and the unsent text is back.
4. `%APPDATA%\com.monocode.desktop\webview-crashes.log` has a line for step 3.

# Draft — Activity Ask, hourly notes, phone activity, fixed layout; ClickUp attachments (L-395 to L-399)
- Tier: complex (async sync between phone and desktop, a new local table and columns, a scheduled background writer, a chat bound to a feature, multipart upload after create) · Snapshot: 75b93390, 2026-11-26
- One batch, five parts. Each part can ship on its own; build them in the order below.

## In plain words
- **ClickUp New task:** you can attach images and files with a paperclip, by pasting, or by dropping them on the form. They upload right after the task is created. The List, Assignees, Priority, Status and date fields use the app's glass look, not solid dark boxes.
- **Activity, Ask:** a new Ask tab in Activity opens a normal chat (the same composer, harness and model picker). You can ask things like "what did we do on 7 October?" or "how many meetings did I have last week?", and the agent reads your activity to answer. Past Ask chats are kept in Activity.
- **More notes:** an hour with computer use but no prompts now gets a short note too (apps, websites by domain, meetings).
- **Phone:** Hari reads your Android screen time (with your permission) and sends it to the PC. Activity gets source filters (MonoCode, Browser, Other apps, Phone). All are on except Phone.
- **Layout:** the Activity page fits the window. The header and the day strip stay put. The left sections fold and scroll on their own, and so does the log on the right.

## Goal and user stories
- As Nakul, I want to attach files when creating a ClickUp task, so I don't have to open ClickUp in the browser to add them.
- As Nakul, I want to ask questions about my past activity in plain words, using any harness, so I can recall what I did without scrolling the log.
- As Nakul, I want notes for the hours I worked outside MonoCode, so the log covers my whole day.
- As Nakul, I want my phone use in Activity, filterable by source, so I can see where my time went.
- As Nakul, I want the Activity page to fit the screen, with each area scrolling on its own, so I can read the log while keeping the overview in view.

## Scope
1. L-395 ClickUp New task attachments, plus glass controls in `ClickupTaskForm` (used by New task and the task edit panel).
2. L-396 Activity Ask: chat tab in Activity, the `activity.read` app CLI action, and Ask chat history.
3. L-397 Hourly notes for hours with desktop activity but no prompts.
4. L-398 Phone activity from Hari (Android usage access), stored on the desktop; Activity source filters.
5. L-399 Activity page fixed to the window height: fixed top, collapsible left sections that scroll in place, a log that scrolls in place.

## Out of scope
- iOS phone activity: Hari's native module is Android only.
- Reading ActivityWatch's Android app (aw-android) over the network.
- Notes written from phone activity. Phone data is shown, filtered and readable by Ask, but no AI notes are written from it.
- Attachments when editing an existing task. The task details panel already lists attachments; adding them there can come later.
- Suggestion chips inside the Ask chat; the session pane's own empty state is used.
- Ask chats in the normal Chats sidebar. They live in Activity only.
- Desktop or phone UI checks by the implementer: see Manual checks.

## Current behavior (confirmed in source at 75b93390)

### ClickUp
- `src/features/clickup/ui/ClickupTaskForm.tsx`:
  - The `FIELD` class (line 8) is `bg-content/[0.04] border-stroke`.
  - The List, Priority and Status `SearchableSelect`s (lines 49, 119, 133) use the default `variant="field"`, which is `bg-background-base` (`src/shared/ui/SearchableSelect.tsx:255`). That is the solid dark box in the screenshot.
  - `ClickupAssigneePicker.tsx:25` uses the same default.
  - The dates are native `<input type="date">` (lines 93, 103).
  - The form has no attachment UI.
- `src/features/clickup/ui/ClickupView.tsx:680-690` `create()` calls `clickupStore.createTask(listId, createInput(draft))` then `onClose()`. On a failure it shows `describeClickupError`.
- `src-tauri/src/clickup.rs`:
  - `request()` (line 125) sends JSON only, through `ureq` 2 (`Cargo.toml:40`, no multipart feature).
  - `clickup_create_task` is at line 620. Attachments are downloaded only (lines 671-860).
  - The token is read from the keychain in `with_token` (line 167).
- `src/shared/ui/DateTimePicker.tsx`:
  - A calendar plus time picker. Props are `value`, `onChange`, `minDate` and `autoFocus` (line 23).
  - It has no date-only mode.
- `src/features/sessions/model/attachments.ts` has `pickAttachments()` (429), `attachmentsFromFiles()` (454), `filesFromClipboard()` (388), `MAX_ATTACHMENTS = 20` and `MAX_EMBED_BYTES = 20 MB`. Each `Attachment` has a `path` (on disk) or `data` (base64).

### Activity
- `src/features/activity/ui/ActivityView.tsx` is one scroll container, `min-h-0 flex-1 overflow-y-auto … [container-type:size]`. It holds, in order:
  - PeriodNav;
  - StatTiles;
  - DayTimeline or DailyBars;
  - a grid `lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]` with Projects, Apps and Sites on the left and the log on the right, inside `MatchLeftColumn` (L-253).
- The page state is remembered in the module-level `remembered {anchor, scope, logFilter}`.
- `src/features/activity/ui/Breakdown.tsx`:
  - `Section` (line 5) renders a static `<header>` with no collapse.
  - `ProjectBreakdown`, `AppsBreakdown` and `SitesBreakdown` follow it.
- `src/features/activity/ui/useActivityData.ts` loads `log` (activity.db) and `aw` (ActivityWatch). It polls AW every 60 s for the current day and listens for `activity-changed`.
- `src/features/activity/ui/ActivityLogFeed.tsx:200` has `LogFilter = "all" | "notes"`.
- `src/features/activity/model/activity.ts` has `ActivityKind = "prompt" | "turn"` (19), `ActivityNote` (51), `ActivityLog` (59), `AwSummary` (66) and `buildLogItems` (465).
- `src-tauri/src/activity/store.rs:85-120` has these tables:
  - `activity_events`;
  - `activity_notes (id, ts, first_event_id, last_event_id, body)`;
  - `activity_summaries`.
- `last_noted_event_id` is `MAX(last_event_id)` (store.rs:280).
- `src-tauri/src/activity/agent.rs` is the notes worker:
  - It runs one thread (`worker`, 426) and wakes on `due_at` (408). That is the `kick` debounce of 4 s, capped by a 20 s batch wait.
  - `run_batch` (535) reads the unnoted events, calls `aw::summary` for app context, then `build_prompt` (870) and `run_agy` under `AGY_GATE` (594).
  - It writes `insert_note`.
  - Backoff is 30 s doubling up to 15 min. A missing `agy` or an auth error pauses the worker.
- `src-tauri/src/activity/aw.rs`:
  - `AwSummary` (103) holds `apps`, `sites`, `meetings` (`Meeting {start, end, label}`, where the label is a product name) and `active_ms`.
  - `pick_buckets` (242) prefers this PC's hostname.
- `src-tauri/src/activity/mod.rs` has the commands. `RANGE_MAX_MS` is 32 days.

### Chats, app CLI, Hari
- Embedding a full chat outside a tab has a precedent: Zen's Mono chat.
  - `App.tsx:6613` `onZenOpenMono` loads a session with `ensureOpenSession` (5771) behind a request counter.
  - `App.tsx:18337` passes `<SessionPane {...sessionPaneProps} session=… />` as the `chat` prop.
- `App.tsx:15450` `onNewChat`: `newDefaultSession("~")` → `ensureScratchChat(id)` → adds the session and a tab.
- App access:
  - `operatorAccess` is set at App.tsx:9597.
  - App context is pushed at App.tsx:10810. It holds the `<monocode_app>` block and the Whiteboard extra (L-394).
  - `appAccess: operatorAccess` is set at 10665.
  - `handleAgentApp(source, …)` (`agentApp.ts:1132`) receives the calling session.
  - Field lists are at agentApp.ts:299.
  - Action allowlist and help text are in `src-tauri/src/control_cli.rs` (`APP_ACTIONS`, `APP_USAGE`, test at 868).
  - Tool labels are in `monocodeToolCall.ts:36`.
- Chats list: `scratchChatSummaries` (`sessionHistory.ts:320`) lists every scratch-cwd chat.
- Hari:
  - The phone calls `command(method, params)`.
  - The desktop routes off-lock methods in `mobile_access.rs:805-830` and dispatches them at 925-945.
  - `mobile_phone_notifications.rs` (L-325) is the pattern for a phone-pushed feed: `handles(method)`, `handle(app, peer, params)`, and an emitted event.
  - On the phone, `mobile/src/features/phoneNotifications/PhoneNotificationsSync.tsx`:
    - sends on connect, on change (1.2 s delay) and on `AppState` active;
    - keeps preferences in `expo-sqlite/kv-store` (`preferences.ts`).
  - The native functions are in `HariLiveModule.kt`; `HariNotifications.kt` shows how to check access and open settings.

## Proposed behavior and invariants

### L-395 ClickUp attachments and glass controls
- **Glass controls in `ClickupTaskForm`:**
  - Every `SearchableSelect` there and in `ClickupAssigneePicker` uses `variant="transparent"`.
  - Start and Due dates become a glass trigger button (the same classes as the transparent select trigger) that opens a `Popover` holding `DateTimePicker`, with a new prop `mode="date"`.
  - The Name input and Description textarea keep their fields but use the same border and transparent background as the transparent variant: `border-content/10 bg-transparent hover:border-content/20 focus:border-content/25`.
- **`DateTimePicker` gets an optional `mode?: "datetime" | "date"` (default `"datetime"`):**
  - `"date"` hides the time row.
  - `value` stays `YYYY-MM-DDTHH:mm`. The caller converts `YYYY-MM-DD` with `T12:00`, and back with `slice(0, 10)`.
  - Existing callers are unchanged.
  - The trigger shows the date as `formatDayLabel`-style text (`26 Nov 2026`), or the placeholder "No date".
  - The popover has a "Clear" text button.
- **Attachments, New task only:**
  - A row under Description, labelled "Attachments", with a paperclip button "Attach files".
  - Paste (`filesFromClipboard`) and drop on the form panel also add files.
  - Each file shows as a chip: an image thumbnail (through `loadAttachmentPreviewUrl`) or a file icon, the name, the size, and an X to remove it.
- **Limits:**
  - At most 10 files, and at most 25 MB each.
  - When a limit is hit, nothing is added for the offending file and the form shows "Files must be 25 MB or smaller." or "Up to 10 files per task."
- **Upload after create:**
  - `create()` creates the task first.
  - Then it uploads the files one at a time, in order, through the new `clickup_upload_attachment` command.
  - The button shows "Uploading 2 of 3…".
  - On full success, the panel closes as today.
- **Partial failure:**
  - The task exists. The panel does not close.
  - The form becomes read-only and shows: "Task created. 1 of 3 files didn't upload." with the buttons "Retry failed" and "Close".
  - Retry re-uploads only the failed files to the same task id.
  - Close discards them.
- **Invariants:**
  - The task is never created twice (re-clicking Create while uploading or after a partial failure must not call `createTask`).
  - The token never leaves Rust.
  - Rust reads only files the user picked: paths come from the picker, drop or clipboard save. Rust also checks that the path is a regular file and at most 25 MB before reading.

### L-396 Activity Ask
- The ActivityView header gets a `SegmentedSwitch` with two options, "Activity" and "Ask". It is remembered in `remembered.mode`.
- **Ask mode** replaces everything under the header with:
  - **A thread bar:**
    - a `SearchableSelect` (`variant="transparent"`) of past Ask chats, newest first, labelled by title and the local date of creation (`Ask · 26 Nov`);
    - a "New chat" button (`Plus` icon);
    - a delete button for the selected chat (`Trash2`, confirm with the existing `Modal`: "Delete this Ask chat?").
  - **The chat:** `askChat`, a ReactNode prop from App, a `SessionPane` exactly like Zen's Mono chat (App.tsx:18341), with `monoComposerUsage` off.
- **An Ask chat is a normal scratch chat with three differences:**
  1. Its id is in the Ask registry (`activityAsk.ts`).
  2. It is hidden from the Chats sidebar (`scratchChatSummaries` skips registered ids).
  3. Every turn has app access restricted to `activity.*` actions, plus the `<monocode_activity>` context.
- **Opening Ask:**
  - Ask reopens the last open Ask chat (`lastOpenId`).
  - If there is none, or it no longer loads, it creates one.
  - Creation is lazy: switching to Ask with no chats creates one at that moment.
- **The `activity.read` app CLI action.** Input:
  - `start`, `end` (required). Each is ISO 8601 with offset, or a local `YYYY-MM-DD` or `YYYY-MM-DDTHH:mm`.
  - A local date as `end` means the end of that day.
  - `include` (optional): any of `notes`, `events`, `apps`, `sites`, `meetings`, `phone`. All by default.
- **`activity.read` validation:**
  - `start < end` and range ≤ 32 days (`RANGE_MAX_MS`).
  - Otherwise it fails with "Use a start before end, at most 32 days apart."
- **`activity.read` output:**

  ```
  {
    range: { start, end, timezone: "+05:30" },
    notes:    [{ time, kind: "prompts" | "hourly", text }],                // ≤ 200, oldest first
    events:   [{ time, kind, project, branch, harness, text }],            // ≤ 300, text ≤ 300 chars; omitted if range > 3 days unless asked
    apps:     [{ app, minutes }],                                          // top 30
    sites:    [{ domain, minutes }],                                       // top 30, domains only
    meetings: { count, totalMinutes, list: [{ start, end, label }] },
    phone:    { available, apps: [{ app, minutes }] },                     // top 30
    truncated: boolean
  }
  ```

  Times are local ISO strings with offset. ActivityWatch data comes from the existing `activity_watch_summary`. `available: false` is returned with a `note` when AW is off.
- **Who can call `activity.read`:**
  - Any thread with app access (Operator chats too).
  - An Ask chat can call only `activity.*`. Anything else fails with "This Activity chat can only read activity."
- **Context sent with each Ask turn (`activityAskContext(cli, now)`):**
  - the current local date and time with weekday and UTC offset;
  - how to resolve relative dates ("7 October" means the most recent 7 October not after today; "last week" means the previous Monday to Sunday);
  - the `activity.read` usage;
  - to answer from the data only and say when data is missing;
  - that times are local.
- **Invariants:**
  - An Ask chat never gets write actions.
  - Deleting an Ask chat removes it from the registry and deletes the session the same way the Chats row menu deletes one.
  - A session deleted elsewhere is pruned from the registry the next time it loads.

### L-397 Hourly notes
- A note is written for local hour `[H, H+1)` when all of these hold:
  - AI notes are on;
  - the hour has ended at least 2 minutes ago;
  - the hour has no `activity_events`;
  - ActivityWatch reports `active_ms ≥ 5 min` for the hour;
  - no hourly note exists for that hour.
- The prompt (`build_hourly_prompt`) gets:
  - the hour in local time;
  - top apps (≤ 10, minutes);
  - sites as domains only (≤ 10, minutes);
  - meetings (label, start to end);
  - the previous note body, for tone.
- It asks for one to three short sentences, the same as prompt notes. Window titles and tab titles are never sent.
- **Storage:** `activity_notes` gains:
  - `kind TEXT NOT NULL DEFAULT 'prompts'`;
  - `span_start INTEGER`;
  - `span_end INTEGER`;
  - a unique index on `(kind, span_start)`, where `kind = 'hourly'`.
- An hourly note has `first_event_id = last_event_id = 0`, so `last_noted_event_id` is unaffected, and `ts = span_end`.
- **Catch-up:** only hours within the last 6 hours are considered, oldest first, one per worker wake. Older missed hours are skipped for good.
- **Ordering:**
  - Prompt batches run before hourly notes. If both are due, the prompt batch runs first and the hourly check runs on the next wake.
  - All `agy` calls stay serialized by `AGY_GATE`.
- **Failures:**
  - A failed hourly run uses the existing backoff state.
  - A missing `agy` or an auth error pauses as today.
  - When ActivityWatch is unavailable, the hour is skipped without a note and without a failure.
- **The log** shows hourly notes like other notes, with a small "Hourly" tag in the note header (`text-[10.5px] text-content/40`).

### L-398 Phone activity and source filters

#### Phone (Hari, Android)
- **Native module.** A new `HariUsage.kt` with three functions, exposed in `HariLiveModule.kt`:
  - `usageAccess(): Boolean`. Checks `AppOpsManager.OPSTR_GET_USAGE_STATS`.
  - `openUsageAccess()`. Opens `Settings.ACTION_USAGE_ACCESS_SETTINGS`.
  - `usageIntervals(since: Double, until: Double): String`. Returns JSON `[{package, label, start, end}]`.
- **How `usageIntervals` works:**
  - It is built from `UsageStatsManager.queryEvents` foreground and background pairs (`ACTIVITY_RESUMED`/`ACTIVITY_PAUSED`).
  - It returns closed intervals only, at least 5 s long.
  - It skips Hari's own package and the launcher (the default home package).
  - Labels come from `PackageManager`.
- **Manifest:** `PACKAGE_USAGE_STATS` with `tools:ignore="ProtectedPermissions"`.
- **JS side:** `mobile/src/features/phoneUsage/PhoneUsageSync.tsx`, mounted next to `PhoneNotificationsSync` in `app/_layout.tsx`.
  - Preferences live in kv-store `hari.phoneUsage.enabled` (default false) and `hari.phoneUsage.deviceId` (a random UUID, made once).
  - It syncs on connect, on `AppState` active, and every 15 minutes while active.
- **Sync step:**
  1. `command("phone.usageCursor", {device})` returns `{since: number | null}`.
  2. It calls `usageIntervals(max(since ?? now-7d, now-7d), now)`.
  3. It sends `command("phone.usage", {device, name: <device model name>, intervals})` in chunks of 500.
  4. It stops on the first error and retries on the next trigger.
- **Settings UI:** the Settings screen that holds the phone-notifications switch gets "Share screen time with PC".
  - Turning it on without access opens usage access settings.
  - The explanation reads "Sends which apps you used and for how long. App names and times only, nothing inside apps."
  - When access is missing, the row shows "Usage access is off. Turn it on" as a link that calls `openUsageAccess()`.
- **Desktop.** New `src-tauri/src/mobile_phone_usage.rs` handles `phone.usageCursor` and `phone.usage`, off the lock. They are routed like `mobile_phone_notifications` in `mobile_access.rs`, both places.
- **Validation:**
  - `device` matches `^[A-Za-z0-9-]{8,64}$`.
  - `name` is at most 80 characters.
  - At most 500 intervals per call.
  - Each interval has `package` ≤ 200 chars matching `^[A-Za-z0-9._]+$`, `label` ≤ 120 chars, `0 < start < end ≤ now + 5 min`, and `end - start ≤ 24 h`.
  - A bad item is skipped and the rest are stored.
- **Storage:**
  - `activity.db` table `phone_usage (device TEXT, package TEXT, label TEXT, start INTEGER, end INTEGER, PRIMARY KEY (device, package, start))`, written with `INSERT … ON CONFLICT DO UPDATE SET end = excluded.end, label = excluded.label`.
  - `phone_devices (device TEXT PRIMARY KEY, name TEXT, last_sync INTEGER)`.
  - Rows older than 400 days are deleted on each `phone.usage` call.
- **Cursor:** `phone.usageCursor` returns `MAX(end)` for the device, minus 10 minutes (overlap is harmless thanks to the upsert), or null.
- **After storing,** the desktop emits `activity-changed`.
- **New command `activity_phone_summary(start, end)`:**
  - returns `{available: boolean, devices: [{device, name, lastSync}], apps: [{app, ms}], activeSpans: [Span]}`;
  - intervals are clipped to the range and summed per label across devices;
  - `available` is false when no device has ever synced.

#### Source filters
- **A row of four toggle chips** at the end of the PeriodNav row: "MonoCode", "Browser", "Other apps", "Phone".
  - Use `SegmentedSwitch`'s chip look if it supports multi-select. Otherwise use plain `<button aria-pressed>` with the same classes as `SegmentedSwitch` items.
  - The default is the first three on and Phone off. The choice is saved in localStorage `monocode.activity.sources.v1`.
  - At least one must stay on: turning off the last one does nothing.
- **What each source controls:**

  | Source | Shows |
  |---|---|
  | MonoCode | Projects section; prompt, turn and prompt-note log items; agent stat tiles; agent spans in the timeline |
  | Browser | Sites section; browser apps in the Apps section and its totals (browser = app name matches `chrome`, `msedge`, `firefox`, `brave`, `opera`, `vivaldi`, `arc`, `zen`, `chromium`, case-insensitive, without `.exe`) |
  | Other apps | Apps section rows that are not browsers; meetings; hourly notes |
  | Phone | A fourth left section "Phone" (top apps, synced device and last sync time); a phone lane in DayTimeline; phone time in the Active stat when on |

- Hourly notes show when Browser or Other apps is on.
- Phone data loads only while Phone is on: a `phone` slice in `useActivityData` with the same `Loadable` pattern and the same generation guard.

### L-399 Fixed layout
- **The ActivityView body becomes a flex column filling the view** (`flex min-h-0 flex-1 flex-col`), not one scroller:
  - Fixed top (`shrink-0`): header, PeriodNav with source chips, StatTiles, and DayTimeline or DailyBars.
  - The rest (`min-h-0 flex-1`) is the two-column grid. Each column scrolls on its own (`min-h-0 overflow-y-auto overscroll-contain`).
  - `MatchLeftColumn` is no longer used on this page; the grid row takes the remaining height.
- **Left column:** Projects, Apps, Sites (and Phone when on), each collapsible.
  - The `Section` header becomes a `<button aria-expanded>` with a `ChevronRight` that rotates 90° (transform, 150 ms, reduced motion respected).
  - The body opens and closes with `RevealHeight` from `src/shared/ui`.
  - The collapsed state is saved per section in localStorage `monocode.activity.collapsed.v1` (`{projects, apps, sites, phone}`, default all open).
  - Collapsed sections keep their header with the total in `aside`.
- **Right column:** the log feed scrolls in place. Its filter row (`LogFilter`) is sticky at the top of that column (`sticky top-0` with the glass backdrop the page already uses for headers).
- **Below `lg`** (one column): only the fixed top stays fixed, and the single column below scrolls as one. Fixed panes would be too short on a small window.
- **Week and month** use the same layout, with DailyBars in the fixed top.

## States and transitions

| Area | State | Event | Next | User sees |
|---|---|---|---|---|
| ClickUp create | editing | Create | creating | button "Creating…", form disabled |
| | creating | task created, 0 files | done | panel closes |
| | creating | task created, n files | uploading(i) | "Uploading i of n…" |
| | uploading | all ok | done | panel closes, task in list |
| | uploading | some failed | partial | "Task created. k of n files didn't upload." Retry failed / Close |
| | partial | Retry failed | uploading(failed only) | as above |
| | creating | create failed | editing | error text as today; files kept |
| Ask | none | switch to Ask | creating chat | thread bar disabled, pane shows a centred spinner |
| | creating chat | session ready | open | chat pane |
| | creating chat | failed | error | "Couldn't start an Ask chat." + Retry |
| | open | pick another thread | loading | old pane stays until the new one loads (request counter) |
| | open | delete confirmed | open (newest remaining) or none | |
| Hourly note | idle | hour ended + 2 min, eligible | writing | agent pill "Writing notes" (existing) |
| | writing | ok | idle | note in log with "Hourly" |
| | writing | error | backoff | existing pill text |
| Phone sync (phone) | off | user turns on, no access | needs access | settings opens; row shows "Usage access is off" |
| | on | trigger | syncing → idle | nothing (silent) |
| | syncing | error | idle | retried next trigger; no toast |
| Phone (desktop) | Phone filter on | never synced | empty | Phone section: "No phone data yet. Turn on Share screen time in Hari." |
| Layout | section open | header click | collapsed | body folds, chevron turns, state saved |

## Acceptance criteria
- **AC-1** Given New task is open, when I pick 2 files with the paperclip, paste 1 image and drop 1 file, then 4 chips show with names and sizes, and the image chips show thumbnails.
- **AC-2** Given 10 files are added, when I add another, then it is not added and "Up to 10 files per task." shows. A 26 MB file is refused with "Files must be 25 MB or smaller."
- **AC-3** Given 3 files are added, when I click Create, then `createTask` is called once, then `clickup_upload_attachment` is called 3 times in order with the new task id, and the panel closes after the third succeeds.
- **AC-4** Given the second of 3 uploads fails, then the panel stays open with "Task created. 1 of 3 files didn't upload." When I click Retry failed, only that file is uploaded, to the same task id, and `createTask` is not called again.
- **AC-5** Given the New task panel or task edit form, then List, Assignees, Priority and Status use the transparent variant, and Start and Due open the date-only picker in a Popover. Picking 26 Nov stores `2026-11-26` in the draft. Clear empties it.
- **AC-6** Given Activity, when I click Ask, then a chat pane with the standard composer and harness picker shows. Asking "what did we do on 7 October" makes the agent run `app activity.read` with a 7 October range, and the chat shows the "Read activity" tool row.
- **AC-7** Given an Ask chat, when its agent runs `app sessions.list` (or any non-`activity.*` action), then it fails with "This Activity chat can only read activity."
- **AC-8** Given an Ask chat exists, then it is not listed in the Chats sidebar. It is listed in the Ask thread picker, and after an app restart Ask reopens it.
- **AC-9** Given `activity.read` with `start` after `end`, or a 40-day range, then it fails with "Use a start before end, at most 32 days apart." Given a 7-day range without `include`, then `events` is omitted and the other keys are present.
- **AC-10** Given AI notes are on, and the hour 14:00 to 15:00 had 30 minutes of ActivityWatch activity and no prompts, then by 15:03 one note with kind `hourly`, `span_start` 14:00 and `span_end` 15:00 exists. It is never written twice, also after a restart.
- **AC-11** Given the hour had a prompt, or under 5 minutes of activity, or AW was off, then no hourly note is written and the agent status is not an error.
- **AC-12** Given a prompt batch and an hourly note are both due, then the prompt note is written first, and two `agy` processes never run at once.
- **AC-13** Given an `activity_notes` table from before this change, when the app starts, then the columns are added. Existing notes read as kind `prompts`, and prompt-note batching continues from the same `last_noted_event_id`.
- **AC-14** Given Hari with usage access and the switch on, when it connects to the PC, then intervals from the cursor (or the last 7 days) reach the desktop. Sending the same intervals twice stores each once.
- **AC-15** Given `phone.usage` with one bad interval (end before start) among 10, then 9 are stored, and the reply is `{stored: 9, skipped: 1}`.
- **AC-16** Given Activity with default filters, then Phone is off and no phone call is made. Turning Phone on shows the Phone section and lane. The choice survives a restart.
- **AC-17** Given only Browser is on, then Projects and the prompt log items are hidden, the Apps section lists only browsers, and Sites shows. Turning off the last chip leaves it on.
- **AC-18** Given a lg-width window, then the header, PeriodNav, StatTiles and timeline do not move when the log is scrolled. The left column scrolls on its own. Collapsing Apps hides its body, and that survives a restart.
- **AC-19** Given a window below `lg`, then the top part stays fixed and the single column below scrolls.

## Ordering contracts

### ClickUp create with attachments (`ClickupView` New task)
1. `create()`:
   1. Return if the phase is not `editing`.
   2. Set phase `creating`.
   3. Validate the draft as today.
   4. `const task = await clickupStore.createTask(listId, createInput(draft))`.
   5. Store `createdTaskId = task.id` in component state before any upload.
2. Uploads:
   1. For each pending file in order, set phase `uploading(i)` and `await clickupApi.uploadAttachment(createdTaskId, file)`.
   2. Mark each file `done` or `failed` (keep the error text for the title attribute). Do not stop on a failure.
3. Done:
   - If no file failed, revoke preview URLs, then `onClose()`.
   - Otherwise set phase `partial`.
4. Retry: set phase `uploading` and run step 2 over the files marked `failed` only, with the same `createdTaskId`.
5. Unmount while uploading:
   - An `aliveRef` stops state updates.
   - Uploads already in flight finish in Rust; the rest are not started.
   - Preview URLs are revoked on unmount.
6. The store refresh that `createTask` already triggers is not repeated per upload. One `clickupStore` refresh of that task (`clickupApi.task(id)` into the store, the same call the details panel uses) runs after the last upload, success or partial.

### Rust upload (`clickup_upload_attachment(task_id, path?, data?, name, mime)`)
1. Check `task_id` with `checked_id`.
2. Require exactly one of `path` or `data`.
3. For a path: `metadata` must be a file of at most 25 MB; then read the bytes.
4. For data: base64-decode, and the result must be at most 25 MB.
5. Clean `name`: strip path separators and control characters, keep at most 200 chars, default `attachment`.
6. Build the multipart body by hand (no new crate):
   - a random boundary;
   - one part `name="attachment"; filename="<clean name>"` with `Content-Type: <mime or application/octet-stream>`.
7. Inside `run_blocking` + `with_token`, `POST /task/{id}/attachment` with `Content-Type: multipart/form-data; boundary=…`, a 120 s timeout and `send_bytes`.
8. Map errors through the same `error_for_status`.
9. Return `{id, title}`.
10. Nothing is retried automatically, because a POST is not idempotent.

### Ask chat lifecycle (App + ActivityView)
1. ActivityView calls `onAskOpen(id?)`, where `id` is the picked chat, or `lastOpenId`, or undefined for a new one.
2. App:
   1. `const request = ++askRequest.current`.
   2. If `id` is set: `session = await ensureOpenSession(id)`. If null, prune `id` from the registry and fall through to create.
   3. Create: `draft = newDefaultSession("~")`, `cwd = await ensureScratchChat(draft.id)`, `registerAskSession(draft.id)` before adding the session (so the Chats list never flashes it), then add the session to `sessionsRef`/`setSessions` the way `onZenOpenMono` does. No tab is added.
   4. If `request !== askRequest.current`, stop. A newer pick won. A session created by the stale request stays registered as an empty chat. It is pruned on the next load only if it has no user turn and is not the newest; `pruneAskRegistry` keeps at most one empty chat.
   5. `setAskSessionId(session.id)` and `saveLastOpen(session.id)`.
3. Submit path, App.tsx near 9597: `const activityAsk = isActivityAskSession(sessionId)`.
   - Include `activityAsk` in `operatorAccess`.
   - In the context block at 10810, when `activityAsk`, push `activityAskContext(cli, new Date())` instead of the general `<monocode_app>` block, so the agent is not told about actions it cannot use.
4. `handleAgentApp`:
   - First line after `fields()`: if `host.isActivityAsk?.(source.id)` and `!action.startsWith("activity.")`, throw.
   - Then `case "activity.read"` calls `host.activity.read(parseActivityReadInput(input, now, tzOffset))`.
5. Delete:
   1. Confirm.
   2. Unregister.
   3. Delete the session through the same function the Chats row menu calls (`onDelete` passed to `ChatPanel` in `Sidebar.tsx:3133`; find its App handler).
   4. Open the newest remaining chat, or none.

### Hourly notes in the worker (`agent.rs`)
1. `due_at` returns the earlier of:
   - the existing prompt-batch due time;
   - `next_hourly_check`, which is the next local hour boundary + 2 min, in the agent's `tz_offset_min`.
2. On wake, the worker:
   1. If unnoted events exist, runs `run_batch` (unchanged) and returns to the loop.
   2. Otherwise runs `run_hourly`:
      1. List candidate hours `[now_hour - 6h, now_hour)` with no hourly note (one query).
      2. For the oldest candidate, check `events in hour == 0`.
      3. Then call `aw::summary(hour_start, hour_end)`.
      4. If not available or `active_ms < 300_000`, insert nothing but record the hour as checked in memory (`checked_hours: HashSet<i64>`, cleared on restart) and move to the next candidate in the same wake.
      5. At most one `agy` call per wake.
3. Writing: `run_agy`, then `insert_hourly_note`. The insert uses `INSERT OR IGNORE`, so a duplicate after a race is dropped silently.
4. Backoff and pause reuse the existing `BatchOutcome` and error arms. `Wrote { more: true }` is returned when candidates remain, so the next one runs after the usual short wait.
5. `configure(enabled = false)` mid-run behaves as today: the note is still written, and the phase becomes Off.

### Phone sync
1. The phone sends nothing unless the switch is on and `usageAccess()` is true.
2. Only one sync runs at a time (`syncing` ref). A trigger during a sync sets `again = true`; one more sync runs after it.
3. Steps:
   1. cursor;
   2. query;
   3. chunked sends, in order.
   A failure stops the remaining chunks. The next sync re-reads the cursor, so nothing is lost, and the overlap is upserted.
4. Desktop:
   1. Validate.
   2. Upsert the intervals in one transaction.
   3. Upsert the device row.
   4. Prune rows older than 400 days.
   5. Commit, then emit `activity-changed`.
   The reply is sent after the commit.
5. Two phones use different `device` ids and never collide. One phone reinstalled gets a new id, and its old data stays under the old id.

## Implementation plan

### L-395
- `src/shared/ui/DateTimePicker.tsx`: add `mode` prop; hide the time row (around line 239) when `"date"`. No change for existing callers.
- `src/features/clickup/ui/ClickupDateField.tsx` (new): glass trigger + `Popover` + `DateTimePicker mode="date"` + Clear. Props `{label, value: string /*YYYY-MM-DD or ""*/, min?: string, disabled, onChange}`.
- `src/features/clickup/ui/ClickupTaskForm.tsx`:
  - Change `FIELD` and the textarea classes.
  - Set `variant="transparent"` on the three selects.
  - Replace the date inputs with `ClickupDateField`; keep the `dueBeforeStart` message.
  - Add optional props `attachments?: ClickupPendingFile[]`, `onAddFiles?`, `onRemoveFile?`, `attachmentError?: string | null`; render the Attachments row only when `onAddFiles` is given.
- `src/features/clickup/ui/ClickupAssigneePicker.tsx`: `variant="transparent"`.
- `src/features/clickup/ui/ClickupAttachmentChips.tsx` (new): the chips (thumbnail via `loadAttachmentPreviewUrl`/`holdAttachmentPreviewUrl`, `revokeAttachment` on remove).
- `src/features/clickup/model/clickupUpload.ts` (new, pure):
  - `addPendingFiles(current, incoming): {files, error}` applies the limits.
  - The upload loop `uploadAll(taskId, files, upload): Promise<ClickupPendingFile[]>` takes the uploader as a parameter so it can be tested.
- `src/features/clickup/model/clickupApi.ts`: `uploadAttachment(taskId, file: {path?, data?, name, mimeType})` → `call("clickup_upload_attachment", …)`.
- `src/features/clickup/ui/ClickupView.tsx` (New task panel, around lines 640-730):
  - Phase state (`editing | creating | uploading | partial`), `createdTaskId`, the files list.
  - The paperclip uses `pickAttachments()`. Paste and drop on the `<aside>` use `filesFromClipboard` and `attachmentsFromFiles`.
  - The flow follows the ordering contract above.
- `src-tauri/src/clickup.rs`:
  - `clickup_upload_attachment` and a pure `multipart_body(boundary, name, mime, bytes) -> Vec<u8>`.
  - A pure `clean_file_name`.
  - Register the command in `lib.rs`'s handler list next to `clickup_save_attachment`.

### L-396
- `src/features/activity/model/activityAsk.ts` (new): the registry in localStorage `monocode.activityAsk.v1` = `{ids: string[], lastOpenId: string | null}`, validated with Zod on load (bad data → empty). Functions:
  - `listAskSessions`
  - `registerAskSession`
  - `unregisterAskSession`
  - `isActivityAskSession`
  - `saveLastOpen`
  - `pruneAskRegistry(existingIds)`
  - `subscribeAsk` (for `useSyncExternalStore`)
- `src/features/activity/model/activityRead.ts` (new):
  - `parseActivityReadInput(input, now, tzOffsetMin)`;
  - `activityAskContext(cli, now)`;
  - `buildActivityReadResult(log, aw, phone, include, range)`, pure: caps, minutes rounding, domain only, local ISO times.
- `src/features/activity/model/activity.ts`: `loadPhoneSummary(range)` → `invoke("activity_phone_summary")`, with a Zod-validated result.
- `src/features/agent-app/model/agentApp.ts`:
  - FIELDS `["activity.read", ["start", "end", "include"]]`.
  - The `AgentAppHost` additions `isActivityAsk?(id)` and `activity?: { read(input): Promise<unknown> }`.
  - The guard and the case.
- `src/app/App.tsx`:
  - The host additions where the host is built.
  - `askSessionId` state, `onAskOpen`, `onAskDelete`.
  - The `activityAsk` flags in submit (9597, 10810).
  - Pass `askChat`, `askThreads`, `onAskOpen`, `onAskDelete` to `<ActivityView>` (18923).
  - Build `askChat` like 18341.
- `src/features/sessions/data/sessionHistory.ts:320`: skip `isActivityAskSession(id)`. Check other chat lists (Zen `zenChatSources`, recents) and skip there too.
- `src/features/sessions/model/monocodeToolCall.ts`: `"activity.read": "Read activity"`.
- `src-tauri/src/control_cli.rs`: add `activity.read` to `APP_ACTIONS`, a usage line in `APP_USAGE`, and a test like the one at 868.
- `src/features/activity/ui/ActivityView.tsx`: the mode switch, plus `ActivityAskPanel.tsx` (new) holding the thread bar and the `askChat` slot.

### L-397
- `src-tauri/src/activity/store.rs`:
  - `migrate_notes_columns(conn)` is called from `ensure_activity_tables`. It checks `PRAGMA table_info(activity_notes)` before each `ALTER TABLE … ADD COLUMN`, then `CREATE UNIQUE INDEX IF NOT EXISTS activity_notes_hourly_idx ON activity_notes(kind, span_start) WHERE kind = 'hourly'`.
  - `ActivityNote` gains `kind: String` and `span_start`/`span_end: Option<i64>`, and `read_note` and the note queries are updated.
  - New functions: `insert_hourly_note`, `hourly_note_starts(conn, from, to) -> Vec<i64>`, `count_events(conn, start, end)`.
- `src-tauri/src/activity/agent.rs`:
  - `next_hourly_check(now_ms, tz) -> i64` (pure).
  - `hour_candidates(now_ms, tz, existing, checked) -> Vec<i64>` (pure).
  - `build_hourly_prompt(hour_start, aw, previous, tz)` (pure).
  - `run_hourly`.
  - `due_at` and the worker branch.
  - The notes switch also controls hourly notes.
- `src/features/activity/model/activity.ts`: `ActivityNote` gains `kind`, `spanStart` and `spanEnd`. `ActivityLogFeed.tsx` shows the "Hourly" tag.

### L-398
- **Phone:**
  - `mobile/modules/hari-live/android/.../HariUsage.kt` (new) and its functions in `HariLiveModule.kt`, plus the TS module typing next to the existing ones.
  - `AndroidManifest.xml` gets the permission.
  - `mobile/src/features/phoneUsage/{PhoneUsageSync.tsx, preferences.ts, usageModel.ts}` (new). `usageModel.ts` is pure: chunking and interval validation.
  - `app/_layout.tsx` mounts the sync.
  - The Settings row goes in the same screen file as the notifications switch (find it by the `phone.notifications` preference import).
- **Desktop:**
  - `src-tauri/src/mobile_phone_usage.rs` (new): `handles`, `handle`, and pure `validate_intervals`.
  - `mobile_access.rs`: both routing places.
  - `activity/store.rs`: the tables, `upsert_phone_usage`, `phone_cursor`, `phone_summary(start, end)` (clip and sum, pure over rows).
  - `activity/mod.rs`: the `activity_phone_summary` command.
  - `lib.rs`: register it.
- **Desktop UI:**
  - `src/features/activity/model/sources.ts` (new): `ActivitySource`, `loadSources`/`saveSources`, `isBrowserApp(name)`, `filterAw(aw, sources)`, `filterLog(items, sources)`.
  - `useActivityData.ts` gets the `phone` slice, and `PhoneBreakdown` goes in `Breakdown.tsx`.
  - `DayTimeline.tsx` gets the phone lane.
  - `StatTiles.tsx` gets the sources passed in.
  - `PeriodNav.tsx` (or ActivityView) gets the chips.

### L-399
- `src/features/activity/ui/ActivityView.tsx`: restructure as described above, and drop `MatchLeftColumn` from this page only (it may be used elsewhere; leave its file).
- `src/features/activity/ui/Breakdown.tsx`: the `Section` collapse with `RevealHeight`, plus `collapsed` and `onToggle` props.
- `src/features/activity/model/sources.ts` or a small `layoutPrefs.ts`: the collapsed state.

## UI details
- **Exact copy:**
  - "Attachments"
  - "Attach files"
  - "Up to 10 files per task."
  - "Files must be 25 MB or smaller."
  - "Uploading {i} of {n}…"
  - "Task created. {k} of {n} files didn't upload."
  - "Retry failed"
  - "Close"
  - "No date"
  - "Clear"
  - "Activity" and "Ask"
  - "New chat"
  - "Delete this Ask chat?"
  - "Couldn't start an Ask chat."
  - "Retry"
  - "Hourly"
  - "MonoCode", "Browser", "Other apps", "Phone"
  - "No phone data yet. Turn on Share screen time in Hari."
  - "Last sync {relative time}"
  - On the phone: "Share screen time with PC", "Sends which apps you used and for how long. App names and times only, nothing inside apps.", "Usage access is off. Turn it on".
- **Components to reuse:**
  - `SearchableSelect`, `Popover`, `DateTimePicker`, `SegmentedSwitch`, `Modal`, `RevealHeight` and the icons (`Paperclip`, `X`, `Plus`, `Trash2`, `ChevronRight`, `Smartphone` or the closest phone icon in `icons.tsx`) from `src/shared/ui`.
  - On the phone, `mobile/src/ui` rows and switches like the notifications row.
- **Glass:** no new solid fills. The thread bar and the sticky log filter use the same translucent header treatment as the Activity header.
- **Motion:**
  - Chips enter with the existing `zen-step-in`.
  - The chevron rotates and the section reveals (transform/opacity).
  - Buttons press with `active:scale-[0.97]`.
  - All of it respects reduced motion.
- **Accessibility:**
  - The chips are `aria-pressed` buttons in a `role="group"` with `aria-label="Sources"`.
  - Section headers are `aria-expanded` buttons controlling the body id.
  - The upload status is `role="status"`.

## Skills to load
`frontend-ui`, `api-integration` (ClickUp upload), `ai-integration` (Ask context, hourly prompt), `mobile-app` (Hari), `desktop-app` (Tauri commands), `testing`.

## Test matrix

| AC or risk | Level | File | Scenario |
|---|---|---|---|
| AC-1, AC-2 | unit | `src/features/clickup/model/clickupUpload.test.ts` | limits: 10 files, 25 MB, error text, order kept |
| AC-3, AC-4 | unit with deferred promises | same | `uploadAll` runs in order; one rejects → others still run; retry runs only failed; task id unchanged |
| AC-3, AC-4 at the action boundary | feature (React Testing Library, mocked `clickupApi`/store) | `src/features/clickup/ui/ClickupNewTask.test.tsx` | Create → createTask once → uploads → close; partial → banner → Retry → no second createTask; double-click Create creates once |
| multipart format, name cleaning | Rust unit | `clickup.rs` tests | body has boundary, filename, content type, bytes; `..\\a/b.png` → `b.png`; over 25 MB refused |
| AC-5 | unit | `src/shared/ui/DateTimePicker.test.tsx` (add) and `ClickupDateField.test.tsx` | `mode="date"` hides the time; pick → `YYYY-MM-DD`; Clear → "" |
| AC-6, AC-9 | unit | `src/features/activity/model/activityRead.test.ts` | parsing ISO and local dates; end-of-day; 40-day refused; include default; events omitted over 3 days; caps; domains only |
| AC-7 | unit | `src/features/agent-app/model/agentApp.test.ts` (add) | Ask session + `sessions.list` → error text; `activity.read` → host called |
| AC-8 | unit | `src/features/activity/model/activityAsk.test.ts`, `sessionHistory.test.ts` (add) | register/prune/lastOpen; bad storage → empty; registered ids not in scratch list |
| Ask stale open | unit | `activityAsk.test.ts` or an App-level helper test | two `onAskOpen` calls, first resolves last → second wins |
| `activity.read` app-only | Rust unit | `control_cli.rs` | `app_mode_exposes_activity_read` |
| AC-10 to AC-12 | Rust unit | `activity/agent.rs` tests | `next_hourly_check` across hour and day boundaries with +05:30; `hour_candidates` skips existing/checked/older than 6 h; prompt events first; `build_hourly_prompt` has domains, no titles |
| AC-10 uniqueness | Rust unit | `activity/store.rs` tests | `insert_hourly_note` twice → one row |
| AC-13 | Rust unit | `store.rs` tests | old schema in memory → `ensure_activity_tables` → columns present, old notes kind `prompts`, `last_noted_event_id` unchanged |
| AC-14, AC-15 | Rust unit | `mobile_phone_usage.rs` tests | validation skips bad item; upsert idempotent; cursor = max end − 10 min; prune 400 days |
| phone summary | Rust unit | `store.rs` tests | clip to range; sum across devices; `available` false with no device |
| phone chunking | unit | `mobile/src/features/phoneUsage/usageModel.test.ts` | 1,200 intervals → 3 chunks in order; a failure stops later chunks |
| AC-16, AC-17 | unit | `src/features/activity/model/sources.test.ts` | defaults; last one stays on; `isBrowserApp`; `filterAw`; `filterLog` (hourly notes need Browser or Other apps) |
| AC-18 collapse persistence | unit | `sources.test.ts` or `layoutPrefs.test.ts` | toggle saved, bad storage → all open |

## Verification
- **The implementer runs:**
  - `npx tsc --noEmit -p .`
  - `npx vitest run src/features/clickup src/features/activity src/features/agent-app src/features/sessions/data src/shared/ui/DateTimePicker.test.tsx`
  - in `mobile`: its typecheck script and `npx vitest run src/features/phoneUsage`
  - in `src-tauri`: `cargo test --lib clickup`, `cargo test --lib activity`, `cargo test --lib mobile_phone_usage`, `cargo test --lib control_cli`
  - ESLint is broken in this repo. Say so rather than skipping silently.
- **Later full checks (not the implementer):** the full vitest suite, `npx vitest run src/platform/tauri/windowArgs.test.ts` (new commands take `tauri::Window` if they need a window, L-218), a desktop build, and a Hari Android build.

## Manual checks (Nakul; the implementer must not drive the desktop or the phone)
1. ClickUp, New task:
   - attach 2 images and 1 PDF by paperclip, paste and drop;
   - create;
   - the files appear on the task in ClickUp.
   Then turn Wi-Fi off after Create is clicked, to see the partial banner and Retry.
2. ClickUp, New task and the edit panel: all dropdowns and dates look glass over the wallpaper, and the date popover shows no time row.
3. Activity › Ask, with Claude, then Antigravity:
   - "What did we do on 7 October?"
   - "What was I doing around 5 pm on 9 October?"
   - "How many meetings did I have in the past week?"
   The answers match the log. Restart the app: the chat is still there and not in Chats.
4. Leave MonoCode idle but use the browser for an hour: a note tagged Hourly appears within a few minutes of the hour ending.
5. Hari:
   - turn on Share screen time;
   - grant usage access;
   - connect.
   On the PC, turn on the Phone chip: the Phone section and lane show today's phone apps.
6. Activity layout at full and narrow widths:
   - the top stays put;
   - each column scrolls on its own;
   - collapsing sections persists.
7. Unverified by automation: real ClickUp multipart acceptance, real Android UsageStats output on Nakul's phone, and the harness behaviour of each model with `activity.read`.

## Facts, decisions, assumptions

**Facts:** listed under Current behavior, verified at 75b93390.

**Decisions:**
- **Ask chats are real sessions,** embedded like Zen's Mono chat, so the composer, harness picker, attachments and history all come for free (the user picked "any harness + activity CLI").
- **Ask chats get read-only app access** (`activity.*`), because a model-triggered write would need confirmation.
- **Ask chats are hidden from Chats.** "History kept per Activity" was read as living in Activity.
- **`activity.read` returns domains only, never page or window titles.** This matches the L-240 privacy rule for what models see.
- **Upload after create,** because ClickUp's create endpoint takes no files. A partial failure keeps the task and offers Retry, never re-create.
- **Multipart is built by hand** in `clickup.rs`. No new dependency (`ureq` 2 has none built in).
- **Hourly notes:**
  - They use the existing `activity_notes` table with additive columns, not a new table, so the log and `activity.read` read one source.
  - Catch-up is limited to 6 hours to protect the `agy` quota.
- **Phone data:**
  - It is pulled by a desktop cursor, not a phone-side cursor, so several PCs and reinstalls stay consistent.
  - It is stored locally in `activity.db` for 400 days.
- **Browser detection** is a fixed app-name list. Other Chromium browsers fall under Other apps until added.
- **Narrow windows** use one scrolling column.

**Assumptions:**
- ClickUp accepts `POST /api/v2/task/{task_id}/attachment` multipart with the field `attachment`. This is from ClickUp's public API docs, not verified with a live call.
- Android's `UsageStatsManager` keeps about 7 to 10 days of events, so the first sync covers at most 7 days.
- `RevealHeight` animates height. The repo guide says to prefer transform/opacity, but this is the existing shared component for reveals, so reuse wins.
- **Schema change:** new columns on `activity_notes` and two new tables in the local `activity.db`. It is additive and local only, but still a schema change. Nakul approved the feature direction; this spec is the place to object.
- **DPDP note:** phone app usage is personal data about Nakul. It stays on his own phone and PC (local SQLite), and is sent to a model only when he asks in Ask, and then only app names and minutes. There are no third-party users, so no consent flow beyond the switch and the Android permission.

## Open questions
None blocking. Worth deciding later:
- Should Ask chats also appear in Chats under a folder?
- Should phone notes be written?
- Should attachments be added in the task edit panel?

### Raised by the implementer (not decided)
- ClickUp: does the real API accept the multipart upload (field `attachment`, auth header) as built? Only unit tests ran; no live call.
- Hari: does `UsageStatsManager.queryEvents` on a real phone give the same intervals (pairs, 5 s minimum, launcher skipped)? Only the TypeScript and Rust sides are tested.
- `activity.read`: does each harness (Claude, Antigravity, others) call it and answer correctly in Ask? Needs a real run.
- Hourly notes keep their "already checked" hours in memory, so a restart re-checks the last 6 hours (a note already written is never repeated: the table has a unique index).

## Suggested LOCAL-FEATURES rows
- L-395 ClickUp New task attachments (paperclip, paste, drop; upload after create with retry) and glass form controls.
- L-396 Activity Ask: chat tab with any harness, `activity.read` app CLI action, Ask chats kept in Activity.
- L-397 Hourly AI notes for hours with computer use but no prompts.
- L-398 Phone screen time from Hari (Android usage access) in Activity, with MonoCode, Browser, Other apps and Phone source filters.
- L-399 Activity page fits the window: fixed top, collapsible left sections and a log that scroll in place.

## Implementer report format
- Per AC (AC-1 to AC-19): done, partial or not done, with `file:line` or test name.
- Deviations from this spec, and why.
- Open questions hit.
- Checks run, with results (typecheck, vitest paths, mobile checks, cargo tests; ESLint status).
- Files changed.
- The LOCAL-FEATURES rows and changelog entry added.
- Do not commit or push unless Nakul asks.

## Handoff retro
- The spec was followed in order. Drift check: none (snapshot and HEAD were both 75b93390).
- Slow parts: the repo has no zod, so every boundary is narrowed by hand; Rust files are often CRLF, which broke plain text edits.
- The old `ActivityLogFeed.test.ts` case "scrolls a long log inside a fixed height" was rewritten, not weakened: L-399 moves scrolling from the list to its column, so it now asserts that and the sticky filter header.
- Worth adding to a next spec: name the test file extension (.ts vs .tsx) and say whether zod exists.
- Verifier (2026-11-26 14:56 IST): typecheck clean; vitest 32 files / 429 tests pass; cargo activity, mobile_phone_usage, clickup, control_cli 79 pass. Create-then-upload keeps the task id, retry skips done files; Ask chats are refused non-`activity.*` actions in `handleAgentApp`; hourly notes are unique by a partial index; the migration only adds columns. Rewritten log test is a real behaviour move, not a weakening.
- Verifier fixed: the Hari "Usage access is off. Turn it on" row (spec UI details) was missing; added in `mobile/src/app/settings/index.tsx`.
- Accepted deviations: Ask delete uses the native confirm, not `Modal`; the sticky log header is `bg-surface/60` with blur; week and month bars leave phone time out; hourly `checked_hours` is in memory, so when ActivityWatch is down at a wake, those hours wait for the next app start. No unit tests for `ActivityAskPanel` or the new ClickUp chips and date field UI.
- Spec gaps that caused these: the Hari note row was only in UI details, not in an AC; no AC named the Ask delete confirm; the spec did not say what happens to skipped hours when ActivityWatch comes back.

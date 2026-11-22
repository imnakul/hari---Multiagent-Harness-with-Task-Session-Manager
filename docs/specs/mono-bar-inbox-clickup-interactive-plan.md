# Review — Mono reply bar, Inbox tab, ClickUp panel, Interactive Mono sessions, Hari notifications — spec

- Tier: complex · Snapshot: `4382809e`, 2026-11-22 · Branch: `nakul/windows-support-upstream-0.16.0`
- Status lives in `docs/specs/SPECS.md` (Draft until Nakul approves).
- Six parts. They are independent and can be built in the order of the Implementation plan. Each part
  gets its own LOCAL-FEATURES row: L-379 to L-384 (next free IDs at the snapshot; check
  `grep -n "^| L-3[78]" docs/LOCAL-FEATURES.md` before using them).
- The checkout has uncommitted work (L-376 to L-378). Leave it as it is; don't commit anything.

## In plain words

- **Monos:** every reply in a Mono ends with its button bar, without hovering. It also separates one
  reply from the next. Today the bar never shows.
- **Inbox tab:** a Settings switch adds an Inbox tab next to Sessions, Explorer and Changes. It lists
  the GitHub pull requests and issues of the repository you picked in the repository dropdown.
  Clicking one opens it in the full Inbox.
- **ClickUp:** a new ClickUp page in the sidebar (desktop only) shows the tasks of Rigorup-active's
  three lists. You can add tasks, edit them, mark them done, and start a session or hand the task
  to a Mono. Agents can list, add and edit tasks too.
- **Interactive Monos:** Claude sessions a Mono starts run Interactive (the real Claude app inside
  MonoCode). Normal chats don't change.
- **Desktop banners:** a finished chat's banner reads "Hari-Desktop · <project>", then the reply,
  then "<model> · <account>".
- **Phone banners:** a switch in Share shows the phone's notifications as desktop banners titled
  "Hari-Phone · <app>". Codes stay hidden.

## Goal and user stories

| Part | User story |
|---|---|
| A. Mono reply bar (L-379) | As Nakul, I want every Mono reply to end with its actions, so I can act on any reply and see where one ends. |
| B. Inbox tab (L-380) | As Nakul, I want the GitHub PRs and issues of the repo I'm working in beside my files, so I don't leave the project to check them. |
| C. ClickUp panel (L-381) | As Nakul, I want to add, see, edit and finish Rigorup-active's ClickUp tasks in MonoCode and start work on them, and I want agents to add tasks directly. |
| D. Interactive Mono sessions (L-382) | As Nakul, I want every Claude session a Mono starts to run Interactive, without changing normal chats. |
| E. Hari-Desktop banners (L-383) | As Nakul, I want a chat's banner to tell me the project, the reply, the model and the account. |
| F. Hari-Phone banners (L-384) | As Nakul, I want my phone's notifications as desktop banners while I work, without codes or duplicates. |

## Scope

- A: the Mono action bar's visibility (CSS only, plus a test).
- B: a Settings switch, an Inbox tab in the classic layout's sidebar, a GitHub-only pane, and opening
  an item in the full Inbox.
- C: a Rust ClickUp client with the token in the OS keychain; a ClickUp app view and sidebar entry;
  setup, list, create, edit, mark done, reopen, start session, give to a Mono; four agent actions.
- D: one change in `sessions.start` for Mono callers, plus the Mono-facing help.
- E: a new banner text for desktop banners only.
- F: a switch, a banner planner with seeding and throttling, a click route to Share › Notifications.

## Out of scope

- A: "Ran for …" in the Mono bar (stays hidden there, see Open questions); second opinion, handoff
  and continue for Monos (upstream choice).
- B: the inset layout (its right panel has its own tab type); other Inbox sources (GitLab, Linear,
  Azure DevOps, ClickUp); changes to the full Inbox view beyond selecting a passed target.
- C: comments, time tracking, custom fields, subtasks, attachments, tags, other workspaces or
  projects, automations, Docs, Chat, webhooks, ClickUp on Hari (phone), MCP, a confirmation step for
  agent writes (Nakul's call: agents add tasks directly).
- D: Session Manager cards a Mono writes or starts (`session_manager.write`, `session_manager.start`
  keep the card's settings); the Mono's own chat (stays Structured); approval work.
- E: the bell (notification centre) and phone notification layout (`recordSessionNotification`);
  the Windows header line, which is the installed app's name and stays "MonoCode" until the app is
  renamed (Hari release pipeline spec).
- F: replacing an earlier banner when the same phone notification updates (the toast API in use has
  no tag; an update shows as a new banner, subject to the throttle); queueing while disconnected;
  macOS and Linux behaviour (not built on this fork, but don't break them).

## Current behavior

### A. Mono reply bar

- `AgentTranscript.tsx:1871` passes `revealOnHover={inlineWork}` to `TurnDuration`
  (`AgentTranscript.tsx:2177`). With it, the root gets the class `turn-actions-hover`
  (`AgentTranscript.tsx:2258`); the root carries `data-turn-actions`.
- `src/styles/index.css:1377–1380` keeps a 1.5rem gap under `.transcript-turn-mono`.
  `index.css:1382–1392` places `.turn-actions-hover` absolutely in that gap at `opacity: 0`.
  `index.css:1396–1403` shows it only for
  `.transcript-turn:hover:not(:has(…)) > .turn-actions-hover`, on `:focus-within`, or while one of its
  menus is open. `index.css:1406–1411` removes the transition for reduced motion (this rule also
  lists `.user-message-actions`).
- Root cause: `HistoryTurn.tsx:48–56` renders the turn's children through `createPortal(children,
  host)` into a host element with `display: contents` (`HistoryTurn.tsx:30`, `data-history-content`).
  The bar is a grandchild of `.transcript-turn`, so the child combinator `>` never matches. Evidence:
  the bar does appear on keyboard focus and with a menu open (the two rules without `>`), and never on
  hover. Upstream `ab5dee1a` added the hover rule; upstream `53777eff` added the portal host.
- `AgentTranscript.tsx:1877` `labelHidden={inlineWork && showFoldLine}` hides "Ran for …" in the
  Mono bar while the fold line above the work shows it. Unchanged.
- Tests: `src/features/sessions/ui/AgentTranscript.inlineWork.test.ts` (452–767) query
  `[data-turn-actions]` and read computed styles, so the stylesheet is loaded in these tests.

### B. Inbox tab

- `SidebarTabId = "files" | "sessions" | "changes" | "inbox"` (`src/features/settings/model/appearance.ts:238`);
  `DEFAULT_SIDEBAR_TAB_ORDER` includes `"inbox"` (`appearance.ts:240–245`); `isSidebarTabId` (~1866).
- `Sidebar.tsx:1139` `visibleTabs = tabOrder.filter((itemId) => itemId !== "inbox")` (upstream
  `c579af2e` removed the tab). `TAB_LABELS` (`Sidebar.tsx:334`) and `COMPACT_TAB_ICONS` (342) already
  have `inbox`. `workspaceTabItems` (~2438) maps `visibleTabs`; the compact rail (~4424) maps `tabs`.
- `paneTab` (`Sidebar.tsx:1271`). Panes render at ~2989 (files) and ~3034 (changes, `cwd={repoRoot}`).
  `repoRoot` (1291–1293) is the repo chosen in the L-377 dropdown, or the git root.
- `App.tsx:2680–2696` `setSidebarTab` maps `"inbox"` to `"sessions"`; `App.tsx:~16057` resets a
  stored `"inbox"` to `"sessions"`.
- `src/features/workspace/model/projectSidebarTab.ts`: `ProjectSidebarTab = Exclude<SidebarTabId,
  "inbox">`, key `monocode.projectSidebarTabs.v1`.
- `INSET_LAYOUT_DEFAULT = false` (`appearance.ts:281`): classic is the default.
- GitHub model (`src/features/inbox/model/githubTasks.ts`): `githubStatus()` (274) →
  `{connected, installed, authenticated}`; `githubRepo(cwd)` (288, cached per path, throws when the
  folder has no GitHub remote); `listGithubWorkItems(cwd, repo, {kind, assignedToMe, state, search})`
  (314); `GithubWorkItem` (59); `formatRelativeTime` (403).
- `InboxView` (`src/features/inbox/ui/InboxView.tsx:403`) takes `target?: LinkedWorkItem | null`
  (398). It seeds `selectedKey` from it (457–460), switches to the GitHub source when it changes
  (556–560), and fetches the item if it's not in the list (795–816). App mounts it at
  `App.tsx:18614` without a target. `onOpenInbox` is at `App.tsx:~15510`.
- `LinkedWorkItem = {kind: "issue" | "pr", repo, number, url}` (`src/features/sessions/model/session.ts:479`).
- Settings › Inbox page: `InboxPage` (`src/features/settings/ui/SettingsView.tsx:2638`); settings
  search index `SETTINGS_INDEX` (see the comment at ~648).

### C. ClickUp

- Nothing exists. Reference patterns:
  - HTTP: `ureq` 2.12 (`src-tauri/Cargo.toml:40`); `ureq::AgentBuilder::new().timeout(…)`
    (`src-tauri/src/linear.rs:328`); status error mapping in `src-tauri/src/azure_devops.rs:~1633`.
  - Keychain: `keyring` 3.6 (per platform, `Cargo.toml` 53/70/84); `keyring::Entry::new(…)` in
    `mobile_access.rs:140` and `codex_mono_store.rs:290–352` (`NoEntry` → none).
  - Command registration: `src-tauri/src/lib.rs:517` `tauri::generate_handler![`.
  - Sidebar nav entries: `Sidebar.tsx:~2925–2975` (`onOpenX && {label, icon, active, onClick}`;
    props ~458–470, destructured ~600).
  - App views: `App.tsx:~1797` (`activeAppView`), `src/features/workspace/model/appViewTabs.ts`
    (`APP_VIEW_LABELS`, `NEW_TAB_VIEW_ORDER`); each opener closes the other views
    (`setWhiteboardViewOpen(false)`, `setInboxViewOpen(false)`, …, e.g. `App.tsx:15510–15540`).
  - Agent actions: `src/features/agent-app/model/agentApp.ts` (`FIELDS` ~196–270, `AgentAppHost`
    ~111, `tasks.read` ~1643 uses `assertMonoProjectAccess`); CLI allowlist
    `APP_ACTIONS: [&str; 43]` and `APP_USAGE` in `src-tauri/src/control_cli.rs:84–135` (help
    examples ~159–250); labels in `src/features/sessions/model/monocodeToolCall.ts:28+`.
  - New sessions: `QuickLaunch` (`src/features/sessions/model/quickComposer.ts:54–76`),
    `acceptQuickLaunch` (`src/app/model/quickLaunchSession.ts:84`, `draft` handled at 110),
    `defaultSessionChoice(cwd)` (`session.ts:~724`).
  - Monos: `Mono` (`src/features/monos/model/mono.ts`; `sessionId?` 37, `projects` 43); App
    `onOpenMono` (`App.tsx:~6227`); the agent-app host `draft` (`App.tsx:~14775`) puts text in a
    session's composer.
- ClickUp API v2 (checked 2026-11-22, developer.clickup.com): personal token `pk_…` sent as
  `Authorization: <token>`; 100 requests per minute per token on Business; HTTP 429 with
  `X-RateLimit-Reset` (Unix seconds).

### D. Mono-started sessions

- `sessions.start` (`agentApp.ts:1456–1510`) calls `startLaunch` (`agentApp.ts:545–647`) and returns
  `{id, cwd, harness, model, submitted, draft, notifyOnComplete?}`.
- `startLaunch` rejects any `modelSettings` key that isn't in `model.settings` (589–599), so a Mono
  can't ask for `claudeExecution`. It merges the source's own `modelSettings` when harness and model
  match (630–635), so a Mono's own `claudeExecution: "structured"` can be inherited.
- `startLaunch` is also used by `session_manager.write` (`agentApp.ts:1268`); that path stays as is.
- Precedent: `useAsideLink.ts:231–241` launches Claude with `claudeExecution: "interactive"` in
  `modelSettings`; `acceptQuickLaunch` keeps it.
- `models.list` (`agentApp.ts:1355–1372`) returns `runtimeModes` and `harnesses`.
- Remote projects: `isRemoteProjectPath(path)` (`src/features/projects/model/recents.ts:397`).

### E. Desktop banners

- `notificationText(session, event)` (`src/features/notifications/model/notifications.ts:~170–211`):
  title `"MonoCode"`, subtitle the chat title, body the clipped reply / question / "Approve: …"
  (`BODY_MAX = 240`). Used by `notifyProjectSession` (~320–343) for the desktop banner and by
  `recordSessionNotification` (bell and phone, L-275).
- Windows: `show_with_app_id` (`src-tauri/src/notifications.rs:~640–675`) maps
  `title → title`, `subtitle → text1`, `body → text2`.
- `compactModelLabel(session)` and `sessionAccountLabel(session)`
  (`src/features/sessions/ui/useCompactModelLabels.ts:25–44`); the account label is null when the
  provider has fewer than two accounts.
- Project label as the Working panel shows it: `resolveTabGroupLabel(projectKey(cwd),
  loadTabGroupLabels(), projectName(cwd))` (`LiveAgentsPreview.tsx:157–159`).

### F. Phone notifications

- Rust `src-tauri/src/mobile_phone_notifications.rs`: the phone sends its whole list on every connect
  and change; the desktop emits `monocode-phone-notifications-changed`; commands
  `mobile_phone_notifications_list`, `_dismiss`, `_clear`.
- TS `src/features/mobile/model/phoneNotifications.ts`: `PHONE_NOTIFICATIONS_EVENT`, `PhoneNotice`
  `{key, package, app, title, text, postedAt}`, `PhoneNotices {receiving, stalled, paired, onPhone,
  earlier, icons}`, `parsePhoneNotices`, `looksLikeCode`, `maskCodes`.
- `notifications.rs:20–30` `handle_click` routes `reminder:` and `hari-share:` identifiers; others
  emit `monocode:notification-click`. `mobile_share.rs:371` `open_from_notification` emits
  `monocode-share-open` with no payload; App listens at `App.tsx:15758` and calls
  `setSharePanelOpen(true)` when the document has focus.
- Share panel: `SharePanel.tsx` (`ShareView = "share" | "notifications" | "files" | "settings"` at
  60, `useState<ShareView>("share")` at 242). Open state store: `src/features/mobile/model/shareView.ts`.
- Phone side: `HariNotifications.kt:97` already skips Hari's own package. Packages:
  `com.hardbeat920.monocodemobile` (Android), `com.hardbeat920.monocode-mobile` (iOS).

## Proposed behavior and invariants

- A1. Every settled Mono reply shows its bar at full opacity, without hover, in the existing 1.5rem
  gap. The gap doesn't change size when a turn finishes. Normal chats are unchanged.
- B1. The Inbox tab exists only when the switch is on and the layout is classic. With the switch off,
  behaviour is exactly as today.
- B2. The pane shows only GitHub items of `repoRoot`'s GitHub repo. A response for an earlier repo
  never shows under a later one.
- C1. The ClickUp token is stored only in the OS keychain (service `com.monocode.clickup`, account
  `personal-token`). No command returns it; it is never written to localStorage, logs, error
  messages, transcripts or agent results.
- C2. Only the lists configured in the panel are reachable, from the UI and from agents.
- C3. A save sends only the fields the user changed. A refresh never replaces a task with an older
  copy (compare `dateUpdated`).
- C4. One write per task at a time; a second click while saving does nothing.
- D1. A Claude session started by a Mono through `sessions.start` runs Interactive unless its
  project is remote. Every other start path is unchanged.
- E1. Only the desktop banner changes; the bell and phone entries keep `notificationText`.
- F1. No banner for: notices present when listening starts or the phone reconnects; Hari's own
  packages; notices while the switch or the global notification switch is off.
- F2. At most one banner per app package per 10 seconds.
- F3. A banner never shows a one-time code.

## States and transitions

### B. Inbox pane

| State | Event | Next | User sees |
|---|---|---|---|
| hidden | switch on (classic layout) | tab visible | Inbox tab between existing tabs, in `tabOrder` position |
| tab visible | switch off, or inset layout | hidden | tab gone; if it was selected, Sessions is selected |
| checking | `githubStatus` not connected | notConnected | "Connect GitHub to see pull requests and issues." + "Open Inbox" |
| checking | connected, `githubRepo` throws | noRepo | "This folder isn't a GitHub repository." |
| checking | remote project | unavailable | "GitHub isn't available for remote projects." |
| loading | both lists return, total 0 | empty | "Nothing open in <owner/name>." |
| loading | both return | ready | rows, newest update first |
| loading | either call fails, no cached rows | error | "Couldn't load GitHub items." + "Try again" |
| ready | refresh fails | ready + stale note | rows stay; line "Couldn't refresh." + "Try again" |
| any | `repoRoot` changes | checking/loading (or ready from cache) | the new repo's rows; old responses ignored |

### C. ClickUp view

| State | Event | Next | User sees |
|---|---|---|---|
| notConnected | Connect, token accepted | needsLists | Project and Lists step |
| notConnected | token rejected (401) | notConnected + error | "ClickUp didn't accept this token." |
| connecting | any | — | "Connecting…", button disabled |
| needsLists | list added and validated | ready (loading) | list tab appears |
| loading | tasks arrive | ready | rows |
| ready | list has no tasks | empty | "No open tasks in <list>." (or "No tasks in <list>." with Show done on) |
| any | 401 | notConnected | "Your ClickUp token stopped working. Connect again." |
| any | 429 | rateLimited | "ClickUp is busy. Try again in N s." refresh disabled with a countdown |
| any | network/server error | error | "Couldn't reach ClickUp." + "Try again" (rows stay if present) |
| list read-only | open detail / new task | readOnly | fields disabled, "You can view this list but not edit it." |
| editing | Save | saving | "Saving…", all actions disabled |
| saving | success | editing (clean) | fields show saved values, "Saved" for 2 s |
| saving | failure | editing (dirty) | error line under the buttons, edits kept |

### F. Phone banner planner

| State | Event | Next | Result |
|---|---|---|---|
| off | switch on | seeding | — |
| seeding | first list with `receiving: true` | live | all keys marked seen, no banners |
| live | list with new key or newer `postedAt` | live | banner, or folded if the package showed one < 10 s ago |
| live | list with `receiving: false` | seeding | — (seen map kept) |
| live | fold window ends with N folded | live | one banner (single notice, or "N new notifications") |
| any | switch off | off | pending folds dropped, timers cleared |

## Acceptance criteria

### A. Mono reply bar

- AC-A1. Given a Mono transcript (`inlineWork` true) with a settled reply, when it renders with no
  hover and no focus, then the reply's `[data-turn-actions]` element has computed `opacity` `1`.
- AC-A2. Given the same reply, then the bar is still `position: absolute` inside a
  `.transcript-turn-mono` with `padding-bottom: 1.5rem` (no layout change from today).
- AC-A3. Given a normal (non-Mono) transcript, then its bar has no `turn-actions-hover` class and
  renders as before (existing tests pass unchanged).
- AC-A4. Given a reply still streaming, then the existing rules that hide the footer while words fade
  still apply (the existing test at `AgentTranscript.inlineWork.test.ts:~486–513` passes).

### B. Inbox tab

- AC-B1. Given the switch "Show Inbox in the side panel" is off (default), when the classic sidebar
  renders, then there is no Inbox tab (as today).
- AC-B2. Given the switch is on and the layout is classic, then an "Inbox" tab shows in the
  workspace tabs and the compact rail, in its `tabOrder` position, and selecting it shows the
  Inbox pane.
- AC-B3. Given the switch is on and the layout is inset, then no Inbox tab shows.
- AC-B4. Given the Inbox tab is selected, when the switch is turned off, then Sessions is selected.
- AC-B5. Given a project whose stored tab is "inbox", when the app restarts with the switch on, then
  Inbox is selected; with the switch off, Sessions is selected.
- AC-B6. Given GitHub is connected and `repoRoot` maps to `owner/name`, when the pane opens, then it
  calls `listGithubWorkItems(repoRoot, "owner/name", {kind: "pr", assignedToMe: false, state:
  "open", search: ""})` and the same with `kind: "issue"`, and shows both merged, sorted by
  `updatedAt` newest first.
- AC-B7. Given the filter switch, when "Pull requests" or "Issues" is chosen, then only that kind
  shows; "All" shows both. The filter resets to All when the app restarts.
- AC-B8. Given the dropdown switches from repo X to repo Y while X's request is pending, when X's
  response arrives after Y's, then the pane shows only Y's items.
- AC-B9. Given cached items for the repo younger than 2 minutes, when the pane reopens, then no
  request is made; "Refresh" always requests.
- AC-B10. Given an item row, when clicked, then the full Inbox opens on the GitHub source with that
  item selected (also when the Inbox view was already mounted with another target).
- AC-B11. Each state in the B table renders its exact copy.

### C. ClickUp

- AC-C1. Given no token, when Nakul pastes a token and presses Connect, then `clickup_set_token`
  calls `GET /api/v2/user`; on 200 the token is saved in the keychain and the Lists step shows; on
  401 the copy "ClickUp didn't accept this token." shows and nothing is saved.
- AC-C2. Given a pasted list link `https://app.clickup.com/9012345/v/li/901234567890` or
  `https://app.clickup.com/9012345/v/l/6-901234567890-1` or the bare ID `901234567890`, when added,
  then the list ID `901234567890` is validated with `GET /list/{id}` and stored with its name.
  Anything else shows "That isn't a ClickUp list link or ID." At most 10 lists.
- AC-C3. Given the config links project P, then the sidebar shows "ClickUp" only when the current
  project is P, or when no project is linked yet.
- AC-C4. Given the view opens, then each configured list loads its statuses and members (cached 10
  minutes) and its open tasks (`include_closed=false`, pages from 0 until `last_page` is true, at most
  5 pages), and the list tabs are "All" plus the list names.
- AC-C5. Given "Show done" on, then tasks are requested with `include_closed=true` and closed tasks
  show with their status.
- AC-C6. Given New task, when Nakul fills name, description, assignees, start date, due date,
  priority and status and presses "Create task", then `POST /list/{id}/task` is sent with `name`,
  `markdown_content`, `assignees` (user IDs), `status`, `priority` (1–4 or omitted), `start_date` /
  `due_date` as local-midnight milliseconds with `start_date_time` / `due_date_time` false; the new
  task appears at the top of that list without a refresh.
- AC-C7. Given a due date before the start date, then "Create task" / "Save changes" is disabled and
  "Due date is before the start date." shows.
- AC-C8. Given an open task, when Nakul edits only the due date and saves, then `PUT /task/{id}` is
  sent with only `due_date` and `due_date_time`. Assignee changes send
  `assignees: {add: [...], rem: [...]}`.
- AC-C9. Given an open task, when "Mark done" is pressed, then the status becomes the list's first
  status (by `orderindex`) whose `type` is `closed`. With no such status the button is disabled with
  the title "This list has no done status." "Reopen" on a closed task sets the first status of type
  `open`, else the lowest-`orderindex` status that isn't `closed`.
- AC-C10. Given Save pressed twice quickly, then exactly one request is sent.
- AC-C11. Given a refresh started before a save and returning after it, then the saved task keeps the
  saved values (the copy with the larger `dateUpdated` wins).
- AC-C12. Given unsaved edits in the detail panel, when a refresh brings a newer copy, then the form
  keeps the edits; untouched fields are not sent on save.
- AC-C13. Given a 429 with `X-RateLimit-Reset` 30 s ahead, then "ClickUp is busy. Try again in 30 s."
  shows and Refresh is disabled until the countdown ends; no automatic retry.
- AC-C14. Given "Start session › New session", then a new session opens in the linked project with
  the composer filled (not sent) with:
  ```
  ClickUp task: <name>
  <url>

  <markdown description, trimmed to 4000 characters>
  ```
  using `defaultSessionChoice(linkedProject)` for harness and model.
- AC-C15. Given "Start session › Give to a Mono", then Monos whose `projects` include the linked
  project are listed; picking one opens it with the same text in its composer (not sent). Monos with
  no `sessionId` are listed disabled with "Not started yet". With no such Mono, the item reads
  "No Mono has this project" and is disabled.
- AC-C16. Given a Mono with the linked project, when it runs `monocode app clickup.create
  '{"list":"Bugs","name":"Fix login","assignees":["Nakul"],"dueDate":"2026-11-30",
  "priority":"high"}'`, then the task is created in Bugs and the result is `{id, url}`; the token
  appears nowhere in the result, transcript or logs.
- AC-C17. Given a Mono without the linked project, or a regular session whose project isn't the
  linked one, then every `clickup.*` action fails with "ClickUp is linked to <project name>."
- AC-C18. Given no token, then every `clickup.*` action fails with "ClickUp is not connected. Ask the
  user to connect it in the ClickUp page."
- AC-C19. Given a list ID that isn't configured, then the action fails with "Unknown list; run
  clickup.lists".
- AC-C20. Given Disconnect in setup, then the keychain entry is deleted, cached data is cleared, and
  the view shows the Connect step. The linked project and lists stay.
- AC-C21. Given a 403 on save, then "You don't have permission to edit this list." shows and the list
  becomes read-only until the next app start.

### D. Interactive Mono sessions

- AC-D1. Given a Mono calls `sessions.start` with harness `claude` in a local project, then the launch
  passed to `host.start` has `modelSettings.claudeExecution === "interactive"`, even when the Mono's
  own `modelSettings.claudeExecution` is `"structured"`.
- AC-D2. Given the same call in a `remote://` project, then `claudeExecution` is not forced (stays as
  merged today) and the result has `"claudeExecution": "structured"` and
  `"note": "Remote projects run Structured."`.
- AC-D3. Given a Mono-started Claude session, then the result includes
  `"claudeExecution": "interactive"`.
- AC-D4. Given a regular session with `/operator` calls `sessions.start`, then `modelSettings` is
  exactly as today.
- AC-D5. Given a Mono starts a `codex` (or other non-Claude) session, then nothing changes.
- AC-D6. Given a Mono passes `modelSettings: {claudeExecution: "structured"}`, then it is rejected as
  today ("Invalid model setting claudeExecution; …").
- AC-D7. Given a Mono calls `models.list`, then the result also has
  `"claudeSessions": "Claude sessions you start run Interactive (the claude CLI); remote projects run Structured."`.
  Non-Mono callers get today's result.
- AC-D8. `session_manager.write` and `session_manager.start` launches are unchanged.

### E. Hari-Desktop banners

- AC-E1. Given a finished turn in project "Rigorup-active" with model "Opus 5.5" and two Claude
  accounts with this chat on "Personal", then `show_notification` gets
  `title: "Hari-Desktop · Rigorup-active"`, `subtitle: <clipped reply>`,
  `body: "Opus 5.5 · Personal"`.
- AC-E2. Given only one account, then `body` is `"Opus 5.5"`.
- AC-E3. Given a question or approval, then `subtitle` is the same text `notificationText` puts in
  `body` today (question prompt, "Approve: …", or the fallbacks).
- AC-E4. Given a renamed project group label, then the title uses that label.
- AC-E5. `recordSessionNotification` output (bell and phone) is unchanged.
- AC-E6. Clicking the banner still opens the chat (identifier is still the session ID).

### F. Hari-Phone banners

- AC-F1. Given the switch is off (default), then no banner shows.
- AC-F2. Given the switch is turned on while the phone has 5 notifications, then no banner shows for
  those 5.
- AC-F3. Given the switch on and live, when a WhatsApp notice arrives with title "Asha" and text
  "Running late", then `show_notification` gets `sessionId: "hari-phone:<key>"`,
  `title: "Hari-Phone · WhatsApp"`, `subtitle: "Asha"`, `body: "Running late"`, `sound: false`.
- AC-F4. Given a notice where `looksLikeCode` is true, then `subtitle` is `maskCodes(title)` and
  `body` is "Code hidden — open to see".
- AC-F5. Given a notice from a package starting with `com.hardbeat920.monocode`, then no banner.
- AC-F6. Given three WhatsApp notices 2 s apart, then the first shows at once; the other two show as
  one banner when the 10 s window ends: `subtitle: "2 new notifications"`, `body: <latest title>`
  (masked if it looks like a code).
- AC-F7. Given one notice folded, then at the window's end it shows as a normal single banner.
- AC-F8. Given the phone disconnects (`receiving: false`) and reconnects, then notices it resends are
  not shown again; a notice that is new after the reconnect is.
- AC-F9. Given the same key with a newer `postedAt`, then it shows again (throttle applies).
- AC-F10. Given the global notification switch is off (`loadNotificationsEnabled()` false), then no
  banner.
- AC-F11. Given the Share panel is open on the Notifications view, then no banner.
- AC-F12. Given a banner is clicked, then the window comes forward, Share opens on Notifications,
  and the notice with that key is scrolled into view and highlighted for 2 s; if it's gone, the view
  just opens.

## Ordering contracts

- B (load): capture `seq = ++requestSeq` and `repoRoot` → `githubStatus()` → `githubRepo(repoRoot)` →
  both `listGithubWorkItems` in parallel → if `seq !== requestSeq.current`, drop → write cache for
  that repo → render. A `repoRoot` change increments `requestSeq` before anything else.
- B (open item): set App `inboxTarget` → open the Inbox view (same as `onOpenInbox`) → InboxView
  selects the target. `onLeaveInbox` clears `inboxTarget`.
- C (connect): validate input (trimmed, non-empty, ≤ 200 chars) → Rust calls `/user` → on success
  write keychain → return user → TS clears the input. On failure nothing is written.
- C (save): if `savingTaskIds` has the ID, return → add it → compute changed fields against the
  snapshot taken when the panel opened → `clickup_update_task` → on success upsert the returned task
  (by `dateUpdated`), take a new snapshot → remove the ID in `finally`.
- C (refresh): capture `generation` per list → fetch pages → if the list's generation changed, drop
  → merge by ID, keeping the copy with the larger `dateUpdated` → tasks absent from the fetch are
  removed only if their local `dateUpdated` is not newer than the fetch start time.
- C (rate limit): on `rateLimited`, store `retryAt` per token (one for the whole app), disable
  refresh and automatic loads until then; queued nothing.
- C (agent write): goes through the same `clickupApi` functions and upserts into the same store, so
  an open view shows the result.
- D: `startLaunch` → force `claudeExecution` in the `sessions.start` case → worktree checks →
  `host.start`. The override is applied to the returned launch object, not inside `startLaunch`.
- E: build text → `invoke("show_notification")` (unchanged flow).
- F: on `PHONE_NOTIFICATIONS_EVENT` → `invoke("mobile_phone_notifications_list")` → parse → if a newer
  fetch has started, drop this result → `planPhoneBanners(state, notices, now)` → show banners →
  schedule one flush timer per package at `lastShownAt + 10_000` if it has folds. Turning the switch
  off clears timers and state; turning it on starts in seeding and fetches the list once.

## Implementation plan

Build in this order: A, E, D, F, B, C. After each part: typecheck, its tests, a LOCAL-FEATURES row
and a changelog entry.

### A. Mono reply bar (L-379)

- `src/styles/index.css:1382–1411`: in `.turn-actions-hover`, set `opacity: 1` and remove
  `transition`. Delete the rule at 1394–1403 (the hover/focus/expanded reveal). In the reduced-motion
  block at 1406–1411, remove `.turn-actions-hover` and keep `.user-message-actions`. Add a short
  comment: Fork (L-379), always visible; the hover rule never matched after the portal host.
- Don't rename the class or the `revealOnHover` prop (upstream file; keeps merges small).

### E. Hari-Desktop banners (L-383)

- `src/features/notifications/model/notifications.ts`: add exported
  `desktopBannerText(session: Session, event: NotificationEvent): NotificationText`:
  - `title`: `Hari-Desktop · ${label}` where `label = resolveTabGroupLabel(projectKey(session.cwd),
    loadTabGroupLabels(), projectName(session.cwd))`.
  - `subtitle`: `notificationText(session, event).body`.
  - `body`: `[compactModelLabel(session), sessionAccountLabel(session)].filter(Boolean).join(" · ")`.
- `notifyProjectSession` (~336): use `desktopBannerText` instead of `notificationText`.
- Don't touch `notificationText` or `recordSessionNotification`.

### D. Interactive Mono sessions (L-382)

- `agentApp.ts` `sessions.start` case (1456): right after `const launch = startLaunch(…)`:
  - `const monoClaude = host.isMono(source.id) && launch.harness === "claude";`
  - if `monoClaude && !isRemoteProjectPath(launch.cwd)`, set
    `launch.modelSettings = {...launch.modelSettings, claudeExecution: "interactive"}`.
  - In the returned object, when `monoClaude`, add `claudeExecution` (`"interactive"` or
    `"structured"`) and, for remote, `note: "Remote projects run Structured."`.
- `models.list` (1355): when `host.isMono(source.id)`, add the `claudeSessions` string from AC-D7.
- `src-tauri/src/control_cli.rs` `APP_USAGE`, `sessions.start` line (~159): add "A Mono's Claude
  sessions run Interactive." Keep the help test passing.
- Check while building (report results, don't fix outside scope): Mono told on finish
  (`notifyMonoId` → `onSettled`), `sessions.read` shows the reply, `sessions.send` reaches a parked
  child, `sessions.stop` ends the process, a question shows "Need approval" in Working.

### F. Hari-Phone banners (L-384)

- New `src/features/mobile/model/phoneBanners.ts` (pure, no timers):
  - `PHONE_BANNERS_KEY = "monocode.phoneBanners.v1"`; `loadPhoneBanners()`, `savePhoneBanners(on)`,
    `subscribePhoneBanners(listener)`, plus the `storage` event for other windows.
  - `PhoneBannerState = {phase: "seeding" | "live"; seen: Map<string, number>; lastShownAt:
    Map<string, number>; folded: Map<string, {count: number; latest: PhoneNotice}>}`.
  - `planPhoneBanners(state, notices: PhoneNotices, now) → {state, show: PhoneBanner[], flushAt:
    Map<string, number>}` implementing the F table. Seen keys not in `onPhone` are pruned in live
    phase.
  - `flushPhoneBanners(state, pkg, now) → {state, show}`.
  - `phoneBannerText(notice) → {title, subtitle, body}` and `phoneFoldText(count, latest)`; clip each
    line to 240 characters (reuse the `clip` approach from notifications.ts; export it if needed).
  - `isHariPackage(pkg) = pkg.startsWith("com.hardbeat920.monocode")`.
- New `src/features/mobile/model/usePhoneNotificationBanners.ts`: mounted once in App. Owns the
  listener, the fetch sequence, flush timers, and checks `loadNotificationsEnabled()` and whether
  Share is open on Notifications (add `readShareView()` / `setShareView()` to `shareView.ts`, set by
  `SharePanel` when its view changes). Calls `invoke("show_notification", {sessionId:
  "hari-phone:" + key, title, subtitle, body, sound: false})`; for folds use the latest notice's key.
- `SharePanel.tsx` Notifications view (or `PhoneNotificationsView.tsx`): a `Toggle` row
  "Show as desktop notifications" at the top. Accept a `focusKey` to scroll a notice into view and
  highlight it.
- Rust `notifications.rs` `handle_click`: add a branch for prefix `hari-phone:` (constant
  `NOTIFICATION_PREFIX` in `mobile_phone_notifications.rs`) calling a new
  `mobile_phone_notifications::open_from_notification(app, key)`: bring the main window forward the
  same way the session click path does, then emit `monocode-share-open` with payload
  `{"view": "notifications", "key": key}`.
- `App.tsx:15758` listener: read the payload (Zod: optional `view`, optional `key`); when `view` is
  `"notifications"`, call `setShareView("notifications", key)` before `setSharePanelOpen(true)`.
  Existing payload-less events behave as today.

### B. Inbox tab (L-380)

- New `src/features/inbox/model/sidebarInboxTab.ts`: key `monocode.inbox.sidebarTab.v1`, default
  false; `loadSidebarInboxTab`, `saveSidebarInboxTab`, `subscribeSidebarInboxTab`,
  `useSidebarInboxTab()` (`useSyncExternalStore`, plus `storage` event).
- `SettingsView.tsx` `InboxPage` (2638): a `Toggle` row "Show Inbox in the side panel" with the
  description from UI details; add it to `SETTINGS_INDEX` (id `sidebar-inbox-tab`).
- `Sidebar.tsx:1139`: keep `"inbox"` when `sidebarInboxTab && !insetLayout`. Render
  `<InboxSidebarPane>` when `paneTab === "inbox"`, beside the files/changes panes (~2989, ~3034),
  with `cwd={repoRoot}`, `remote={remoteProject}`, `onOpenItem`, `onOpenInbox`. New prop
  `onOpenInboxItem?: (item: LinkedWorkItem) => void`.
- `App.tsx:2680–2696` `setSidebarTab`: allow `"inbox"` when the switch is on and the layout is
  classic. `App.tsx:~16057`: reset `"inbox"` only when the switch is off or the layout is inset.
- `projectSidebarTab.ts`: widen the type and validator to include `"inbox"`.
- New `src/features/inbox/ui/InboxSidebarPane.tsx`: states per the B table; filter
  `SegmentedSwitch` (All / Pull requests / Issues); module-level cache `Map<repo, {items,
  fetchedAt}>`, fresh for 2 minutes; `requestSeq` ref; Refresh icon button.
- `App.tsx`: new state `inboxTarget: LinkedWorkItem | null`; `onOpenInboxItem(item)` sets it and runs
  the `onOpenInbox` body; pass `target={inboxTarget}` to `InboxView` (18614); clear it in
  `onLeaveInbox`.
- `InboxView.tsx`: if `selectedKey` doesn't follow a changed `target` after mount, add an effect that
  sets `selectedKey` to `targetSelectionKey` when it changes. Don't change other Inbox behaviour.

### C. ClickUp (L-381)

Rust:
- New `src-tauri/src/clickup.rs`, `mod clickup;` in `lib.rs`, commands added to `generate_handler!`.
  Base `https://api.clickup.com/api/v2`, timeout 20 s, header `Authorization: <token>`. Run the
  blocking calls off the main thread the way `linear.rs` does.
- Keychain helpers: `read_token() -> Result<Option<String>>`, `write_token`, `delete_token` (service
  `com.monocode.clickup`, account `personal-token`; `NoEntry` → `None`).
- Error type, serialized with `#[serde(tag = "kind", rename_all = "camelCase")]`:
  `notConnected`, `auth` (401), `forbidden` (403), `notFound` (404), `rateLimited {retryAfterSeconds}`
  (429, from `X-RateLimit-Reset` minus now, minimum 1, default 60), `invalid {message}` (400, from
  ClickUp's `err`), `server` (5xx), `network`. Messages never include the token or headers.
- Commands (all return camelCase DTOs):
  - `clickup_status() -> {connected: bool}` (keychain only, no network).
  - `clickup_set_token(token) -> {id, username}` (validates with `GET /user`, then stores).
  - `clickup_disconnect()`.
  - `clickup_list(list_id) -> {id, name, statuses: [{status, type, color, orderindex}],
    permissionLevel: Option<String>}`.
  - `clickup_list_members(list_id) -> [{id, username, email, initials, color, profilePicture}]`.
  - `clickup_tasks(list_id, page, include_closed) -> {tasks, lastPage}` (query
    `page`, `include_closed`, `subtasks=false`, `order_by=updated`, `reverse=true`).
  - `clickup_task(task_id) -> Task` (`include_markdown_description=true`).
  - `clickup_create_task(list_id, input) -> Task`; `clickup_update_task(task_id, input) -> Task`.
  - `Task`: `{id, name, markdownDescription?, status: {status, type, color}, priority: 1..4 | null,
    assignees: Member[], startDate: ms | null, dueDate: ms | null, dateUpdated: ms, url, listId}`.
    ClickUp sends dates as strings of ms and priority as an object with a string `id`; convert.
- Unit tests in the module: status mapping, reset parsing, task JSON conversion (priority null and
  object, dates null and string, missing description).

TypeScript (`src/features/clickup/`):
- `model/clickupApi.ts`: invoke wrappers; Zod schemas for every DTO and the error; a `ClickupError`
  class carrying `kind` and `retryAfterSeconds`.
- `model/clickupConfig.ts`: key `monocode.clickup.v1`, Zod `{projectPath: string | null, lists:
  {id: string, name: string}[] (max 10)}`; `parseClickupListRef(input): string | null` for the three
  forms in AC-C2.
- `model/clickupTasks.ts` (pure): `mergeTasks`, `sortTasks` (due date ascending, no date last, then
  `dateUpdated` descending), `doneStatus`, `reopenStatus`, `taskPatch(original, edited)`,
  `dueLabel(ms, now)` ("Today", "Tomorrow", "Yesterday", else short weekday and date; overdue
  flagged), `sessionPromptForTask(task)`, `toLocalMidnight("YYYY-MM-DD")`.
- `model/clickupStore.ts`: in-memory store (`useSyncExternalStore`) with per-list tasks, meta and
  members caches, generations, `savingTaskIds`, `retryAt`, `readOnlyLists`. Exposes `refresh(listId,
  {force})`, `createTask`, `updateTask`, `subscribe`.
- `model/clickupAgent.ts`: `runClickupAction(action, input, deps)` with input parsing and errors from
  AC-C16–C19. Agent input: list by ID or name (case-insensitive); assignees by username, email or
  numeric ID matched to list members (unknown → "Unknown assignee <x>; members: …"); status by name
  (case-insensitive); priority `urgent | high | normal | low | null`; dates `YYYY-MM-DD` or `null`
  (update only); `done: true | false`; `description` ≤ 20 000 characters; `name` 1–1000 characters.
  `clickup.update` takes `assignees` as the full new list. `clickup.tasks` takes `list?`,
  `includeClosed?`, `id?` (with `id`, one task including its description). Results use usernames and
  `YYYY-MM-DD` dates, and at most 100 tasks.
- `agentApp.ts`: `FIELDS` entries for the four actions; `AgentAppHost.clickup?: {linkedProject():
  string | null; run: typeof runClickupAction-compatible}`; dispatch cases that check access first
  (Monos: the linked project must be one of the Mono's `projects`, compared as
  `assertMonoProjectAccess` compares them; others: `sameProjectPath(source.cwd, linkedProject)`).
  Both failures throw the AC-C17 message. Then call the host.
- `control_cli.rs`: add the four actions to `APP_ACTIONS` (43 → 47) and help lines with one example
  each. `monocodeToolCall.ts`: labels "List ClickUp lists", "List ClickUp tasks",
  "Create ClickUp task", "Update ClickUp task".
- UI (`ui/`): `ClickupView.tsx`, `ClickupSetup.tsx`, `ClickupTaskRow.tsx`, `ClickupTaskForm.tsx`
  (shared by create and edit), `ClickupTaskPanel.tsx` (`SlidePanel`), `ClickupAssigneePicker.tsx`
  (`Popover`, multi-select). Create uses `Modal`.
- App: `clickupViewOpen` state wired like the Automations view: add `setClickupViewOpen(false)` next
  to every existing `setWhiteboardViewOpen(false)` in view openers; add to `activeAppView` and
  `APP_VIEW_LABELS` ("ClickUp"); not to `NEW_TAB_VIEW_ORDER`. Provide `host.clickup` to the agent
  app. "New session" uses `launchQuickSession` with `draft: true`, `reveal: true`; "Give to a Mono"
  uses the host `draft` path for the Mono's `sessionId`, then `onOpenMono`.
- `Sidebar.tsx` nav (~2925–2975): `onOpenClickup && {label: "ClickUp", icon: CheckCircle, active,
  onClick}`, after Task Manager. If `CheckCircle` is already used in that list, use `ListBullet`.

## UI details

Reuse `SegmentedSwitch`, `Popover`, `Modal`, `SlidePanel`, `Toggle`, `SelectMenu`, icons from
`src/shared/ui/icons.tsx`; glass surfaces, theme tokens, one icon size per row; transform/opacity
animations only; respect reduced motion. No toasts (the repo has no toast library); results show
inline.

### B copy

- Settings: "Show Inbox in the side panel" — "Adds an Inbox tab next to Sessions, Explorer and
  Changes. It lists GitHub pull requests and issues for the repository you're working in."
- Pane header: `owner/name`, Refresh button (`aria-label="Refresh"`).
- Filter: "All", "Pull requests", "Issues".
- Row: kind icon, `#<number>` and title (truncate), second line "Draft" badge if draft, then
  `formatRelativeTime(updatedAt)`.
- States: see the B table; "Open Inbox" button opens the full Inbox.

### C copy

- Nav label "ClickUp"; view title "ClickUp".
- Setup: "Connect ClickUp"; field "Personal API token" (password input); help "In ClickUp, open
  Settings › Apps and generate a personal token. MonoCode keeps it in Windows Credential Manager on
  this computer."; button "Connect" / "Connecting…".
- Lists step: "Project" (select from recent projects, default the current one); "Lists" input
  placeholder "Paste a list link or ID", button "Add", rows with "Remove"; "Done". Setup is reachable
  later from a gear button (`aria-label="ClickUp settings"`), which also has "Disconnect".
- Header: list `SegmentedSwitch` ("All" + names), `Toggle` "Show done", Refresh, "New task".
- Row: status colour dot, name, up to 3 assignee initials circles then "+N", due label (overdue in
  `text-red-400`), list name in All.
- Form fields: "List", "Name", "Description" (Markdown), "Assignees", "Start date", "Due date",
  "Priority" ("No priority", "Urgent", "High", "Normal", "Low", with ClickUp's colour when sent),
  "Status". Buttons: "Create task" / "Creating…", "Cancel"; in the panel "Save changes" /
  "Saving…", "Mark done" or "Reopen", "Start session" menu ("New session", "Give to a Mono" ›
  Mono names), "Open in ClickUp".
- Errors: exact strings from the C table and ACs.

### F copy

- Share › Notifications: `Toggle` "Show as desktop notifications".
- Banner: title `Hari-Phone · <app>`; line 1 the notice title (or the app name when empty); line 2
  the text; code: "Code hidden — open to see"; fold: "N new notifications" and the latest title.

## Skills to load

`frontend-ui`, `api-integration`, `desktop-app`, `testing`.

## Test matrix

| AC or risk | Level | File | Scenario |
|---|---|---|---|
| AC-A1–A4 | feature (happy-dom) | `src/features/sessions/ui/AgentTranscript.inlineWork.test.ts` | Mono reply bar opacity 1 without hover; absolute in gap; normal chat class absent; streaming hide still applies |
| AC-E1–E5 | unit | `src/features/notifications/model/notifications.test.ts` | `desktopBannerText` for finished, question, approval; one vs two accounts; renamed label; `notificationText` unchanged |
| AC-E1, E6 | unit | `src/features/notifications/model/notificationDelivery.test.ts` | `show_notification` receives the new fields and the session ID |
| AC-D1–D8 | unit | `src/features/agent-app/model/agentApp.test.ts` | Mono claude local → interactive (also overriding inherited structured); remote → structured + note; non-Mono unchanged; codex unchanged; explicit setting rejected; models.list field; session_manager.write unchanged |
| AC-F1–F11 | unit (fake time) | `src/features/mobile/model/phoneBanners.test.ts` | seeding, new key, newer postedAt, Hari package, code masking, fold 1 vs N, reconnect, prune, switch off |
| AC-F3, F10, F11 | hook | `src/features/mobile/model/usePhoneNotificationBanners.test.ts` | event → fetch → invoke args; out-of-order fetches (deferred promises) keep the newer; global switch off; Share on Notifications |
| AC-F12 | Rust unit + manual | `src-tauri/src/notifications.rs` tests (if the module has them) | prefix routing to the new opener |
| AC-B1–B5 | feature | `src/app/shell/Sidebar.test.ts` (or the existing sidebar tab test) and `projectSidebarTab.test.ts` | tab hidden/visible per switch and layout; reset to Sessions; restore |
| AC-B6–B11 | feature | `src/features/inbox/ui/InboxSidebarPane.test.ts` | calls and merge order; filter; repo switch with deferred X resolving after Y; cache 2 min; each state's copy; click → `onOpenItem` payload |
| AC-B10 | feature | `src/features/inbox/ui/InboxView.test.ts` (existing or new) | target change after mount selects the new item |
| AC-C2, C7–C9, C11, C12, C14 | unit | `src/features/clickup/model/clickupTasks.test.ts`, `clickupConfig.test.ts` | list ref parsing; date order; patch only changed fields and assignee add/rem; done/reopen status; merge by dateUpdated; prompt text and 4000 trim |
| AC-C10, C11, C13, C21 | unit | `src/features/clickup/model/clickupStore.test.ts` | double save one call; refresh/save out of order; 429 countdown blocks refresh; 403 read-only |
| AC-C16–C19 | unit | `src/features/agent-app/model/agentApp.clickup.test.ts` | each action with a mocked host; access errors; unknown list/assignee; result has no token-like fields |
| AC-C1, C4–C6, C15, C20 | feature | `src/features/clickup/ui/ClickupView.test.ts` | connect success/401; loading → ready; create sends fields and shows the task; Give to a Mono list; disconnect |
| CLI allowlist | Rust unit | `src-tauri/src/control_cli.rs` tests | the four actions parse; count 47 |
| Rust client | Rust unit | `src-tauri/src/clickup.rs` | status mapping, reset parsing, task conversion |
| L-218 guard | unit | `src/platform/tauri/windowArgs.test.ts` | new commands take no `WebviewWindow` |

## Verification

- Implementer runs:
  - `npx tsc --noEmit` (or the repo's typecheck script) — zero errors.
  - `npx eslint <changed files>` — zero warnings in changed files.
  - `npx vitest run` on each test file in the matrix plus `src/platform/tauri/windowArgs.test.ts`.
  - `cargo test --manifest-path src-tauri/Cargo.toml clickup control_cli notifications`.
  - `cargo check --manifest-path src-tauri/Cargo.toml`.
- Later (Nakul or the spec writer): full vitest suite, production build and installer.

## Manual checks

Nakul checks these on the desktop; the implementer doesn't drive the window.

1. A Mono's earlier and latest replies all show the bar; no jump when a turn finishes.
2. Settings › Inbox switch adds and removes the tab; switching repos in the dropdown changes the list;
   clicking a PR opens it in the Inbox.
3. ClickUp: connect with the real token; add the three lists (Knoarc Labs, Bugs, Tickets) by link;
   create a task with two assignees and dates and see it in ClickUp; edit it in ClickUp and refresh;
   mark done; New session and Give to a Mono fill the composer; a Mono creates a task with
   `clickup.create`; Windows Credential Manager shows `com.monocode.clickup`.
4. A Mono starts a Claude session: it runs Interactive; the Mono is told when it finishes and can read
   it; a question shows "Need approval".
5. A finished chat in the background shows the Hari-Desktop banner with reply and model · account.
6. Phone switch on: a WhatsApp message shows a Hari-Phone banner; an OTP shows "Code hidden"; a burst
   folds; clicking opens Share › Notifications at the notice, also when the window was behind
   another app.

Unverified until then: whether ClickUp returns `permission_level` on `GET /list/{id}` for guests
(if absent, lists are treated as editable and a 403 makes them read-only), and whether
`GET /list/{id}/member` works for a guest token.

## Facts, decisions, assumptions

**Facts** (verified in code or docs): everything under Current behavior; ClickUp endpoints and rate
limit as listed; Nakul has Full edit on the three lists (share dialog).

**Decisions:**
- A is CSS-only; class and prop names stay for merge safety.
- B is classic-layout only, GitHub only, open items only, two calls per load.
- C uses the keychain, not the app-data file Linear uses (Nakul's wish). Agent writes need no
  confirmation (Nakul's call; this overrides the global "confirm model-triggered actions" rule for
  these four actions). Dates are date-only, sent as local midnight with `*_date_time: false`.
  Lists are added by link or ID (guests may not see the hierarchy). Give to a Mono drafts, doesn't
  send. No new dependencies.
- D applies only in `sessions.start`, after `startLaunch`; remote projects stay Structured.
- E keeps the account out when there's only one account.
- F banners are silent (the phone already sounds); updates don't replace earlier banners; banners
  skip while Share shows Notifications.

**Assumptions:**
- Team members share Nakul's timezone (IST), so local-midnight dates read the same in ClickUp.
- ClickUp's update endpoint accepts `markdown_content` as the create endpoint does; check the docs
  page while building and report if it doesn't.
- DPDP: member names and emails are held in memory only; the config stores list IDs, list names and
  the project path.

## Open questions

1. Inbox tab in the inset layout: wanted later? (Default: no.)
2. "Ran for …" also in the Mono bar? (Default: no.)
3. Should a Mono be able to ask for Structured explicitly? (Default: no.)
4. If the guest token can't read `/list/{id}/member`, the assignee picker falls back to the assignees
   seen on that list's tasks. Acceptable? (Default: yes.)

5. (Implementer) ClickUp update with `markdown_content`: not confirmed against the docs or a live list. Task
   descriptions are sent that way on update as on create; if ClickUp ignores it, edits to the description
   won't stick.
6. (Implementer) Guest tokens: `permission_level` and `/list/{id}/member` access are unverified; the
   panel falls back to assignees seen on tasks, and a 403 on save makes the list read-only.
7. (Implementer) `phoneBanners.ts` has its own `clipLine` instead of reusing the desktop one. Merge them?

## Implementer report format

- Per AC (A1 … F12): done / partial / not done, with `file:line` or test name.
- Deviations from this spec and why.
- Results of the D "check while building" list.
- Open questions raised.
- Checks run with results (typecheck, lint, vitest files, cargo).
- Files changed, grouped by part; LOCAL-FEATURES rows and changelog entries added.

## Rework

Reviewed 2026-11-22 against the diff. A, D and E hold as written; B, C and F hold apart from these items.

1. Fixed 2026-11-22 14:00. B, Refresh: `InboxSidebarPane.tsx` `run()` sets `{kind: "checking"}` before `githubStatus()`, so the rows
   disappear on every Refresh and repo switch until the status call returns. Only show "checking" when no
   rows are cached for this pane; keep showing the rows while a refresh runs (States table: rows stay).
   Add a test: rows present → Refresh → rows still rendered before the deferred `githubStatus` resolves.
2. F, banner click from the background (AC-F12): `open_from_notification` focuses the window and emits in
   the same main-thread call, and the App listener drops the event unless `document.hasFocus()`. If manual
   check 6 shows Share doesn't open when the window was behind another app, emit to the focused window only
   (`emit_to` its label) and skip the `hasFocus` gate when the payload carries `view`. The L-279 share
   arrival has the same pattern; fix both together only if it fails.
3. Checked 2026-11-22: the same errors appear on `4382809e` (36 in the two settings files run on both), all from `ShareButton.tsx` via `WindowControls`, which this work doesn't touch. Not new; no change. Baseline check: the full vitest run reports about 162 unhandled `transformCallback` errors from Tauri
   listeners in settings and share tests. Run those test files on `4382809e` (a separate worktree) to show
   whether they are new. If new, mock `@tauri-apps/api/event` `listen` in the tests that now mount
   `usePhoneNotificationBanners` or the share listener.

Accepted deviations (no rework): the planner keeps running while the switch is off and only delivery is
gated, which has the same effect as reseeding on enable; ClickUp only in the main Sidebar nav;
`onOpenInboxPaneItem` prop name; hand-written payload narrowing (no zod in the repo); Give to a Mono
opens a busy Mono without drafting (and warns); no lint (the repo has no ESLint config).

## Handoff retro

- The implementer reported A's tests under `LiveAgentsPreview.test.ts` (L-378's file); the A test is in
  `AgentTranscript.inlineWork.test.ts` as specified. Gap: the report format should ask for test names
  per AC, not only files.
- The spec said "Zod" for new boundaries; the repo has no zod. Gap: check dependencies before naming a
  validator in a spec.
- `onOpenInboxItem` already existed with another signature. Gap: grep proposed prop names before fixing
  them in the plan.
- The States table said rows stay on a failed refresh but didn't say rows stay during a refresh. Gap: state
  tables need the in-flight row for each refresh, not only the outcome rows.
- AC-F12 "also when the window was behind another app" depended on a focus gate the spec cited but didn't
  resolve. Gap: when a spec cites a guard on the path, say whether the new path must pass it.
- Turning the phone switch on/off was specified as reset-on-toggle; the implementer gated delivery instead.
  Same user outcome, simpler. The spec over-specified the mechanism.

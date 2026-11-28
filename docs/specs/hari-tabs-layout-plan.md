# Draft — Hari tabs layout and Hari Dev build — spec

- Tier: complex (navigation, persistence, gestures, a second Android app id, two phases)
- Snapshot: `c70ef78c`, 2026-11-27 19:13 IST
- Local feature IDs: L-412 (Tabs layout), L-413 (Hari Dev build)

## In plain words

Today Hari is one long stack of screens. Opening a project, Share or Computer from the side menu throws away
the screen you were on and builds the new one from scratch, so pages reload, and the Share/Control swipe
sometimes sticks. After this, Settings has a new layout called **Tabs**: five tabs at the bottom
(Sessions, Share, Monos, Computer, Running) that stay alive once opened, so switching between them is instant.
Sessions and Monos have a curved row of circles above the bar (All, then your last five) to jump between
projects or Monos, each with an icon you can pick. A floating + button at the bottom right starts a new
session or Mono. Notes, Tasks, Notifications and Settings move into the side menu. The current layout stays
as an option. Separately, a **Hari Dev** app installs next to Hari so code changes show on the phone
in seconds, without a release.

## Goal and user story

- As a Hari user, I want the main places one tap away and already loaded, so the app feels instant and
  never shows a reload or a stuck swipe.
- As the developer, I want a dev build on my phone that reloads from my PC, so I can test phone changes
  without waiting for a release.

## Scope

1. Phase 0: the Hari Dev build (L-413). Build it first; it's used to test Phases 1 to 4.
2. Phase 1: the layout setting, the tabs group, the custom tab bar (floating or fixed, gliding highlight,
   thumb slide) and the side menu for the Tabs layout.
3. Phase 2: the arc on Sessions and Monos, the 5 kept projects or Monos, and phone-only icons.
4. Phase 3: the + button and the New session project picker.
5. Phase 4: the Running tab.

## Out of scope

- iOS. The fork builds Android only. Code must still compile for iOS, but nothing is tested there.
- Icons shared with the desktop. Icons are phone-only.
- A left-handed + button position.
- Changes to the Classic or Monos-only layouts, other than moving their setting into the new Layout choice.
- Expo's native tabs (`expo-router/unstable-native-tabs`). They can't show the gliding highlight or thumb
  slide, and they're marked unstable.
- Any desktop or protocol change. Everything the Running tab needs is already on the phone (see Facts).
- OTA updates. `updates.enabled` stays `false`.

## Current behavior (confirmed in source)

- **Root navigator:**
  - [src/app/_layout.tsx:177-271](../../mobile/src/app/_layout.tsx) `LinkedWorkspace`: a `WorkspaceLayout`,
    then `ScenePagerHost drawer={<WorkspaceDrawer/>}`, then `SessionFrame`, then one native `Stack`
    with `animation: "none"`.
  - Places (project, Mono, Tasks, Notes, Notifications, Share, Computer) are swapped in place, as Stack
    screens.
- **Layout setting:**
  - [src/features/settings/monoOnly.ts](../../mobile/src/features/settings/monoOnly.ts) stores
    `layout.monoOnly` in `expo-sqlite/kv-store`, read through `useSyncExternalStore`.
  - `useChangeLayout` covers the app with `DitherLoading`, closes Settings, resets navigation, then flips the
    value (`DISMISS_MS` 500, `SETTLE_MS` 400).
  - It's used in `_layout.tsx:182`, `app/index.tsx:11`, `app/mono/[monoId].tsx:58` and
    `app/settings/index.tsx:72-85, 243-262` (Settings shows a "Monos only" switch under "Layout", gated by
    `MONOS_ENABLED`, which is `true` in `features/connection/selection.ts:8`).
- **Side menu:** [WorkspaceDrawer.tsx](../../mobile/src/features/workspace/WorkspaceDrawer.tsx):
  - Projects, Monos, running sessions per project (`runningByProject`, lines 151-165), then Tasks, Notes,
    Notifications, Computer and Settings.
  - It opens places with `showPlace` / `showSession` from
    [placeStack.ts](../../mobile/src/features/workspace/placeStack.ts), after `drawer.closeThen`.
  - It opens on Android from the right edge (`EDGE_STRIP` 28 in `ui/ScenePager.tsx:53`).
- **Why pages reload:** `showPlace` replaces the place route (`placeStack.ts:76-120`), so the previous screen
  unmounts.
  - `ComputerHub` ([ComputerHub.tsx:129+](../../mobile/src/features/pc/ComputerHub.tsx)) holds `SharePanel`
    and `ComputerControl`, switched by a manual-activation `Gesture.Pan` (line 167) that competes with list
    scrolling and the drawer swipe.
- **Where the user was:** `readLastPlace` / `rememberPlace` in `lastPlace.ts`, and `readPlaceMemory` in
  `placeMemory.ts`, both per desktop fingerprint.
- **Running state:**
  - `isRunning(session)` in `features/liveUpdates/liveCards.ts:61` covers project sessions that are busy or
    waiting, and excludes Mono sessions.
  - Mono status comes from `useWorkspace().monos` and the drawer roster: `"working" | "needs-you" | "idle"`.
  - Sessions come from the workspace catalog (`WorkspaceProvider.tsx:57`, `sessions: SessionSummary[]`).
- **Project screen:**
  - `ProjectScreen` ([ProjectScreen.tsx:95](../../mobile/src/features/workspace/ProjectScreen.tsx)) has two
    pages: `"chat"` (new session, `EmptySession` plus composer) and `"sessions"` (`SessionsPage`).
  - `useProjectPages` (`ProjectPages.tsx:16`) starts on `"chat"` unless `showProjectSessions(id)` asked
    for sessions.
- **Haptics:** there's a user setting, `useHaptics()` in `features/settings/haptics.ts:32` (on by default).
- **Tabs support in Expo Router 57:**
  - `expo-router` 57.0.28 vendors React Navigation bottom tabs
    (`node_modules/expo-router/build/react-navigation/bottom-tabs`).
  - Its options include `lazy`, `freezeOnBlur`, `popToTopOnBlur`, `animation`, `tabBar` and
    `detachInactiveScreens` (`types.d.ts:181-295`).
  - `expo-router/build/layouts/Tabs.js` exposes `Tabs`.
- **Build:**
  - `app.config.js` sets name "Hari", the version code and the plugins. `app.json` sets scheme `monocode`
    and package `com.hardbeat920.monocodemobile`.
  - `expo-dev-client ~57.0.20` is already a dependency.
  - `mobile/android` is generated and not tracked.
  - Release APKs are built in `.github/workflows/hari-release.yml` (`expo prebuild`, then
    `assembleRelease`).
  - `with-hari-signing` uses the Hari key only when `HARI_KEYSTORE_PATH` is set; otherwise the debug key.
  - `with-hari-shortcuts.js:32,44` uses `${pkg}`, not a hard-coded package.
  - The only hard-coded deep links are `liveCards.ts:55,58` (`monocode:///`).
- **This PC:** the Android SDK is at `E:\Installed\AndroidSDK` (`ANDROID_HOME` is set, and `adb` is on PATH),
  and JDK 17 is at `E:\Installed\JDK17`.

## Proposed behavior and invariants

### Phase 0: Hari Dev (L-413)

- When `APP_VARIANT=dev`, `app.config.js` produces:
  - name `Hari Dev`
  - Android package `com.hardbeat920.monocodemobile.dev`
  - scheme `hari-dev`
  - `extra.hari.variant: "dev"`
- With no `APP_VARIANT`, the config is byte-for-byte what it is today, so release builds don't change.
- Hari Dev is a debug build with the Expo dev client. It loads JavaScript from Metro on the PC, and a saved
  file reloads on the phone (Fast Refresh).
- Hari and Hari Dev install side by side. Each has its own storage, so Hari Dev is paired with the desktop
  once, like a new phone.
- In Hari Dev, `HariUpdatePrompt` never offers an update, since release APKs are a different app.
- Deep links use the running app's scheme, so a Live Update card in Hari Dev opens Hari Dev, not Hari.

### Phases 1 to 4: Tabs layout (L-412)

- **Layout setting:**
  - Settings → Layout becomes a choice of three: **Classic**, **Tabs**, **Monos only**.
  - **Tab bar** (Floating / Fixed) shows under it only when Tabs is chosen.
  - Switching layouts reuses the existing covered switch (`useChangeLayout`).
- **Tab bar:**
  - Tabs, in order: Sessions, Share, Monos, Computer, Running.
  - With `MONOS_ENABLED` false, the Monos tab is left out (4 tabs).
  - Each tab mounts on first visit and stays mounted while the Tabs layout is on. A hidden tab is frozen,
    not unmounted, so scroll position, drafts and loaded data survive.
  - Pressing the active tab again scrolls its list to the top. It doesn't remount it.
  - A chat, file, diff, Changes, Settings, Tasks, Notes, Notifications or a Mono chat opens over the tabs as
    a full screen. The tab bar, arc and + button aren't shown there, and back returns to the same tab in the
    same state.
  - The open tab and each tab's arc selection are remembered per desktop and restored at launch.
- **Side menu:**
  - In the Tabs layout, it holds only Notes, Tasks, Notifications and Settings.
  - It opens from the right edge strip (as today) and from a menu button in each tab's header.
  - Its items push over the tabs.
- **No sideways page swipes** inside any tab. The only sideways gestures are the arc, the tab bar and the
  side-menu edge strip.
- **Arc** (Sessions and Monos tabs):
  - "All", then up to 5 recently opened projects (or Monos), newest next to All.
  - Opening a 6th drops the least recently opened one.
  - A project the desktop no longer has is dropped from the arc and its icon is deleted.
- **Kept views:** the Sessions tab keeps one session list mounted for each project in its arc (at most 5),
  so switching between them doesn't reload.
- **+ button:**
  - Sessions: opens the New session sheet listing every project, with the selected one first; picking one
    opens that project's new-session page.
  - Monos: opens New Mono (`/mono-new`).
  - It isn't shown on Share, Computer or Running.
- **Running tab:**
  - Lists every running or waiting project session, plus every Mono whose status isn't `"idle"`.
  - Ordered: needs-you or waiting first, then by most recent activity.
  - Updates live from the catalog.
- **Classic and Monos-only** behave exactly as they do today.

## States and transitions

| State | Event | Next state | User sees |
|---|---|---|---|
| Layout classic or monos | Settings: pick Tabs | Changing (covered) | Settings closes; the loading cover shows |
| Changing | Reset done, value saved | Tabs on, restoring | Cover fades out over the saved tab, or Sessions if none |
| Tabs, tab A open | Tap tab B | Tab B (mounted if new, else unfrozen) | Highlight glides to B; B shows at once, as it was |
| Tabs, tab A open | Tap tab A | Same | A's list scrolls to the top |
| Tabs | Press and slide on the bar | Sliding | Highlight follows the thumb; a light tick per tab crossed |
| Sliding | Lift over tab C | Tab C | C opens |
| Sliding | Lift outside the bar (vertical move over 40 pt) | Previous tab | Highlight springs back |
| Sessions, arc on project P | Swipe or tap arc to Q | Q selected | Q's list shows (kept, or built if new); P stays kept if it's among the 5 |
| Sessions, arc on Q (new) | Q is the 6th | Q kept, oldest dropped | The oldest circle leaves the arc |
| Sessions, arc on All | — | — | All projects list; tap one to select it (adds it to the arc) |
| Any tab | Long-press an arc circle | Circle menu | "Change icon", "Remove from arc" (not on All) |
| Sessions | Tap + | Picker sheet open | Projects list, the selected project first |
| Picker open | Pick project R | New-session page pushed | Project R's composer, over the tabs, with no bar |
| Picker open | Swipe down or back | Sessions | Sheet closes |
| Any tab | Open a chat | Chat pushed | Full-screen chat; bar, arc and + hidden |
| Chat | Back | Previous tab | Same tab, same scroll |
| Running | Catalog updates | Same | Rows add, remove or reorder; empty state when none |
| Tabs | Desktop disconnects | Same | Each tab shows its existing reconnecting state; cached lists stay visible |
| Tabs | Arc project deleted on desktop | Arc pruned | Circle disappears; if it was selected, All is selected |

## Acceptance criteria

### Phase 0 (L-413)

- **AC-0.1:**
  - Given `APP_VARIANT` is unset, when `app.config.js` is evaluated, then the result deep-equals the output
    at snapshot `c70ef78c` (name "Hari", package `com.hardbeat920.monocodemobile`, scheme `monocode`).
  - Given `APP_VARIANT=dev`, then the name is "Hari Dev", the package is
    `com.hardbeat920.monocodemobile.dev`, the scheme is `hari-dev` and `extra.hari.variant === "dev"`.
- **AC-0.2:** Given Hari Dev is running, when `HariUpdatePrompt` checks for updates, then it never shows a
  prompt.
- **AC-0.3:** Given the app's scheme is `hari-dev`, when `sessionUrl(session)` and `HOME_URL` are built, then
  they start with `hari-dev:///`. With scheme `monocode`, they're unchanged from today.
- **AC-0.4:**
  - Given the phone is on USB with debugging on, when the developer runs `npm run android:dev` in `mobile/`,
    then Hari Dev builds, installs next to Hari, opens, and loads JavaScript from Metro.
  - Given it's running, when a `.tsx` file is saved, then the change shows on the phone without a rebuild.
  - This is a manual check.

### Phases 1 to 4 (L-412)

- **AC-1:**
  - Given no `layout.app` value and `layout.monoOnly === "true"`, when the app starts, then the layout is
    `"monos"`.
  - Given neither value is set, then it's `"classic"`.
  - Given `layout.app` is `"tabs"`, then it's `"tabs"`.
  - Any other stored value reads as `"classic"`.
- **AC-2:**
  - Given Settings is open, when the user picks Tabs, then `useChangeLayout` runs its covered switch: the
    sheet closes, navigation resets to `/`, and `layout.app` is saved as `"tabs"`.
  - The first screen shown is the saved tab for this desktop, else Sessions.
- **AC-3:**
  - Given the Tabs layout, the tab bar shows Sessions, Share, Monos, Computer and Running in that order, with
    the labels and icons in UI details.
  - When `MONOS_ENABLED` is false, Monos isn't rendered.
- **AC-4:**
  - Given the Share tab has been opened and scrolled, when the user switches to Computer and back, then
    Share shows the same rows at the same scroll position.
  - `SharePanel` doesn't remount (the render test asserts its mount effect ran once).
- **AC-5:**
  - Given tab A is active, when the user taps tab A, then the screen calls its scroll-to-top handler and
    doesn't remount.
- **AC-6:**
  - Given the bar is visible, when the user presses on tab 1 and slides right to tab 4 and lifts, then tab 4
    opens.
  - A selection haptic fires on each tab boundary crossed (3 times), only when `useHaptics()` is on.
  - The highlight follows the finger during the slide.
- **AC-7:**
  - Given a slide in progress, when the finger moves more than 40 pt vertically away from the bar and lifts,
    then no tab change happens and the highlight springs back to the active tab.
- **AC-8:**
  - Given `layout.tabBar` is `"floating"` (the default), the bar is a glass pill inset 12 pt from the sides
    and 8 pt above the safe-area bottom.
  - Given `"fixed"`, it spans the full width and sits on the safe-area bottom.
  - Changing it in Settings applies at once, without the covered switch.
- **AC-9:**
  - Given any tab, when a session chat, Mono chat, file, diff, Changes, Settings, Tasks, Notes or
    Notifications opens, then it covers the tabs completely (no bar, no arc, no +).
  - Back returns to the same tab, which hasn't remounted.
- **AC-10:**
  - Given the Tabs layout, when the side menu opens, then it lists Notes, Tasks, Notifications and Settings
    only.
  - Tapping one closes the menu, then pushes that screen over the tabs.
- **AC-11:**
  - Given the Tabs layout, no tab contains `ComputerHub`. Share renders `SharePanel` and Computer renders
    `ComputerControl` directly.
  - Computer's "Open Share" action (`onOpenShare`) switches to the Share tab.
- **AC-12:**
  - Given the arc's recent list `[A, B, C, D, E]` (newest first), when the user opens project F, then the
    list becomes `[F, A, B, C, D]`, E's kept view unmounts, and the list is saved for this desktop.
  - Opening an id already in the list moves it to the front, without duplicates.
- **AC-13:**
  - Given the arc on the Sessions tab, when the user swipes it left by one step, then the next circle becomes
    the selection, with one selection haptic.
  - Releasing mid-way snaps to the nearest circle.
  - A fast fling moves at most 2 steps.
  - Tapping a circle selects it.
- **AC-14:**
  - Given project P is selected and kept, when the user selects Q and then P again, then P's session list
    shows without its loading state and at its previous scroll position.
- **AC-15:**
  - Given a project in the arc no longer exists in `useWorkspace().projects` (after the catalog has loaded at
    least once), then it's removed from the arc and from icons.
  - If it was selected, All is selected.
  - Before the first catalog load, nothing is pruned.
- **AC-16:**
  - Given the user long-presses a project circle and picks "Change icon", then a sheet shows a grid of the
    app's icons and an emoji field.
  - Picking an icon or entering one emoji saves it for that id on this desktop and the circle shows it at
    once.
  - "Use letter" removes it.
  - With no icon, the circle shows the first letter of the name on `projectColor(name)`. Monos show their
    existing avatar.
- **AC-17:**
  - Given the Sessions tab, when the user taps +, then a `ModalSheet` lists every project, the selected arc
    project first, then the rest by most recent activity, with a search field when there are more than 8.
  - Picking project R closes the sheet, adds R to the arc, and pushes R's new-session page (the
    `ProjectScreen` `"chat"` page).
- **AC-18:**
  - Given the Monos tab, when the user taps +, then `/mono-new` opens.
  - Given the Share, Computer or Running tab, no + is shown.
- **AC-19:**
  - Given the Monos tab with the arc on All, the tab shows the Mono list (`MonoHome`'s list).
  - Tapping a Mono circle pushes that Mono's chat, and the circle becomes the arc's selection and its newest
    entry.
- **AC-20:**
  - Given sessions S1 (busy, updated 10:00), S2 (waiting, 09:00), S3 (idle) and Mono M1 (`"working"`,
    active 09:30), the Running tab lists S2, M1, S1, and not S3.
  - Each row shows the project or Mono name, the session title and a status ("Needs you" or "Working").
  - Tapping S1 pushes its chat; tapping M1 pushes the Mono chat.
- **AC-21:**
  - Given nothing is running, the Running tab shows "Nothing running" with "Sessions you start show here
    while they work."
- **AC-22:**
  - Given the Tabs layout and Android reduce motion on, the highlight and arc move without spring overshoot
    (timing of 0 ms or a short linear timing). Haptics still follow the setting.
- **AC-23:**
  - Given the Classic or Monos-only layout, all existing tests pass unchanged and `WorkspaceDrawer` renders
    as today.

## Ordering contracts

- **Layout switch:**
  1. `useChangeLayout(next, { close, reset })`: guard `changing`.
  2. `close()`.
  3. `setChanging(true)`.
  4. After `DISMISS_MS`, `reset()` to `/`.
  5. Then `set(next)` (writes `layout.app`, notifies).
  6. After `SETTLE_MS`, the cover leaves.
  - A second switch while `changing` is ignored, as today.
  - Writing `layout.app` must happen before the cover leaves, so a crash mid-switch restarts in the new
    layout. That's acceptable, since both are valid.
- **Arc selection:**
  1. Gesture end computes the target index on the UI thread.
  2. `runOnJS(select)(id)`.
  3. `select` updates the in-memory recent list and selection synchronously, which renders.
  4. It then calls `persistArc(desktop, kind, state)`. Writes are fire-and-forget `Storage.setItem`, and
     the latest call wins because each write stores the full state.
  - The kept view for a dropped id unmounts in the same render that drops it.
- **Icon save:** update the in-memory map and notify, then `Storage.setItem` the whole map. Removing a
  project deletes its key in the same write.
- **Pruning (AC-15):** runs in an effect keyed on `projects` only after `catalogLoaded` is true, so
  reconnecting with an empty, not-yet-loaded list never wipes the arc. Find the existing "loaded" flag in
  `WorkspaceProvider`. If there isn't one, prune only when `projects.length > 0`.
- **Tab restore at launch:** read `hari.tabs.<desktop>` synchronously (`Storage.getItemSync`) for the
  initial route, so there's no flash of Sessions before the saved tab.
- **Picker, then new session:**
  1. Close the sheet.
  2. On the sheet's dismiss callback (not before), `router.push` to the new-session route.
  - This avoids pushing under a closing modal, the issue L-235 had on Android.
- **Thumb slide:**
  1. The pan activates after 8 pt horizontal movement (`activeOffsetX([-8, 8])`), and fails after 24 pt
     vertical movement before activation (`failOffsetY`), so scrolling content above isn't stolen.
  2. Haptics fire from `runOnJS` only when the computed index changes.
  3. On end, the tab is navigated once.
  - A tap (no activation) is handled by each tab button's own `onPress`.

## Implementation plan

### Phase 0: Hari Dev

- **`mobile/app.config.js`:**
  - Read `const variant = process.env.APP_VARIANT === "dev" ? "dev" : "release";`.
  - For `dev`, override `name: "Hari Dev"`, `scheme: "hari-dev"`,
    `android.package: \`${config.android.package}.dev\``, and set `extra.hari.variant`.
  - Leave `versionCode` as is.
  - Export a pure helper so the config can be tested without env leakage, and keep
    `module.exports.versionCode`.
- **`mobile/src/features/updates/appVariant.ts` (new):**
  - `isDevVariant()` reads `Constants.expoConfig?.extra?.hari?.variant === "dev"`, validated with a small
    Zod schema or a type guard.
  - `appScheme()` returns `Constants.expoConfig?.scheme` as a string, else `"monocode"`.
- **`HariUpdatePrompt.tsx`:** return `null` early when `isDevVariant()`.
- **`liveCards.ts:55-58`:** build `HOME_URL` and `sessionUrl` from `appScheme()`.
- **`mobile/package.json` scripts:** add `"android:dev": "cross-env APP_VARIANT=dev npm run android"` only
  if `cross-env` is already installed. Otherwise add `scripts/android-dev.mjs`, which sets
  `process.env.APP_VARIANT = "dev"` and spawns `npm run android` with inherited stdio. Don't add a
  dependency.
- **`mobile/README.md` (section "Hari Dev"):**
  - One-time steps:
    - USB debugging on.
    - `adb devices`.
    - Check `rustup target list --installed` includes `aarch64-linux-android` and `cargo ndk --version`
      works, since `npm run android` runs `native:android`.
    - Then `npm run android:dev`.
  - Daily steps:
    - Run `npx expo start --dev-client`.
    - Open Hari Dev; over USB, run `adb reverse tcp:8081 tcp:8081`, or be on the same Wi-Fi.
  - When to rebuild: after a change in `modules/`, `plugins/`, native dependencies or `app.config.js`.
- **If the local native-link build fails** (no Rust Android target): stop and report. Don't install
  toolchains without asking. A CI workflow for dev APKs is a follow-up, not part of this spec.

### Phase 1: Layout setting, tabs, bar, side menu

- **`mobile/src/features/settings/appLayout.ts` (new):**
  - `type AppLayout = "classic" | "tabs" | "monos"`, key `layout.app`, with the migration in AC-1.
  - `useAppLayout()` returns `[layout, setLayout]` with the same `useSyncExternalStore` pattern as
    `monoOnly.ts`.
  - `type TabBarStyle = "floating" | "fixed"`, key `layout.tabBar`, default `"floating"`, via
    `useTabBarStyle()`.
- **`monoOnly.ts`:**
  - `useMonoOnlyLayout()` becomes a wrapper: `[layout === "monos", (on) => setLayout(on ? "monos" : "classic")]`.
    Existing callers stay unchanged.
  - `useChangeLayout` takes `next: AppLayout` and calls `setLayout(next)`.
  - Update the one caller in `settings/index.tsx`.
- **`mobile/src/app/settings/index.tsx:243-262`:**
  - Replace the "Monos only" switch with a `SegmentedSwitch` of Classic / Tabs / Monos only (Monos only
    present only when `MONOS_ENABLED`).
  - When the layout is tabs, add a second row with a `SegmentedSwitch` of Floating / Fixed.
  - Copy is in UI details.
- **Route group `mobile/src/app/(tabs)/`:**
  - `_layout.tsx`: `Tabs` from `expo-router`, with:
    - `screenOptions={{ headerShown: false, lazy: true, freezeOnBlur: true, animation: "none" }}`
    - `tabBar={(props) => <HariTabBar {...props} />}`
    - `initialRouteName` from `readTabsMemory(desktop).tab`
  - Screens: `sessions.tsx`, `share.tsx`, `monos.tsx`, `computer.tsx`, `running.tsx`.
  - Each screen saves itself as the open tab in a focus effect (`useFocusEffect`), via
    `rememberTab(desktop, name)`.
  - The `(tabs)` route names must not collide with the existing `share` and `computer` routes. Expo Router
    resolves `/share` to the first match, so all navigation to tabs uses `/(tabs)/share` etc. explicitly.
    If `tsc` (typed routes) reports the collision, or the wrong screen opens, name the files
    `share-tab.tsx` and `computer-tab.tsx`.
- **`mobile/src/app/_layout.tsx`:**
  - Read `useAppLayout()`.
  - Add `<Stack.Screen name="(tabs)" />`.
  - When the layout is tabs:
    - `ScenePagerHost drawer={<TabsSideMenu />}`.
    - `SessionFrame standAside` (like Monos only), so the frame doesn't wrap the tabs.
    - Pushed screens (`project/[projectId]/session/[sessionId]`, `mono/[monoId]`, `tasks`, `notes`,
      `notifications`, `project/[projectId]/index`) use `screens.session` or `screens.page` push animation,
      not `animation: "none"`.
    - `WorkspaceLayout sidebar={false}`.
  - Keep the classic and monos branches identical to today.
- **`mobile/src/app/index.tsx`:** when the layout is tabs, `<Redirect href="/(tabs)/<saved tab or sessions>" />`.
- **`mobile/src/features/tabs/tabsMemory.ts` (new):**
  - Per desktop key `hari.tabs.<fingerprint>`, JSON validated on read:
    ```
    { tab: TabName; arcs: { sessions: { recent: string[]; selected: string | "all" }; monos: { recent: string[]; selected: string | "all" } } }
    ```
  - Pure functions `pushRecent(recent, id, max = 5)`, `pruneRecent(recent, existingIds)` and
    `nextSelection(...)` are exported for tests.
- **`mobile/src/features/tabs/HariTabBar.tsx` (new):**
  - Glass via `LiquidView` (the floating pill) or `GlassBackdrop`-equivalent mobile glass for fixed. Use
    the theme's tokens.
  - Highlight: an `Animated.View` with `translateX` (shared value) of `index * tabWidth`, springing with
    `withSpring({ damping: 20, stiffness: 220 })`, or `withTiming(…, { duration: 0 })` under reduce motion.
  - Thumb slide: `Gesture.Pan()` per the ordering contract, wrapped in a `GestureDetector` around the
    buttons row.
  - Buttons: `Pressable`, `accessibilityRole="tab"`, `accessibilityState={{ selected }}`, and a 48 dp
    minimum target.
  - Press feedback: scale to 0.94 on press-in.
  - Calls `navigation.emit({ type: "tabPress", target, canPreventDefault: true })`, then navigates. React
    Navigation's own `tabPress` gives scroll-to-top through `useScrollToTop(ref)` in each tab's list.
- **`mobile/src/features/tabs/TabsSideMenu.tsx` (new):**
  - Glass panel, four rows (Notes, Tasks, Notifications, Settings), each with an existing `Icon`.
  - Uses `drawer.closeThen(() => router.push(path))`.
  - Settings uses the existing `openModal` behavior, so on Android it closes first.
- **Header menu button:** each tab's header (a small row: title left, menu `CircleButton` right) calls
  `useDrawerActions().open()`.
- **Share tab:** `<SharePanel />`.
- **Computer tab:** `<ComputerControl active={isFocused} onOpenShare={() => navigation.navigate("share")} />`.

### Phase 2: Arc, kept views, icons

- **`mobile/src/features/tabs/PlaceArc.tsx` (new):**
  - Props: `items: ArcItem[]` (All first), `selectedId`, `onSelect(id)`, `onLongPress(id)`.
  - Layout: circles laid on an arc by index offset `d` from the selected index:
    - `translateX = d * 64`
    - `translateY = d² * 6`
    - `scale = d === 0 ? 1 : max(0.62, 1 - |d| * 0.16)`
    - `opacity = |d| > 2 ? 0 : 1`
    - Selected circle 72 pt; others 52 pt before scale.
  - The selected name shows under it in the accent colour, letter-spaced caps, as in the user's reference
    image.
  - Driven by one shared value `position` (a float index).
  - Pan updates `position = start - translationX / 64`. On end, it snaps to
    `clamp(round(position + velocityX / -2000), current - 2, current + 2)`, then fires one haptic per
    integer crossed while dragging.
  - Collapse: while the tab's list scrolls down more than 24 pt, the arc animates to `scale 0.6` and
    `translateY 30`, with opacity on the names. It restores on scroll up or scroll end. Transform and
    opacity only.
  - Accessibility: each circle is a button labelled with its name, and the selected one has
    `accessibilityState.selected`. Add `accessibilityActions` increment and decrement on the arc container.
- **`mobile/src/features/tabs/placeIcons.ts` (new):**
  - Key `hari.placeIcons.<fingerprint>`, value `Record<id, { kind: "icon"; name: IconName } | { kind: "emoji"; text: string }>`.
  - Validate on read: drop unknown icon names. For emoji, keep at most 1 grapheme by using
    `Intl.Segmenter` if available, else the first 8 UTF-16 units.
  - `usePlaceIcon(id)`, `setPlaceIcon` and `removePlaceIcon`.
- **`mobile/src/features/tabs/IconPickerSheet.tsx` (new):**
  - `ModalSheet` with:
    - A grid of the `Icon` names used in the app. Export a curated list `PLACE_ICON_NAMES` of 24 from
      `ui/Icon.tsx`'s set; don't invent names.
    - An emoji `TextInput`.
    - "Use letter" and "Done".
- **`ArcCircle`:** shows the icon, the emoji, or the letter on `projectColor(name)`. Monos use the same
  avatar component `MonoHome` rows use; find it in `MonoHome.tsx` near line 400.
- **Sessions tab (`(tabs)/sessions.tsx`):**
  - `selected === "all"`: a list of all projects (reuse the projects list rows from `app/projects/index.tsx`
    if they're exportable; otherwise a simple list styled like the drawer rows), each showing its running
    count. Tapping one selects it.
  - Otherwise, a stack of kept `SessionsPage` views, one per id in `recent`. Each is absolutely filled. The
    non-selected ones have `opacity: 0`, `pointerEvents="none"`, `accessibilityElementsHidden` and
    `importantForAccessibility="no-hide-descendants"`, and get `active={false}`. They're keyed by project
    id, so they don't remount.
  - Find what `SessionsPage` needs from `ProjectScreen` (`worktree`, `active` and others, near
    `ProjectScreen.tsx:507`) and pass the same values for a project with no worktree selection.
- **Monos tab (`(tabs)/monos.tsx`):**
  - `MonoHome`'s list. If it isn't separable from its header, extract the list part into
    `MonoList` in the same file and use it in both.
  - Arc selection on a Mono pushes `/mono/[monoId]`.

### Phase 3: + button and New session

- **`mobile/src/features/tabs/PlusButton.tsx` (new):**
  - 64 pt glass rounded square (radius 20) with the `plus` icon.
  - Positioned bottom-right: 16 pt from the right edge, and 12 pt above the arc's top on the Sessions and
    Monos tabs.
  - Press feedback: scale 0.92. Label "New session" or "New Mono".
- **`mobile/src/features/tabs/NewSessionSheet.tsx` (new):**
  - A `ModalSheet` listing projects per AC-17.
  - On pick: close, then on dismiss call `pushRecent`, then
    `router.push({ pathname: "/project/[projectId]", params: { projectId } })`.
  - The project route opens on the `"chat"` page by default (`ProjectPages.tsx:20`). Check that it doesn't
    call `rememberPlace` in a way that breaks tab restore: `rememberPlace` is for Classic, and it's harmless
    in Tabs since the index redirect ignores it there.
  - In the Tabs layout, `ProjectScreen`'s drawer swipe (`useDrawerSwipe`) must be off, since the drawer
    there is the side menu, and its back swipe goes back. Pass a new prop `inTabs` from the route when the
    layout is tabs; don't change Classic.

### Phase 4: Running tab

- **`mobile/src/features/tabs/runningRows.ts` (new):** a pure
  `runningRows(sessions, monos, projectsById): RunningRow[]` per AC-20.
  - Sessions: `isRunning(session)`.
  - Monos: `status !== "idle"`.
  - Sort key: `needsYou` (session `waiting`, or Mono `"needs-you"`) first, then `updatedAt` or
    `lastActiveAt` descending.
- **`(tabs)/running.tsx`:**
  - A `FlatList` of rows (reuse `SessionCard` or the drawer's running row visuals, if exported).
  - Tap: `router.push` to the session route or `/mono/[monoId]`.
  - Shows the AC-21 empty state.

### Records

- Rows for L-412 and L-413 in `docs/LOCAL-FEATURES.md` (feature row, file-table row, Last updated).
- A changelog entry in the Current file for each phase.

## UI details

- **Settings → Layout:**
  - Heading "Layout".
  - Segments "Classic", "Tabs", "Monos only".
  - Note under it, which changes with the choice:
    - Classic: "Projects and Monos in the side menu."
    - Tabs: "Sessions, Share, Monos, Computer and Running as tabs at the bottom."
    - Monos only: "A list of your Monos and their chats, with no sidebar or projects."
  - Second row "Tab bar": segments "Floating", "Fixed".
- **Tab labels and icons:** use existing `Icon` names; check `ui/Icon.tsx` for the closest match before
  adding any.
  - Sessions → `chat`
  - Share → the icon `SharePanel`'s header uses today
  - Monos → the Mono icon the drawer uses
  - Computer → the Computer icon the drawer uses
  - Running → `bolt` (as the drawer's "Working now" filter, `WorkspaceDrawer.tsx:379`)
- **Bar contents:** icons 22 pt and labels 11 pt, from theme type. Active tab: accent colour. Inactive: the
  theme's secondary text colour.
- **Side menu:** title "More". Rows "Notes", "Tasks", "Notifications", "Settings".
- **Arc circle menu (`ChoiceMenu`):** "Change icon", "Remove from arc". The All circle is labelled
  "All projects" (or "All Monos") and has no menu.
- **New session sheet:** title "New session", search placeholder "Search projects", rows with the project's
  arc icon or letter, name, and last-active time (`relativeTime.ts`).
- **Running:**
  - Header "Running". Row status text "Needs you" (accent) or "Working".
  - Empty state per AC-21.
- **Glass:** bar, arc circles, + button, sheets and side menu use the transparent glass look over the
  wallpaper (`LiquidView`), not solid fills.
- **Motion:**
  - Spring on highlight and arc; scale on press.
  - Tabs switch instantly (no cross-fade).
  - Nothing animates width, height or position props.

## Skills to load

`mobile-app`, `frontend-ui`, `testing`, and `spec-implement`.

## Test matrix

| AC or risk | Level | File | Scenario |
|---|---|---|---|
| AC-0.1 | unit | `mobile/tests/appConfig.test.ts` | Config with and without `APP_VARIANT=dev`; snapshot equality for release |
| AC-0.3 | unit | `mobile/tests/liveCards.test.ts` (extend or new) | URLs under schemes `hari-dev` and `monocode` (mock `expo-constants`) |
| AC-0.2 | unit | `mobile/tests/appVariant.test.ts` | `isDevVariant` true or false from mocked `Constants`; malformed `extra` → false |
| AC-1 | unit | `mobile/tests/appLayout.test.ts` | Migration table: none, monoOnly true, app=tabs, garbage |
| AC-2 | unit | `mobile/tests/appLayout.test.ts` | `useChangeLayout` order with fake timers: close → changing → reset → set; second call ignored |
| AC-12, 15 | unit | `mobile/tests/tabsMemory.test.ts` | `pushRecent` (front, dedupe, cap 5, drop oldest); `pruneRecent`; selection falls back to all |
| AC-15 risk | unit | `mobile/tests/tabsMemory.test.ts` | Empty project list before load → no prune |
| Memory read | unit | `mobile/tests/tabsMemory.test.ts` | Corrupt JSON, unknown tab, non-array recent → defaults |
| AC-16 | unit | `mobile/tests/placeIcons.test.ts` | Validation drops unknown icon names; emoji trimmed to 1 grapheme; remove deletes key |
| AC-6, 7, 13 | unit | `mobile/tests/tabGestures.test.ts` | Pure helpers `indexAt(x, width, count)`, `crossings(from, to)`, `snapIndex(position, velocity, current)` (fling capped at ±2), `cancelsSlide(dy)` |
| AC-20, 21 | unit | `mobile/tests/runningRows.test.ts` | Ordering example from AC-20; Mono sessions excluded from project rows; empty |
| AC-4, 5, 9, 10, 11, 17, 18 | manual | — | Navigation and mount behavior on device (see Manual checks); the repo has no RN render test setup (Vitest, node) |
| AC-23 | suite | existing | `npx vitest run` in `mobile/` stays green |

Keep the gesture and arc math in pure functions (`features/tabs/tabMath.ts`) so they're unit-testable.
Worklets call them (mark them `"worklet"`).

## Verification

- **Implementer runs, in `mobile/`:**
  - `npx tsc --noEmit`
  - `npx expo lint` (no new warnings in changed files)
  - `npx vitest run`
  - Root `npx vitest run src/platform/tauri/windowArgs.test.ts` isn't needed (no Tauri change).
- **Phase 0:** the implementer also runs `npm run android:dev` once if a phone is connected (`adb devices`
  shows one). If none is connected, they report that.
- **Later, not the implementer:** a release APK through `hari-release.yml`, to confirm the release config is
  unchanged.

## Manual checks (on the phone, by Nakul; never driven by the agent)

1. Hari Dev:
   - Installs beside Hari, named "Hari Dev".
   - Pairs.
   - Saving a file updates the phone in about 2 s.
   - A Live Update card opens Hari Dev.
   - No update prompt appears.
2. Switching to Tabs: the cover shows, then Sessions; after a restart, it opens on the last tab.
3. Share: scroll, switch to Computer and back; same place, with no reload flash. Repeat 10 times quickly;
   nothing sticks.
4. Bar:
   - The tap highlight glides.
   - Thumb slide across all tabs ticks each one.
   - Sliding up off the bar cancels.
   - Floating and Fixed both look right on the wallpaper and with the keyboard closed.
5. Arc:
   - Swipe, fling, tap.
   - The 6th project drops the oldest.
   - Change an icon (icon and emoji); "Use letter".
   - Remove from arc.
   - Scroll the list down; the arc shrinks, then comes back.
6. +: Sessions opens the picker, and picking opens the new-session composer without the bar. Monos opens
   New Mono.
7. Running: start a session on the desktop; it appears, then leaves when done. A waiting session is first.
8. Open a chat from each tab; there's no bar, and back returns to the same tab and scroll.
9. Side menu: right-edge swipe and header button; each of the 4 items opens over the tabs.
10. Classic and Monos only: still behave as before.
11. TalkBack: tabs announce their names and selected state; arc circles are reachable.

## Facts, decisions, assumptions

### Facts

The facts are as stated in Current behavior, with their file references.

### Decisions

- **Settings model:** a single `layout.app` value of three, not a second boolean. This avoids impossible
  combinations, and `useMonoOnlyLayout` stays as a wrapper so existing callers don't change.
- **Tab bar:** the JS `Tabs` navigator with a custom bar, not native tabs. The gliding highlight and thumb
  slide need it, and native tabs are unstable in 57.
- **Kept tabs:** `lazy` plus `freezeOnBlur`, so hidden tabs keep their state but don't re-render.
- **Mono arc:** selecting a Mono opens its chat (pushed). Selecting a project filters the session list in
  place. A Mono has no list of its own worth showing inside the tab, and its chat needs the full screen for
  its composer.
- **"All":** the first circle in both arcs. It shows the full project list, or the Mono list.
- **Running tab:** built from the phone's existing catalog and Mono roster, with no desktop change.
- **Hari Dev:** a separate package (`.dev`) and scheme (`hari-dev`), built locally with
  `expo run:android` (debug). There's no CI workflow for it (a CI change is Ask-first; it can be a
  follow-up).
- **New session:** opens the existing project new-session page, rather than a new composer.

### Assumptions (to verify while implementing)

- The Rust Android target and `cargo-ndk` are installed on this PC, which `native:android` needs. If not,
  stop at Phase 0 and report.
- `SessionsPage` can render outside `ProjectScreen` with the props it gets there. If it depends on the
  `ProjectScreen` context, wrap it in the same providers.
- `ComputerControl` doesn't depend on being inside `ComputerHub`, apart from `active` and `onOpenShare`.
- The `(tabs)` group can coexist with the root `share` and `computer` routes. If typed routes conflict, use
  the `-tab` file names.

## Open questions

- AC-20 lists S2, M1, S1, which breaks the spec's own rule (needs-you first, then recency). Built the rule: S2, S1, M1. Which is right?
- No catalog "loaded" flag exists; pruning runs only when the project list is non-empty (the fallback). Confirm.

None blocking. The user settled icons (phone only), "All" in the arc, and the layout as a toggle on
2026-11-27.

## Implementer report format

- Per AC: done, partial or not done, with `file:line` or the test name.
- Deviations from this spec and why.
- Open questions hit.
- Checks run, with results (tsc, lint, vitest counts; Phase 0 device run or "no phone connected").
- Files changed.
- Phases completed, if stopped early.

## Handoff retro

Stopped after Phases 0, 1 and 4 (no phone connected, so no device run). Phases 2 (place arc, icon picker, kept sessions pages, All list, MonoList) and 3 (+ button, new-session sheet, `inTabs` on ProjectScreen) are not built. The Sessions tab lists projects and the Monos tab lists Monos as plain lists. Share and Computer routes are `share-tab`/`computer-tab` (root `share` and `computer` exist). Next: Phase 2.

2026-11-28 (second pass, checked on the phone by screenshot): the worker's bar collapsed to a thin strip (`LiquidView fill` with no fixed parent height) and its highlight used a spring that overshot; fixed with no `fill` and a 240 ms cubic-out timing. The bar now reports its height through `BottomTabBarHeightCallbackContext`, so Share and Sessions place content above it. Phases 2 and 3 built: `PlaceArc` (one shared float `position`, continuous `arcPlacement`), `ArcMenu` + `IconPickerSheet`, `NewSessionSheet`, `PlusButton`; Sessions keeps visited project pages mounted inside `SheetLayout` (new optional `bottom` and `keyboardOffset`). Decisions: picking a place already on the arc does not reorder it (AC-20); circles fall back to the desktop mascot. Not done: arc collapse on scroll, `inTabs` on ProjectScreen (drawer swipe still on), recording a Mono as recent when opened from outside the Monos tab. Spec gaps: no rule for where the bar's height comes from; Monos arc behaviour on turn (vs tap) was unspecified, chosen: turn pins the Mono at the top of the list, tap opens its chat.

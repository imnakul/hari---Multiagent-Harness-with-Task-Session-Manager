# Progress — Hari phone app: auto-updates, icon, header blur, Interactive switch (L-235)

- Tier: Large · Branch: `nakul/windows-support-upstream-0.16.0` · Base: `d5f1e4ae` · Created 2026-11-07
- Repo: `imnakul/hari---Multiagent-Harness-with-Task-Session-Manager` (public; `nakul-fork` remote)
- Replaces, for now, the parts of [hari-release-pipeline-plan.md](hari-release-pipeline-plan.md) about CI and auto-update. That draft's desktop rebrand to Hari and the private build repo stay out of scope.

## Idea

Nakul paired the phone app (L-234) and found four things:

1. Claude's Interactive (terminal) mode can't be picked on the phone.
2. On Android the chat's top bar is see-through but not blurred, so the title is unreadable over the messages.
3. The phone app should be called **Hari** and use the peacock-feather icon (`public/monocode.png`) everywhere.
4. Installing every new build by hand is slow. He wants updates to arrive by themselves, for both the phone and the desktop.

Tasks, Notes and Automations on the phone are a separate discussion later.

## Locked decisions (2026-11-07)

- **Builds:** GitHub Actions on the existing public repo builds the desktop installer and the phone APK. It runs only when asked, through a version tag `hari-v<version>` or a manual run.
- **Desktop updates:** the existing Tauri updater (upstream's) reads `latest.json` from the repo's latest GitHub release. The sidebar "Update" button and Settings check already exist.
- **Phone updates:** Hari checks the latest GitHub release when it opens, and from a Settings button. It downloads the APK, and the user taps Update once in Android's installer. No Expo account, no app store.
- **Phone name and look:** "Hari", the peacock icon on a frosted-glass background (app icon, adaptive icon, splash).
- **Header:** a gradual blur that fades out behind the chat header on Android.
- **Interactive:** a Structured / Interactive choice in the phone's model sheet, under Claude.

## Research (facts checked in source at `d5f1e4ae`)

- **Desktop updater:**
  - `src/app/model/updater.ts` (`check()`, `runUpdateFlow`, `probeForUpdate`) runs from the sidebar (`SidebarUpdate.tsx`), the menu bar, Settings and App start.
  - `src-tauri/tauri.conf.json` has `plugins.updater = {pubkey:"", endpoints:[]}` and `bundle.createUpdaterArtifacts: true`.
  - Upstream fills both in at CI time (`release.yml` windows job, `scripts/release-channel.cjs`).
  - `RELEASES_URL` points at upstream's repo.
- **Phone versioning:**
  - `mobile/app.json` has name "MonoCode", version `1.0.0`, `runtimeVersion` fingerprint, `updates.url` (upstream's EAS project) and package `com.hardbeat920.monocodemobile`.
  - It has no `versionCode`, so every build is 1 and Android can't tell builds apart.
- **Phone install:**
  - `expo-file-system` (`File.downloadFileAsync`, `File.contentUri`), `expo-constants` and `expo-application` are installed.
  - `expo-intent-launcher` is not installed.
  - Android needs the `REQUEST_INSTALL_PACKAGES` permission and a `content://` URI with read permission to open the installer.
  - An update installs only if it is signed with the same key as the installed app.
- **Header blur:**
  - The session screen draws a top `GradualBlur` under the native header (`SessionScreen.tsx` ~597).
  - `GradualBlur` (`mobile/src/ui/GradualBlur.tsx`) uses `BlurView` without `blurMethod`/`blurTarget`. On Android, expo-blur then draws only a translucent tint, with no blur.
  - `LiquidView` already does real Android blur with `blurMethod="dimezisBlurViewSdk31Plus"` plus `blurTarget` (the `GlassBlurTarget` context that the session frame provides).
- **Interactive:**
  - The desktop's Structured / Interactive buttons are a UI-only control in `ModelPicker.tsx` (~804) that writes `modelSettings.claudeExecution`.
  - `mobileModels` sends each model's `settings`, and the phone shows every extra setting as a plain choice (`otherSettings` in `mobile/src/features/models/modelChoice.ts`).
  - `session.configure` applies phone choices through `onModelSettingsChange`, as the composer does, and `mergeModelSettings` keeps `claudeExecution`.
  - So adding the setting on the desktop side is enough.

## Plan

### Phone: name, icon, splash

- Generate the frosted-glass icon set from `public/monocode.png` with `jimp-compact` (already in `mobile/node_modules`). The script is `mobile/scripts/hari-icons.mjs`, so it can be rerun.
  - Background: an enlarged, blurred copy of the icon (its own colours as a soft glow), a translucent white pane, a light top edge and fine grain.
  - Outputs: `hari-icon.png` (1024, full), `hari-android-foreground.png` (icon in the 66% safe zone, transparent), `hari-android-background.png` (glass only), `hari-android-monochrome.png` (silhouette), `hari-splash.png` (icon only, transparent).
- New `mobile/app.config.js` (fork-only, so upstream's `app.json` merges stay clean). It takes `app.json`'s config and overrides:
  - `name` "Hari"; `version` from the root `package.json`.
  - `android.versionCode` = minor·10000 + patch·100 + local number. Example: `0.16.0-local27` → 160027.
  - Icons and splash from the new files.
  - `updates.enabled: false`, with the EAS URL removed.
  - Adds `REQUEST_INSTALL_PACKAGES`, `expo-intent-launcher` and `./plugins/with-hari-signing`.
  - `extra.hari` = `{ version, versionCode, repo }`, so the app knows its own build.
- `mobile/plugins/with-hari-signing.js`: when `HARI_KEYSTORE_PATH` is set, the release build signs with that keystore; otherwise it keeps the debug key.

### Phone: update check

- `mobile/src/features/updates/hariUpdate.ts` (pure, tested):
  - `parseHariManifest`, `isNewer(versionCode)`, and the release URL builders.
  - Reads `https://github.com/<repo>/releases/latest/download/hari-android.json` = `{version, versionCode, apk, notes}`.
- `mobile/src/features/updates/useHariUpdate.ts`:
  - Checks on launch, at most once every 6 hours, and on demand.
  - Downloads the APK to the cache, then opens Android's installer (`ACTION_VIEW`, `application/vnd.android.package-archive`, read-permission flag).
- UI:
  - A Settings card: "Updates", showing the current version, "Check for updates" and "Update to <v>".
  - A native dialog on launch when an update exists, with Update and Later.
  - Android only. iOS shows nothing.

### Phone: header blur

`GradualBlur` uses the same Android blur path as `LiquidView`: `blurMethod="dimezisBlurViewSdk31Plus"` with the `GlassBlurTarget` ref when one is present. Without a target it keeps today's tint.

### Desktop: Interactive on the phone

In `mobileModels`, Claude models (local projects only) get a setting `claudeExecution`, labelled "Mode", with the options Structured and Interactive and a description. Remote (SSH) projects don't get it, as on the desktop.

### Desktop: updater

- `tauri.conf.json`:
  - `plugins.updater.pubkey` = the new Hari public key.
  - `endpoints` = `https://github.com/imnakul/hari---Multiagent-Harness-with-Task-Session-Manager/releases/latest/download/latest.json`.
- The pubkey and endpoint live in `src-tauri/tauri.hari.conf.json` (`createUpdaterArtifacts:false`), which local `npm run build:windows` passes with `--config`; CI turns updater files on. It still builds without the private key; only CI makes signed update files.
- `RELEASES_URL` points at the Hari repo.

### CI: `.github/workflows/hari-release.yml`

- Trigger: tag `hari-v*` or `workflow_dispatch`. The version comes from `package.json` and must match the tag.
- Job `windows` (windows-latest): npm ci, then `tauri build --bundles nsis` with `TAURI_SIGNING_PRIVATE_KEY` and its password. It uploads the exe and `.sig`.
- Job `android` (ubuntu-latest):
  - Setup: Java 17, the Rust Android targets, cargo-ndk if needed, and the runner's NDK.
  - Build: `mobile` npm ci → `npm run native:android` → `expo prebuild` → `gradlew assembleRelease`, signed with the keystore secret.
  - Uploads the APK.
- Job `release`:
  - Writes `latest.json` (Tauri format, `windows-x86_64`) and `hari-android.json`.
  - Creates a GitHub release (not a prerelease, so `latest` points at it) with the exe, `.sig`, APK and both JSON files.
- Secrets: `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, `HARI_KEYSTORE_BASE64`, `HARI_KEYSTORE_PASSWORD`, `HARI_KEY_ALIAS`, `HARI_KEY_PASSWORD`.
- Key backup: `C:\Users\gclna\.hari-keys\`, outside the repo and never committed.

## Edge cases

- **First signed APK:** Android refuses it over today's debug-signed install. Uninstall once and pair again. After that, every update installs in place.
- **"Install unknown apps":** Android asks for this once. The app opens that settings screen if the permission is missing.
- **Version text order:** `local100` sorts below `local99` as text. Desktop semver compares prerelease parts numerically when they are digits only; `local27` is alphanumeric, so it compares as text. Keep two-digit local numbers until 0.17, or switch to `-local.27` then.
- **Offline or GitHub rate limit:** the check fails quietly on launch and shows the error only from the Settings button.
- **Download fails halfway:** the partial file is deleted and the user can try again.
- **Interactive on a remote project:** not offered (the desktop doesn't offer it either).

## Todos

- [x] Icon set generated and shown to Nakul
- [x] `app.config.js`, signing plugin, intent launcher installed
- [x] Update check, Settings card, launch prompt (a native dialog), with tests
- [x] GradualBlur Android blur
- [x] Interactive setting in `mobileModels`, with a test
- [x] Desktop updater config, local build override, `RELEASES_URL`
- [x] `hari-release.yml`
- [x] Keys generated, backed up, GitHub secrets set
- [x] Gates: root tsc and vitest, phone tsc and vitest
- [x] Records: LOCAL-FEATURES L-235, changelog
- [x] First release `hari-v0.16.0-local27`, assets copied to Installable versions (run 42363584267)
- [x] APK CI builds arm64 only (`ANDROID_ABIS=arm64-v8a`, `-PreactNativeArchitectures`) with Gradle cache: the first run took 36+ min for four chip types; both phones (Poco X8 Pro, Moto G54) are arm64. Ships with the first release.

## Manual checks (Nakul)

1. Phone: uninstall the old app, install the APK from the first release, and pair again. The app is named Hari, with the new icon and splash.
2. Phone: open a chat with long messages and scroll. The title stays readable over a blur.
3. Phone: the model sheet under Claude shows Mode (Structured / Interactive). Pick Interactive and send. The desktop runs the turn in its terminal.
4. After the next release: Hari offers "Update to …". One tap on Update installs it.
5. Desktop: install the release's installer once. On the next release, the sidebar shows Update and installs in place.

## Issues and fixes

- `npx expo install` on Windows dropped the `libc` markers from `mobile/package-lock.json`, which Linux CI needs to skip the wrong native packages. Rebuilt the lock from the previous one plus the new package only.
- Upstream's `updaterConfig.test.ts` expected the old releases link; updated to the fork's.
- `expo-intent-launcher` has no config plugin, so it isn't listed under `plugins`.
- First CI run: Gradle ran out of class memory (`OutOfMemoryError: Metaspace` in `expo-updates:kspReleaseKotlin`) with Expo's default `-XX:MaxMetaspaceSize=512m` and hung for 30 min. Cancelled; the workflow now raises Gradle to 6 GB / 2 GB Metaspace after prebuild, builds arm64 only, and stops the APK job after 45 min. Tag `hari-v0.16.0-local27` moved to the fix commit (no release had been published).
- Second CI run: Gradle stopped with `Process 'command 'node'' finished with non-zero exit value 1`. The generated `gradle.properties` has no final line break, so the appended `kotlin.daemon.jvmargs` line joined `expo.inlineModules.watchedDirectories=[]`. Fixed by writing a line break first; tag moved again.

## Learnings

- Keep `app.json` and `tauri.conf.json` as upstream's: the fork's Hari settings live in `app.config.js` and `tauri.hari.conf.json`, so merges stay clean.
- expo-blur blurs on Android only with `blurMethod` and a `blurTarget`; without them it draws a tint. The Android path uses one unmasked blur plus a fading tint (masking a real blur on Android is untested; check on the phone).

## Done

(Filled in at the end.)

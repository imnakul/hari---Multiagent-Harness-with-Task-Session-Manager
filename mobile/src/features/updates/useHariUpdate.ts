// Fork (Hari, L-235): checks the fork's GitHub releases for a newer Hari,
// downloads its APK and hands it to Android's installer, where one tap on
// Update installs it over this app. Shared by the launch prompt and Settings.
import Constants from "expo-constants";
import { File, Paths } from "expo-file-system";
import { startActivityAsync } from "expo-intent-launcher";
import Storage from "expo-sqlite/kv-store";
import { useSyncExternalStore } from "react";
import { Linking, Platform } from "react-native";

import {
  installedBuild,
  launchCheckDue,
  manifestUrl,
  newerRelease,
  parseHariManifest,
  releasesUrl,
  type HariRelease,
} from "./hariUpdate";

export type HariUpdateState =
  | { status: "idle" | "checking" | "current" }
  | { status: "available"; release: HariRelease }
  | { status: "downloading"; release: HariRelease; progress: number }
  | { status: "error"; message: string; release?: HariRelease };

const LAST_CHECK_KEY = "hari.update.lastCheckedAt";
// Android's ACTION_VIEW, and Intent.FLAG_GRANT_READ_URI_PERMISSION so the
// installer may read the APK from this app's cache.
const ACTION_VIEW = "android.intent.action.VIEW";
const GRANT_READ = 1;
const APK_TYPE = "application/vnd.android.package-archive";

export const installed = installedBuild(Constants.expoConfig?.extra);
/** In-app updates run only in Android builds made as Hari. */
export const updatesSupported = Platform.OS === "android" && !!installed;

let state: HariUpdateState = { status: "idle" };
const listeners = new Set<() => void>();
const set = (next: HariUpdateState) => {
  state = next;
  for (const listener of listeners) listener();
};

export function useHariUpdate() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
  );
}

/**
 * Looks for a newer release. Quiet (launch) checks run at most every few
 * hours and leave errors unshown; the Settings button always checks.
 */
export async function checkForHariUpdate(quiet = false): Promise<HariRelease | undefined> {
  if (!updatesSupported || !installed) return;
  if (state.status === "checking" || state.status === "downloading") return;
  if (quiet) {
    const last = Number(Storage.getItemSync(LAST_CHECK_KEY) ?? NaN);
    if (!launchCheckDue(Number.isFinite(last) ? last : undefined, Date.now())) return;
  }
  set({ status: "checking" });
  // A check from Settings shows its spinner for a moment, even when GitHub
  // answers at once, so the tap visibly did something (L-235).
  const shown = quiet ? undefined : new Promise((done) => setTimeout(done, 700));
  try {
    const response = await fetch(manifestUrl(installed.repo), { cache: "no-store" });
    await shown;
    if (response.status === 404) {
      set({ status: "current" });
      return;
    }
    if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
    const release = newerRelease(installed, parseHariManifest(await response.json()));
    void Storage.setItem(LAST_CHECK_KEY, String(Date.now()));
    set(release ? { status: "available", release } : { status: "current" });
    return release;
  } catch (error) {
    await shown;
    set(
      quiet
        ? { status: "idle" }
        : { status: "error", message: error instanceof Error ? error.message : String(error) },
    );
  }
}

/** Downloads the release's APK and opens Android's installer for it. */
export async function installHariUpdate(release: HariRelease) {
  if (!updatesSupported || state.status === "downloading") return;
  set({ status: "downloading", release, progress: 0 });
  const target = new File(Paths.cache, "hari-update.apk");
  try {
    if (target.exists) target.delete();
    const apk = await File.downloadFileAsync(release.apk, target, {
      idempotent: true,
      onProgress: ({ bytesWritten, totalBytes }) => {
        if (totalBytes > 0 && state.status === "downloading")
          set({ ...state, progress: bytesWritten / totalBytes });
      },
    });
    set({ status: "available", release });
    // Android asks once to allow installs from Hari, then shows Update.
    await startActivityAsync(ACTION_VIEW, {
      data: apk.contentUri,
      type: APK_TYPE,
      flags: GRANT_READ,
    });
  } catch (error) {
    try {
      if (target.exists) target.delete();
    } catch {}
    set({
      status: "error",
      release,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

/** The release page, for installing by hand if the in-app install fails. */
export function openHariReleases() {
  if (installed) void Linking.openURL(releasesUrl(installed.repo));
}

// Fork (Hari, L-235): Hari updates itself from the fork's GitHub releases.
// Each release carries hari-android.json, which names the APK and its build
// number; the app compares that with its own and offers the newer one.

export type HariBuild = { version: string; versionCode: number; repo: string };

export type HariRelease = {
  version: string;
  versionCode: number;
  apk: string;
  notes?: string;
};

/** Where the latest release's manifest lives. */
export function manifestUrl(repo: string) {
  return `https://github.com/${repo}/releases/latest/download/hari-android.json`;
}

/** The release page, for when the in-app install can't run. */
export function releasesUrl(repo: string) {
  return `https://github.com/${repo}/releases/latest`;
}

/** The manifest, if it is well formed and its APK is a GitHub https link. */
export function parseHariManifest(value: unknown): HariRelease | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const raw = value as Record<string, unknown>;
  if (typeof raw.version !== "string" || !raw.version) return;
  if (typeof raw.versionCode !== "number" || !Number.isInteger(raw.versionCode)) return;
  if (typeof raw.apk !== "string") return;
  let apk: URL;
  try {
    apk = new URL(raw.apk);
  } catch {
    return;
  }
  if (apk.protocol !== "https:" || apk.hostname !== "github.com") return;
  return {
    version: raw.version,
    versionCode: raw.versionCode,
    apk: apk.toString(),
    ...(typeof raw.notes === "string" && raw.notes ? { notes: raw.notes.slice(0, 2000) } : {}),
  };
}

/** The build this app was made as, from app.config.js's `extra.hari`. */
export function installedBuild(extra: unknown): HariBuild | undefined {
  const hari = (extra as { hari?: Partial<HariBuild> } | undefined)?.hari;
  if (
    !hari ||
    typeof hari.version !== "string" ||
    typeof hari.versionCode !== "number" ||
    typeof hari.repo !== "string"
  )
    return;
  return { version: hari.version, versionCode: hari.versionCode, repo: hari.repo };
}

/** The release, when it is newer than what is installed. */
export function newerRelease(
  installed: HariBuild,
  release: HariRelease | undefined,
): HariRelease | undefined {
  return release && release.versionCode > installed.versionCode ? release : undefined;
}

/** Launch checks run at most this often; the Settings button always checks. */
export const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

export function launchCheckDue(lastCheckedAt: number | undefined, now: number) {
  return lastCheckedAt == null || now < lastCheckedAt || now - lastCheckedAt >= CHECK_INTERVAL_MS;
}

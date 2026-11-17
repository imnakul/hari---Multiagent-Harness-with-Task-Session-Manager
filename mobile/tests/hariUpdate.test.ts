import { describe, expect, it } from "vitest";
import {
  apkSources,
  CHECK_INTERVAL_MS,
  checkResult,
  installedBuild,
  launchCheckDue,
  manifestUrl,
  newerRelease,
  parseHariManifest,
} from "@/features/updates/hariUpdate";

const repo = "imnakul/hari---Multiagent-Harness-with-Task-Session-Manager";
const apk = `https://github.com/${repo}/releases/download/hari-v0.16.0-local28/Hari.apk`;

describe("Hari updates", () => {
  it("reads the latest release's manifest", () => {
    expect(manifestUrl(repo)).toBe(
      `https://github.com/${repo}/releases/latest/download/hari-android.json`,
    );
    expect(parseHariManifest({ version: "0.16.0-local28", versionCode: 160028, apk })).toEqual({
      version: "0.16.0-local28",
      versionCode: 160028,
      apk,
    });
  });

  it("rejects manifests that are malformed or point away from GitHub", () => {
    expect(parseHariManifest(null)).toBeUndefined();
    expect(parseHariManifest({ version: "x", versionCode: "160028", apk })).toBeUndefined();
    expect(parseHariManifest({ version: "x", versionCode: 1.5, apk })).toBeUndefined();
    expect(parseHariManifest({ version: "x", versionCode: 1, apk: "http://github.com/a.apk" })).toBeUndefined();
    expect(parseHariManifest({ version: "x", versionCode: 1, apk: "https://evil.example/a.apk" })).toBeUndefined();
    expect(parseHariManifest({ version: "x", versionCode: 1, apk: "not a url" })).toBeUndefined();
  });

  it("takes an APK on the repo owner's GitHub Pages", () => {
    const pages = "https://imnakul.github.io/hari---Multiagent-Harness-with-Task-Session-Manager/Hari.apk";
    const base = { version: "0.16.0-local55", versionCode: 160055 };
    expect(parseHariManifest({ ...base, apk: pages }, repo)).toEqual({ ...base, apk: pages });
    expect(parseHariManifest({ ...base, apk: "https://someone.github.io/Hari.apk" }, repo)).toBeUndefined();
    expect(parseHariManifest({ ...base, apk: "http://imnakul.github.io/Hari.apk" }, repo)).toBeUndefined();
    // Without the repo, only GitHub itself.
    expect(parseHariManifest({ ...base, apk: pages })).toBeUndefined();
  });

  it("keeps the release's own APK as a backup to Pages (L-327)", () => {
    const pages = "https://imnakul.github.io/hari/Hari_1_android.apk";
    const backup = "https://github.com/imnakul/hari/releases/download/hari-v1/Hari_1_android.apk";
    const release = parseHariManifest(
      { version: "1", versionCode: 2, apk: pages, apkBackup: backup },
      "imnakul/hari",
    );
    expect(release?.apkBackup).toBe(backup);
    expect(release && apkSources(release)).toEqual([pages, backup]);
    const offsite = parseHariManifest(
      { version: "1", versionCode: 2, apk: pages, apkBackup: "https://example.com/x.apk" },
      "imnakul/hari",
    );
    expect(offsite?.apkBackup).toBeUndefined();
    expect(offsite && apkSources(offsite)).toEqual([pages]);
  });

  it("offers only a higher build number", () => {
    const installed = { version: "0.16.0-local27", versionCode: 160027, repo };
    const release = parseHariManifest({ version: "0.16.0-local28", versionCode: 160028, apk });
    expect(newerRelease(installed, release)).toEqual(release);
    expect(newerRelease({ ...installed, versionCode: 160028 }, release)).toBeUndefined();
    expect(newerRelease(installed, undefined)).toBeUndefined();
  });

  it("never calls a manifest it cannot read Up to date (L-322)", () => {
    const installed = { version: "0.16.0-local54", versionCode: 160054, repo };
    const pages = "https://imnakul.github.io/hari---Multiagent-Harness-with-Task-Session-Manager/Hari.apk";
    const base = { version: "0.16.0-local55", versionCode: 160055 };
    expect(checkResult(installed, { ...base, apk: pages })).toEqual({
      kind: "newer",
      release: { ...base, apk: pages },
    });
    expect(checkResult({ ...installed, versionCode: 160055 }, { ...base, apk: pages })).toEqual({ kind: "current" });
    expect(checkResult(installed, { ...base, apk: "https://evil.example/Hari.apk" })).toEqual({ kind: "unreadable" });
    expect(checkResult(installed, { version: "x" })).toEqual({ kind: "unreadable" });
  });

  it("knows its own build from the app config", () => {
    expect(installedBuild({ hari: { version: "0.16.0-local27", versionCode: 160027, repo } })).toEqual({
      version: "0.16.0-local27",
      versionCode: 160027,
      repo,
    });
    expect(installedBuild({})).toBeUndefined();
    expect(installedBuild(undefined)).toBeUndefined();
  });

  it("checks on launch at most every six hours", () => {
    const now = 1_000_000_000;
    expect(launchCheckDue(undefined, now)).toBe(true);
    expect(launchCheckDue(now - 60_000, now)).toBe(false);
    expect(launchCheckDue(now - CHECK_INTERVAL_MS, now)).toBe(true);
    // A clock set back still checks rather than waiting for days.
    expect(launchCheckDue(now + 60_000, now)).toBe(true);
  });
});

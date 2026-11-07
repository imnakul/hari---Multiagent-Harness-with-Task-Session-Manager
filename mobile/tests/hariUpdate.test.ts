import { describe, expect, it } from "vitest";
import {
  CHECK_INTERVAL_MS,
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

  it("offers only a higher build number", () => {
    const installed = { version: "0.16.0-local27", versionCode: 160027, repo };
    const release = parseHariManifest({ version: "0.16.0-local28", versionCode: 160028, apk });
    expect(newerRelease(installed, release)).toEqual(release);
    expect(newerRelease({ ...installed, versionCode: 160028 }, release)).toBeUndefined();
    expect(newerRelease(installed, undefined)).toBeUndefined();
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

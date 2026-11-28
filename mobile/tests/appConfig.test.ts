import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

import releaseSnapshot from "./fixtures/appConfig.release.json";

const require = createRequire(import.meta.url);
const { buildConfig, versionCode } = require("../app.config.js") as {
  buildConfig: (config: unknown, variant: "dev" | "release") => Record<string, any>;
  versionCode: (version: string) => number;
};
const { version } = require("../../package.json") as { version: string };

/**
 * The snapshot with this release's version in it: each release bumps the
 * version, and that is the only part of the release config meant to change.
 */
function expectedRelease(): typeof releaseSnapshot {
  const expected = structuredClone(releaseSnapshot);
  const code = versionCode(version);
  expected.version = version;
  expected.android.versionCode = code;
  expected.extra.hari.version = version;
  expected.extra.hari.versionCode = code;
  return expected;
}
const { expo } = require("../app.json") as { expo: unknown };

describe("app.config.js variants (L-413)", () => {
  it("leaves the release config exactly as it was at snapshot c70ef78c", () => {
    const release = buildConfig(structuredClone(expo), "release");
    expect(JSON.parse(JSON.stringify(release))).toEqual(expectedRelease());
    expect(release.name).toBe("Hari");
    expect(release.scheme).toBe("monocode");
    expect(release.android.package).toBe("com.hardbeat920.monocodemobile");
    expect(release.extra.hari.variant).toBeUndefined();
  });

  it("makes Hari Dev with its own name, package and scheme", () => {
    const dev = buildConfig(structuredClone(expo), "dev");
    expect(dev.name).toBe("Hari Dev");
    expect(dev.android.package).toBe("com.hardbeat920.monocodemobile.dev");
    expect(dev.scheme).toBe("hari-dev");
    expect(dev.extra.hari.variant).toBe("dev");
    expect(dev.android.versionCode).toBe(versionCode(version));
    expect(dev.updates).toEqual({ enabled: false });
  });
});

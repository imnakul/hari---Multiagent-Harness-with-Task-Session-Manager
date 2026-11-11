import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const native = (name: string) =>
  readFileSync(join(import.meta.dirname, "../modules/hari-live/android/src/main/java/expo/modules/harilive", name), "utf8");

// Fork (Hari, L-247): the Kotlin isn't built in these tests, so this guards the
// one rule whose breakage only shows on a phone, as a crash on every launch.
describe("Live Update service", () => {
  it("is started plainly, so Android can't close the app for a late startForeground", () => {
    const code = native("HariLive.kt").replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/startForegroundService\s*\(/);
    expect(code).toMatch(/startService\s*\(/);
  });

  it("stops without a placeholder when it has no card", () => {
    const code = native("HariLiveService.kt");
    expect(code).not.toMatch(/placeholder\s*\(/);
    expect(code).toMatch(/ForegroundServiceStartNotAllowedException/);
  });
});

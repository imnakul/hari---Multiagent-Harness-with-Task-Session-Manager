import { beforeEach, describe, expect, it, vi } from "vitest";

const constants = vi.hoisted(() => ({ expoConfig: undefined as unknown }));
vi.mock("expo-constants", () => ({ default: constants }));

import { appScheme, isDevVariant } from "@/features/updates/appVariant";

describe("app variant", () => {
  beforeEach(() => {
    constants.expoConfig = undefined;
  });

  it("is dev only when extra.hari.variant is 'dev'", () => {
    constants.expoConfig = { extra: { hari: { variant: "dev" } } };
    expect(isDevVariant()).toBe(true);
    constants.expoConfig = { extra: { hari: { variant: "release" } } };
    expect(isDevVariant()).toBe(false);
    constants.expoConfig = { extra: { hari: {} } };
    expect(isDevVariant()).toBe(false);
  });

  it("reads malformed extra as the release app", () => {
    for (const extra of [null, "dev", 4, { hari: "dev" }, { hari: null }, undefined]) {
      constants.expoConfig = { extra };
      expect(isDevVariant()).toBe(false);
    }
    expect(isDevVariant()).toBe(false);
  });

  it("answers to the configured scheme, else monocode", () => {
    constants.expoConfig = { scheme: "hari-dev" };
    expect(appScheme()).toBe("hari-dev");
    constants.expoConfig = { scheme: ["hari-dev", "x"] };
    expect(appScheme()).toBe("hari-dev");
    constants.expoConfig = { scheme: 3 };
    expect(appScheme()).toBe("monocode");
    constants.expoConfig = undefined;
    expect(appScheme()).toBe("monocode");
  });
});

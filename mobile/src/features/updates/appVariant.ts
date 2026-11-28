// Fork (Hari, L-413): tells Hari from Hari Dev, the debug build that installs beside it.
import Constants from "expo-constants";

const RELEASE_SCHEME = "monocode";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** True in Hari Dev. A missing or malformed `extra.hari` reads as the release app. */
export function isDevVariant(): boolean {
  const extra: unknown = Constants.expoConfig?.extra;
  const hari = isRecord(extra) ? extra.hari : undefined;
  return isRecord(hari) && hari.variant === "dev";
}

/** The link scheme this build answers to: `hari-dev` in Hari Dev, else `monocode`. */
export function appScheme(): string {
  const scheme: unknown = Constants.expoConfig?.scheme;
  if (typeof scheme === "string" && scheme.length > 0) return scheme;
  return Array.isArray(scheme) && typeof scheme[0] === "string" ? scheme[0] : RELEASE_SCHEME;
}

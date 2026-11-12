import { invoke } from "@tauri-apps/api/core";
import type { HarnessId } from "../../sessions/model/session";
import { getCustomBinary, setCustomBinary } from "../../../integrations/harness/core/customBinary";

export type ConfigurableBinaryProvider = HarnessId;

const STORAGE_KEY = "monocode.providerBinaryPaths.v1";

type StoredBinaryPaths = Partial<Record<ConfigurableBinaryProvider, string>>;
const CONFIGURABLE_PROVIDERS: ConfigurableBinaryProvider[] = [
  "claude",
  "codex",
  "cursor",
  "grok",
  "opencode",
  "pi",
  "omp",
  "fx",
  "antigravity-cli",
  "cline",
  "hermes",
  "command-code",
];

function readProviderBinaryPaths(): StoredBinaryPaths {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return {};
    }
    const stored = Object.fromEntries(
      Object.entries(value).filter(([, path]) => typeof path === "string"),
    ) as StoredBinaryPaths;
    const migrated: ConfigurableBinaryProvider[] = [];
    for (const provider of CONFIGURABLE_PROVIDERS) {
      if (stored[provider]) continue;
      const legacyPath = getCustomBinary(provider);
      if (!legacyPath) continue;
      stored[provider] = legacyPath;
      migrated.push(provider);
    }
    if (migrated.length > 0) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
        for (const provider of migrated) setCustomBinary(provider, null);
      } catch {
        // Keep the old values until the versioned settings can be written.
      }
    }
    return stored;
  } catch {
    return {};
  }
}

const runtimeBinaryPaths = readProviderBinaryPaths();

export async function initializeProviderBinaryPaths(): Promise<void> {
  const active = await invoke<StoredBinaryPaths>("harness_runtime_binary_paths", {
    paths: readProviderBinaryPaths(),
  });
  for (const provider of Object.keys(runtimeBinaryPaths)) {
    delete runtimeBinaryPaths[provider as ConfigurableBinaryProvider];
  }
  Object.assign(runtimeBinaryPaths, active);
}

export function runtimeProviderBinaryPath(
  provider: ConfigurableBinaryProvider,
): string | null {
  const path = runtimeBinaryPaths[provider];
  return typeof path === "string" && path.trim() ? path.trim() : null;
}

export function loadProviderBinaryPath(
  provider: ConfigurableBinaryProvider,
): string | null {
  const path = readProviderBinaryPaths()[provider];
  return typeof path === "string" && path.trim() ? path.trim() : null;
}

export function providerBinaryPathChangePending(
  provider: ConfigurableBinaryProvider,
): boolean {
  return runtimeProviderBinaryPath(provider) !== loadProviderBinaryPath(provider);
}

export function saveProviderBinaryPath(
  provider: ConfigurableBinaryProvider,
  path: string | null,
): boolean {
  try {
    const stored = readProviderBinaryPaths();
    const value = path?.trim();
    if (value) stored[provider] = value;
    else delete stored[provider];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
    // Once the versioned setting is durable it must be the only source, so a
    // cleared override cannot be resurrected by the legacy fallback.
    setCustomBinary(provider, null);
    return true;
  } catch {
    return false;
  }
}

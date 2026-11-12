import type { HarnessId } from "../../../features/sessions/model/session";
import { execChild } from "./child";

/**
 * npm-distributed agent CLIs we can version-check honestly. Curl/script
 * channels (grok, omp, fx, hermes) and the ACP zip (antigravity) are skipped
 * on purpose — no registry to read, no fake coverage.
 */
export const CLI_UPDATE_CHANNELS: Partial<
  Record<HarnessId, { packageName: string; updateCommand: string }>
> = {
  claude: {
    packageName: "@anthropic-ai/claude-code",
    updateCommand: "npm i -g @anthropic-ai/claude-code",
  },
  codex: {
    packageName: "@openai/codex",
    updateCommand: "npm i -g @openai/codex",
  },
  pi: {
    packageName: "@earendil-works/pi-coding-agent",
    updateCommand: "npm i -g @earendil-works/pi-coding-agent",
  },
  // Fork (L-255): Command Code ships on npm as `command-code` (binary `cmdc`).
  "command-code": {
    packageName: "command-code",
    updateCommand: "npm i -g command-code",
  },
  cline: {
    packageName: "cline",
    updateCommand: "npm i -g cline",
  },
};

export type CliUpdateNotice = {
  harness: HarnessId;
  currentVersion: string;
  latestVersion: string;
  updateCommand: string;
};

/** First `x.y.z` in a CLI's `--version` output. */
export function parseCliVersion(output: string): string | null {
  return /\d+\.\d+\.\d+/.exec(output)?.[0] ?? null;
}

/** Negative when `left` is older than `right`; segments compare numerically. */
export function compareCliVersions(left: string, right: string): number {
  const a = left.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const b = right.split(".").map((part) => Number.parseInt(part, 10) || 0);
  for (let i = 0; i < 3; i += 1) {
    const delta = (a[i] ?? 0) - (b[i] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

type RegistryLatest = { version?: unknown };

/**
 * npm registry `latest` dist-tag version. Returns null on any failure — this
 * is a hint, never a blocker (offline, CORS drift, private registries).
 */
export async function fetchLatestCliVersion(
  packageName: string,
): Promise<string | null> {
  try {
    const response = await fetch(
      `https://registry.npmjs.org/${encodeURIComponent(packageName)}/latest`,
    );
    if (!response.ok) return null;
    const payload = (await response.json()) as RegistryLatest;
    return typeof payload.version === "string" ? payload.version : null;
  } catch {
    return null;
  }
}

/**
 * Compare installed CLIs' `--version` output with npm `latest`. Never throws;
 * unprobeable or up-to-date harnesses simply produce no notice.
 */
export async function checkCliUpdates(
  binaries: Partial<Record<HarnessId, string>>,
  deps?: {
    fetchLatest?: (packageName: string) => Promise<string | null>;
    readVersion?: (binary: string) => Promise<string>;
  },
): Promise<CliUpdateNotice[]> {
  const fetchLatest = deps?.fetchLatest ?? fetchLatestCliVersion;
  const readVersion =
    deps?.readVersion ?? ((binary: string) => execChild(binary, ["--version"], undefined));
  const notices: CliUpdateNotice[] = [];
  for (const [harness, binary] of Object.entries(binaries) as [
    HarnessId,
    string,
  ][]) {
    const channel = CLI_UPDATE_CHANNELS[harness];
    if (!channel || !binary) continue;
    try {
      const current = parseCliVersion(await readVersion(binary));
      if (!current) continue;
      const latest = await fetchLatest(channel.packageName);
      if (!latest) continue;
      if (compareCliVersions(current, latest) < 0) {
        notices.push({
          harness,
          currentVersion: current,
          latestVersion: latest,
          updateCommand: channel.updateCommand,
        });
      }
    } catch {
      // Hint only: a missing/failing CLI or registry must never surface.
    }
  }
  return notices;
}

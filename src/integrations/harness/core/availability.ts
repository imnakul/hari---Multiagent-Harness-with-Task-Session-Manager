import type { HarnessId } from "../../../features/sessions/model/session";
import { HARNESSES } from "../../../features/sessions/model/session";
import { probeHarnessBinary } from "./child";
import { isLiveHarness } from "./registry";
import { IS_WIN } from "../../../platform/tauri/platform";
import {
  harnessAvailabilityProbedAt,
  markHarnessAvailabilityProbed,
  resetHarnessAvailabilityState,
  setHarnessAvailability,
  type HarnessAvailability,
} from "./availabilityState";

export type { HarnessAvailability } from "./availabilityState";
export {
  getHarnessAvailabilitySnapshot,
  hasHarnessEvidence,
  hasProbedHarnessAvailability,
  isHarnessAvailable,
  subscribeHarnessAvailability,
} from "./availabilityState";

/**
 * We only ever check whether the binary exists, never whether it is
 * authenticated, so the hint must not blame a login.
 */
const CLI: Record<HarnessId, { name: string; install?: string }> = {
  claude: { name: "Claude Code CLI" },
  codex: { name: "Codex CLI" },
  cursor: { name: "Cursor CLI" },
  grok: {
    name: "Grok Build CLI",
    install: "curl -fsSL https://x.ai/cli/install.sh | bash",
  },
  opencode: { name: "OpenCode CLI" },
  pi: { name: "Pi CLI", install: "npm i -g @earendil-works/pi-coding-agent" },
  omp: { name: "omp CLI", install: "curl -fsSL https://omp.sh/install | sh" },
  fx: { name: "fx CLI", install: "curl -fsSL https://fx.sh/setup.sh | bash" },
  "antigravity-cli": { name: "Antigravity CLI (agy)", install: "Install agy from antigravity.google/docs/cli/install/" },
  cline: { name: "Cline CLI", install: "npm i -g cline" },
  // Fork (L-255): on Windows `cmd` is the system shell, so the CLI is `cmdc`.
  "command-code": {
    name: "Command Code CLI (cmdc)",
    install: "npm i -g command-code, then run cmdc login",
  },
  hermes: {
    name: "Hermes Agent CLI",
    install: "Install from hermes-agent.nousresearch.com, then run hermes model",
  },
  devin: {
    name: "Devin CLI",
    install: IS_WIN
      ? "irm https://static.devin.ai/cli/setup.ps1 | iex"
      : "curl -fsSL https://cli.devin.ai/install.sh | bash",
  },
};

let inflight: Promise<void> | null = null;
let probeGeneration = 0;

/**
 * A probe stats ~100 paths across the resolvers. The model picker and the
 * providers pane both probe on open, so without a TTL every open pays for it
 * again to learn what it already knows. Installing a CLI mid-session is rare,
 * and `force` covers it.
 */
const PROBE_TTL_MS = 30_000;

export function harnessUnavailableHint(id: HarnessId): string {
  const { name, install } = CLI[id];
  const how = install ? ` (\`${install}\`)` : "";
  return `${name} not found${how}. Install it, or restart MonoCode if it is already installed.`;
}

/** Test seam. */
export function resetHarnessAvailability(): void {
  probeGeneration += 1;
  inflight = null;
  resetHarnessAvailabilityState();
}

export function probeHarnessAvailability(
  options?: { force?: boolean },
): Promise<void> {
  if (inflight) return inflight;
  const lastProbe = harnessAvailabilityProbedAt();
  if (!options?.force && lastProbe > 0 && Date.now() - lastProbe < PROBE_TTL_MS) {
    return Promise.resolve();
  }

  const generation = probeGeneration;
  const pending = Promise.all(
    HARNESSES.map(async (id) => {
      if (!isLiveHarness(id)) return [id, false] as const;
      try {
        await probeHarnessBinary(id);
        return [id, true] as const;
      } catch {
        return [id, false] as const;
      }
    }),
  )
    .then((entries) => {
      if (generation !== probeGeneration) return;
      const updates: Partial<HarnessAvailability> = {};
      for (const [id, ok] of entries) updates[id] = ok;
      setHarnessAvailability(updates);
    })
    .finally(() => {
      if (generation !== probeGeneration) return;
      markHarnessAvailabilityProbed();
      inflight = null;
    });
  inflight = pending;
  return pending;
}

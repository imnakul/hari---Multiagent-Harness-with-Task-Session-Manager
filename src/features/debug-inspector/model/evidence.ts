import { invoke } from "@tauri-apps/api/core";
import type { UsageMeasurement, UsageScope } from "./trace";
import { finiteCount, metadataLabel } from "./trace";

export type LocalEvidence = {
  provider: "claude" | "codex";
  nativeId: string;
  accountId: string;
  source: string;
  observedAt: number;
  fileBytes: number;
  readBytes: number;
  truncated: boolean;
  changedDuringRead: boolean;
  malformedLines: number;
  partialLines: number;
  limitations: string[];
  measurements: UsageMeasurement[];
};

export function objectRecord(
  value: unknown,
): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : undefined;
}
const SCOPES: readonly UsageScope[] = [
  "message",
  "turn",
  "session-cumulative",
  "sdk-result",
  "last-response",
];
const LIMITATIONS: Record<string, string> = {
  headAndTailReadOnly:
    "Only a bounded head and tail were read; the middle is omitted.",
  incompleteLinesSkipped:
    "Partially written or boundary-crossing lines were skipped.",
  malformedLinesSkipped: "Malformed records were skipped.",
  oversizedLineSkipped: "Records larger than 128 KiB were skipped.",
  fileChangedDuringRead:
    "The transcript changed during the read; measurements may span snapshots.",
  lineLimitReached: "The complete-line limit was reached.",
  measurementLimitReached:
    "The 1,000 measurement limit was reached; later usage is omitted.",
  recordIdentityMismatchSkipped:
    "Records with a different native identity were skipped.",
  assistantMessageIdentityMissing:
    "Assistant usage without a message identity was skipped.",
  assistantMessageIdentityInvalid:
    "Assistant usage with an unsupported identity was skipped.",
  sdkResultIdentityMissing:
    "Some SDK-result snapshots lack a trusted identity and must not be summed.",
};

async function boundedInvoke(
  command: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      invoke<unknown>(command, args),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Local metadata read timed out.")),
          15_000,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Reconstruct IPC data from the metadata allowlist, never trusting a transcript payload. */
export function parseLocalEvidence(
  value: unknown,
  provider: "claude" | "codex",
  nativeId: string,
  accountId: string,
): LocalEvidence {
  const row = objectRecord(value);
  if (
    !row ||
    row.provider !== provider ||
    row.nativeId !== nativeId ||
    row.accountId !== accountId ||
    !Array.isArray(row.measurements) ||
    row.measurements.length > 1000
  )
    throw new Error("Local evidence identity or format did not match.");
  const requiredNumber = (key: string): number => {
    const count = finiteCount(row[key]);
    if (count === undefined)
      throw new Error("Local evidence metadata was incomplete.");
    return count;
  };
  const measurements = row.measurements.map((value): UsageMeasurement => {
    const item = objectRecord(value);
    const scope = SCOPES.find((scope) => scope === item?.scope);
    if (
      !item ||
      !scope ||
      typeof item.identity !== "string" ||
      item.identity.length > 256
    )
      throw new Error("Unsupported local usage record.");
    return {
      identity: item.identity,
      scope,
      model: metadataLabel(item.model),
      timestamp:
        typeof item.timestamp === "string" &&
        item.timestamp.length < 40 &&
        Number.isFinite(Date.parse(item.timestamp))
          ? item.timestamp
          : undefined,
      uncachedInput: finiteCount(item.uncachedInput),
      input: finiteCount(item.input),
      output: finiteCount(item.output),
      cacheRead: finiteCount(item.cacheRead),
      cacheWrite: finiteCount(item.cacheWrite),
      cacheWrite5m: finiteCount(item.cacheWrite5m),
      cacheWrite1h: finiteCount(item.cacheWrite1h),
      reasoning: finiteCount(item.reasoning),
      costUsd: finiteCount(item.costUsd),
    };
  });
  return {
    provider,
    nativeId,
    accountId,
    source: provider === "claude" ? "Claude Code JSONL" : "Codex rollout JSONL",
    observedAt: requiredNumber("observedAt"),
    fileBytes: requiredNumber("fileBytes"),
    readBytes: requiredNumber("readBytes"),
    truncated: row.truncated === true,
    changedDuringRead: row.changedDuringRead === true,
    malformedLines: requiredNumber("malformedLines"),
    partialLines: requiredNumber("partialLines"),
    // Backend limitations are fixed strings. Never surface unexpected untrusted error text.
    limitations: [
      "Historical file snapshot; no provider activity was requested.",
      "Only the bounded read region is covered. Other applications and compressed/database formats may be unavailable.",
      ...(Array.isArray(row.limitations)
        ? row.limitations.flatMap((key) =>
            typeof key === "string" && LIMITATIONS[key]
              ? [LIMITATIONS[key]]
              : [],
          )
        : []),
    ],
    measurements,
  };
}

export async function readLocalEvidence(
  provider: "claude" | "codex",
  nativeId: string,
  accountId: string,
): Promise<LocalEvidence> {
  if (
    !/^[a-zA-Z0-9_-]{1,128}$/.test(nativeId) ||
    !/^[a-zA-Z0-9_-]{1,128}$/.test(accountId)
  )
    throw new Error("Choose a valid native session and account.");
  const result = await boundedInvoke("debug_inspector_local_evidence", {
    provider,
    nativeId,
    accountId,
  });
  return parseLocalEvidence(result, provider, nativeId, accountId);
}

/** Direct database read avoids getSession's transcript repair/persistence side effects. */
export async function readStoredIdentity(
  sessionId: string,
  mono: boolean,
): Promise<{
  provider: "claude" | "codex";
  nativeId: string;
  accountId: string;
}> {
  const value = objectRecord(
    await boundedInvoke("debug_inspector_session_identity", {
      sessionId,
    }),
  );
  if (
    !value ||
    value.sessionId !== sessionId ||
    (value.provider !== "claude" && value.provider !== "codex") ||
    typeof value.nativeId !== "string" ||
    typeof value.accountId !== "string"
  )
    throw new Error("This chat has no supported native identity.");
  const accountId = value.accountId;
  if (mono && value.provider === "codex")
    throw new Error(
      "Mono's private Codex store is not supported by this reader.",
    );
  if (
    !/^[a-zA-Z0-9_-]{1,128}$/.test(value.nativeId) ||
    !/^[a-zA-Z0-9_-]{1,128}$/.test(accountId)
  )
    throw new Error("Native identity is unavailable.");
  return {
    provider: value.provider,
    nativeId: value.nativeId,
    accountId,
  };
}

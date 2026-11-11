import { invoke } from "@tauri-apps/api/core";
import { modelsFor } from "../../../features/sessions/model/models";
import {
  DEFAULT_RUNTIME_MODE,
  newSession,
  type HarnessId,
  type RuntimeMode,
  type Session,
} from "../../../features/sessions/model/session";
import { bindHarnessSession } from "./registry";

/** Sources the scanner can emit. File sources replay from transcripts;
 * database sources replay from `read_external_transcript`. Antigravity
 * rows are resume-only (protobuf step store, no transcript parser).
 */
export type ExternalSource =
  | "claude"
  | "codex"
  | "opencode"
  | "zcode"
  | "cline"
  | "antigravity";

/** Short pill labels for workspace source badges. */
export const SOURCE_LABEL: Record<ExternalSource, string> = {
  claude: "Claude",
  codex: "Codex",
  opencode: "OpenCode",
  zcode: "ZCode",
  cline: "Cline",
  antigravity: "Antigravity",
};

/** One row of the `scan_external_sessions` backend result. */
export type ExternalSessionInfo = {
  id: string;
  title: string;
  updatedAt?: string;
  messageCount: number;
  source: ExternalSource;
  cwd: string;
  file: string;
};

export type ExternalWorkspace = {
  workspacePath: string;
  sessionCount: number;
  /** Distinct sources in this workspace, in scanner order. */
  sources: string[];
  sessions: ExternalSessionInfo[];
};

/**
 * Which MonoCode harness natively resumes each external source.
 * ZCode has no harness (replay-only).
 */
export const NATIVE_HARNESS: Partial<Record<ExternalSource, HarnessId>> = {
  claude: "claude",
  codex: "codex",
  opencode: "opencode",
  cline: "cline",
  // Fork (L-244): Antigravity ACP is gone; its conversations resume in the CLI.
  antigravity: "antigravity-cli",
};

/** Sources with a transcript reader (everything but Antigravity). */
const REPLAYABLE_SOURCES: ReadonlySet<ExternalSource> = new Set([
  "claude",
  "codex",
  "opencode",
  "zcode",
  "cline",
]);

/** The harness a session would resume natively in, if any. */
export function nativeHarnessFor(
  info: ExternalSessionInfo,
): HarnessId | undefined {
  return NATIVE_HARNESS[info.source];
}

/** Whether a session can be replayed as history (Antigravity cannot). */
export function canReplay(info: ExternalSessionInfo): boolean {
  return REPLAYABLE_SOURCES.has(info.source);
}

/** Session titles stay tab-sized no matter how long the transcript title is. */
const MAX_IMPORT_TITLE_CHARS = 80;

export function truncateImportTitle(title: string): string {
  const single = title.split(/\s+/).join(" ").trim();
  if ([...single].length <= MAX_IMPORT_TITLE_CHARS) return single;
  return `${[...single].slice(0, MAX_IMPORT_TITLE_CHARS).join("")}…`;
}

/**
 * Scan `~/.claude/projects` + `~/.codex/sessions` via the backend.
 * Pure file reads — the scanner never spawns a CLI, so no console can flash.
 */
export async function scanExternalSessions(
  sinceDays: number,
  limit: number,
): Promise<ExternalWorkspace[]> {
  const workspaces = await invoke<ExternalWorkspace[]>(
    "scan_external_sessions",
    { sinceDays, limit },
  );
  if (!Array.isArray(workspaces)) return [];
  return workspaces.filter(
    (workspace): workspace is ExternalWorkspace =>
      !!workspace &&
      typeof workspace.workspacePath === "string" &&
      Array.isArray(workspace.sessions),
  );
}

/**
 * Export an sqlite-backed transcript (opencode/zcode) as ordered
 * `{role, time, parts}` JSON for the replay parsers. File sources go
 * through `readTextFile` instead.
 */
export async function readExternalTranscript(
  source: ExternalSource,
  sessionId: string,
): Promise<string> {
  return invoke<string>("read_external_transcript", {
    source,
    sessionId,
  });
}

/**
 * Use the requested model only when the harness catalog knows it. Otherwise
 * fall back to the provider default: a wrong-harness id (e.g. a claude id
 * on a codex session) would be worse than the default.
 */
export function resolveImportModel(
  harness: HarnessId,
  model?: string,
): string | undefined {
  if (!model) return undefined;
  return modelsFor(harness).some((known) => known.id === model)
    ? model
    : undefined;
}

export type NativeImportOptions = {
  model?: string;
  runtimeMode?: RuntimeMode;
};

/**
 * Build a MonoCode session that resumes an external session natively and
 * bind the native id through the adapter's existing resume seam, so the
 * first send issues `--resume` (Claude) / `thread/resume` (Codex) /
 * `--conversation` (AGY) instead of starting fresh.
 *
 * Returns the session for the caller to store; the caller sends the first
 * turn normally. Never sets `providerSessionId` up front — the adapter
 * reports it via `session.providerBound` once the CLI confirms the resume.
 * Throws for sources without a native harness (caller falls back to replay).
 */
export function createNativeResumeSession(
  info: ExternalSessionInfo,
  options: NativeImportOptions = {},
): Session {
  const harness = nativeHarnessFor(info);
  if (!harness) {
    throw new Error(`No native resume harness for source "${info.source}"`);
  }
  const nativeId = info.id.trim();
  if (!nativeId) {
    throw new Error("Cannot resume a session without a native id");
  }
  const cwd = info.cwd.trim() || "~";
  const session = newSession(
    harness,
    cwd,
    resolveImportModel(harness, options.model),
    options.runtimeMode ?? DEFAULT_RUNTIME_MODE,
  );
  const title = truncateImportTitle(info.title);
  session.title = title || session.title;
  bindHarnessSession(harness, session.id, nativeId, cwd);
  return session;
}

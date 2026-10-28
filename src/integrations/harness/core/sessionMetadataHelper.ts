import { continueTranscript } from "../../../features/sessions/model/continueCard";
import { HARNESS_TITLE, type Block, type HarnessId } from "../../../features/sessions/model/session";
import {
  buildLabelPrompt,
  buildNotesPrompt,
  loadSessionMetadataAi,
  notesInstructions,
  parseLabelReply,
  parseNotesReply,
  type NotesReply,
  type SessionMetadataAiSettings,
} from "../../../features/sessions/model/sessionMetadataAi";
import {
  buildPointsPrompt,
  parsePointsReply,
  taggedTranscript,
  type PointsReply,
  type SessionPanelData,
} from "../../../features/sessions/model/sessionPanel";
import {
  AI_HELPER_PROVIDERS,
  loadAiHelperSettings,
  type AiHelperSettings,
  type AiHelperTarget,
} from "../../../features/settings/model/settings";
import { continueHelperAvailable } from "./continueHelper";
import { runHelperPipeline, type HelperFailureKind } from "./helperPipeline";
import { runHarnessHelperPrompt } from "./registry";

/** AI session metadata (fork, L-190): label and notes written by an AI helper. */
type HelperRun = (target: AiHelperTarget, prompt: string, timeoutMs: number) => Promise<string>;

export type MetadataHelperOutcome<T> =
  | { ok: true; value: T; helper: AiHelperTarget }
  | { ok: false; cancelled: boolean; message: string };

type HelperInput = {
  blocks: Block[];
  cwd: string;
  harness: HarnessId;
  signal?: AbortSignal;
  settings?: SessionMetadataAiSettings;
  targets?: AiHelperTarget[];
  isAvailable?: (target: AiHelperTarget) => boolean;
  run?: HelperRun;
};

const TIMEOUT_MS = { label: 120_000, update: 120_000, full: 240_000 } as const;

const FAILURE_TEXT: Record<HelperFailureKind, string> = {
  auth: "needs sign-in",
  "tool-attempt": "tried a tool",
  cancelled: "was cancelled",
  timeout: "took too long",
  invalid: "gave an unusable reply",
  unavailable: "is not available",
  failed: "failed",
};

function isHelperProvider(id: HarnessId): id is AiHelperTarget["provider"] {
  return AI_HELPER_PROVIDERS.some((provider) => provider === id);
}

function targetKey(target: AiHelperTarget): string {
  return `${target.provider}:${target.accountId ?? ""}:${target.model ?? ""}`;
}

/** The chosen model, then the AI helper settings, the chat's provider and the rest. */
export function sessionMetadataHelperTargets(input: {
  settings: SessionMetadataAiSettings;
  aiHelper: AiHelperSettings;
  harness: HarnessId;
}): AiHelperTarget[] {
  const list: AiHelperTarget[] = [];
  if (input.settings.helper) list.push(input.settings.helper);
  if (input.aiHelper.mode === "custom") {
    list.push(input.aiHelper.primary);
    if (input.aiHelper.fallback) list.push(input.aiHelper.fallback);
  }
  for (const id of [input.harness, ...AI_HELPER_PROVIDERS])
    if (isHelperProvider(id)) list.push({ provider: id });
  const seen = new Set<string>();
  const providers = new Set<string>();
  return list.filter((target) => {
    const key = targetKey(target);
    // A bare provider fallback is redundant once that provider is already listed.
    const bare = target.accountId === undefined && target.model === undefined;
    if (seen.has(key) || (bare && providers.has(target.provider))) return false;
    seen.add(key);
    providers.add(target.provider);
    return true;
  });
}

async function runTargets<T>(
  input: HelperInput,
  task: { prompt: string; timeoutMs: number; parse: (raw: string) => T | null; expected: string; what: string },
): Promise<MetadataHelperOutcome<T>> {
  const settings = input.settings ?? loadSessionMetadataAi();
  const isAvailable = input.isAvailable ?? continueHelperAvailable;
  const targets =
    input.targets ??
    sessionMetadataHelperTargets({ settings, aiHelper: loadAiHelperSettings(), harness: input.harness });
  const run: HelperRun =
    input.run ??
    ((target, prompt, timeoutMs) =>
      runHarnessHelperPrompt(target.provider, {
        cwd: input.cwd,
        prompt,
        timeoutMs,
        providerAccountId: target.accountId,
        model: target.model,
      }));
  const failures: string[] = [];
  for (const target of targets) {
    if (input.signal?.aborted) return { ok: false, cancelled: true, message: "" };
    if (!isAvailable(target)) continue;
    const result = await runHelperPipeline({
      targets: [target],
      prompt: task.prompt,
      outputSchema: {},
      parse: task.parse,
      describeExpected: task.expected,
      perCallTimeoutMs: task.timeoutMs,
      deadlineMs: task.timeoutMs * 2 + 10_000,
      isAvailable,
      run: (next, text, opts) => run(next, text, opts.timeoutMs),
      signal: input.signal,
    });
    if (input.signal?.aborted) return { ok: false, cancelled: true, message: "" };
    if (result.ok) return { ok: true, value: result.value, helper: target };
    if (result.kind === "cancelled") return { ok: false, cancelled: true, message: "" };
    failures.push(`${HARNESS_TITLE[target.provider]} ${FAILURE_TEXT[result.kind]}`);
  }
  const reason = failures.length > 0 ? failures.join(", ") : "no AI helper is available";
  return { ok: false, cancelled: false, message: `Couldn't write the ${task.what}: ${reason}.` };
}

function emptyChat<T>(what: string): MetadataHelperOutcome<T> {
  return { ok: false, cancelled: false, message: `Couldn't write the ${what}: this chat has nothing to read yet.` };
}

export async function writeSessionLabel(input: HelperInput): Promise<MetadataHelperOutcome<string>> {
  const transcript = continueTranscript(input.blocks, "short").text;
  if (!transcript.trim()) return emptyChat("label");
  return runTargets(input, {
    prompt: buildLabelPrompt(transcript),
    timeoutMs: TIMEOUT_MS.label,
    parse: parseLabelReply,
    expected: "one short label line",
    what: "label",
  });
}

/** What to add to the notes; `scope` "update" means `blocks` are only the new turns. */
export async function writeSessionNotes(
  input: HelperInput & { notes: string; scope: "full" | "update" },
): Promise<MetadataHelperOutcome<NotesReply>> {
  const transcript = continueTranscript(input.blocks, input.scope === "full" ? "long" : "short").text;
  if (!transcript.trim()) return emptyChat("notes");
  const settings = input.settings ?? loadSessionMetadataAi();
  return runTargets(
    { ...input, settings },
    {
      prompt: buildNotesPrompt({
        transcript,
        notes: input.notes,
        instructions: notesInstructions(settings),
        scope: input.scope,
      }),
      timeoutMs: TIMEOUT_MS[input.scope],
      parse: parseNotesReply,
      expected: "Markdown points to add, ending with a **Left off:** line, or NOTHING_NEW",
      what: "notes",
    },
  );
}

/**
 * Session panel points (L-191): what to add from `blocks`; `scope` "update"
 * means `blocks` are only the messages since the last run.
 */
export async function writeSessionPoints(
  input: HelperInput & { data: SessionPanelData; scope: "full" | "update" },
): Promise<MetadataHelperOutcome<PointsReply>> {
  const transcript = taggedTranscript(input.blocks);
  if (!transcript.text.trim()) return emptyChat("panel");
  return runTargets(input, {
    prompt: buildPointsPrompt({ transcript: transcript.text, data: input.data, scope: input.scope }),
    timeoutMs: TIMEOUT_MS[input.scope],
    parse: (raw) => parsePointsReply(raw, transcript.ids),
    expected: "lines like `decision | m12 | text`, ending with one `leftoff | mN | text` line, or NOTHING_NEW",
    what: "panel",
  });
}

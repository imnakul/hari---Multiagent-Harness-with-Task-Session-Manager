import {
  buildImprovePrompt,
  parseImproveReply,
  recentTurns,
  splitLeadingCommand,
  withLeadingCommand,
  type LearnedLines,
} from "../../../features/prompt-improve/model/promptImprove";
import {
  loadPromptImproveSettings,
  loadPromptMemory,
  memoryProjectKey,
  memoryProjectName,
  type PromptImproveSettings,
  type PromptMemory,
} from "../../../features/prompt-improve/model/promptImproveStore";
import {
  HARNESS_TITLE,
  type Block,
  type HarnessId,
} from "../../../features/sessions/model/session";
import {
  loadAiHelperSettings,
  type AiHelperTarget,
} from "../../../features/settings/model/settings";
import { continueHelperAvailable } from "./continueHelper";
import { runHelperPipeline, type HelperFailureKind } from "./helperPipeline";
import { runHarnessHelperPrompt } from "./registry";
import { sessionMetadataHelperTargets } from "./sessionMetadataHelper";

/** Improve prompt (fork, L-252): one rewrite of a composer draft. */
type HelperRun = (
  target: AiHelperTarget,
  prompt: string,
  timeoutMs: number,
) => Promise<string>;

export type ImproveOutcome =
  | {
      ok: true;
      /** The rewrite with any leading `/command` put back in front. */
      prompt: string;
      learned: LearnedLines;
      /** Edit samples that were in the prompt; drop them from memory. */
      usedSamples: number;
      helper: AiHelperTarget;
      /**
       * Why earlier helpers were passed over, e.g. "Command Code tried a tool".
       * Present only when the rewrite came from a fallback.
       */
      fallbackReason?: string;
    }
  | { ok: false; cancelled: boolean; message: string };

const TIMEOUT_MS = 90_000;

const FAILURE_TEXT: Record<HelperFailureKind, string> = {
  auth: "needs sign-in",
  "tool-attempt": "tried a tool",
  cancelled: "was cancelled",
  timeout: "took too long",
  invalid: "dropped part of your text",
  unavailable: "is not available",
  failed: "failed",
};

export async function improvePrompt(input: {
  text: string;
  cwd: string;
  harness: HarnessId;
  blocks?: readonly Block[];
  signal?: AbortSignal;
  settings?: PromptImproveSettings;
  memory?: PromptMemory;
  targets?: AiHelperTarget[];
  isAvailable?: (target: AiHelperTarget) => boolean;
  run?: HelperRun;
}): Promise<ImproveOutcome> {
  const settings = input.settings ?? loadPromptImproveSettings();
  const memory = input.memory ?? loadPromptMemory();
  const isAvailable = input.isAvailable ?? continueHelperAvailable;
  const { prefix, body } = splitLeadingCommand(input.text);
  const draft = body.trim();
  if (!draft)
    return {
      ok: false,
      cancelled: false,
      message: "There is nothing to improve yet.",
    };
  const project = memory.projects[memoryProjectKey(input.cwd)];
  const samples = settings.learn ? memory.samples : [];
  const prompt = buildImprovePrompt({
    draft,
    project: memoryProjectName(input.cwd),
    turns: recentTurns(input.blocks ?? []),
    instructions: settings.instructions,
    profile: memory.profile,
    glossary: project?.glossary ?? "",
    rules: project?.rules.map((rule) => rule.text) ?? [],
    samples,
    learn: settings.learn,
  });
  const targets =
    input.targets ??
    sessionMetadataHelperTargets({
      settings,
      aiHelper: loadAiHelperSettings(),
      harness: input.harness,
    });
  const run: HelperRun =
    input.run ??
    ((target, text, timeoutMs) =>
      runHarnessHelperPrompt(target.provider, {
        cwd: input.cwd,
        prompt: text,
        timeoutMs,
        providerAccountId: target.accountId,
        model: target.model,
        ...(settings.effort
          ? { modelSettings: { effort: settings.effort } }
          : {}),
      }));
  const failures: string[] = [];
  for (const target of targets) {
    if (input.signal?.aborted)
      return { ok: false, cancelled: true, message: "" };
    if (!isAvailable(target)) {
      // A helper the owner picked must not vanish silently behind a fallback.
      if (target === settings.helper)
        failures.push(
          `${HARNESS_TITLE[target.provider]} ${FAILURE_TEXT.unavailable}`,
        );
      continue;
    }
    const result = await runHelperPipeline({
      targets: [target],
      prompt,
      outputSchema: {},
      parse: (raw) => parseImproveReply(raw, draft),
      describeExpected:
        "a <prompt> block holding the rewrite, with every path, @mention, URL, ID and backtick text copied exactly",
      perCallTimeoutMs: TIMEOUT_MS,
      deadlineMs: TIMEOUT_MS * 2 + 10_000,
      isAvailable,
      run: (next, text, opts) => run(next, text, opts.timeoutMs),
      signal: input.signal,
    });
    if (input.signal?.aborted)
      return { ok: false, cancelled: true, message: "" };
    if (result.ok) {
      return {
        ok: true,
        prompt: withLeadingCommand(prefix, result.value.prompt),
        learned: settings.learn
          ? result.value.learned
          : { styles: [], terms: [], rules: [] },
        usedSamples: samples.length,
        helper: target,
        ...(failures.length > 0 ? { fallbackReason: failures.join(", ") } : {}),
      };
    }
    if (result.kind === "cancelled")
      return { ok: false, cancelled: true, message: "" };
    // The strip shows only the short kind; keep the provider's own words for debugging.
    console.warn(
      `[prompt-improve] ${target.provider} failed (${result.kind}): ${result.message}`,
    );
    failures.push(
      `${HARNESS_TITLE[target.provider]} ${FAILURE_TEXT[result.kind]}`,
    );
  }
  const reason =
    failures.length > 0 ? failures.join(", ") : "no AI helper is available";
  return {
    ok: false,
    cancelled: false,
    message: `Couldn't improve the prompt: ${reason}. Your text is unchanged.`,
  };
}

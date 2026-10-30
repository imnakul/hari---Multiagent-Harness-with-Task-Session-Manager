import type { HarnessId } from "../../../features/sessions/model/session";
import {
  buildThreadTitlePrompt,
  parseGeneratedSessionTitle,
  type GeneratedSessionTitle,
} from "../../../features/sessions/model/sessionTitle";
import { HARNESS_TITLE } from "../../../features/sessions/model/session";
import {
  loadAiHelperSettings,
  type AiHelperTarget,
} from "../../../features/settings/model/settings";
import {
  buildCommitMessagePrompt,
  buildPrContentPrompt,
  fallbackPrContent,
  formatCommitMessage,
  parseCommitMessage,
  parsePrContent,
  type CommitMessage,
  type PrContent,
} from "../../../features/source-control/model/gitText";
import { gitRangeContext, gitStagedContext } from "../../../platform/tauri/fs";
import {
  generateHarnessTitle,
  runHarnessHelperPrompt,
  type TitleInput,
} from "./registry";
import { isHarnessAvailable } from "./availability";
import {
  providerAccountExists,
  supportsProviderAccounts,
} from "../../../features/providers/model/providerAccounts";
import {
  runHelperPipeline,
  type HelperFailureKind,
  type HelperResult,
} from "./helperPipeline";
import {
  COMMIT_OUTPUT_SCHEMA,
  PR_OUTPUT_SCHEMA,
  TITLE_OUTPUT_SCHEMA,
} from "./helperSchemas";
import { generateCommitMessage, generatePrContent } from "./textHarness";

export type HelperPrDraft = PrContent & { base: string; head: string };

export type HelperPrOutcome =
  | { status: "ready"; content: HelperPrDraft }
  | {
      status: "needs-review";
      draft: HelperPrDraft;
      failure: Extract<HelperResult<never>, { ok: false }>;
    }
  | { status: "cancelled" };

export class HelperFailedError extends Error {
  readonly kind: HelperFailureKind;
  readonly provider: AiHelperTarget["provider"] | null;

  constructor(task: "commit" | "pr", result: Extract<HelperResult<never>, { ok: false }>) {
    super(helperFailureMessage(task, result));
    this.name = "HelperFailedError";
    this.kind = result.kind;
    this.provider = result.target?.provider ?? null;
  }
}

function configuredTargets(
  settings: Extract<ReturnType<typeof loadAiHelperSettings>, { mode: "custom" }>,
): AiHelperTarget[] {
  return settings.fallback
    ? [settings.primary, settings.fallback]
    : [settings.primary];
}

function isAvailable(target: AiHelperTarget): boolean {
  // Unverified providers are allowed; their runner stops on tool use (L-193).
  if (!isHarnessAvailable(target.provider)) return false;
  if (target.accountId === undefined) return true;
  return (
    supportsProviderAccounts(target.provider) &&
    providerAccountExists(target.provider, target.accountId)
  );
}

function failureProvider(
  result: Extract<HelperResult<never>, { ok: false }>,
): string {
  return result.target ? HARNESS_TITLE[result.target.provider] : "the chosen AI helper";
}

export function helperFailureMessage(
  task: "commit" | "pr",
  result: Extract<HelperResult<never>, { ok: false }>,
): string {
  if (result.kind === "cancelled") return "";
  if (task === "commit") {
    switch (result.kind) {
      case "auth":
        return `Couldn't write a commit message: ${failureProvider(result)} needs you to sign in. Sign in, or choose another AI helper in Settings.`;
      case "invalid":
        return `Couldn't write a commit message with ${failureProvider(result)}: the reply wasn't in the expected format. Write one yourself or try again.`;
      case "timeout":
        return `Couldn't write a commit message: ${failureProvider(result)} took too long. Write one yourself or try again.`;
      case "unavailable":
        return "Couldn't write a commit message: the chosen AI helper isn't available. Check Settings → Chat → AI helper.";
      case "tool-attempt":
        return `Couldn't write a commit message: ${failureProvider(result)} tried to use a tool, so MonoCode stopped it. Nothing was changed. Try again or write one yourself.`;
      case "failed":
        return `Couldn't write a commit message with ${failureProvider(result)}. Write one yourself or try again.`;
    }
  }
  switch (result.kind) {
    case "auth":
      return `Couldn't write the pull request description: ${failureProvider(result)} needs you to sign in. Edit the draft below, or sign in and try again.`;
    case "invalid":
      return `Couldn't write the pull request description with ${failureProvider(result)}: the reply wasn't in the expected format. Edit the draft below or try again.`;
    case "timeout":
      return `Couldn't write the pull request description: ${failureProvider(result)} took too long. Edit the draft below or try again.`;
    case "unavailable":
      return "Couldn't write the pull request description: the chosen AI helper isn't available. Edit the draft below, or check Settings → Chat → AI helper.";
    case "tool-attempt":
      return `Couldn't write the pull request description: ${failureProvider(result)} tried to use a tool, so MonoCode stopped it. Nothing was changed. Edit the draft below or try again.`;
    case "failed":
      return `Couldn't write the pull request description with ${failureProvider(result)}. Edit the draft below or try again.`;
  }
}

function runConfiguredPipeline<T>(input: {
  targets: AiHelperTarget[];
  cwd: string;
  prompt: string;
  outputSchema: Record<string, unknown>;
  parse: (raw: string) => T | null;
  describeExpected: string;
  perCallTimeoutMs: number;
  deadlineMs: number;
  signal?: AbortSignal;
}): Promise<HelperResult<T>> {
  return runHelperPipeline({
    targets: input.targets,
    prompt: input.prompt,
    outputSchema: input.outputSchema,
    parse: input.parse,
    describeExpected: input.describeExpected,
    perCallTimeoutMs: input.perCallTimeoutMs,
    deadlineMs: input.deadlineMs,
    isAvailable,
    signal: input.signal,
    run: (target, prompt, opts) =>
      runHarnessHelperPrompt(target.provider, {
        cwd: input.cwd,
        prompt,
        timeoutMs: opts.timeoutMs,
        providerAccountId: target.accountId,
        model: target.model,
        ...(target.provider === "codex" && opts.outputSchema
          ? { outputSchema: opts.outputSchema }
          : {}),
      }),
  });
}

export async function generateHelperTitle(
  input: TitleInput & { chatHarness: HarnessId; signal?: AbortSignal },
): Promise<GeneratedSessionTitle | null> {
  const settings = loadAiHelperSettings();
  if (settings.mode === "automatic") {
    return generateHarnessTitle(input.chatHarness, {
      sessionId: input.sessionId,
      cwd: input.cwd,
      message: input.message,
      providerAccountId: input.providerAccountId,
    });
  }

  const result = await runConfiguredPipeline({
    targets: configuredTargets(settings),
    cwd: input.cwd,
    prompt: buildThreadTitlePrompt(input.message),
    outputSchema: TITLE_OUTPUT_SCHEMA,
    parse: (raw) => parseGeneratedSessionTitle(raw, input.message),
    describeExpected:
      'JSON {"title": string, "workItem": null | {"kind": "issue" | "pr", "number": integer}}',
    perCallTimeoutMs: 45_000,
    deadlineMs: 60_000,
    signal: input.signal,
  });
  if (result.ok) return result.value;
  console.debug("[monocode] helper title", {
    kind: result.kind,
    provider: result.target?.provider,
    calls: result.calls,
  });
  return null;
}

export async function generateHelperCommitMessage(
  cwd: string,
  preferred?: HarnessId,
  signal?: AbortSignal,
): Promise<string> {
  const settings = loadAiHelperSettings();
  if (settings.mode === "automatic") {
    return generateCommitMessage(cwd, preferred);
  }
  const context = await gitStagedContext(cwd);
  const result = await runConfiguredPipeline<CommitMessage>({
    targets: configuredTargets(settings),
    cwd,
    prompt: buildCommitMessagePrompt({
      branch: context.branch,
      stagedSummary: context.summary,
      stagedPatch: context.patch,
    }),
    outputSchema: COMMIT_OUTPUT_SCHEMA,
    parse: parseCommitMessage,
    describeExpected: 'JSON {"subject": string, "body": string}',
    perCallTimeoutMs: 90_000,
    deadlineMs: 180_000,
    signal,
  });
  if (result.ok) return formatCommitMessage(result.value);
  throw new HelperFailedError("commit", result);
}

export async function generateHelperPrContent(
  cwd: string,
  preferred?: HarnessId,
  signal?: AbortSignal,
): Promise<HelperPrOutcome> {
  const settings = loadAiHelperSettings();
  if (settings.mode === "automatic") {
    const content = await generatePrContent(cwd, preferred);
    if (!content) throw new Error("Could not prepare pull request content");
    return { status: "ready", content };
  }

  const range = await gitRangeContext(cwd);
  const result = await runConfiguredPipeline<PrContent>({
    targets: configuredTargets(settings),
    cwd,
    prompt: buildPrContentPrompt({
      baseBranch: range.base,
      headBranch: range.head,
      commitSummary: range.commitSummary,
      diffSummary: range.diffSummary,
      diffPatch: range.diffPatch,
    }),
    outputSchema: PR_OUTPUT_SCHEMA,
    parse: parsePrContent,
    describeExpected: 'JSON {"title": string, "body": string}',
    perCallTimeoutMs: 90_000,
    deadlineMs: 180_000,
    signal,
  });
  if (result.ok) {
    return {
      status: "ready",
      content: { ...result.value, base: range.base, head: range.head },
    };
  }
  if (result.kind === "cancelled") return { status: "cancelled" };

  console.debug("[monocode] helper pr", {
    kind: result.kind,
    provider: result.target?.provider,
    calls: result.calls,
  });
  const fallback = fallbackPrContent(range);
  return {
    status: "needs-review",
    draft: { ...fallback, base: range.base, head: range.head },
    failure: result,
  };
}

import {
  assembleContinueCard,
  buildContinueCheckPrompt,
  buildContinueHelperPrompt,
  buildQuickCard,
  continueFacts,
  continueTranscript,
  parseHelperCard,
  resolveContinueRun,
  type ContinueChoice,
} from "../../../features/sessions/model/continueCard";
import { HARNESS_TITLE, type Block, type HarnessId } from "../../../features/sessions/model/session";
import {
  AI_HELPER_PROVIDERS,
  loadAiHelperSettings,
  type AiHelperSettings,
  type AiHelperTarget,
} from "../../../features/settings/model/settings";
import {
  providerAccountExists,
  supportsProviderAccounts,
} from "../../../features/providers/model/providerAccounts";
import { isHarnessAvailable } from "./availability";
import { runHelperPipeline, type HelperFailureKind } from "./helperPipeline";
import { runHarnessHelperPrompt } from "./registry";

export type ContinueCardResult = {
  card: string;
  /** Short status for the composer chip. */
  note: string;
  helper?: AiHelperTarget;
};

type HelperRun = (target: AiHelperTarget, prompt: string, timeoutMs: number) => Promise<string>;

const CALL_TIMEOUT_MS = { short: 120_000, long: 240_000 } as const;

function isHelperProvider(id: HarnessId): id is AiHelperTarget["provider"] {
  return AI_HELPER_PROVIDERS.some((provider) => provider === id);
}

function targetKey(target: AiHelperTarget): string {
  return `${target.provider}:${target.accountId ?? ""}:${target.model ?? ""}`;
}

/** The chosen helper first, then Settings, the two chats' providers and the rest as fallbacks. */
export function continueHelperTargets(input: {
  choice: ContinueChoice;
  sourceHarness: HarnessId;
  settings: AiHelperSettings;
}): AiHelperTarget[] {
  const list: AiHelperTarget[] = [];
  if (input.choice.helper) list.push(input.choice.helper);
  if (input.settings.mode === "custom") {
    list.push(input.settings.primary);
    if (input.settings.fallback) list.push(input.settings.fallback);
  }
  for (const id of [input.sourceHarness, input.choice.target.harness, ...AI_HELPER_PROVIDERS]) {
    if (isHelperProvider(id)) list.push({ provider: id });
  }
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

/** Antigravity is allowed here: a strict prompt plus the stop-on-tool guard, then the next helper. */
export function continueHelperAvailable(target: AiHelperTarget): boolean {
  if (!isHarnessAvailable(target.provider)) return false;
  if (target.accountId === undefined) return true;
  return (
    supportsProviderAccounts(target.provider) &&
    providerAccountExists(target.provider, target.accountId)
  );
}

const FAILURE_TEXT: Record<HelperFailureKind, string> = {
  auth: "needs sign-in",
  "tool-attempt": "tried a tool",
  cancelled: "was cancelled",
  timeout: "took too long",
  invalid: "gave an unusable reply",
  unavailable: "is not available",
  failed: "failed",
};

function helperName(target: AiHelperTarget): string {
  return HARNESS_TITLE[target.provider];
}

async function runOne(
  target: AiHelperTarget,
  prompt: string,
  timeoutMs: number,
  run: HelperRun,
  isAvailable: (target: AiHelperTarget) => boolean,
): Promise<{ ok: true; card: string } | { ok: false; kind: HelperFailureKind }> {
  const result = await runHelperPipeline({
    targets: [target],
    prompt,
    outputSchema: {},
    parse: parseHelperCard,
    describeExpected: "a Markdown context card with ## section headings",
    perCallTimeoutMs: timeoutMs,
    deadlineMs: timeoutMs * 2 + 10_000,
    isAvailable,
    run: (next, text, opts) => run(next, text, opts.timeoutMs),
  });
  return result.ok ? { ok: true, card: result.value } : { ok: false, kind: result.kind };
}

/** Builds the context card; never throws, and falls back to the Quick card. */
export async function prepareContinueCard(input: {
  blocks: Block[];
  cwd: string;
  choice: ContinueChoice;
  sourceHarness: HarnessId;
  targets?: AiHelperTarget[];
  isAvailable?: (target: AiHelperTarget) => boolean;
  run?: HelperRun;
}): Promise<ContinueCardResult> {
  const facts = continueFacts(input.blocks, input.cwd);
  const quick = buildQuickCard(facts);
  const plan = resolveContinueRun(input.choice);
  if (!plan.helper) return { card: quick, note: "Quick card" };

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
  const isAvailable = input.isAvailable ?? continueHelperAvailable;
  const targets =
    input.targets ??
    continueHelperTargets({
      choice: input.choice,
      sourceHarness: input.sourceHarness,
      settings: loadAiHelperSettings(),
    });
  const transcript = continueTranscript(input.blocks, plan.context);
  const timeoutMs = CALL_TIMEOUT_MS[plan.context];
  const failures: string[] = [];

  for (const target of targets) {
    if (!isAvailable(target)) continue;
    const draft = await runOne(
      target,
      buildContinueHelperPrompt(transcript, plan.context),
      timeoutMs,
      run,
      isAvailable,
    );
    if (!draft.ok) {
      failures.push(`${helperName(target)} ${FAILURE_TEXT[draft.kind]}`);
      continue;
    }
    let card = draft.card;
    let wrote = `Written by ${helperName(target)}`;
    if (plan.passes === 2) {
      const checked = await runOne(
        target,
        buildContinueCheckPrompt(transcript, draft.card, plan.context),
        timeoutMs,
        run,
        isAvailable,
      );
      if (checked.ok) {
        card = checked.card;
        wrote = `Written and checked by ${helperName(target)}`;
      } else {
        wrote = `Written by ${helperName(target)} (check ${FAILURE_TEXT[checked.kind]})`;
      }
    }
    const note = failures.length > 0 ? `${wrote} · ${failures.join(", ")}` : wrote;
    return { card: assembleContinueCard(card, facts), note, helper: target };
  }

  const reason = failures.length > 0 ? failures.join(", ") : "no AI helper is available";
  return { card: quick, note: `Quick card used: ${reason}` };
}

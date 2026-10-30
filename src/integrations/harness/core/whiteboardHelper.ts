import { HARNESS_TITLE } from "../../../features/sessions/model/session";
import {
  AI_HELPER_PROVIDERS,
  loadAiHelperSettings,
  type AiHelperSettings,
  type AiHelperTarget,
} from "../../../features/settings/model/settings";
import {
  parseWhiteboardReply,
  type WhiteboardReply,
} from "../../../features/whiteboard/model/whiteboardAgent";
import { continueHelperAvailable } from "./continueHelper";
import { runHelperPipeline, type HelperFailureKind } from "./helperPipeline";
import { runHarnessHelperPrompt } from "./registry";

/** Whiteboard agent chat (fork, L-194): one reply from an AI helper. */
type HelperRun = (target: AiHelperTarget, prompt: string, timeoutMs: number) => Promise<string>;

export type WhiteboardAgentOutcome =
  | { ok: true; reply: WhiteboardReply; helper: AiHelperTarget }
  | { ok: false; cancelled: boolean; message: string };

const TIMEOUT_MS = 180_000;

const FAILURE_TEXT: Record<HelperFailureKind, string> = {
  auth: "needs sign-in",
  "tool-attempt": "tried a tool",
  cancelled: "was cancelled",
  timeout: "took too long",
  invalid: "gave an empty reply",
  unavailable: "is not available",
  failed: "failed",
};

const targetKey = (target: AiHelperTarget) =>
  `${target.provider}:${target.accountId ?? ""}:${target.model ?? ""}`;

/** The AI helper settings first, then every helper provider; no repeats. */
export function whiteboardAgentTargets(
  aiHelper: AiHelperSettings = loadAiHelperSettings(),
  isAvailable: (target: AiHelperTarget) => boolean = continueHelperAvailable,
): AiHelperTarget[] {
  const list: AiHelperTarget[] = [];
  if (aiHelper.mode === "custom") {
    list.push(aiHelper.primary);
    if (aiHelper.fallback) list.push(aiHelper.fallback);
  }
  for (const provider of AI_HELPER_PROVIDERS) list.push({ provider });
  const seen = new Set<string>();
  const providers = new Set<string>();
  return list.filter((target) => {
    const bare = target.accountId === undefined && target.model === undefined;
    const key = targetKey(target);
    if (seen.has(key) || (bare && providers.has(target.provider)) || !isAvailable(target)) {
      return false;
    }
    seen.add(key);
    providers.add(target.provider);
    return true;
  });
}

export function whiteboardTargetLabel(target: AiHelperTarget): string {
  const name = HARNESS_TITLE[target.provider];
  return target.model ? `${name} · ${target.model}` : name;
}

export async function askWhiteboardAgent(input: {
  target: AiHelperTarget;
  cwd: string;
  prompt: string;
  signal?: AbortSignal;
  isAvailable?: (target: AiHelperTarget) => boolean;
  run?: HelperRun;
}): Promise<WhiteboardAgentOutcome> {
  const isAvailable = input.isAvailable ?? continueHelperAvailable;
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
  const name = HARNESS_TITLE[input.target.provider];
  if (!isAvailable(input.target)) {
    return { ok: false, cancelled: false, message: `${name} is not available as an AI helper.` };
  }
  const result = await runHelperPipeline({
    targets: [input.target],
    prompt: input.prompt,
    outputSchema: {},
    parse: (raw: string) => {
      const reply = parseWhiteboardReply(raw);
      return reply.text || reply.ops ? reply : null;
    },
    describeExpected: "a short answer, optionally followed by one ```whiteboard JSON block",
    perCallTimeoutMs: TIMEOUT_MS,
    deadlineMs: TIMEOUT_MS + 10_000,
    isAvailable,
    run: (next, text, opts) => run(next, text, opts.timeoutMs),
    signal: input.signal,
  });
  if (input.signal?.aborted) return { ok: false, cancelled: true, message: "" };
  if (result.ok) return { ok: true, reply: result.value, helper: input.target };
  if (result.kind === "cancelled") return { ok: false, cancelled: true, message: "" };
  return { ok: false, cancelled: false, message: `${name} ${FAILURE_TEXT[result.kind]}.` };
}

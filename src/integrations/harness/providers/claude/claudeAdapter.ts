import {
  bindClaudeSession,
  inspectClaudeContext,
  cancelClaudeTurn,
  compactClaudeContext,
  forgetClaudeSession,
  respondClaudeApproval,
  respondClaudeQuestion,
  restoreClaudeTaskLists,
  isClaudeRemoteControlDesired,
  setClaudeRemoteControl,
  setClaudeRemoteControlDesired,
  sendClaudeTurn,
  steerClaudeTurn,
  stopClaudeSession,
} from "./claude";
import { refreshClaudeCatalog } from "./claudeCatalog";
import {
  generateClaudeBranchName,
  generateClaudeCommitMessage,
  generateClaudePrContent,
} from "./claudeGit";
import { generateClaudeSessionTitle } from "./claudeTitle";
import {
  runClaudeTextPrompt,
  stopClaudeTextPrompt,
  warmupClaudeText,
} from "./claudeText";
import { registerHarness, type HarnessAdapter } from "../../core/registry";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { hasHeadlessChildBackend } from "../../core/child";
import { isClaudeInteractive } from "./claudeInteractiveProtocol";
import {
  bindInteractiveClaude,
  cancelInteractiveClaude,
  forgetInteractiveClaude,
  hasInteractiveClaude,
  interactiveClaudeBinding,
  interactiveClaudeEpoch,
  rejectInteractiveSteer,
  replyInteractiveClaude,
  sendInteractiveClaude,
  stopInteractiveClaude,
} from "./claudeInteractive";

const interactiveSelections = new Set<string>();

export const claudeAdapter: HarnessAdapter = {
  id: "claude",
  live: true,
  sendTurn: async (input): Promise<void> => {
    const interactive = isClaudeInteractive(input.modelSettings);
    const epoch = interactiveClaudeEpoch(input.sessionId);
    if (interactive) {
      if (hasHeadlessChildBackend() || !isTauri())
        throw new Error("Claude Interactive requires the local desktop app.");
      interactiveSelections.add(input.sessionId);
      if (!hasInteractiveClaude(input.sessionId)) {
        await invoke("harness_stop_confirmed", { sessionId: input.sessionId });
        await stopClaudeSession(input.sessionId);
      }
    } else if (hasInteractiveClaude(input.sessionId)) {
      const binding = interactiveClaudeBinding(input.sessionId);
      await stopInteractiveClaude(input.sessionId);
      if (binding)
        bindClaudeSession(
          input.sessionId,
          binding.nativeId,
          binding.cwd,
          binding.accountId,
        );
    }
    if (!interactive) interactiveSelections.delete(input.sessionId);
    const send = interactive
      ? (turn: typeof input): Promise<void> =>
          sendInteractiveClaude(turn, epoch)
      : sendClaudeTurn;
    await send({
      ...input,
      onEvent: (event): void => {
        if (event.type === "session.providerBound") {
          bindInteractiveClaude(
            input.sessionId,
            event.providerSessionId,
            input.cwd,
            input.providerAccountId,
          );
        }
        input.onEvent(event);
      },
    });
  },
  compactContext: async (input): Promise<void> => {
    if (
      isClaudeInteractive(input.modelSettings) ||
      hasInteractiveClaude(input.sessionId)
    )
      throw new Error("Use /compact in Claude's native terminal.");
    await compactClaudeContext(input);
  },
  inspectContext: (id, signal) =>
    hasInteractiveClaude(id)
      ? Promise.resolve(null)
      : inspectClaudeContext(id, signal),
  steerTurn: (input) =>
    hasInteractiveClaude(input.sessionId) ||
    isClaudeInteractive(input.modelSettings)
      ? rejectInteractiveSteer()
      : steerClaudeTurn(input),
  cancelTurn: (id) =>
    interactiveSelections.has(id) || hasInteractiveClaude(id)
      ? cancelInteractiveClaude(id)
      : cancelClaudeTurn(id),
  respondApproval: (id, requestId, decision, scope): void => {
    if (hasInteractiveClaude(id))
      void replyInteractiveClaude(id, requestId, decision);
    else respondClaudeApproval(id, requestId, decision, scope);
  },
  respondQuestion: (id, requestId, reply): void => {
    if (hasInteractiveClaude(id))
      void replyInteractiveClaude(id, requestId, "allow", reply);
    else respondClaudeQuestion(id, requestId, reply);
  },
  stopSession: async (id): Promise<void> => {
    if (interactiveSelections.has(id) || hasInteractiveClaude(id))
      await stopInteractiveClaude(id);
    else await stopClaudeSession(id);
  },
  forgetSession: async (id): Promise<void> => {
    interactiveSelections.delete(id);
    await forgetInteractiveClaude(id);
    await forgetClaudeSession(id);
  },
  bindSession: (id, nativeId, cwd, accountId): void => {
    bindClaudeSession(id, nativeId, cwd, accountId);
    bindInteractiveClaude(id, nativeId, cwd, accountId);
  },
  restoreTaskLists: restoreClaudeTaskLists,
  setRemoteControl: async (input): Promise<void> => {
    if (
      isClaudeInteractive(input.modelSettings) ||
      hasInteractiveClaude(input.sessionId)
    )
      throw new Error(
        "Use /remote-control in Claude's native terminal, or switch to Structured.",
      );
    await setClaudeRemoteControl(input);
  },
  setRemoteControlDesired: setClaudeRemoteControlDesired,
  isRemoteControlDesired: isClaudeRemoteControlDesired,
  refreshCatalog: refreshClaudeCatalog,
  generateTitle: generateClaudeSessionTitle,
  generateCommitMessage: generateClaudeCommitMessage,
  generatePrContent: generateClaudePrContent,
  generateBranchName: generateClaudeBranchName,
  warmupText: warmupClaudeText,
  runHelperPrompt: ({ cwd, prompt, timeoutMs, providerAccountId, model }) =>
    runClaudeTextPrompt({
      cwd,
      prompt,
      timeoutMs,
      providerAccountId,
      model,
      helperOnly: true,
    }),
  runTextPrompt: (input) => {
    if (isClaudeInteractive(input.modelSettings))
      throw new Error(
        "Side questions start a separate structured request. Switch this helper to Structured explicitly.",
      );
    return runClaudeTextPrompt(input);
  },
  stopTextPrompt: stopClaudeTextPrompt,
};

let registered = false;

export function ensureClaudeRegistered(): void {
  if (registered) return;
  registerHarness(claudeAdapter);
  registered = true;
}

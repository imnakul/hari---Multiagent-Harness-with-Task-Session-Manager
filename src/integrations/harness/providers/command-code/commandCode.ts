import {
  findModel,
  modelEffortSetting,
  nativeModelId,
} from "../../../../features/sessions/model/models";
import {
  killChild,
  resolveCommandCodeBinary,
  spawnChild,
  unwatchChild,
  watchChild,
  writeChild,
} from "../../core/child";
import type {
  ApprovalDecision,
  HarnessEvent,
  SendTurnInput,
  SteerTurnInput,
} from "../../core/types";
import { NativeForkError } from "../../core/types";
import {
  COMMAND_CODE_READ_ONLY_HELP,
  asRecord,
  commandCodeCanEdit,
  commandCodeErrorText,
  commandCodeExitError,
  commandCodePrintArgs,
  commandCodePromptText,
  commandCodeToolKind,
  commandCodeToolOutput,
  commandCodeToolPreview,
  commandCodeToolTitle,
  isCommandCodeMissingResume,
  isCommandCodePermissionBlock,
  parseCommandCodeLine,
  type CommandCodeResult,
  type CommandCodeRun,
} from "./commandCodeProtocol";

/** The Command Code session a chat continues, and the folder it lives in. */
type Bound = { id: string; cwd: string };

type Active = {
  finish: (error?: Error) => void;
};

const TURN_TIMEOUT_MS = 30 * 60_000;
const MAX_TOOL_DETAIL = 20_000;

const boundByThread = new Map<string, Bound>();
const activeByThread = new Map<string, Active>();
const epochs = new Map<string, number>();
const serial = new Map<string, Promise<void>>();

class MissingResumeError extends Error {}

function epoch(id: string): number {
  return epochs.get(id) ?? 0;
}

/**
 * Fork (L-258): Command Code runs headless, one `cmdc -p` process per turn.
 * `--output-format json` streams NDJSON events; the next turn passes
 * `--resume <session>` so the CLI keeps the conversation. Print mode has no
 * approval prompts, so access is Read only or Full access (see
 * `commandCodePrintArgs`). This replaced the `cmdc acp` runtime (L-255),
 * which offered fewer models than the CLI.
 */
export function sendCommandCodeTurn(input: SendTurnInput): Promise<void> {
  if (input.fork?.forkPoint)
    return Promise.reject(
      new NativeForkError(
        "Command Code can copy a whole conversation, not part of one; the original chat was not changed.",
      ),
    );
  if (input.nativeResume)
    bindCommandCodeSession(
      input.sessionId,
      input.nativeResume.providerSessionId,
      input.cwd,
    );
  const startedAt = epoch(input.sessionId);
  const next = (serial.get(input.sessionId) ?? Promise.resolve())
    .catch((): void => {})
    .then(async (): Promise<void> => {
      if (epoch(input.sessionId) !== startedAt) return;
      const bound = boundByThread.get(input.sessionId);
      const forkFrom = input.fork?.sourceProviderSessionId.trim();
      let resume: string | undefined = forkFrom || undefined;
      if (!resume && bound) {
        if (bound.cwd === input.cwd) resume = bound.id;
        else {
          boundByThread.delete(input.sessionId);
          input.onEvent({
            type: "status",
            text: "This chat moved to another folder, so Command Code starts a new conversation here.",
          });
        }
      }
      const run = runSettings(input, resume, !!forkFrom);
      try {
        await runOnce(input, run, startedAt);
      } catch (error) {
        if (!(error instanceof MissingResumeError) || forkFrom) throw error;
        if (epoch(input.sessionId) !== startedAt) return;
        // A turn stopped before Command Code saved a step leaves nothing to
        // resume; keep the chat usable instead of failing every send.
        boundByThread.delete(input.sessionId);
        input.onEvent({
          type: "status",
          text: "Command Code had not saved this conversation yet, so it starts fresh. It won't remember earlier messages in this chat.",
        });
        await runOnce(input, { ...run, resume: undefined, fork: false }, startedAt);
      }
    });
  serial.set(input.sessionId, next);
  void next
    .finally((): void => {
      if (serial.get(input.sessionId) === next) serial.delete(input.sessionId);
    })
    .catch((): void => {});
  return next;
}

function runSettings(
  input: SendTurnInput,
  resume: string | undefined,
  fork: boolean,
): CommandCodeRun {
  const model = nativeModelId(input.model).trim();
  const effort = input.modelSettings?.effort?.trim();
  // Efforts differ per model; one this model lacks would fail the run.
  const known = findModel(input.model);
  // A chat saved before the plan changed can still name a locked model.
  if (known?.locked)
    throw new Error(
      `${known.name} isn't available on your Command Code plan (${known.locked.reason}). Pick another model.`,
    );
  const effortSetting = known ? modelEffortSetting(known) : undefined;
  const effortOk =
    !!effort &&
    !!effortSetting?.options.some((option) => option.value === effort);
  return {
    ...(model && model !== "default" ? { model } : {}),
    ...(effortOk ? { effort } : {}),
    ...(resume ? { resume, fork } : {}),
    runtimeMode: input.runtimeMode,
    planning: input.intent === "plan",
    ...(input.ephemeral ? { ephemeral: true } : {}),
  };
}

async function runOnce(
  input: SendTurnInput,
  run: CommandCodeRun,
  startedAt: number,
): Promise<void> {
  const prompt = commandCodePromptText(input.text, input.attachments);
  if (!prompt.trim()) return;
  const { path } = await resolveCommandCodeBinary();
  if (epoch(input.sessionId) !== startedAt) return;
  const id = input.sessionId;
  const emit = (event: HarnessEvent): void => {
    if (epoch(id) === startedAt) input.onEvent(event);
  };
  const stream = new TurnStream(emit, run, (sessionId) => {
    if (input.ephemeral) return;
    const current = boundByThread.get(id);
    if (current?.id === sessionId && current.cwd === input.cwd) return;
    boundByThread.set(id, { id: sessionId, cwd: input.cwd });
    emit({ type: "session.providerBound", providerSessionId: sessionId });
  });

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(
      (): void => {
        finish(new Error("Command Code turn timed out."));
        void killChild(id).catch((): void => {});
      },
      TURN_TIMEOUT_MS,
    );
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (activeByThread.get(id) === active) activeByThread.delete(id);
      unwatchChild(id);
      if (error) reject(error);
      else resolve();
    };
    const active: Active = { finish };
    activeByThread.set(id, active);

    watchChild(
      id,
      (line): void => {
        if (epoch(id) === startedAt) stream.line(line);
      },
      (code): void => {
        if (epoch(id) !== startedAt) return finish();
        try {
          stream.exit(code);
          finish();
        } catch (error) {
          finish(error instanceof Error ? error : new Error(String(error)));
        }
      },
      (line): void => stream.stderr(line),
    );

    void (async (): Promise<void> => {
      try {
        await spawnChild(
          id,
          path,
          commandCodePrintArgs(run),
          input.cwd,
          undefined,
          "command-code",
        );
        if (epoch(id) !== startedAt) {
          await killChild(id).catch((): void => {});
          return finish();
        }
        emit({ type: "session.started" });
        // EOF starts the run: `-p` reads the whole prompt from stdin.
        await writeChild(id, prompt, true);
        if (epoch(id) === startedAt) input.onAccepted?.();
      } catch (error) {
        await killChild(id).catch((): void => {});
        finish(error instanceof Error ? error : new Error(String(error)));
      }
    })();
  });
}

/** Turns one run's NDJSON into MonoCode events. Exported for tests. */
export class TurnStream {
  private text = "";
  private thinking = false;
  private blocked = false;
  private result?: CommandCodeResult;
  private runError?: string;
  private readonly errors: string[] = [];
  private readonly tools = new Map<string, string>();

  constructor(
    private readonly emit: (event: HarnessEvent) => void,
    private readonly run: CommandCodeRun,
    private readonly bind: (sessionId: string) => void,
  ) {}

  line(raw: string): void {
    const parsed = parseCommandCodeLine(raw);
    if (!parsed) return;
    if (parsed.kind === "result") {
      this.result = parsed.result;
      if (parsed.result.sessionId && parsed.result.ok)
        this.bind(parsed.result.sessionId);
      return;
    }
    const { type, event } = parsed;
    switch (type) {
      case "run_start": {
        const sessionId = event.sessionId;
        if (typeof sessionId === "string" && sessionId.trim())
          this.bind(sessionId.trim());
        return;
      }
      case "text_delta":
        if (typeof event.delta !== "string" || !event.delta) return;
        this.endThinking();
        this.text += event.delta;
        this.emit({ type: "message.delta", text: event.delta });
        return;
      case "thinking_delta":
        if (typeof event.delta !== "string" || !event.delta) return;
        this.thinking = true;
        this.emit({ type: "reasoning.delta", text: event.delta });
        return;
      case "thinking_end":
        this.endThinking();
        return;
      case "tool_queued":
      case "tool_running":
        this.toolStarted(event);
        return;
      case "tool_completed": {
        const callId = this.toolStarted(event);
        if (!callId) return;
        const output = commandCodeToolOutput(event.result);
        this.emit({
          type: "tool.updated",
          callId,
          status: "completed",
          ...(output ? { detail: clip(output) } : {}),
        });
        return;
      }
      case "tool_errored":
      case "tool_denied":
      case "tool_hook_blocked": {
        const callId = this.toolStarted(event);
        if (!callId) return;
        const detail =
          commandCodeErrorText(event.error) ??
          commandCodeErrorText(event.reason) ??
          commandCodeErrorText(event.hookOutput) ??
          (type === "tool_denied" ? "Not allowed" : "Failed");
        if (type === "tool_denied" || isCommandCodePermissionBlock(detail))
          this.blocked = true;
        this.emit({
          type: "tool.updated",
          callId,
          status: "failed",
          detail: clip(detail),
        });
        return;
      }
      case "model_request_end": {
        const usage = asRecord(event.usage);
        const input = usage?.inputTokens;
        const output = usage?.outputTokens;
        if (typeof input === "number" && input > 0)
          this.emit({
            type: "context",
            used: input + (typeof output === "number" ? output : 0),
          });
        return;
      }
      case "compaction_start":
        this.emit({
          type: "status",
          text: "Command Code is compacting the conversation.",
          key: "command-code-compaction",
        });
        return;
      case "run_error":
        this.runError = commandCodeErrorText(event.error) ?? this.runError;
        return;
      default:
        return;
    }
  }

  stderr(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;
    this.errors.push(trimmed.replace(/^error:\s*/i, ""));
    if (this.errors.length > 20) this.errors.shift();
  }

  /** Settles the turn when the process exits; throws when it failed. */
  exit(code: number | null | undefined): void {
    this.endThinking();
    const result = this.result;
    if (result?.ok) {
      if (!this.text && result.finalText)
        this.emit({ type: "message.delta", text: result.finalText });
      this.emit({ type: "message.completed" });
      if (result.usage) this.emit({ type: "usage", turn: result.usage });
      if (result.stopReason === "max_tokens")
        this.emit({
          type: "status",
          text: "Command Code stopped: the reply hit the model's length limit.",
        });
      if (this.blocked && !this.run.planning && !commandCodeCanEdit(this.run.runtimeMode))
        this.emit({ type: "status", text: COMMAND_CODE_READ_ONLY_HELP, key: "command-code-access" });
      return;
    }
    const detail =
      result?.error ?? this.runError ?? this.errors.slice(-3).join("\n");
    if (this.run.resume && isCommandCodeMissingResume(detail))
      throw new MissingResumeError(detail);
    if (this.text) this.emit({ type: "message.completed" });
    if (result?.usage) this.emit({ type: "usage", turn: result.usage });
    throw commandCodeExitError(code === 0 ? null : code, detail);
  }

  private endThinking(): void {
    if (!this.thinking) return;
    this.thinking = false;
    this.emit({ type: "reasoning.completed" });
  }

  /** Emits `tool.started` once per call; returns its call id. */
  private toolStarted(event: Record<string, unknown>): string | undefined {
    const callId =
      typeof event.toolCallId === "string" ? event.toolCallId : undefined;
    if (!callId) return undefined;
    const name =
      typeof event.toolName === "string" ? event.toolName : this.tools.get(callId);
    if (this.tools.has(callId)) {
      if (event.type === "tool_running")
        this.emit({ type: "tool.updated", callId, status: "in_progress" });
      return callId;
    }
    const tool = name ?? "tool";
    this.tools.set(callId, tool);
    this.endThinking();
    const preview = commandCodeToolPreview(tool, event.input);
    this.emit({
      type: "tool.started",
      callId,
      title: commandCodeToolTitle(tool, event.input),
      kind: commandCodeToolKind(tool),
      status: event.type === "tool_running" ? "in_progress" : "pending",
      ...(preview ? { preview } : {}),
    });
    return callId;
  }
}

function clip(text: string): string {
  return text.length > MAX_TOOL_DETAIL
    ? `${text.slice(0, MAX_TOOL_DETAIL)}\n…`
    : text;
}

/** Print mode takes the whole prompt up front; a follow-up waits its turn. */
export async function steerCommandCodeTurn(_input: SteerTurnInput): Promise<void> {
  throw new Error("Command Code does not support steering an in-flight turn");
}

/** Print mode never asks for approval; access is set per run. */
export function respondCommandCodeApproval(
  _sessionId: string,
  _requestId: number,
  _decision: ApprovalDecision,
): void {}

/**
 * Stop ends this turn's process. The conversation stays bound: Command Code
 * saves each finished step, so the next turn resumes from there.
 */
export async function cancelCommandCodeTurn(sessionId: string): Promise<void> {
  await stopCommandCodeSession(sessionId);
}

export async function stopCommandCodeSession(sessionId: string): Promise<void> {
  epochs.set(sessionId, epoch(sessionId) + 1);
  activeByThread.get(sessionId)?.finish();
  unwatchChild(sessionId);
  await killChild(sessionId).catch((): void => {});
}

export async function forgetCommandCodeSession(sessionId: string): Promise<void> {
  await stopCommandCodeSession(sessionId);
  boundByThread.delete(sessionId);
  serial.delete(sessionId);
}

export function bindCommandCodeSession(
  threadId: string,
  providerSessionId: string,
  cwd: string,
): void {
  const id = providerSessionId.trim();
  if (!threadId || !id || !cwd.trim()) return;
  boundByThread.set(threadId, { id, cwd });
}

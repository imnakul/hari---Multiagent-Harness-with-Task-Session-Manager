import { invoke, isTauri } from "@tauri-apps/api/core";
import { hasHeadlessChildBackend, resolveClaudeBinary } from "../../core/child";
import {
  HarnessNeedsAttentionError,
  NativeForkError,
  NativeResumeError,
  TurnNotReadyError,
  type ApprovalDecision,
  type HarnessEvent,
  type SendTurnInput,
} from "../../core/types";
import { nativeModelId } from "../../../../features/sessions/model/models";
import {
  questionsFromUnknown,
  type UserQuestionReply,
} from "../../../../features/sessions/model/userQuestion";
import {
  asRecord,
  askUserQuestionAllowInput,
  normalizeClaudeCliEffort,
  previewFromTool,
  resolveClaudeApiModelId,
  runtimeModeToPermission,
  toolKindFromName,
  toolTitle,
} from "./claudeProtocol";
import {
  interactiveTranscriptEvents,
  newTranscriptState,
  type TranscriptState,
} from "./claudeInteractiveProtocol";
import {
  createInteractiveTerminal,
  type InteractiveTerminal,
} from "./claudeInteractiveTerminal";

type Binding = { nativeId: string; cwd: string; accountId?: string };
type Pending = {
  text: string;
  accepted: boolean;
  resolve: () => void;
  reject: (error: Error) => void;
  onAccepted?: () => void;
  timer?: ReturnType<typeof setTimeout>;
};
type Poll = {
  phase: string;
  terminalOwner: boolean;
  sequence: number;
  events: Record<string, unknown>[];
  lines: string[];
  more: boolean;
};
type Live = {
  id: string;
  binding: Binding;
  key: string;
  terminal: InteractiveTerminal;
  stopped: boolean;
  fault?: string;
  phase: string;
  sequence: number;
  transcript: TranscriptState;
  pending?: Pending;
  onEvent: (event: HarnessEvent) => void;
  timer?: ReturnType<typeof setTimeout>;
  approvals: Map<number, Record<string, unknown>>;
  external?: string;
  stopping: number;
};
const bindings = new Map<string, Binding>();
const lives = new Map<string, Live>();
const epochs = new Map<string, number>();

export function interactiveClaudeEpoch(id: string): number {
  return epochs.get(id) ?? 0;
}
function checkEpoch(id: string, epoch: number): void {
  if (interactiveClaudeEpoch(id) !== epoch)
    throw new Error(
      "Interactive Claude launch was cancelled. No prompt was sent.",
    );
}

export function bindInteractiveClaude(
  id: string,
  nativeId: string,
  cwd: string,
  accountId?: string,
): void {
  bindings.set(id, { nativeId, cwd, accountId });
}
export function interactiveClaudeBinding(id: string): Binding | undefined {
  return bindings.get(id);
}
export function hasInteractiveClaude(id: string): boolean {
  return lives.has(id);
}

function emit(live: Live, event: HarnessEvent): void {
  if (live.stopped) return;
  live.onEvent(
    live.external
      ? { type: "externalTurn.event", turnId: live.external, event }
      : event,
  );
}
function faultError(live: Live): Error {
  const message = live.fault ?? "Interactive Claude needs attention.";
  return live.terminal.stopped
    ? new Error(message)
    : new HarnessNeedsAttentionError(message);
}
function fail(live: Live, message: string): void {
  live.fault = message;
  live.terminal.owner = true;
  clearTimeout(live.pending?.timer);
  const hadPending = !!live.pending;
  live.pending?.reject(faultError(live));
  live.pending = undefined;
  if (!hadPending) emit(live, { type: "session.error", message });
}

function complete(live: Live): void {
  if (live.pending && !live.pending.accepted) {
    fail(
      live,
      "Claude stopped without confirming this prompt. Review its terminal before resending.",
    );
    return;
  }
  emit(live, { type: "message.completed" });
  emit(live, { type: "reasoning.completed" });
  if (live.external) {
    live.onEvent({ type: "externalTurn.finished", turnId: live.external });
    live.external = undefined;
  }
  clearTimeout(live.pending?.timer);
  live.pending?.resolve();
  live.pending = undefined;
}

function hookEvent(live: Live, row: Record<string, unknown>): void {
  const event = row.hook_event_name;
  if (row.agent_id && event !== "PermissionRequest") return;
  if (event === "UserPromptSubmit") {
    // Native acceptance, rather than process creation, establishes resumable history.
    if (!bindings.has(live.id)) {
      bindings.set(live.id, live.binding);
      emit(live, {
        type: "session.providerBound",
        providerSessionId: live.binding.nativeId,
      });
    }
    live.stopping = 0;
    live.transcript = newTranscriptState();
    if (live.pending && row.prompt === live.pending.text) {
      if (!live.pending.accepted) {
        live.pending.accepted = true;
        clearTimeout(live.pending.timer);
        live.pending.onAccepted?.();
        emit(live, {
          type: "turn.started",
          providerTurnId: String(row.bridgeId),
        });
      }
    } else {
      if (live.pending)
        fail(
          live,
          "The CLI accepted different input. Review the terminal before resending.",
        );
      live.external = `interactive:${live.binding.nativeId}:${String(row.bridgeId)}`;
      live.onEvent({
        type: "externalTurn.started",
        turnId: live.external,
        text: typeof row.prompt === "string" ? row.prompt : "",
        nativeId: live.binding.nativeId,
      });
    }
  }
  if (
    (event === "PermissionRequest" ||
      (event === "PreToolUse" && row.tool_name === "AskUserQuestion")) &&
    typeof row.bridgeId === "number"
  ) {
    const requestId = row.bridgeId;
    const input = asRecord(row.tool_input) ?? {};
    const name =
      typeof row.tool_name === "string" ? row.tool_name : "Claude tool";
    live.approvals.set(requestId, row);
    const questions =
      name === "AskUserQuestion" ? questionsFromUnknown(input) : [];
    if (questions.length) {
      emit(live, {
        type: "question.asked",
        requestId,
        questions,
        title: "Claude Code question",
      });
    } else {
      emit(live, {
        type: "approval.requested",
        requestId,
        title: toolTitle(name, input),
        kind: toolKindFromName(name),
        callId:
          typeof row.tool_use_id === "string" ? row.tool_use_id : undefined,
        preview: previewFromTool(name, input),
      });
    }
  }
  if (event === "Notification") {
    emit(live, {
      type: "status",
      text:
        typeof row.message === "string"
          ? row.message
          : "Claude needs attention in the terminal",
    });
  }
  if (event === "PreToolUse" && row.tool_name === "AskUserQuestion") {
    emit(live, {
      type: "status",
      text: "Claude has a question. Answer in the native terminal if no form appears.",
    });
  }
  if (
    event === "BridgePermissionResolved" &&
    typeof row.request_id === "number" &&
    live.approvals.has(row.request_id)
  ) {
    const request = live.approvals.get(row.request_id);
    live.approvals.delete(row.request_id);
    if (request?.tool_name === "AskUserQuestion")
      emit(live, {
        type: "question.resolved",
        requestId: row.request_id,
        decision: "cancelled",
      });
    else
      emit(live, {
        type: "approval.resolved",
        requestId: row.request_id,
        decision: "cancelled",
      });
  }
  if (event === "Stop" || event === "PostCompact") live.stopping = 1;
  if (event === "StopFailure")
    fail(
      live,
      `Claude stopped with an error: ${typeof row.error === "string" ? row.error : "review the native terminal"}`,
    );
  if (event === "SessionEnd") {
    if (live.pending)
      fail(
        live,
        "Claude ended the interactive session. Review its terminal before retrying.",
      );
    emit(live, { type: "session.ended" });
  }
}

async function poll(live: Live): Promise<void> {
  if (live.stopped) return;
  try {
    const result = await invoke<Poll>("claude_interactive_poll", {
      sessionId: live.id,
      after: live.sequence,
    });
    if (live.stopped) return;
    live.phase = result.phase;
    // Prompt acceptance must be processed before its transcript activity.
    for (const row of result.events) hookEvent(live, row);
    for (const line of result.lines) {
      for (const event of interactiveTranscriptEvents(line, live.transcript))
        emit(live, event);
    }
    live.sequence = result.sequence;
    // Let final JSONL writes settle after Stop, including multi-page tool results.
    if (live.stopping && !result.more) {
      live.stopping = result.lines.length ? 1 : live.stopping + 1;
      if (live.stopping >= 3 && live.phase === "ready") {
        live.stopping = 0;
        complete(live);
      }
    }
  } catch (error) {
    if (!live.stopped)
      fail(
        live,
        `Interactive observation stopped: ${String(error)}. Use the native terminal or stop this session.`,
      );
    return;
  }
  if (!live.stopped)
    live.timer = setTimeout(() => {
      void poll(live);
    }, 200);
}

function launchKey(input: SendTurnInput): string {
  return JSON.stringify([
    input.cwd,
    input.providerAccountId ?? "default",
    input.model,
    input.modelSettings?.effort,
    input.modelSettings?.fast,
    input.modelSettings?.context,
    input.runtimeMode,
    input.intent === "plan",
  ]);
}

async function ensureLive(input: SendTurnInput, epoch: number): Promise<Live> {
  checkEpoch(input.sessionId, epoch);
  let live = lives.get(input.sessionId);
  const key = launchKey(input);
  if (live && live.key !== key) {
    if (
      live.pending ||
      live.external ||
      live.phase !== "ready" ||
      live.terminal.owner ||
      !live.terminal.ready()
    ) {
      throw new Error(
        "Return to an empty, idle native prompt before changing interactive model or permissions.",
      );
    }
    await stopInteractiveClaude(input.sessionId, true);
    checkEpoch(input.sessionId, epoch);
    live = undefined;
  }
  if (live?.terminal.stopped) {
    await stopInteractiveClaude(input.sessionId, true);
    checkEpoch(input.sessionId, epoch);
    live = undefined;
  }
  if (live) {
    live.onEvent = input.onEvent;
    return live;
  }
  if (hasHeadlessChildBackend() || !isTauri())
    throw new Error(
      "Claude Interactive currently requires the local desktop app. Use Structured for remote hosts.",
    );
  const binding = bindings.get(input.sessionId);
  if (
    binding &&
    (binding.cwd !== input.cwd ||
      (binding.accountId ?? "default") !==
        (input.providerAccountId ?? "default"))
  ) {
    throw new NativeResumeError(
      "Interactive Claude is bound to a different project or account.",
    );
  }
  const nativeId =
    input.nativeResume?.providerSessionId ??
    binding?.nativeId ??
    crypto.randomUUID();
  if (binding && input.nativeResume && binding.nativeId !== nativeId)
    throw new NativeResumeError("Native Claude session identity changed.");
  const nextBinding = {
    nativeId,
    cwd: input.cwd,
    accountId: input.providerAccountId,
  };
  const { path: binary } = await resolveClaudeBinary();
  checkEpoch(input.sessionId, epoch);
  const terminal = await createInteractiveTerminal(input.sessionId, (code) => {
    const current = lives.get(input.sessionId);
    if (current && !current.stopped) {
      fail(
        current,
        `Claude's native terminal exited${code == null ? "" : ` (code ${code})`}. Check the Claude installation and sign-in before starting another turn.`,
      );
      clearTimeout(current.timer);
    }
  });
  try {
    checkEpoch(input.sessionId, epoch);
  } catch (error) {
    terminal.dispose();
    throw error;
  }
  live = {
    id: input.sessionId,
    binding: nextBinding,
    key,
    terminal,
    stopped: false,
    phase: "starting",
    sequence: 0,
    transcript: newTranscriptState(),
    onEvent: input.onEvent,
    approvals: new Map(),
    stopping: 0,
  };
  lives.set(input.sessionId, live);
  try {
    const effort = input.modelSettings?.effort;
    if (
      effort === "ultracode" ||
      effort === "ultrathink" ||
      input.modelSettings?.thinking === "true"
    ) {
      throw new Error(
        "Configure Ultracode, Ultrathink or legacy Thinking in the native terminal; GUI interactive launch supports standard effort levels.",
      );
    }
    await invoke("claude_interactive_start", {
      input: {
        sessionId: input.sessionId,
        nativeId,
        resume: !!binding || !!input.nativeResume,
        cwd: input.cwd,
        binary,
        accountId: input.providerAccountId,
        model: resolveClaudeApiModelId(
          nativeModelId(input.model),
          input.modelSettings?.context,
        ),
        effort: normalizeClaudeCliEffort(effort, nativeModelId(input.model)),
        fast: input.modelSettings?.fast === "true",
        permissionMode:
          input.intent === "plan"
            ? "plan"
            : runtimeModeToPermission(input.runtimeMode),
      },
    });
    checkEpoch(input.sessionId, epoch);
    await terminal.started();
    checkEpoch(input.sessionId, epoch);
    emit(live, { type: "session.started" });
    emit(live, {
      type: "diagnostic.lifecycle",
      operation: "transport",
      identity: nativeId,
      state: "interactive-pty-cli",
    });
    void poll(live);
    return live;
  } catch (error) {
    await stopInteractiveClaude(input.sessionId);
    throw error;
  }
}

export async function sendInteractiveClaude(
  input: SendTurnInput,
  epoch = interactiveClaudeEpoch(input.sessionId),
): Promise<void> {
  if (input.fork)
    throw new NativeForkError(
      "Interactive branching is available in the native terminal. No prompt was sent.",
    );
  if (
    input.ephemeral ||
    input.attachments?.length ||
    input.controlsAgents ||
    input.appAccess
  ) {
    throw new Error(
      "Interactive mode needs native transcript storage. Use the terminal for attachments, and Structured for Operator or orchestration turns. No prompt was sent.",
    );
  }
  if (
    !input.text.trim() ||
    input.text.trimStart().startsWith("/") ||
    /[\x00-\x08\x0b-\x1f\x7f]/.test(input.text)
  ) {
    throw new Error(
      "Use the native terminal for slash commands and control characters. No prompt was sent.",
    );
  }
  const live = await ensureLive(input, epoch);
  checkEpoch(input.sessionId, epoch);
  if (live.fault) throw faultError(live);
  const deadline = Date.now() + 20000;
  while (
    !live.stopped &&
    !live.fault &&
    !live.terminal.stopped &&
    live.phase === "starting" &&
    Date.now() < deadline
  ) {
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
  }
  // SessionStart alone is insufficient: trust/model dialogs can still own input.
  while (
    !live.stopped &&
    !live.fault &&
    !live.terminal.stopped &&
    live.phase === "ready" &&
    !live.terminal.ready() &&
    !live.terminal.owner &&
    Date.now() < deadline
  ) {
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
  }
  if (live.fault) throw faultError(live);
  checkEpoch(input.sessionId, epoch);
  if (
    live.pending ||
    live.external ||
    live.stopped ||
    live.phase !== "ready" ||
    live.terminal.owner ||
    !live.terminal.ready()
  ) {
    throw new HarnessNeedsAttentionError(
      "Claude needs attention before chat can send. Open the model picker → Open native terminal, finish setup or close the menu, then Return to chat. No prompt was sent.",
    );
  }
  live.terminal.writing = true;
  let resolveTurn: () => void = () => undefined;
  let rejectTurn: (error: Error) => void = () => undefined;
  const done = new Promise<void>((resolve, reject) => {
    resolveTurn = resolve;
    rejectTurn = reject;
  });
  const pending: Pending = {
    text: input.text,
    accepted: false,
    resolve: resolveTurn,
    reject: rejectTurn,
    onAccepted: input.onAccepted,
  };
  live.pending = pending;
  // Attach a rejection handler before IPC: hook polling can fail while it awaits.
  void done.catch(() => undefined);
  try {
    await invoke("claude_interactive_send", {
      sessionId: input.sessionId,
      submissionId: input.diagnostic?.submissionId ?? crypto.randomUUID(),
      text: input.text,
    });
    if (!pending.accepted && live.pending === pending) {
      pending.timer = setTimeout(() => {
        if (live.pending === pending && !pending.accepted)
          fail(
            live,
            "Prompt delivery is unconfirmed. Review the native terminal; this message will not be resent automatically.",
          );
      }, 15000);
    }
  } catch (error) {
    fail(
      live,
      `Prompt delivery is unconfirmed: ${String(error)}. Review the native terminal before resending.`,
    );
  } finally {
    live.terminal.writing = false;
  }
  await done;
}

export async function replyInteractiveClaude(
  id: string,
  requestId: number,
  decision: ApprovalDecision | "terminal",
  reply?: UserQuestionReply,
): Promise<void> {
  const live = lives.get(id);
  const row = live?.approvals.get(requestId);
  if (!live || !row) return;
  const input = asRecord(row.tool_input) ?? {};
  const questions = questionsFromUnknown(input);
  const updatedInput =
    reply?.kind === "answered"
      ? askUserQuestionAllowInput(input, reply)
      : undefined;
  try {
    await invoke("claude_interactive_reply", {
      sessionId: id,
      requestId,
      behavior: reply?.kind === "skipped" ? "deny" : decision,
      updatedInput,
    });
    live.approvals.delete(requestId);
    if (questions.length)
      emit(live, {
        type: "question.resolved",
        requestId,
        decision: reply?.kind === "answered" ? "answered" : "skipped",
      });
    else
      emit(live, {
        type: "approval.resolved",
        requestId,
        decision: decision === "terminal" ? "cancelled" : decision,
      });
  } catch (error) {
    emit(live, {
      type: "status",
      text: `Approval reply failed: ${String(error)}. Review the native terminal.`,
    });
  }
}

export async function releaseInteractiveApprovals(id: string): Promise<void> {
  const live = lives.get(id);
  if (!live) return;
  live.terminal.owner = true;
  for (const requestId of live.approvals.keys())
    await replyInteractiveClaude(id, requestId, "terminal");
}

export async function cancelInteractiveClaude(id: string): Promise<void> {
  // Killing the owner is unambiguous even if a native menu owns input.
  await stopInteractiveClaude(id);
}

export async function stopInteractiveClaude(
  id: string,
  preserveEpoch = false,
): Promise<void> {
  if (!preserveEpoch) epochs.set(id, interactiveClaudeEpoch(id) + 1);
  const live = lives.get(id);
  if (live) {
    live.stopped = true;
    clearTimeout(live.timer);
    clearTimeout(live.pending?.timer);
    live.pending?.reject(
      new Error(
        "Interactive Claude stopped. Review any unconfirmed prompt before resending.",
      ),
    );
    live.pending = undefined;
  }
  await invoke("claude_interactive_stop", { sessionId: id });
  live?.terminal.dispose();
  lives.delete(id);
}

export async function forgetInteractiveClaude(id: string): Promise<void> {
  epochs.set(id, interactiveClaudeEpoch(id) + 1);
  if (lives.has(id)) await stopInteractiveClaude(id);
  bindings.delete(id);
}

export function rejectInteractiveSteer(): never {
  throw new TurnNotReadyError(
    "Interactive Claude accepts one composer turn at a time. Queue it or use the native terminal.",
  );
}

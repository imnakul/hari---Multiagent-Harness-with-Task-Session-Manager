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
  type CompactContextInput,
} from "../../core/types";
import { nativeModelId } from "../../../../features/sessions/model/models";
import { loadInteractiveIdleMinutes } from "../../../../features/settings/model/interactiveIdleSettings";
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
  canLaunchWithPrompt,
  composerShowsPaste,
  interactiveTranscriptEvents,
  interactiveTaskNotification,
  newTranscriptState,
  type TranscriptState,
} from "./claudeInteractiveProtocol";
import {
  createInteractiveTerminal,
  type InteractiveTerminal,
  type InteractiveReadiness,
} from "./claudeInteractiveTerminal";
import {
  INTERACTIVE_ATTACHMENTS_HEADER,
  interactivePromptMatches,
} from "./claudeInteractivePrompt";

type Binding = { nativeId: string; cwd: string; accountId?: string };
type Pending = {
  text: string;
  accepted: boolean;
  /** A Stop seen after this prompt was queued; earlier Stops cannot end it. */
  sawStop?: boolean;
  compact?: boolean;
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
type ReadinessSnapshot = {
  revision: "2026-10-17-no-native-suggestions";
  phase: string;
  pendingTurn: boolean;
  externalTurn: boolean;
  terminal: InteractiveReadiness;
};
type InteractiveDiagnostics = {
  status: "live" | "exited" | "stopped";
  current: ReadinessSnapshot;
  lastBlocked?: ReadinessSnapshot;
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
  lastBlocked?: ReadinessSnapshot;
  lastActivity: number;
  fastUntil: number;
  polling: boolean;
  wake: boolean;
  background: Set<string>;
  uncertainBackground: boolean;
  seenMessages: Set<string>;
  lastParkCheck: number;
  continuation?: string;
  stopText?: string;
  lastReply?: string[];
};
const bindings = new Map<string, Binding>();
const RECLAIM_AFTER_INPUT_MS = 1500;
const lives = new Map<string, Live>();
// Metadata only, bounded per window. Explicit Forget clears the session's report.
const stoppedDiagnostics = new Map<string, InteractiveDiagnostics>();
const MAX_STOPPED_DIAGNOSTICS = 50;
const epochs = new Map<string, number>();
const parking = new Map<string, Promise<boolean>>();

function wakePoll(live: Live): void {
  live.lastActivity = Date.now();
  live.fastUntil = Date.now() + 2000;
  clearTimeout(live.timer);
  if (live.polling) live.wake = true;
  else void poll(live);
}

/** Manual monitor bulk-stop uses the same conservative policy as parking. */
export function interactiveClaudeIdleSafe(id: string): boolean {
  const live = lives.get(id);
  return (
    !!live &&
    !live.stopped &&
    !live.fault &&
    !live.pending &&
    !live.external &&
    !live.stopping &&
    live.phase === "ready" &&
    !live.approvals.size &&
    !live.background.size &&
    !live.uncertainBackground &&
    !live.terminal.owner &&
    live.terminal.ready()
  );
}

export async function parkInteractiveClaude(
  id: string,
  minutes = loadInteractiveIdleMinutes(),
  explicitIdleStop = false,
): Promise<boolean> {
  if (parking.has(id)) return parking.get(id)!;
  const live = lives.get(id);
  if (
    !live ||
    !interactiveClaudeIdleSafe(id) ||
    Date.now() - live.lastActivity < minutes * 60000
  )
    return false;
  const work = (async (): Promise<boolean> => {
    const stopped = await invoke<boolean>("claude_interactive_park", {
      sessionId: id,
      after: live.sequence,
      minutes,
      explicitIdleStop,
    });
    if (stopped) {
      // Backend already used the ordinary owned-process teardown. Keep binding
      // and epoch: a send waiting on this promise resumes that exact session.
      live.stopped = true;
      clearTimeout(live.timer);
      live.terminal.dispose();
      lives.delete(id);
    }
    return stopped;
  })();
  parking.set(id, work);
  try {
    return await work;
  } finally {
    parking.delete(id);
  }
}

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

function readinessSnapshot(live: Live): ReadinessSnapshot {
  return {
    revision: "2026-10-17-no-native-suggestions",
    phase: live.phase,
    pendingTurn: !!live.pending,
    externalTurn: !!live.external,
    terminal: live.terminal.inspect(),
  };
}
export function hasInteractiveClaudeDiagnostics(id: string): boolean {
  return lives.has(id) || stoppedDiagnostics.has(id);
}
export function interactiveClaudeDiagnostics(
  id: string,
): InteractiveDiagnostics | undefined {
  const live = lives.get(id);
  return live
    ? {
        status: live.terminal.stopped ? "exited" : "live",
        current: readinessSnapshot(live),
        lastBlocked: live.lastBlocked,
      }
    : stoppedDiagnostics.get(id);
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

/**
 * Claude reported an API error (StopFailure) for the running turn. The turn is
 * over and Claude is idle again, so end it with the error but leave no fault:
 * the next send is a fresh prompt, as a Structured retry would be.
 */
function failTurn(live: Live, message: string): void {
  // Acceptance precedes the API call, so an unaccepted prompt cannot have failed.
  if (live.pending && !live.pending.accepted) return;
  live.stopping = 0;
  const pending = live.pending;
  live.pending = undefined;
  clearTimeout(pending?.timer);
  if (pending) pending.reject(new HarnessNeedsAttentionError(message));
  else emit(live, { type: "session.error", message });
  if (live.external) {
    live.onEvent({ type: "externalTurn.finished", turnId: live.external });
    live.external = undefined;
  }
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
  const agent = typeof row.agent_id === "string" ? row.agent_id : undefined;
  if (event === "SubagentStart" && agent) live.background.add(`agent:${agent}`);
  if (event === "SubagentStop" && agent)
    live.background.delete(`agent:${agent}`);
  const task = typeof row.task_id === "string" ? row.task_id : undefined;
  if (event === "TaskCreated" && task) live.background.add(`task:${task}`);
  if (event === "TaskCompleted" && task) live.background.delete(`task:${task}`);
  const toolInput = asRecord(row.tool_input);
  if (event === "PreToolUse" && toolInput?.run_in_background === true)
    live.uncertainBackground = true;
  const backgroundId = asRecord(row.tool_response)?.backgroundTaskId;
  if (event === "PostToolUse" && typeof backgroundId === "string")
    live.background.add(`task:${backgroundId}`);
  if (event === "Stop" && !row.agent_id) {
    if (
      Array.isArray(row.background_tasks) &&
      Array.isArray(row.session_crons)
    ) {
      for (const key of live.background)
        if (key.startsWith("task:")) live.background.delete(key);
      live.uncertainBackground = row.session_crons.length > 0;
      for (const raw of row.background_tasks) {
        const entry = asRecord(raw);
        if (
          !entry ||
          typeof entry.id !== "string" ||
          typeof entry.status !== "string"
        )
          live.uncertainBackground = true;
        else if (
          !["completed", "failed", "killed", "stopped"].includes(entry.status)
        )
          live.background.add(`task:${entry.id}`);
      }
    } else live.uncertainBackground = true;
  }
  if (row.agent_id && event !== "PermissionRequest") return;
  if (event === "UserPromptSubmit") {
    const taskId = interactiveTaskNotification(row.prompt);
    if (
      taskId &&
      row.prompt !== live.pending?.text &&
      live.background.has(`task:${taskId}`)
    ) {
      // Keep old-turn transcript lines attached to their turn. The native JSONL
      // user notification is the boundary for the next autonomous response.
      live.continuation = taskId;
      return;
    }
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
    live.stopText = undefined;
    live.lastReply = undefined;
    if (live.pending && interactivePromptMatches(live.pending.text, row.prompt)) {
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
  if (
    event === "Notification" &&
    row.notification_type !== "idle_prompt" &&
    !(
      typeof row.message === "string" &&
      /^Claude is waiting for your input[.!]?$/i.test(row.message.trim())
    )
  ) {
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
  if (event === "PreCompact" && live.pending?.compact) {
    live.pending.accepted = true;
    clearTimeout(live.pending.timer);
    live.pending.onAccepted?.();
  }
  if (event === "Stop" || event === "PostCompact") {
    live.stopping = 1;
    if (live.pending) live.pending.sawStop = true;
    live.stopText =
      event === "Stop" && typeof row.last_assistant_message === "string"
        ? row.last_assistant_message.trim() || undefined
        : undefined;
  }
  if (event === "StopFailure")
    failTurn(
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
  if (live.stopped || live.polling) return;
  live.polling = true;
  live.wake = false;
  let more = false;
  try {
    const result = await invoke<Poll>("claude_interactive_poll", {
      sessionId: live.id,
      after: live.sequence,
    });
    if (live.stopped) return;
    live.phase = result.phase;
    more = result.more;
    if (result.events.length || result.lines.length) {
      live.lastActivity = Date.now();
      live.fastUntil = Date.now() + 2000;
    }
    // Prompt acceptance must be processed before its transcript activity.
    for (const row of result.events) hookEvent(live, row);
    for (const line of result.lines) {
      // Background completions can trigger a root assistant without another
      // UserPromptSubmit. Establish its GUI turn before rendering any deltas.
      let row: Record<string, unknown> | undefined;
      try {
        row = asRecord(JSON.parse(line)) ?? undefined;
      } catch {
        /* parser handles malformed records */
      }
      if (row?.type === "user" && live.continuation) {
        const content = asRecord(row.message)?.content;
        const text =
          typeof content === "string"
            ? content
            : Array.isArray(content)
              ? content.map((part) => asRecord(part)?.text ?? "").join("\n")
              : "";
        if (interactiveTaskNotification(text) === live.continuation) {
          if (live.pending?.accepted) complete(live);
          live.background.delete(`task:${live.continuation}`);
          live.continuation = undefined;
          live.transcript = newTranscriptState();
        }
      }
      if (
        row?.type === "assistant" &&
        !row.isSidechain &&
        typeof row.uuid === "string" &&
        !live.seenMessages.has(row.uuid)
      ) {
        live.seenMessages.add(row.uuid);
        if (!live.pending && !live.external) {
          live.external = `interactive:${live.binding.nativeId}:${row.uuid}`;
          live.onEvent({
            type: "externalTurn.started",
            turnId: live.external,
            text: "",
            nativeId: live.binding.nativeId,
          });
        }
      }
      if (row?.type === "assistant" && !row.isSidechain) {
        const content = asRecord(row.message)?.content;
        if (Array.isArray(content))
          live.lastReply = content.flatMap((part) => {
            const block = asRecord(part);
            return block?.type === "text" && typeof block.text === "string"
              ? [block.text]
              : [];
          });
      }
      for (const event of interactiveTranscriptEvents(line, live.transcript))
        emit(live, event);
    }
    live.sequence = result.sequence;
    // Let final JSONL writes settle after Stop, including multi-page tool results.
    if (live.stopping && !result.more) {
      live.stopping = result.lines.length ? 1 : live.stopping + 1;
      const finalReplyRendered =
        live.pending?.compact ||
        !live.stopText ||
        ["", "\n"].some(
          (separator) =>
            live.lastReply?.join(separator).trim() === live.stopText,
        );
      if (
        live.stopping >= 3 &&
        live.phase === "ready" &&
        (live.pending ? live.pending.sawStop : live.external) &&
        finalReplyRendered
      ) {
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
  } finally {
    live.polling = false;
  }
  if (!live.stopped) {
    if (
      interactiveClaudeIdleSafe(live.id) &&
      Date.now() - live.lastParkCheck > 60000 &&
      Date.now() - live.lastActivity >= loadInteractiveIdleMinutes() * 60000
    ) {
      live.lastParkCheck = Date.now();
      try {
        if (await parkInteractiveClaude(live.id)) return;
      } catch {
        /* unavailable observation never authorizes a shutdown */
      }
    }
    const active =
      live.wake ||
      more ||
      live.pending ||
      live.external ||
      live.stopping ||
      live.approvals.size ||
      live.background.size ||
      live.phase !== "ready" ||
      Date.now() < live.fastUntil;
    live.timer = setTimeout(
      () => {
        void poll(live);
      },
      active ? 200 : 1500,
    );
  }
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

/** A send that starts Claude: its prompt rides the launch command instead of a paste. */
type LaunchPrompt = { text: string; submissionId: string; pending: Pending };

/**
 * Reuse or start the session's Claude. When this call starts Claude and a
 * `launch` prompt is given, it becomes Claude's prompt argument and
 * `live.pending` before any hook can arrive; `launched` says the send is
 * already in flight and must not be pasted as well.
 */
async function ensureLive(
  input: SendTurnInput,
  epoch: number,
  launch?: LaunchPrompt,
): Promise<{ live: Live; launched: boolean }> {
  await parking.get(input.sessionId);
  checkEpoch(input.sessionId, epoch);
  let live = lives.get(input.sessionId);
  const key = launchKey(input);
  if (live && live.key !== key) {
    if (
      live.pending ||
      live.external ||
      live.approvals.size ||
      live.background.size ||
      live.uncertainBackground ||
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
    return { live, launched: false };
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
    (input.fork ? crypto.randomUUID() : undefined) ??
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
    if (current && !current.stopped && !parking.has(input.sessionId)) {
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
    lastActivity: Date.now(),
    fastUntil: Date.now() + 2000,
    polling: false,
    wake: false,
    background: new Set(),
    uncertainBackground: false,
    seenMessages: new Set(),
    lastParkCheck: 0,
  };
  lives.set(input.sessionId, live);
  stoppedDiagnostics.delete(input.sessionId);
  // Set before Claude starts: its UserPromptSubmit hook can be the first event.
  if (launch) live.pending = launch.pending;
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
        resume: !input.fork && (!!binding || !!input.nativeResume),
        fork: input.fork,
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
        prompt: launch
          ? { submissionId: launch.submissionId, text: launch.text }
          : undefined,
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
    return { live, launched: !!launch };
  } catch (error) {
    await stopInteractiveClaude(input.sessionId);
    throw error;
  }
}

export async function sendInteractiveClaude(
  input: SendTurnInput,
  epoch = interactiveClaudeEpoch(input.sessionId),
): Promise<void> {
  if (input.fork?.forkPoint)
    throw new NativeForkError(
      "Interactive Claude only forks full native history. Use copied context for a selected earlier turn. No prompt was sent.",
    );
  if (input.ephemeral || input.controlsAgents || input.appAccess) {
    throw new Error(
      "Interactive mode needs native transcript storage. Use Structured for Operator or orchestration turns. No prompt was sent.",
    );
  }
  if (
    !input.text.trim() ||
    (input.text.trimStart().startsWith("/") &&
      input.text.trim() !== "/compact") ||
    /[\x00-\x08\x0b-\x1f\x7f]/.test(input.text)
  ) {
    throw new Error(
      "Use the native terminal for slash commands and control characters. No prompt was sent.",
    );
  }
  const submissionId = input.diagnostic?.submissionId ?? crypto.randomUUID();
  // Claude discards input typed while it starts, so a send that starts Claude
  // hands it the prompt as a launch argument (as Orca does) when it can.
  const launchText = input.text.replace(/	/g, "    ");
  const launch =
    !input.attachments?.length &&
    input.text.trim() !== "/compact" &&
    canLaunchWithPrompt(launchText)
      ? newTurn(launchText, false, input.onAccepted)
      : undefined;
  const { live, launched } = await ensureLive(
    input,
    epoch,
    launch && { text: launchText, submissionId, pending: launch.pending },
  ).catch((error: unknown) => {
    if (input.fork)
      throw new NativeForkError(
        `Native Interactive fork failed before sending: ${String(error)}`,
      );
    throw error;
  });
  if (launched && launch) {
    const { pending } = launch;
    wakePoll(live);
    pending.timer = setTimeout(() => {
      if (live.pending === pending && !pending.accepted)
        fail(
          live,
          "Claude has not picked up this message yet. Open the model picker → Open native terminal: a dialog may be waiting (a new account first asks whether to trust this folder). Once it is answered Claude sends the message itself, so do not resend it.",
        );
    }, LAUNCH_ACCEPT_TIMEOUT_MS);
    await launch.done;
    return;
  }
  checkEpoch(input.sessionId, epoch);
  if (live.fault)
    throw live.terminal.stopped
      ? faultError(live)
      : new HarnessNeedsAttentionError(
          `${live.fault} Open the model picker → Open native terminal, check it, then use Return to chat once its prompt is empty (or Stop Claude). No prompt was sent.`,
        );
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
    const screen = live.terminal.inspect();
    if (
      screen.reason === "prompt-mismatch" &&
      screen.outputAgeMs != null &&
      screen.outputAgeMs >= 750 &&
      !screen.pendingParses
    )
      await live.terminal.repaint?.().catch(() => undefined);
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
  }
  if (live.fault) throw faultError(live);
  checkEpoch(input.sessionId, epoch);
  // Answering a native dialog (such as folder trust) leaves the terminal owning
  // input. An idle, empty prompt holds no draft to clobber, so take input back.
  // A fresh keystroke may not have echoed yet; only trust a screen drawn after it.
  const screen = live.terminal.owner ? live.terminal.inspect() : undefined;
  if (
    screen?.reason === "ready" &&
    (screen.inputAgeMs ?? Infinity) >= RECLAIM_AFTER_INPUT_MS &&
    (screen.outputAgeMs ?? Infinity) < (screen.inputAgeMs ?? Infinity) &&
    !live.pending &&
    !live.external &&
    !live.stopped &&
    live.phase === "ready"
  ) {
    await live.terminal.reclaim();
    checkEpoch(input.sessionId, epoch);
  }
  if (
    live.pending ||
    live.external ||
    live.stopped ||
    live.phase !== "ready" ||
    live.terminal.owner ||
    !live.terminal.ready()
  ) {
    const snapshot = readinessSnapshot(live);
    live.lastBlocked = snapshot;
    emit(live, {
      type: "diagnostic.lifecycle",
      operation: "interactive-readiness",
      identity: live.binding.nativeId,
      state: JSON.stringify(snapshot),
    });
    const reason = snapshot.terminal.reason;
    const explanation = live.terminal.owner
      ? "The native terminal currently has input."
      : live.pending || live.external || live.phase !== "ready"
        ? "Claude has not reached an idle conversation state."
        : reason === "no-output" || reason === "starting"
          ? "Claude started, but no terminal output reached MonoCode."
          : reason === "settling" || reason === "parsing"
            ? "Claude's terminal output did not settle before the startup timeout."
            : reason === "native-dialog" || snapshot.terminal.dialogOnScreen
              ? "Claude is showing a native menu or setup dialog (a new account first asks whether to trust this folder)."
              : "MonoCode could not recognize Claude's empty input prompt.";
    throw new HarnessNeedsAttentionError(
      `${explanation} Open the model picker → Open native terminal. Use Return to chat once its prompt is empty; if it is already empty, Copy diagnostics there. No prompt was sent.`,
    );
  }
  const compact = input.text.trim() === "/compact";
  if (compact && (live.background.size || live.uncertainBackground))
    throw new HarnessNeedsAttentionError(
      "Wait for background work to finish before compacting. No command was sent.",
    );
  // The native input editor expands pasted tabs to four spaces before its hook.
  // Match that verified representation so indentation is not mistaken for a
  // different prompt and delivery can still be confirmed exactly.
  let text = compact ? "/compact" : input.text.replace(/\t/g, "    ");
  if (input.attachments?.length) {
    if (compact)
      throw new Error(
        "Compact cannot include attachments. No prompt was sent.",
      );
    const paths = await invoke<string[]>("claude_interactive_attachments", {
      nativeId: live.binding.nativeId,
      attachments: input.attachments,
    });
    checkEpoch(input.sessionId, epoch);
    if (
      live.pending ||
      live.external ||
      live.stopped ||
      live.phase !== "ready" ||
      live.terminal.owner ||
      !live.terminal.ready()
    )
      throw new HarnessNeedsAttentionError(
        "Claude changed state while saving attachments. No prompt was sent.",
      );
    text +=
      INTERACTIVE_ATTACHMENTS_HEADER +
      paths
        .map(
          (path, index) =>
            `${JSON.stringify(input.attachments![index].name)}: ${JSON.stringify(path)}`,
        )
        .join("\n");
  }
  live.terminal.writing = true;
  const { pending, done } = newTurn(text, compact, input.onAccepted);
  live.pending = pending;
  wakePoll(live);
  const submit = (action: "enter" | "repaste" | "abort"): Promise<void> =>
    invoke("claude_interactive_submit", {
      sessionId: input.sessionId,
      submissionId,
      action,
    });
  let outcome: PasteOutcome = "unknown";
  try {
    const pastedAt = Date.now();
    await invoke("claude_interactive_send", {
      sessionId: input.sessionId,
      submissionId,
      text,
    });
    outcome = await awaitPasteShown(live, pending, text, pastedAt, () =>
      submit("repaste"),
    );
    if (outcome === "dropped") {
      await submit("abort");
      live.pending = undefined;
      pending.reject(
        new HarnessNeedsAttentionError(
          "Claude did not receive this message: its prompt stayed empty, so nothing was sent. Send it again.",
        ),
      );
    } else if (outcome === "unknown") {
      fail(
        live,
        "Prompt delivery is unconfirmed: Claude's prompt never showed the message, so Enter was not pressed. Review the native terminal before resending.",
      );
    } else if (outcome === "shown") {
      await submit("enter");
      if (!pending.accepted && live.pending === pending) {
        pending.timer = setTimeout(() => {
          if (live.pending === pending && !pending.accepted)
            fail(
              live,
              "Prompt delivery is unconfirmed. Review the native terminal; this message will not be resent automatically.",
            );
        }, 15000);
      }
    }
  } catch (error) {
    outcome = "unknown";
    fail(
      live,
      `Prompt delivery is unconfirmed: ${String(error)}. Review the native terminal before resending.`,
    );
  } finally {
    live.terminal.writing = false;
  }
  if (outcome === "shown") await retryEnter(live, pending, text, submit);
  await done;
}

/** A prompt in flight and the promise its turn settles. */
function newTurn(
  text: string,
  compact: boolean,
  onAccepted: (() => void) | undefined,
): { pending: Pending; done: Promise<void> } {
  let resolveTurn: () => void = () => undefined;
  let rejectTurn: (error: Error) => void = () => undefined;
  const done = new Promise<void>((resolve, reject) => {
    resolveTurn = resolve;
    rejectTurn = reject;
  });
  // Attach a rejection handler before IPC: hook polling can fail while it awaits.
  void done.catch(() => undefined);
  return {
    pending: {
      text,
      compact,
      accepted: false,
      resolve: resolveTurn,
      reject: rejectTurn,
      onAccepted,
    },
    done,
  };
}

/** How long a launch prompt may wait for Claude to submit it (a startup dialog holds it). */
const LAUNCH_ACCEPT_TIMEOUT_MS = 45_000;
/** Longest wait for Claude to draw a paste; a resumed chat can stall seconds after it mounts. */
const PASTE_SHOWN_TIMEOUT_MS = 20_000;
/** Output this long after a paste is Claude's own drawing, not ConPTY's instant echo. */
const PASTE_ECHO_MS = 500;
/** A screen quiet this long has finished drawing what Claude received. */
const SCREEN_QUIET_MS = 1500;
/** Press Enter again while the paste still sits in the prompt this long after a press. */
const ENTER_RETRY_MS = 3000;

type PasteOutcome = "shown" | "accepted" | "dropped" | "unknown";

/**
 * Wait until Claude's prompt box shows the paste. Output bytes prove nothing:
 * ConPTY echoes at once, and Claude 2.1.303 discards input that arrives while
 * its startup screen takes over the terminal. A prompt Claude redrew empty after
 * the paste means nothing reached it, so paste once more, then report "dropped".
 * A prompt that is not redrawn (Claude stalled) is never repasted.
 */
async function awaitPasteShown(
  live: Live,
  pending: Pending,
  text: string,
  pastedAt: number,
  repaste: () => Promise<void>,
): Promise<PasteOutcome> {
  let repasted = false;
  for (;;) {
    if (live.pending !== pending || pending.accepted) return "accepted";
    if (live.stopped || live.terminal.stopped || live.terminal.owner)
      return "unknown";
    const screen = live.terminal.inspect();
    const draft = live.terminal.composer();
    const age = screen.pendingParses ? 0 : (screen.outputAgeMs ?? 0);
    const redrawn =
      screen.outputAgeMs != null &&
      Date.now() - screen.outputAgeMs >= pastedAt + PASTE_ECHO_MS;
    if (draft != null && composerShowsPaste(draft, text) && age >= 300)
      return "shown";
    if (draft === "" && redrawn && age >= SCREEN_QUIET_MS) {
      if (repasted) return "dropped";
      repasted = true;
      pastedAt = Date.now();
      await repaste();
      continue;
    }
    if (Date.now() - pastedAt >= PASTE_SHOWN_TIMEOUT_MS) return "unknown";
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
  }
}

/**
 * Claude can miss an Enter during a post-startup stall and keep the paste as a
 * draft. While it still shows the paste unsubmitted, press Enter again (twice at
 * most); once submitted the prompt is empty and a stray Enter does nothing.
 */
async function retryEnter(
  live: Live,
  pending: Pending,
  text: string,
  submit: (action: "enter") => Promise<void>,
): Promise<void> {
  let enteredAt = Date.now();
  for (let enters = 1; enters < 3; ) {
    await new Promise<void>((resolve) => setTimeout(resolve, 250));
    if (
      live.pending !== pending ||
      pending.accepted ||
      live.stopped ||
      live.terminal.stopped ||
      live.terminal.owner
    )
      return;
    const screen = live.terminal.inspect();
    const draft = live.terminal.composer();
    if (
      Date.now() - enteredAt < ENTER_RETRY_MS ||
      screen.pendingParses ||
      (screen.outputAgeMs ?? 0) < 1000 ||
      draft == null ||
      !composerShowsPaste(draft, text)
    )
      continue;
    try {
      await submit("enter");
    } catch {
      return; // Claude acknowledged meanwhile, or the user took the terminal.
    }
    enters++;
    enteredAt = Date.now();
  }
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
  wakePoll(live);
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

/**
 * Return to chat is the user's confirmation that they reviewed the native
 * terminal, so it also clears a fault left by an earlier send. Claude must be
 * idle with no tracked turn and an empty prompt (`reclaim` checks the screen,
 * the backend checks its phase). A pasted draft or a turn still running keeps
 * it blocked, so an unconfirmed prompt is never resent without that review.
 * After a faulted send the backend phase can stay "sending" (Claude never
 * acknowledged the prompt) or "unconfirmed"; the backend accepts those here.
 */
export async function returnInteractiveClaudeToChat(id: string): Promise<void> {
  const live = lives.get(id);
  if (!live || live.stopped) throw new Error("Interactive Claude is not running.");
  const unacknowledged =
    live.fault !== undefined &&
    (live.phase === "sending" || live.phase === "unconfirmed");
  if (
    live.pending ||
    live.external ||
    live.terminal.writing ||
    (live.phase !== "ready" && !unacknowledged)
  )
    throw new Error(
      "Wait for the native conversation to finish before returning to chat.",
    );
  await live.terminal.reclaim();
  live.phase = "ready";
  live.fault = undefined;
  // Observation stops after a poll failure; returning restarts it.
  wakePoll(live);
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
  if (live) {
    live.phase = "stopped";
    live.terminal.stopped = true;
    stoppedDiagnostics.delete(id);
    stoppedDiagnostics.set(id, {
      status: "stopped",
      current: readinessSnapshot(live),
      lastBlocked: live.lastBlocked,
    });
    while (stoppedDiagnostics.size > MAX_STOPPED_DIAGNOSTICS)
      stoppedDiagnostics.delete(stoppedDiagnostics.keys().next().value!);
  }
  lives.delete(id);
  live?.terminal.dispose();
}

export async function forgetInteractiveClaude(id: string): Promise<void> {
  epochs.set(id, interactiveClaudeEpoch(id) + 1);
  if (lives.has(id)) await stopInteractiveClaude(id);
  bindings.delete(id);
  stoppedDiagnostics.delete(id);
}

export function rejectInteractiveSteer(): never {
  throw new TurnNotReadyError(
    "Interactive Claude accepts one composer turn at a time. Queue it or use the native terminal.",
  );
}

/** The existing Compact button uses the same terminal owner and hook drain. */
export async function compactInteractiveClaude(
  input: CompactContextInput,
): Promise<void> {
  await sendInteractiveClaude({ ...input, text: "/compact" });
}

import { nativeModelId } from "../../../../features/sessions/model/models";
import type { RuntimeMode } from "../../../../features/sessions/model/session";
import { AcpClient, type AcpHandlers } from "../../core/acp";
import { AcpSubagents } from "../../core/acpSubagents";
import {
  killChild,
  resolveCommandCodeBinary,
  spawnChild,
  unwatchChild,
  watchChild,
} from "../../core/child";
import {
  asRecord,
  commandCodeConfigOptions,
  commandCodeCurrentModeId,
  commandCodeCurrentModelId,
  commandCodeModeId,
  commandCodePromptBlocks,
  commandCodeSessionId,
  commandCodeStartupError,
  commandCodeTurnError,
  type CommandCodeConfigOption,
} from "./commandCodeProtocol";
import {
  eventsFromAcpUpdate,
  permissionOptionId,
  permissionRequestFromAcp,
  pickAutoOption,
} from "../grok/grokProtocol";
import type {
  ApprovalDecision,
  HarnessEvent,
  HarnessSessionInput,
  SendTurnInput,
  SteerTurnInput,
} from "../../core/types";

type Live = {
  subagents: AcpSubagents;
  acp: AcpClient;
  acpSessionId: string;
  cwd: string;
  modelId: string;
  modeId: string;
  configOptions: CommandCodeConfigOption[];
  /** A model id Command Code rejected, so the warning is shown once. */
  staleModel: string;
  muteUpdates: boolean;
  cancelled: boolean;
  runtimeMode: RuntimeMode;
  planning: boolean;
  onEvent: (event: HarnessEvent) => void;
  approvals: Map<number, (decision: ApprovalDecision) => void>;
  turns: Promise<void>;
};

type Resume = { acpSessionId: string; cwd: string };

const INIT_TIMEOUT_MS = 20_000;
const SESSION_TIMEOUT_MS = 45_000;
const CONTROL_TIMEOUT_MS = 20_000;
const PROMPT_TIMEOUT_MS = 30 * 60_000;

const CLIENT_CAPABILITIES = {
  fs: { readTextFile: false, writeTextFile: false },
  terminal: false,
};

const liveByThread = new Map<string, Live>();
const resumeByThread = new Map<string, Resume>();
const cancelledThreads = new Set<string>();

/**
 * Fork (L-255): live Command Code adapter. Spawns `cmdc acp` and talks
 * standard ACP; the CLI keeps its own sessions, so a chat resumes with
 * `session/load` after a restart.
 */
export async function sendCommandCodeTurn(input: SendTurnInput): Promise<void> {
  let live: Live;
  try {
    live = await ensureLive(input);
  } catch (error) {
    cancelledThreads.delete(input.sessionId);
    throw error;
  }
  if (cancelledThreads.delete(input.sessionId)) return;

  live.onEvent = input.onEvent;
  live.runtimeMode = input.runtimeMode;
  live.planning = input.intent === "plan";
  live.turns = live.turns
    .catch(() => undefined)
    .then(async () => {
      live.cancelled = false;
      live.muteUpdates = false;
      try {
        await applyModelSelection(live, input);
        if (live.cancelled) return;
        await applyRuntimeMode(live, input.runtimeMode, live.planning);
        if (live.cancelled) return;
        await prompt(live, input);
      } catch (error) {
        if (live.cancelled) return;
        throw error;
      }
    });

  try {
    await live.turns;
  } catch (error) {
    if (liveByThread.get(input.sessionId) === live) {
      await stopCommandCodeSession(input.sessionId);
    }
    throw error;
  }
}

/**
 * ACP allows one prompt at a time and Command Code does not document
 * mid-turn steering, so follow-ups wait for the turn like Cline and Devin.
 */
export async function steerCommandCodeTurn(_input: SteerTurnInput): Promise<void> {
  throw new Error("Command Code does not support steering an in-flight turn");
}

export function respondCommandCodeApproval(
  sessionId: string,
  requestId: number,
  decision: ApprovalDecision,
): void {
  liveByThread.get(sessionId)?.approvals.get(requestId)?.(decision);
}

export async function cancelCommandCodeTurn(sessionId: string): Promise<void> {
  const live = liveByThread.get(sessionId);
  if (!live) {
    cancelledThreads.add(sessionId);
    return;
  }
  live.cancelled = true;
  live.muteUpdates = true;
  resolveApprovals(live);
  await live.acp
    .notify("session/cancel", { sessionId: live.acpSessionId })
    .catch(() => undefined);
  live.acp.rejectPending(new Error("cancelled"));
}

export async function stopCommandCodeSession(sessionId: string): Promise<void> {
  cancelledThreads.delete(sessionId);
  const live = liveByThread.get(sessionId);
  liveByThread.delete(sessionId);
  if (live) {
    live.muteUpdates = true;
    live.cancelled = true;
    resolveApprovals(live);
  }
  live?.acp.close();
  unwatchChild(sessionId);
  await killChild(sessionId).catch(() => undefined);
}

export async function forgetCommandCodeSession(sessionId: string): Promise<void> {
  resumeByThread.delete(sessionId);
  await stopCommandCodeSession(sessionId);
}

export function bindCommandCodeSession(
  threadId: string,
  acpSessionId: string,
  cwd: string,
): void {
  const sessionId = acpSessionId.trim();
  if (!threadId || !sessionId || !cwd.trim()) return;
  resumeByThread.set(threadId, { acpSessionId: sessionId, cwd });
}

async function ensureLive(input: HarnessSessionInput): Promise<Live> {
  const existing = liveByThread.get(input.sessionId);
  if (existing && existing.cwd === input.cwd) {
    existing.onEvent = input.onEvent;
    existing.runtimeMode = input.runtimeMode;
    existing.planning = input.intent === "plan";
    return existing;
  }
  if (existing) {
    resumeByThread.delete(input.sessionId);
    await stopCommandCodeSession(input.sessionId);
  }

  const resume = resumeByThread.get(input.sessionId);
  const canLoad = resume != null && resume.cwd === input.cwd;
  if (resume && resume.cwd !== input.cwd) resumeByThread.delete(input.sessionId);

  const { path } = await resolveCommandCodeBinary();
  const handlers: AcpHandlers = {};
  const acp = new AcpClient(input.sessionId, handlers);
  const liveRef: { current: Live | null } = { current: null };
  const muteGate = { current: false };

  handlers.onNotification = (method, params) => {
    const live = liveRef.current;
    if (!live) return;
    // Config changes stay tracked while muted so a replayed history cannot
    // leave a stale effort or mode behind.
    if (method === "session/update" && trackSessionState(live, params)) return;
    if (muteGate.current || live.muteUpdates) return;
    handleNotification(live, method, params);
  };
  handlers.onRequest = (id, method, params) => {
    const live = liveRef.current;
    if (!live) {
      void acp
        .respondError(id, {
          code: -32601,
          message: `Method not found: ${method}`,
        })
        .catch(() => undefined);
      return;
    }
    void handleRequest(live, id, method, params);
  };

  const emit = (event: HarnessEvent) => {
    (liveRef.current?.onEvent ?? input.onEvent)(event);
  };
  watchChild(
    input.sessionId,
    (line) => acp.pushLine(line),
    (code) => {
      const live = liveRef.current;
      if (live) live.cancelled = true;
      acp.close(new Error("Command Code exited"));
      liveByThread.delete(input.sessionId);
      emit({ type: "session.ended", code });
    },
    (line) => {
      // `[acp] …` progress lines; failures arrive as JSON-RPC errors.
      console.debug("[monocode] command-code stderr", line);
    },
  );

  await spawnChild(
    input.sessionId,
    path,
    ["acp"],
    input.cwd,
    undefined,
    "command-code",
  );

  try {
    try {
      await acp.request(
        "initialize",
        {
          protocolVersion: 1,
          clientCapabilities: CLIENT_CAPABILITIES,
          clientInfo: { name: "monocode", version: "0.1.0" },
        },
        INIT_TIMEOUT_MS,
      );
    } catch (error) {
      throw commandCodeStartupError(error);
    }

    let setup: unknown;
    let acpSessionId: string | undefined;
    let didLoad = false;
    if (canLoad && resume) {
      // History replay would duplicate the transcript MonoCode already shows.
      muteGate.current = true;
      try {
        setup = await acp.request(
          "session/load",
          { sessionId: resume.acpSessionId, cwd: input.cwd, mcpServers: [] },
          SESSION_TIMEOUT_MS,
        );
        acpSessionId = commandCodeSessionId(setup) ?? resume.acpSessionId;
        didLoad = true;
      } catch {
        setup = undefined;
        acpSessionId = undefined;
      } finally {
        muteGate.current = false;
      }
    }

    if (!acpSessionId) {
      try {
        setup = await acp.request(
          "session/new",
          { cwd: input.cwd, mcpServers: [] },
          SESSION_TIMEOUT_MS,
        );
      } catch (error) {
        throw commandCodeStartupError(error);
      }
      acpSessionId = commandCodeSessionId(setup);
    }
    if (!acpSessionId) throw new Error("Command Code did not return a session id");

    const live: Live = {
      subagents: new AcpSubagents(),
      acp,
      acpSessionId,
      cwd: input.cwd,
      modelId: commandCodeCurrentModelId(setup) ?? "",
      modeId: commandCodeCurrentModeId(setup) ?? "",
      configOptions: commandCodeConfigOptions(setup),
      staleModel: "",
      muteUpdates: didLoad,
      cancelled: false,
      runtimeMode: input.runtimeMode,
      planning: input.intent === "plan",
      onEvent: input.onEvent,
      approvals: new Map(),
      turns: Promise.resolve(),
    };
    liveRef.current = live;
    liveByThread.set(input.sessionId, live);
    if (!input.ephemeral) {
      resumeByThread.set(input.sessionId, { acpSessionId, cwd: input.cwd });
      live.onEvent({
        type: "session.providerBound",
        providerSessionId: acpSessionId,
      });
    }
    live.onEvent({ type: "session.started" });
    return live;
  } catch (error) {
    acp.close(error instanceof Error ? error : new Error(String(error)));
    await stopCommandCodeSession(input.sessionId);
    throw error;
  }
}

async function applyModelSelection(
  live: Live,
  input: HarnessSessionInput,
): Promise<void> {
  const modelId = nativeModelId(input.model).trim();
  if (modelId && modelId !== "default" && modelId !== live.modelId) {
    try {
      const result = await live.acp.request(
        "session/set_model",
        { sessionId: live.acpSessionId, modelId },
        CONTROL_TIMEOUT_MS,
      );
      live.modelId = modelId;
      refreshConfigOptions(live, result);
    } catch (error) {
      if (live.cancelled) throw error;
      // A model the account lost (plan change, CLI update) must not fail
      // every turn of a saved chat; keep the session's model and say so.
      if (live.staleModel !== modelId) {
        live.staleModel = modelId;
        live.onEvent({
          type: "status",
          text: `Command Code did not accept the model "${modelId}"; using its current model. Pick another model to change it.`,
        });
      }
    }
  }

  const effort = input.modelSettings?.effort?.trim();
  if (!effort) return;
  const option = live.configOptions.find((entry) => entry.id === "effort");
  // Efforts differ per model; a value this model lacks keeps its own.
  if (!option || option.currentValue === effort) return;
  if (option.choices.length > 0 && !option.choices.includes(effort)) return;
  const result = await live.acp.request(
    "session/set_config_option",
    { sessionId: live.acpSessionId, configId: "effort", value: effort },
    CONTROL_TIMEOUT_MS,
  );
  option.currentValue = effort;
  refreshConfigOptions(live, result);
}

function refreshConfigOptions(live: Live, result: unknown): void {
  const options = commandCodeConfigOptions(result);
  if (options.length > 0) live.configOptions = options;
}

async function applyRuntimeMode(
  live: Live,
  runtimeMode: RuntimeMode,
  planning: boolean,
): Promise<void> {
  const modeId = commandCodeModeId(runtimeMode, planning);
  if (modeId === live.modeId) return;
  // Fail closed: a rejected downgrade must not leave bypass active.
  await live.acp.request(
    "session/set_mode",
    { sessionId: live.acpSessionId, modeId },
    CONTROL_TIMEOUT_MS,
  );
  live.modeId = modeId;
}

async function prompt(live: Live, input: SendTurnInput): Promise<void> {
  const blocks = commandCodePromptBlocks(input.text, input.attachments);
  if (blocks.length === 0) return;
  try {
    const pending = live.acp.request(
      "session/prompt",
      { sessionId: live.acpSessionId, prompt: blocks },
      PROMPT_TIMEOUT_MS,
    );
    input.onAccepted?.();
    const result = await pending;
    if (live.cancelled) return;
    const stopReason = asRecord(result)?.stopReason;
    if (stopReason === "cancelled") return;
    if (stopReason === "refusal" || stopReason === "max_tokens") {
      live.onEvent({
        type: "session.error",
        message:
          stopReason === "refusal"
            ? "Command Code's model declined this request."
            : "Command Code stopped: the reply hit the model's length limit.",
      });
    }
    live.onEvent({ type: "message.completed" });
    live.onEvent({ type: "reasoning.completed" });
  } catch (error) {
    if (live.cancelled) return;
    live.onEvent({ type: "session.error", message: commandCodeTurnError(error) });
    throw error;
  }
}

/** Keep mode and config state current; true when the update is consumed. */
function trackSessionState(live: Live, params: unknown): boolean {
  const update = asRecord(asRecord(params)?.update);
  if (update?.sessionUpdate === "config_option_update") {
    refreshConfigOptions(live, update);
    return true;
  }
  if (update?.sessionUpdate === "current_mode_update") {
    const mode = update.currentModeId;
    if (typeof mode === "string") live.modeId = mode;
    return true;
  }
  return update?.sessionUpdate === "available_commands_update";
}

function handleNotification(live: Live, method: string, params: unknown): void {
  if (method !== "session/update") return;
  const events = eventsFromAcpUpdate(params);
  for (const event of live.subagents.route(params, events)) {
    live.onEvent(event);
  }
}

async function handleRequest(
  live: Live,
  id: number,
  method: string,
  params: unknown,
): Promise<void> {
  if (method === "session/request_permission") {
    await handlePermission(live, id, params);
    return;
  }
  await live.acp
    .respondError(id, { code: -32601, message: `Method not found: ${method}` })
    .catch(() => undefined);
}

async function handlePermission(
  live: Live,
  id: number,
  params: unknown,
): Promise<void> {
  const request = permissionRequestFromAcp(params);
  if (request.callId) {
    live.onEvent({
      type: "tool.updated",
      callId: request.callId,
      title: request.title,
      kind: request.kind,
      preview: request.preview,
    });
  }

  if (live.planning) {
    const readOnly = request.kind === "read" || request.kind === "search";
    await respondPermission(
      live,
      id,
      permissionOptionId(readOnly ? "allow" : "deny", request.optionIds),
    );
    return;
  }

  const automatic = pickAutoOption(live.runtimeMode, request.kind, request.optionIds);
  if (automatic) {
    await respondPermission(live, id, automatic);
    return;
  }

  live.onEvent({
    type: "approval.requested",
    requestId: id,
    title: request.title,
    kind: request.kind,
    callId: request.callId,
    preview: request.preview,
  });
  const decision = await new Promise<ApprovalDecision>((resolve) => {
    live.approvals.set(id, resolve);
  });
  live.approvals.delete(id);
  live.onEvent({ type: "approval.resolved", requestId: id, decision });
  await respondPermission(live, id, permissionOptionId(decision, request.optionIds));
}

async function respondPermission(
  live: Live,
  id: number,
  optionId: string,
): Promise<void> {
  await live.acp.respond(id, {
    outcome: { outcome: "selected", optionId },
  });
}

function resolveApprovals(live: Live): void {
  for (const resolve of live.approvals.values()) resolve("deny");
  live.approvals.clear();
}

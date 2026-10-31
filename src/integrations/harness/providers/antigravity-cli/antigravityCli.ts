import {
  execChild,
  killChild,
  probeHarnessBinary,
  resolveAntigravityCliBinary,
  readAntigravityCliAgents,
  spawnChild,
  unwatchChild,
  watchChild,
  writeChild,
} from "../../core/child";
import type {
  HarnessEvent,
  HarnessSessionInput,
  SendTurnInput,
} from "../../core/types";
import { NativeForkError } from "../../core/types";
import type { ProcessedUsage } from "../../../../features/sessions/model/tokenAccounting";
import {
  CLI_HELP,
  CLI_POLICY,
  cliSpawnArgs,
  cliAgentName,
  cliUsage,
  nativeConversationId,
  record,
  reportArgs,
  usageDelta,
  userMessage,
  validateCliPrompt,
} from "./antigravityCliProtocol";

type Active = {
  emit: (event: HarnessEvent) => void;
  finish: (error?: Error) => void;
  text: string;
  tools: Set<string>;
  lastStep: number;
  stepUsage: Map<number, ProcessedUsage>;
  doneSteps: Set<number>;
};
type Live = {
  agent: string;
  instanceId: string;
  key: string;
  ready: Promise<void>;
  initialize: (error?: Error) => void;
  nativeId?: string;
  active?: Active;
  usage?: ProcessedUsage;
  turns: number;
  stopped: boolean;
  startupError?: Error;
  /** agy's own reason when it stops before a turn (bad model, flags, sign-in). */
  exitReason?: string;
  resumed: boolean;
  lastStep: number;
};
const lives = new Map<string, Live>();
const resumes = new Map<string, { id: string; cwd: string; agent?: string }>();
const epochs = new Map<string, number>();
const serial = new Map<string, Promise<void>>();
const TURN_TIMEOUT_MS = 30 * 60_000;

function epoch(id: string): number {
  return epochs.get(id) ?? 0;
}

export function bindCliSession(
  threadId: string,
  providerSessionId: string,
  cwd: string,
): void {
  const id = nativeConversationId(providerSessionId);
  if (!id)
    throw new Error(
      "This conversation ID is not an Antigravity CLI session. ACP and CLI chats use separate providers.",
    );
  const bound = lives.get(threadId)?.nativeId ?? resumes.get(threadId)?.id;
  if (bound && bound !== id)
    throw new Error(
      "Cannot bind this chat to a different Antigravity CLI conversation. Start a separate chat.",
    );
  resumes.set(threadId, { id, cwd, agent: lives.get(threadId)?.agent ?? resumes.get(threadId)?.agent });
}

/** Stop kills this CLI only; native identity survives for the next exact resume. */
export async function stopCliSession(id: string): Promise<void> {
  epochs.set(id, epoch(id) + 1);
  const live = lives.get(id);
  lives.delete(id);
  if (live) {
    live.stopped = true;
    live.initialize();
    live.active?.finish();
  }
  unwatchChild(id);
  await killChild(id).catch((): void => {});
}

export async function forgetCliSession(id: string): Promise<void> {
  await stopCliSession(id);
  resumes.delete(id);
  serial.delete(id);
}

export function sendCliTurn(input: SendTurnInput): Promise<void> {
  if (input.intent === "plan" || input.intent === "orchestrate")
    return Promise.reject(
      new Error(
        "Antigravity CLI does not expose a verified headless Plan mode. Use Antigravity ACP for this workflow, or turn Plan off explicitly.",
      ),
    );
  if (input.attachments?.length)
    return Promise.reject(
      new Error(
        "Antigravity CLI headless input supports text only. Choose Antigravity ACP to send attachments.",
      ),
    );
  if (input.fork)
    return Promise.reject(
      new NativeForkError(
        "Antigravity CLI does not expose headless native forking; the original chat was not changed.",
      ),
    );
  if (input.providerAccountId && input.providerAccountId !== "default")
    return Promise.reject(
      new Error(
        "Antigravity CLI uses its own signed-in account; MonoCode account profiles are not supported.",
      ),
    );
  if (input.nativeResume) {
    try {
      bindCliSession(
        input.sessionId,
        input.nativeResume.providerSessionId,
        input.cwd,
      );
    } catch (error) {
      return Promise.reject(error);
    }
  }
  const startedAt = epoch(input.sessionId);
  const next = (serial.get(input.sessionId) ?? Promise.resolve())
    .catch((): void => {})
    .then(async (): Promise<void> => {
      if (epoch(input.sessionId) !== startedAt) return;
      const report = reportArgs(input.text);
      if (report) {
        const { path } = await probeHarnessBinary("antigravity-cli");
        if (epoch(input.sessionId) !== startedAt) return;
        const output = await execChild(
          path,
          report,
          input.cwd,
          "antigravity-cli",
        );
        if (epoch(input.sessionId) === startedAt) {
          input.onEvent({ type: "session.started" });
          input.onEvent({ type: "message.delta", text: output });
          input.onEvent({ type: "message.completed" });
        }
        return;
      }
      validateCliPrompt(input.text);
      const agent = cliAgentName(input.modelSettings);
      const boundAgent = lives.get(input.sessionId)?.agent ?? resumes.get(input.sessionId)?.agent;
      if (boundAgent !== undefined && boundAgent !== agent)
        throw new Error("The Antigravity CLI agent is fixed for this conversation. Start a new chat to choose another agent.");
      let live: Live | undefined;
      try {
        live = await ensureLive(input, startedAt);
        if (!live || live.stopped || epoch(input.sessionId) !== startedAt)
          return;
        input.onEvent({ type: "session.started" });
        if (input.modelSettings?.antigravityAgent !== live.agent)
          input.onEvent({ type: "session.configChanged", modelSettings: { antigravityAgent: live.agent } });
        if (live.nativeId)
          input.onEvent({
            type: "session.providerBound",
            providerSessionId: live.nativeId,
          });
        if (input.runtimeMode !== "full-access")
          input.onEvent({ type: "status", text: CLI_POLICY });
        const current = live;
        await new Promise<void>((resolve, reject) => {
          let settled = false;
          const timer = setTimeout(
            (): void => finish(new Error("Antigravity CLI turn timed out.")),
            TURN_TIMEOUT_MS,
          );
          const finish = (error?: Error): void => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            current.active = undefined;
            if (error) reject(error);
            else resolve();
          };
          current.active = {
            emit: input.onEvent,
            finish,
            text: "",
            tools: new Set(),
            lastStep: current.lastStep + 1,
            stepUsage: new Map(),
            doneSteps: new Set(),
          };
          void writeChild(input.sessionId, userMessage(input.text))
            .then((): void => {
              if (!current.stopped && epoch(input.sessionId) === startedAt)
                input.onAccepted?.();
            })
            .catch((error: unknown): void =>
              finish(error instanceof Error ? error : new Error(String(error))),
            );
        });
      } catch (error) {
        if (epoch(input.sessionId) !== startedAt) return;
        await stopCliSession(input.sessionId);
        throw error;
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

async function ensureLive(
  input: HarnessSessionInput,
  startedAt: number,
): Promise<Live | undefined> {
  const agent = cliAgentName(input.modelSettings);
  const { path } = await resolveAntigravityCliBinary();
  if (epoch(input.sessionId) !== startedAt) return undefined;
  const key = JSON.stringify([
    path,
    input.cwd,
    input.model,
    input.modelSettings?.effort,
    agent,
    input.runtimeMode,
  ]);
  const previous = lives.get(input.sessionId);
  if (previous?.startupError) throw previous.startupError;
  if (previous?.key === key && !previous.stopped) return previous;
  if (agent !== "default") {
    const available = await readAntigravityCliAgents(input.cwd);
    if (!available.some((item) => item.id === agent))
      throw new Error(`Antigravity CLI agent "${agent}" is unavailable in this project. Restore its definition or choose an available agent in a new chat.`);
    if (epoch(input.sessionId) !== startedAt) return undefined;
  }
  const inspected = await probeHarnessBinary("antigravity-cli");
  if (epoch(input.sessionId) !== startedAt) return undefined;
  if (inspected.path !== path)
    throw new Error(
      "Antigravity CLI binary changed during startup. Retry the chat.",
    );
  if (previous) {
    previous.stopped = true;
    previous.initialize();
    lives.delete(input.sessionId);
    unwatchChild(input.sessionId);
    await killChild(input.sessionId);
    if (epoch(input.sessionId) !== startedAt) return undefined;
  }
  const resume = resumes.get(input.sessionId);
  if (resume && resume.cwd !== input.cwd)
    throw new Error(
      "Antigravity CLI resume belongs to a different workspace; create a new chat here.",
    );
  let initialize: (error?: Error) => void = (): void => {};
  const ready = new Promise<void>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(
      (): void =>
        initialize(
          new Error(`Antigravity CLI did not initialize. ${CLI_HELP}`),
        ),
      30_000,
    );
    initialize = (error?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    };
  });
  void ready.catch((): void => {});
  const live: Live = {
    instanceId: crypto.randomUUID(),
    agent,
    key,
    ready,
    initialize,
    nativeId: resume?.id,
    turns: 0,
    stopped: false,
    resumed: !!resume,
    lastStep: -1,
  };
  lives.set(input.sessionId, live);
  watchChild(
    input.sessionId,
    (line): void => {
      if (live.stopped || lives.get(input.sessionId) !== live) return;
      try {
        readEvent(
          input.sessionId,
          input.cwd,
          live,
          JSON.parse(line) as unknown,
        );
      } catch (error) {
        if (line.trimStart().startsWith("{")) {
          const failure =
            error instanceof Error
              ? error
              : new Error("Malformed Antigravity CLI stream.");
          live.startupError = failure;
          live.initialize(failure);
          live.active?.finish(failure);
        }
      }
    },
    (code): void => {
      if (live.stopped || lives.get(input.sessionId) !== live) return;
      live.stopped = true;
      lives.delete(input.sessionId);
      unwatchChild(input.sessionId);
      live.startupError = new Error(
        live.exitReason
          ? `Antigravity CLI stopped (${String(code)}): ${live.exitReason}`
          : `Antigravity CLI exited before its turn completed (${String(code)}). ${CLI_HELP}`,
      );
      live.initialize(live.startupError);
      live.active?.finish(live.startupError);
    },
    (line): void => {
      if (live.stopped) return;
      const reason = line.match(/^s*error:s*(.+)$/i)?.[1]?.trim();
      if (reason) live.exitReason ??= reason;
      if (
        /authentication required|keyring.*locked|not (?:authenticated|signed in)/i.test(
          line,
        )
      ) {
        const failure = new Error(
          `Antigravity CLI authentication required. ${CLI_HELP}`,
        );
        live.startupError = failure;
        live.initialize(failure);
        live.active?.finish(failure);
        return;
      }
      if (!live.active) return;
      if (
        /soft.denied|permission.*denied|requires.*approval|confirmation.*required/i.test(
          line,
        )
      )
        live.active.emit({
          type: "interjection",
          customType: "permission",
          text: CLI_POLICY,
        });
    },
  );
  try {
    await spawnChild(
      input.sessionId,
      path,
      cliSpawnArgs(input, resume?.id),
      input.cwd,
      undefined,
      "antigravity-cli",
    );
    await live.ready;
    if (live.startupError && epoch(input.sessionId) === startedAt)
      throw live.startupError;
    if (live.stopped || epoch(input.sessionId) !== startedAt) {
      await killChild(input.sessionId).catch((): void => {});
      return undefined;
    }
    return live;
  } catch (error) {
    live.stopped = true;
    live.initialize();
    lives.delete(input.sessionId);
    unwatchChild(input.sessionId);
    await killChild(input.sessionId).catch((): void => {});
    throw error;
  }
}

function bindIdentity(
  threadId: string,
  cwd: string,
  live: Live,
  raw: unknown,
): void {
  const id = nativeConversationId(raw);
  if (!id) return;
  if (live.nativeId && live.nativeId !== id)
    throw new Error(
      "Antigravity CLI returned a different conversation while resuming. The chat was stopped to protect its native context.",
    );
  live.nativeId = id;
  resumes.set(threadId, { id, cwd, agent: live.agent });
  live.active?.emit({ type: "session.providerBound", providerSessionId: id });
}

function readEvent(
  threadId: string,
  cwd: string,
  live: Live,
  value: unknown,
): void {
  const event = record(value);
  if (!event) return;
  if (event.event === "init") {
    if (!nativeConversationId(event.conversation_id))
      throw new Error(
        "Antigravity CLI initialized without a valid native conversation ID.",
      );
    bindIdentity(threadId, cwd, live, event.conversation_id);
    live.initialize();
    return;
  }
  const active = live.active;
  if (!active) {
    const failed = event.event === "result" ? record(event.result) : undefined;
    if (typeof failed?.error === "string" && failed.error.trim())
      live.exitReason = failed.error.trim();
    return;
  }
  if (event.event === "step_update") {
    const step = record(event.step_update);
    if (
      !step ||
      typeof step.step_index !== "number" ||
      !Number.isSafeInteger(step.step_index) ||
      step.step_index < active.lastStep ||
      active.doneSteps.has(step.step_index)
    )
      return;
    bindIdentity(threadId, cwd, live, step.conversation_id);
    live.lastStep = Math.max(live.lastStep, step.step_index);
    if (step.state === "DONE") active.doneSteps.add(step.step_index);
    const stepUsage = cliUsage(step.usage);
    if (step.state === "DONE" && stepUsage)
      active.stepUsage.set(step.step_index, stepUsage);
    const delta = typeof step.text_delta === "string" ? step.text_delta : "";
    if (step.step_type === "agent_response" && delta) {
      active.text += delta;
      active.emit({ type: "message.delta", text: delta });
    } else if (
      ["agent_thought", "reasoning", "thinking"].includes(
        String(step.step_type),
      ) &&
      delta
    ) {
      active.emit({ type: "reasoning.delta", text: delta });
      if (step.state === "DONE") active.emit({ type: "reasoning.completed" });
    } else if (step.step_type === "tool") {
      const info = record(step.tool_info);
      const title =
        typeof step.tool_name === "string"
          ? step.tool_name
          : typeof info?.name === "string"
            ? info.name
            : "Tool";
      const callId = `agy:${live.instanceId}:${live.turns}:${step.step_index}`;
      if (!active.tools.has(callId)) {
        active.tools.add(callId);
        active.emit({ type: "tool.started", callId, title });
      }
      const detail = typeof info?.output === "string" ? info.output : undefined;
      active.emit({
        type: "tool.updated",
        callId,
        status:
          step.state === "DONE"
            ? info?.error
              ? "failed"
              : "completed"
            : "in_progress",
        detail,
      });
    }
    return;
  }
  if (event.event !== "result") return;
  const result = record(event.result);
  if (!result) throw new Error("Invalid Antigravity CLI result event.");
  if (
    result.status === "SUCCESS" &&
    live.turns > 0 &&
    typeof result.num_turns === "number" &&
    result.num_turns <= live.turns
  )
    return;
  bindIdentity(threadId, cwd, live, result.conversation_id);
  if (typeof result.num_turns === "number") live.turns = result.num_turns;
  else live.turns += 1;
  const response = typeof result.response === "string" ? result.response : "";
  if (!active.text && response)
    active.emit({ type: "message.delta", text: response });
  else if (
    response.startsWith(active.text) &&
    response.length > active.text.length
  )
    active.emit({
      type: "message.delta",
      text: response.slice(active.text.length),
    });
  active.emit({ type: "message.completed" });
  const usage = cliUsage(result.usage);
  if (usage) {
    let turn: ProcessedUsage | undefined;
    if (live.usage || !live.resumed) turn = usageDelta(usage, live.usage);
    else if (active.stepUsage.size) {
      turn = { total: 0, input: 0, output: 0, cachedInput: 0, reasoning: 0 };
      for (const item of active.stepUsage.values()) {
        turn.total += item.total;
        turn.input += item.input;
        turn.output += item.output;
        turn.cachedInput = (turn.cachedInput ?? 0) + (item.cachedInput ?? 0);
        turn.reasoning = (turn.reasoning ?? 0) + (item.reasoning ?? 0);
      }
    }
    if (turn) active.emit({ type: "usage", turn });
    live.usage = usage;
  }
  if (result.status === "SUCCESS") {
    if (!live.nativeId)
      throw new Error(
        "Antigravity CLI finished without a native conversation ID; resume is unavailable.",
      );
    active.finish();
  } else if (["CANCELED", "INTERRUPTED"].includes(String(result.status))) {
    active.finish(
      new Error(
        "Antigravity CLI turn was interrupted; resume this conversation to continue.",
      ),
    );
  } else
    active.finish(
      new Error(
        typeof result.error === "string"
          ? result.error
          : `Antigravity CLI returned ${String(result.status)}.`,
      ),
    );
}

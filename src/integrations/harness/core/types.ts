import type {
  AgentStepKind,
  Attachment,
  InterjectionMeta,
  RuntimeMode,
  TaskListItem,
  TurnModel,
  ToolPreview,
  TurnIntent,
  TurnMetrics,
} from "../../../features/sessions/model/session";
import type { UserQuestion } from "../../../features/sessions/model/userQuestion";
import type { McpFormField } from "../../../features/sessions/model/mcpForm";
import { type ProcessedUsage } from "../../../features/sessions/model/tokenAccounting";

export type HarnessEvent =
  | { type: "diagnostic.measurement"; measurement: import("../../../features/debug-inspector/model/trace").UsageMeasurement; purpose?: string }
  | { type: "diagnostic.tool"; callId: string; name: string }
  | { type: "diagnostic.lifecycle"; operation: string; identity: string; state?: string }
  | { type: "externalTurn.started"; turnId: string; text?: string; nativeId?: string }
  | { type: "externalTurn.user"; turnId: string; text: string; nativeId?: string }
  | { type: "externalTurn.event"; turnId: string; event: HarnessEvent }
  | { type: "externalTurn.finished"; turnId: string }
  | { type: "session.started" }
  | { type: "session.ended"; code?: number | null }
  | { type: "session.error"; message: string }
  | { type: "session.providerBound"; providerSessionId: string }
  | {
      type: "remoteControl.changed";
      status: RemoteControlStatus;
      url?: string;
      message?: string;
    }
  | { type: "turn.started"; providerTurnId: string }
  | { type: "turn.forkPoint"; providerForkPoint: string }
  | { type: "turn.model"; turnModel: TurnModel }
  | { type: "turn.ready" }
  | {
      type: "session.configChanged";
      model?: string;
      modelSettings?: Record<string, string>;
    }
  | { type: "status"; text: string; key?: string }
  /** The provider refused the turn until its usage window resets (epoch ms). */
  | { type: "usage.limited"; resetsAt?: number }
  /**
   * The agent has yielded but the turn is not over: work it started is still
   * running and will wake it again. Empty once it is back at work.
   */
  | { type: "background.updated"; tasks: string[] }
  | ({ type: "interjection"; text: string } & InterjectionMeta)
  | { type: "message.delta"; text: string }
  | { type: "message.completed" }
  | {
      type: "image.generated";
      itemId: string;
      data: string;
      name: string;
      alt?: string;
    }
  | {
      type: "image.generated";
      itemId: string;
      path: string;
      name: string;
      mimeType: string;
      size: number;
      alt?: string;
    }
  | { type: "reasoning.delta"; text: string }
  | { type: "reasoning.completed" }
  | {
      type: "tool.started";
      agentModel?: string;
      callId: string;
      title: string;
      kind?: string;
      status?: string;
      /** Work the agent left running when it yielded. */
      background?: boolean;
      preview?: ToolPreview;
      /** Every path affected when one structured edit changes multiple files. */
      paths?: string[];
    }
  | {
      type: "tool.updated";
      agentModel?: string;
      callId: string;
      title?: string;
      kind?: string;
      status?: string;
      detail?: string;
      preview?: ToolPreview;
      /** Every path affected when one structured edit changes multiple files. */
      paths?: string[];
    }
  /** Something a subagent did, mirrored onto its parent Agent tool call. */
  | {
      type: "agent.step";
      /** Tool call id of the parent Agent/Task call. */
      callId: string;
      /** Provider step identity; repeats merge onto the same row. */
      stepId: string;
      kind: AgentStepKind;
      text: string;
      /** Tool kind for a "tool" step, so it gets the right icon. */
      toolKind?: string;
      status?: string;
      detail?: string;
      preview?: ToolPreview;
      /** The subagent's own name, when the provider only reveals it here. */
      agentName?: string;
      agentType?: string;
    }
  | {
      type: "approval.requested";
      requestId: number;
      title: string;
      kind?: string;
      callId?: string;
      preview?: ToolPreview;
      sessionScope?: { hint: string };
      /** Present only when this provider identified the MCP server safely. */
      serverScope?: { serverName: string; hint: string };
    }
  | {
      type: "approval.resolved";
      requestId: number;
      /** "cancelled" = a PermissionRequest hook decided before the user could. */
      decision: "allow" | "deny" | "cancelled";
      scope?: ApprovalScope;
    }
  | {
      type: "question.asked";
      requestId: number;
      title?: string;
      questions: UserQuestion[];
      callId?: string;
      autoResolveAt?: number;
    }
  | {
      type: "question.updated";
      requestId: number;
      autoResolveAt?: number;
    }
  | {
      type: "question.resolved";
      requestId: number;
      decision: "answered" | "skipped" | "cancelled";
    }
  | {
      type: "form.requested";
      requestId: number;
      serverName: string;
      message: string;
      fields: McpFormField[];
    }
  | {
      type: "form.resolved";
      requestId: number;
      decision: "submitted" | "declined" | "cancelled";
    }
  | {
      type: "tasks.updated";
      key?: string;
      explanation?: string;
      /** Merge changed items into the existing list instead of replacing it. */
      merge?: boolean;
      /** This snapshot owns its labels, so a changed item text is a rename. */
      authoritative?: boolean;
      /** Provider conversation that owns these items. */
      providerSessionId?: string;
      items: TaskListItem[];
    }
  | {
      type: "plan";
      text: string;
      /** Merge identity for deltas and the authoritative completed item. */
      key?: string;
      /** Append a stream delta instead of replacing the current snapshot. */
      append?: boolean;
      /** False marks the plan ready for review. */
      streaming?: boolean;
    }
  /** Context-window level after the harness's latest request. */
  | { type: "context.stale" }
  | { type: "context"; used?: number; window?: number }
  /** Processed token usage for this turn and/or session thread. */
  | {
      type: "usage";
      turn?: ProcessedUsage;
      session?: ProcessedUsage;
    }
  | ({ type: "turn.metrics" } & TurnMetrics);

export type RemoteControlStatus =
  | "off"
  | "connecting"
  | "on"
  | "needs-consent"
  | "failed";

export class HarnessRemoteControlError extends Error {
  constructor(
    readonly status: "needs-consent" | "failed",
    message: string,
  ) {
    super(message);
    this.name = "HarnessRemoteControlError";
  }
}

export type ApprovalDecision = "allow" | "deny";
export type ApprovalScope = "once" | "session" | "server";

/** The turn is connecting or has just ended; retain the follow-up for later. */
export class TurnNotReadyError extends Error {}

/** A live provider needs user attention; failure cleanup must retain its owner. */
export class HarnessNeedsAttentionError extends Error {}

export type HarnessSessionInput = {
  /** Diagnostic correlation only; never sent to a provider. */
  diagnostic?: { submissionId?: string; turnId?: string; purpose?: string };
  fork?: NativeForkRequest;
  /** Resume this exact provider conversation; the adapter must fail closed. */
  nativeResume?: { providerSessionId: string };
  sessionId: string;
  cwd: string;
  model: string;
  modelSettings?: Record<string, string>;
  providerAccountId?: string;
  runtimeMode: RuntimeMode;
  /** Keep provider context in memory; MonoCode owns the saved transcript. */
  ephemeral?: boolean;
  /** Persist Codex context in MonoCode's private Mono store. */
  codexStore?: "mono";
  intent?: TurnIntent;
  /**
   * This session drives MonoCode's control CLI, which reaches the app over
   * loopback. Sandboxes deny network by default, so a lead that cannot open
   * that socket cannot supervise its agents at all.
   */
  controlsAgents?: boolean;
  /** Grants this normal turn access to MonoCode's scoped app CLI. */
  appAccess?: boolean;
  onEvent: (event: HarnessEvent) => void;
};

export type NativeForkRequest = {
  sourceProviderSessionId: string;
  /** Claude/Codex inclusive position; OpenCode exclusive next message. */
  forkPoint?: string;
};

/** Only failures proven to occur before writing the user's message. */
export class NativeForkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NativeForkError";
  }
}

/** Native resume failed before the user message was written. */
export class NativeResumeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NativeResumeError";
  }
}

export type SendTurnInput = HarnessSessionInput & {
  text: string;
  attachments?: Attachment[];
  /** Called once the provider has accepted the user turn. */
  onAccepted?: () => void;
  /** The user typed this turn (not an app-generated or orchestration turn). */
  humanAuthored?: boolean;
};

export type CompactContextInput = HarnessSessionInput;

export type SteerTurnInput = {
  diagnostic?: HarnessSessionInput["diagnostic"];
  sessionId: string;
  cwd: string;
  model: string;
  modelSettings?: Record<string, string>;
  text: string;
  attachments?: Attachment[];
};

export type RewindLastTurnInput = CompactContextInput & {
  /** Provider turn boundary for the visible user message, when known. */
  providerTurnId?: string;
  /** When set, Cursor may resend via session/edit_prompt in one RPC. */
  text?: string;
  attachments?: Attachment[];
};

export type RewindLastTurnResult = {
  /** True when the harness already ran the replacement turn. */
  submitted: boolean;
};

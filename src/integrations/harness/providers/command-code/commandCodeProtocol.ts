import {
  attachmentPath,
  attachmentPathText,
  isAttachmentFolder,
} from "../../../../features/sessions/model/attachments";
import type {
  Attachment,
  RuntimeMode,
  ToolPreview,
} from "../../../../features/sessions/model/session";
import type { ProcessedUsage } from "../../../../features/sessions/model/tokenAccounting";

/** Fork (L-255). The Windows launcher is `cmdc`; `cmd` is the system shell. */
export const COMMAND_CODE_AUTH_HELP =
  "Sign in with `cmdc login` in a terminal, then try again.";

/** Shown when a read-only turn tried to edit or run something (L-258). */
export const COMMAND_CODE_READ_ONLY_HELP =
  "Command Code is in Read only mode, so it can't edit files or run commands. Switch the chat to Full access to allow that.";

export type CommandCodeRun = {
  model?: string;
  effort?: string;
  /** Command Code session to continue. */
  resume?: string;
  /** With `resume`, copy that session into a new one instead. */
  fork?: boolean;
  runtimeMode: RuntimeMode;
  planning: boolean;
  /** Keep nothing on disk: AI helper replies. */
  ephemeral?: boolean;
};

/**
 * Fork (L-258): one `cmdc -p` run per turn. The prompt goes over stdin (the
 * Windows `.cmd` shim mangles `%` and newlines in arguments), so it is not
 * part of these arguments.
 *
 * Print mode has no approval prompts. Without `--yolo` Command Code refuses
 * edits and shell commands outright; with it, everything runs. Plan always
 * wins so a plan turn can never edit, whatever the access level.
 */
export function commandCodePrintArgs(run: CommandCodeRun): string[] {
  const args = [
    "-p",
    "--output-format",
    "json",
    "--skip-onboarding",
    "--trust",
    "--no-auto-update",
  ];
  if (run.model) args.push("--model", safeArg(run.model, "model"));
  if (run.effort) args.push("--effort", safeArg(run.effort, "effort"));
  if (run.resume) {
    args.push("--resume", safeArg(run.resume, "session id"));
    if (run.fork) args.push("--fork-session");
  }
  if (run.ephemeral) args.push("--no-session");
  if (run.planning) args.push("--permission-mode", "plan");
  else if (commandCodeCanEdit(run.runtimeMode)) args.push("--yolo");
  return args;
}

/**
 * On Windows the `.cmd` launcher runs through `cmd.exe`, which expands `%`
 * and splits on `&`; ids and efforts never need either.
 */
function safeArg(value: string, label: string): string {
  if (!/^[A-Za-z0-9._:/@+-]+$/.test(value))
    throw new Error(`Command Code ${label} "${value}" has unsupported characters.`);
  return value;
}

/** Only Read only (`supervised`) keeps Command Code from editing. */
export function commandCodeCanEdit(runtimeMode: RuntimeMode): boolean {
  return runtimeMode !== "supervised";
}

/**
 * Command Code has no image flag; its `read_file` tool opens images for the
 * model, so attachments travel as saved paths it is asked to read.
 */
export function commandCodePromptText(
  text: string,
  attachments: Attachment[] = [],
): string {
  const parts = [text];
  for (const file of attachments) {
    if (file.kind === "image" && !isAttachmentFolder(file) && file.text == null)
      parts.push(
        `Attached image (open it with read_file to see it): ${JSON.stringify(attachmentPath(file))}`,
      );
    else parts.push(attachmentPathText(file));
  }
  return parts.filter((part) => part.trim()).join("\n\n");
}

export type CommandCodeResult = {
  ok: boolean;
  sessionId?: string;
  stopReason?: string;
  finalText: string;
  error?: string;
  usage?: ProcessedUsage;
};

export type CommandCodeLine =
  | { kind: "event"; type: string; event: Record<string, unknown> }
  | { kind: "result"; result: CommandCodeResult };

/** One NDJSON line of `--output-format json`; anything else is ignored. */
export function parseCommandCodeLine(line: string): CommandCodeLine | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) return null;
  let value: unknown;
  try {
    value = JSON.parse(trimmed);
  } catch {
    return null;
  }
  const rec = asRecord(value);
  if (rec?.type === "event") {
    const event = asRecord(rec.event);
    if (!event || typeof event.type !== "string") return null;
    return { kind: "event", type: event.type, event };
  }
  if (rec?.type === "result") {
    const sessionId = text(rec.sessionId);
    const stopReason = text(rec.stopReason);
    const error = errorText(rec.error);
    const usage = commandCodeUsage(rec.usage);
    return {
      kind: "result",
      result: {
        ok: rec.subtype === "success",
        ...(sessionId ? { sessionId } : {}),
        ...(stopReason ? { stopReason } : {}),
        finalText: typeof rec.finalText === "string" ? rec.finalText : "",
        ...(error ? { error } : {}),
        ...(usage ? { usage } : {}),
      },
    };
  }
  return null;
}

/** Command Code reports cache reads inside `inputTokens`, like Codex. */
export function commandCodeUsage(value: unknown): ProcessedUsage | undefined {
  const usage = asRecord(value);
  if (
    !usage ||
    (typeof usage.inputTokens !== "number" &&
      typeof usage.outputTokens !== "number")
  )
    return undefined;
  const input = count(usage.inputTokens);
  const output = count(usage.outputTokens);
  return {
    total: input + output,
    input,
    output,
    cachedInput: count(usage.cacheReadTokens),
    cacheWrite: count(usage.cacheWriteTokens),
  };
}

/** MonoCode tool kinds (ACP names), so rows get the right icon and preview. */
export function commandCodeToolKind(name: string): string {
  switch (name) {
    case "read_file":
    case "list_directory":
    case "list_dir":
      return "read";
    case "write_file":
    case "edit_file":
    case "multi_edit":
      return "edit";
    case "shell_command":
    case "powershell":
    case "bash":
    case "monitor_command":
    case "kill_shell":
      return "execute";
    case "grep":
    case "glob":
    case "web_search":
      return "search";
    case "web_fetch":
      return "fetch";
    case "todo_write":
      return "think";
    default:
      return "other";
  }
}

const TOOL_LABELS: Record<string, string> = {
  read_file: "Read",
  write_file: "Write",
  edit_file: "Edit",
  shell_command: "Run",
  powershell: "Run",
  bash: "Run",
  grep: "Search",
  glob: "Find files",
  web_fetch: "Fetch",
  web_search: "Web search",
  todo_write: "Update tasks",
  agent: "Agent",
};

/** A short title such as `Read src/app.ts` or `Run npm test`. */
export function commandCodeToolTitle(name: string, input: unknown): string {
  const label = TOOL_LABELS[name] ?? name;
  const args = asRecord(input);
  const target =
    text(args?.file_path) ??
    text(args?.path) ??
    text(args?.command) ??
    text(args?.pattern) ??
    text(args?.query) ??
    text(args?.url) ??
    text(args?.description);
  if (!target) return label;
  const line = target.split(/\r?\n/, 1)[0] ?? target;
  return `${label} ${line.length > 120 ? `${line.slice(0, 117)}…` : line}`;
}

export function commandCodeToolPreview(
  name: string,
  input: unknown,
): ToolPreview | undefined {
  const args = asRecord(input);
  if (!args) return undefined;
  const path = text(args.file_path) ?? text(args.path);
  if (name === "read_file" && path) return { kind: "read", path };
  if (name === "write_file" && path) {
    const content = typeof args.content === "string" ? args.content : "";
    return {
      kind: "write",
      path,
      contentOnly: true,
      additions: content ? content.split(/\r?\n/).length : 0,
      lines: content
        .split(/\r?\n/)
        .slice(0, 200)
        .map((line) => ({ kind: "add" as const, text: line })),
    };
  }
  if (name === "edit_file" && path) {
    const before = typeof args.old_string === "string" ? args.old_string : "";
    const after = typeof args.new_string === "string" ? args.new_string : "";
    const removed = before ? before.split(/\r?\n/) : [];
    const added = after ? after.split(/\r?\n/) : [];
    return {
      kind: "write",
      path,
      additions: added.length,
      deletions: removed.length,
      lines: [
        ...removed.map((line) => ({ kind: "del" as const, text: line })),
        ...added.map((line) => ({ kind: "add" as const, text: line })),
      ].slice(0, 400),
    };
  }
  const command = text(args.command);
  if (commandCodeToolKind(name) === "execute" && command)
    return { kind: "shell", title: command };
  const query = text(args.pattern) ?? text(args.query);
  if (commandCodeToolKind(name) === "search" && query)
    return { kind: "search", query, ...(path ? { path } : {}) };
  return undefined;
}

/** The text of a `tool_completed` result list. */
export function commandCodeToolOutput(result: unknown): string | undefined {
  if (typeof result === "string") return result;
  if (!Array.isArray(result)) return undefined;
  const parts = result.flatMap((item) => {
    const rec = asRecord(item);
    return rec?.type === "text" && typeof rec.text === "string"
      ? [rec.text]
      : [];
  });
  return parts.length ? parts.join("\n") : undefined;
}

/** Print mode refused a tool because the run had no `--yolo`. */
export function isCommandCodePermissionBlock(detail: string): boolean {
  return /requires permissions|use --yolo|permission denied|not allowed in plan/i.test(
    detail,
  );
}

/** A resumed session that never saved a step is unknown to Command Code. */
export function isCommandCodeMissingResume(detail: string): boolean {
  return /no session .* found to resume/i.test(detail);
}

/**
 * Documented `cmd -p` exit codes, turned into messages a user can act on.
 * `detail` is the result or stderr text, when there was any.
 */
export function commandCodeExitError(
  code: number | null | undefined,
  detail?: string,
): Error {
  const reason = detail?.trim();
  switch (code) {
    case 3:
      return new Error(
        `Command Code is not signed in. ${COMMAND_CODE_AUTH_HELP}`,
      );
    case 5:
      return new Error(
        "Command Code is rate limited right now. Wait a moment, then try again.",
      );
    case 6:
      return new Error(
        "Command Code could not reach its servers. Check your connection, then try again.",
      );
    case 7:
      return new Error(
        "Command Code's servers returned an error. Try again in a moment.",
      );
    case 8:
      return new Error(
        "Command Code stopped after reaching its turn limit for one message. Send a follow-up to continue.",
      );
    case 10:
      return new Error(
        "Your Command Code plan is out of credits for this model. Pick another model or top up, then try again.",
      );
    default:
      if (reason && isAuthFailure(reason))
        return new Error(`${reason}\n\n${COMMAND_CODE_AUTH_HELP}`);
      return new Error(
        reason
          ? `Command Code stopped: ${reason}`
          : `Command Code exited before finishing (code ${String(code)}).`,
      );
  }
}

function isAuthFailure(detail: string): boolean {
  return /auth(?:entication|orization)? (?:required|failed)|not (?:signed|logged) in|not authenticated|unauthori[sz]ed|(?:invalid|expired|missing) (?:api key|token|credential)/i.test(
    detail,
  );
}

function errorText(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  const rec = asRecord(value);
  return text(rec?.message);
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : 0;
}

export function commandCodeErrorText(value: unknown): string | undefined {
  return errorText(value);
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

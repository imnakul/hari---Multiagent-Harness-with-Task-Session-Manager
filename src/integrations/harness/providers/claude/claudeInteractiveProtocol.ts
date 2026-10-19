import type { HarnessEvent } from "../../core/types";
import { claudeMeasurement } from "../../../../features/debug-inspector/model/trace";
import {
  asRecord,
  contextUsedFromAssistant,
  parseJsonLine,
  previewFromTool,
  toolKindFromName,
  toolTitle,
} from "./claudeProtocol";
import {
  parseClaudeUsage,
  sumProcessedUsage,
  type ProcessedUsage,
} from "../../../../features/sessions/model/tokenAccounting";

export const CLAUDE_EXECUTION_SETTING = "claudeExecution";

export function isClaudeInteractive(
  settings?: Record<string, string>,
): boolean {
  return settings?.[CLAUDE_EXECUTION_SETTING] === "interactive";
}

export type PromptScreen = {
  before: string;
  after: string;
  afterIsDim: boolean;
  above: string;
  below: string;
  screen: string;
};

/**
 * Footer and question text of Claude's native menus and setup dialogs, including
 * the folder trust question a new account asks before its first chat.
 */
export function showsNativeDialog(text: string): boolean {
  return /enter to (?:confirm|select)|esc to (?:cancel|close|interrupt|exit)|select (?:a |the )?model|do you (?:want|trust)|trust this|trust the files|type to search|choose the text style|select login method/i.test(
    text,
  );
}

export function interactivePromptChecks(screen: PromptScreen): {
  cursorAtPrompt: boolean;
  emptyDraft: boolean;
  frameAbove: boolean;
  frameBelow: boolean;
  dialogFree: boolean;
} {
  return {
    cursorAtPrompt: /^\s*❯\s*$/.test(screen.before),
    emptyDraft:
      !screen.after.trim() ||
      screen.afterIsDim ||
      isPromptPlaceholder(screen.after),
    frameAbove: /[─━]{8}/.test(screen.above),
    frameBelow: /[─━]{8}/.test(screen.below),
    dialogFree: !showsNativeDialog(screen.screen),
  };
}

/** Longest launch prompt, in UTF-16 units; Windows caps a whole command line at 32,767. */
export const MAX_LAUNCH_PROMPT = 16 * 1024;

/**
 * Whether `text` can be Claude's prompt argument when a send starts Claude.
 * Claude then submits it itself once its input is ready, so it cannot be lost
 * to the startup window where typed input is discarded. Mirrors
 * `validate_launch_prompt` in Rust: a leading "-" would be read as an option and
 * "/" as a slash command, and a single word can name a subcommand (`purge`
 * deletes project state), so those keep the paste path.
 */
export function canLaunchWithPrompt(text: string): boolean {
  const trimmed = text.trim();
  return (
    trimmed.length > 0 &&
    text.length <= MAX_LAUNCH_PROMPT &&
    !/^[-/]/.test(trimmed) &&
    /\s/.test(trimmed) &&
    !/[\x00-\x09\x0b-\x1f\x7f-\x9f]/.test(text)
  );
}

/** Claude's suggestion hint in an empty prompt, e.g. `Try "fix lint errors"`. */
export function isPromptPlaceholder(text: string): boolean {
  return /^Try\s+["“][^\r\n]*["”]\s*$/.test(text.trim());
}

/**
 * Whether Claude's prompt box shows the pasted `text`. Sending required an
 * empty prompt with chat owning input, so any draft is this paste, except the
 * one letter typed outside the bracketed paste (`paste_payload` in Rust): that
 * letter alone means Claude dropped the paste. Long pastes fold into a
 * "[Pasted text #1 +N lines]" label, so the draft is not compared to `text`.
 */
export function composerShowsPaste(draft: string, text: string): boolean {
  const squash = (value: string): string => value.replace(/\s+/g, "");
  const shown = squash(draft);
  if (!shown || isPromptPlaceholder(draft)) return false;
  const typed = text === "/compact" ? "" : (/[\p{L}\p{N}]/u.exec(text)?.[0] ?? "");
  return shown !== typed || squash(text) === typed;
}

/** Fail closed on unfamiliar screens, drafts and native selection dialogs. */
export function isEmptyInteractivePrompt(screen: PromptScreen): boolean {
  return Object.values(interactivePromptChecks(screen)).every(Boolean);
}

export type TranscriptState = {
  text: Map<string, string>;
  tools: Set<string>;
  results: Set<string>;
  usage: Map<string, ProcessedUsage>;
  lastMessage?: string;
};

export function newTranscriptState(): TranscriptState {
  return {
    text: new Map(),
    tools: new Set(),
    results: new Set(),
    usage: new Map(),
  };
}

/** JSONL is authoritative. Hook tool events are lifecycle hints, never duplicate text. */
export function interactiveTranscriptEvents(
  line: string,
  state: TranscriptState,
): HarnessEvent[] {
  const row = parseJsonLine(line);
  if (!row && line.trim())
    throw new Error(
      "Claude transcript contains an invalid complete JSONL record; review the native terminal.",
    );
  if (!row || row.isSidechain === true) return [];
  const message = asRecord(row.message);
  const content = message?.content;
  if (!message || !Array.isArray(content) || typeof row.uuid !== "string")
    return [];
  const events: HarnessEvent[] = [];
  const uuid = row.uuid;
  if (row.type === "assistant" && state.lastMessage !== uuid) {
    if (state.lastMessage)
      events.push(
        { type: "message.completed" },
        { type: "reasoning.completed" },
      );
    state.lastMessage = uuid;
  }
  content.forEach((raw: unknown, index: number) => {
    const block = asRecord(raw);
    if (!block) return;
    const key = `${uuid}:${index}`;
    if (
      row.type === "assistant" &&
      (block.type === "text" || block.type === "thinking")
    ) {
      const text = block.type === "text" ? block.text : block.thinking;
      if (typeof text !== "string") return;
      const previous = state.text.get(key) ?? "";
      if (previous && !text.startsWith(previous))
        throw new Error(
          "Claude transcript changed a previously rendered message; review the native terminal.",
        );
      if (text.startsWith(previous) && text.length > previous.length) {
        events.push({
          type: block.type === "text" ? "message.delta" : "reasoning.delta",
          text: text.slice(previous.length),
        });
      }
      state.text.set(key, text);
    }
    if (
      row.type === "assistant" &&
      block.type === "tool_use" &&
      typeof block.id === "string" &&
      typeof block.name === "string" &&
      !state.tools.has(block.id)
    ) {
      state.tools.add(block.id);
      const input = asRecord(block.input) ?? {};
      events.push(
        { type: "message.completed" },
        { type: "reasoning.completed" },
        {
          type: "tool.started",
          callId: block.id,
          title: toolTitle(block.name, input),
          kind: toolKindFromName(block.name),
          preview: previewFromTool(block.name, input),
        },
      );
    }
    if (
      row.type === "user" &&
      block.type === "tool_result" &&
      typeof block.tool_use_id === "string" &&
      !state.results.has(block.tool_use_id)
    ) {
      state.results.add(block.tool_use_id);
      const text =
        typeof block.content === "string"
          ? block.content
          : Array.isArray(block.content)
            ? block.content
                .flatMap((item: unknown) => {
                  const r = asRecord(item);
                  return typeof r?.text === "string" ? [r.text] : [];
                })
                .join("\n")
            : "";
      events.push({
        type: "tool.updated",
        callId: block.tool_use_id,
        status: block.is_error ? "failed" : "completed",
        detail: text,
      });
    }
  });
  if (row.type === "assistant" && typeof message.model === "string") {
    // Requests can occur many times in one interactive turn. Preserve their scopes.
    const usage = asRecord(message.usage);
    if (usage) {
      const parsed = parseClaudeUsage(usage);
      const requestId = typeof message.id === "string" ? message.id : uuid;
      if (
        parsed &&
        JSON.stringify(state.usage.get(requestId)) !== JSON.stringify(parsed)
      ) {
        state.usage.set(requestId, parsed);
        events.push({
          type: "diagnostic.measurement",
          measurement: claudeMeasurement(
            usage,
            requestId,
            "message",
            message.model,
          ),
        });
        events.push({
          type: "usage",
          turn: sumProcessedUsage([...state.usage.values()]),
        });
        events.push({
          type: "turn.model",
          turnModel: {
            harness: "claude",
            id: message.model,
            name: message.model,
          },
        });
        const used = contextUsedFromAssistant(row);
        if (used !== undefined) events.push({ type: "context", used });
      }
    }
  }
  return events;
}

/** Native background completion, never composer text or a slash command. */
export function interactiveTaskNotification(text: unknown): string | undefined {
  if (
    typeof text !== "string" ||
    !text.trimStart().startsWith("<task-notification>")
  )
    return undefined;
  const id = /<task-id>([a-zA-Z0-9_-]+)<\/task-id>/.exec(text)?.[1];
  return id && /<status>(completed|failed|killed|stopped)<\/status>/.test(text)
    ? id
    : undefined;
}

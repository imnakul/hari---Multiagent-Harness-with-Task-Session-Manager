import type { Attachment } from "../../../../features/sessions/model/session";
import { preferredModelId } from "../../../../features/sessions/model/models";
import type { HarnessEvent } from "../../core/types";
import {
  allowInteractiveAttachmentReads,
  forgetInteractiveClaude,
  sendInteractiveClaude,
  stopInteractiveClaude,
} from "./claudeInteractive";

/**
 * Fork (L-204): one helper answer from the Claude CLI itself, run in a hidden
 * native terminal (the Interactive mode chats use) instead of the structured
 * child. Each call is a fresh Claude conversation, closed afterwards, so the
 * caller's prompt carries all the context. A tool request ends the call: a
 * helper should only answer. The one exception (L-271): Claude may Read the
 * attachments sent with this call, which is how it sees an image.
 */
export async function runInteractiveClaudeHelper(input: {
  cwd: string;
  prompt: string;
  timeoutMs: number;
  model?: string;
  providerAccountId?: string;
  modelSettings?: Record<string, string>;
  signal?: AbortSignal;
  /** Names the hidden session in diagnostics, e.g. "whiteboard". */
  purpose: string;
  /** Saved to disk and listed as paths for Claude to Read (L-271). */
  attachments?: Attachment[];
}): Promise<string> {
  input.signal?.throwIfAborted();
  const sessionId = `${input.purpose}-helper-${crypto.randomUUID()}`;
  let text = "";
  let refused: string | null = null;
  let stop: (() => void) | undefined;
  const stopped = new Promise<never>((_, reject) => {
    stop = () => {
      void stopInteractiveClaude(sessionId).catch(() => undefined);
      reject(new Error(refused ?? "Interactive Claude request cancelled"));
    };
  });
  stopped.catch(() => undefined);
  const onEvent = (event: HarnessEvent) => {
    if (event.type === "message.delta") text += event.text;
    else if (
      event.type === "approval.requested" ||
      event.type === "question.asked"
    ) {
      refused = "AI helper tried to use a tool instead of answering.";
      stop?.();
    }
  };
  const onAbort = () => stop?.();
  if (input.attachments?.length) allowInteractiveAttachmentReads(sessionId, true);
  input.signal?.addEventListener("abort", onAbort, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      sendInteractiveClaude({
        sessionId,
        cwd: input.cwd,
        model: input.model || preferredModelId("claude"),
        modelSettings: { ...input.modelSettings, claudeExecution: "interactive" },
        providerAccountId: input.providerAccountId,
        runtimeMode: "supervised",
        diagnostic: { purpose: `${input.purpose}-helper` },
        text: input.prompt,
        ...(input.attachments?.length ? { attachments: input.attachments } : {}),
        onEvent,
      }),
      stopped,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Interactive Claude helper timed out")),
          input.timeoutMs,
        );
      }),
    ]);
    const output = text.trim();
    if (!output) throw new Error("Claude returned empty output.");
    return output;
  } finally {
    clearTimeout(timer);
    input.signal?.removeEventListener("abort", onAbort);
    allowInteractiveAttachmentReads(sessionId, false);
    await forgetInteractiveClaude(sessionId).catch(() => undefined);
  }
}

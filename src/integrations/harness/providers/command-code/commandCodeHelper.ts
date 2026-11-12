import { invoke } from "@tauri-apps/api/core";
import type { HelperPromptInput } from "../../core/registry";
import {
  HelperToolAttemptError,
  HelperUnavailableError,
} from "../../core/helperIsolation";
import { forgetCommandCodeSession, sendCommandCodeTurn } from "./commandCode";

/**
 * Fork (L-255): AI helpers on Command Code run one plan-mode turn in an empty
 * app-data folder, then stop the process. Command Code's tools cannot be
 * switched off, so a tool call fails the reply instead of running.
 */
export async function runCommandCodeHelperPrompt(
  input: HelperPromptInput,
): Promise<string> {
  let cwd: string;
  try {
    cwd = await invoke<string>("command_code_helper_directory");
  } catch {
    throw new HelperUnavailableError("Command Code helper folder is unavailable.");
  }
  const sessionId = `command-code-helper:${crypto.randomUUID()}`;
  let text = "";
  let fail!: (error: Error) => void;
  const failure = new Promise<never>((_resolve, reject) => {
    fail = reject;
  });
  void failure.catch(() => undefined);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const turn = sendCommandCodeTurn({
      sessionId,
      cwd,
      model: input.model || "default",
      ...(input.modelSettings ? { modelSettings: input.modelSettings } : {}),
      runtimeMode: "supervised",
      intent: "plan",
      ephemeral: true,
      text: input.prompt,
      onEvent: (event) => {
        if (event.type === "message.delta") text += event.text;
        else if (event.type === "tool.started")
          fail(new HelperToolAttemptError("command-code", "tool"));
        else if (event.type === "approval.requested")
          fail(new HelperToolAttemptError("command-code", event.kind ?? "tool"));
        else if (event.type === "session.error") fail(new Error(event.message));
      },
    });
    timer = setTimeout(
      () => fail(new Error("Command Code text generation timed out")),
      input.timeoutMs,
    );
    await Promise.race([turn, failure]);
  } finally {
    if (timer) clearTimeout(timer);
    await forgetCommandCodeSession(sessionId);
  }
  const reply = text.trim();
  if (!reply) throw new Error("Command Code returned empty output.");
  return reply;
}

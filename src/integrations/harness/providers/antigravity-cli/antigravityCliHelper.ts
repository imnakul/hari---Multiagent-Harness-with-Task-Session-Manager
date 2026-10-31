import { invoke } from "@tauri-apps/api/core";
import type { HelperPromptInput } from "../../core/registry";
import {
  HelperToolAttemptError,
  HelperUnavailableError,
} from "../../core/helperIsolation";
import { forgetCliSession, sendCliTurn } from "./antigravityCli";

/**
 * Fork (L-208): AI helpers on Antigravity run one short `agy` process that is
 * stopped as soon as the reply lands, so nothing stays behind. The shared ACP
 * runtime kept every helper session (and its MCP servers) until MonoCode quit.
 */
export async function runAntigravityCliHelperPrompt(
  input: HelperPromptInput,
): Promise<string> {
  let cwd: string;
  try {
    cwd = await invoke<string>("antigravity_helper_directory");
  } catch {
    throw new HelperUnavailableError("Antigravity helper folder is unavailable.");
  }
  const sessionId = `antigravity-cli-helper:${crypto.randomUUID()}`;
  let text = "";
  let fail!: (error: Error) => void;
  const failure = new Promise<never>((_resolve, reject) => {
    fail = reject;
  });
  void failure.catch(() => undefined);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const turn = sendCliTurn({
      sessionId,
      cwd,
      model: input.model || "default",
      ...(input.modelSettings ? { modelSettings: input.modelSettings } : {}),
      // Never full access: agy's headless policy denies anything needing approval.
      runtimeMode: "supervised",
      ephemeral: true,
      text: input.prompt,
      onEvent: (event) => {
        if (event.type === "message.delta") text += event.text;
        else if (event.type === "tool.started")
          fail(new HelperToolAttemptError("antigravity-cli", "tool"));
      },
    });
    timer = setTimeout(
      () => fail(new Error("Antigravity text generation timed out")),
      input.timeoutMs,
    );
    await Promise.race([turn, failure]);
  } finally {
    if (timer) clearTimeout(timer);
    await forgetCliSession(sessionId);
  }
  const reply = text.trim();
  if (!reply) throw new Error("Antigravity returned empty output.");
  return reply;
}

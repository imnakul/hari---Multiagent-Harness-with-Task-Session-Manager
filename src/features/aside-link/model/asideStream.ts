/**
 * Fork (L-274): the OpenAI chat-completions shapes Aside reads back. Each
 * string is one SSE event's JSON; the desktop side adds the `data:` framing.
 */

export type AsideDelta = {
  role?: "assistant";
  content?: string;
  /** Shown by Aside as the model's thinking. */
  reasoning_content?: string;
};

export function asideChunk(
  id: string,
  model: string,
  delta: AsideDelta,
  finish: "stop" | null = null,
): string {
  return JSON.stringify({
    id,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, delta, finish_reason: finish }],
  });
}

/** A whole reply, for a request that did not ask to stream. */
export function asideCompletion(id: string, model: string, content: string): string {
  return JSON.stringify({
    id,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  });
}

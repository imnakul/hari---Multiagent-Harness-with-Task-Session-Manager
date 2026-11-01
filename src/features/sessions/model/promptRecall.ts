import type { Block } from "./session";

/**
 * Up/Down in an empty composer steps through this chat's sent messages, like
 * a terminal's history (L-231).
 */

/** Messages this chat sent, newest first, repeats in a row kept once. */
export function sentPrompts(blocks: readonly Block[]): string[] {
  const prompts: string[] = [];
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index]!;
    if (block.role !== "user" || block.draft || block.internal) continue;
    if (block.monoSessionCompletion) continue;
    const text = block.text.trim();
    if (!text || prompts[prompts.length - 1] === text) continue;
    prompts.push(text);
  }
  return prompts;
}

/** -1 is the empty box; 0 is the newest message. */
export type PromptRecall = { index: number; text: string };

export const NO_RECALL: PromptRecall = { index: -1, text: "" };

/**
 * The next recall for an arrow key, or `undefined` when the key should do its
 * usual job: the box has text the user typed or changed, or there is nothing
 * further to step to.
 */
export function stepPromptRecall(
  recall: PromptRecall,
  key: "ArrowUp" | "ArrowDown",
  value: string,
  prompts: readonly string[],
): PromptRecall | undefined {
  const recalling = recall.index >= 0 && value === recall.text;
  if (!recalling && value !== "") return undefined;
  const from = recalling ? recall.index : -1;
  if (key === "ArrowUp") {
    const index = from + 1;
    const text = prompts[index];
    return text === undefined ? undefined : { index, text };
  }
  if (from < 0) return undefined;
  const index = from - 1;
  return index < 0 ? NO_RECALL : { index, text: prompts[index]! };
}

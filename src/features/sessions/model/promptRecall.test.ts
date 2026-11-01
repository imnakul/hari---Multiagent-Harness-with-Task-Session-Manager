import { describe, expect, it } from "vitest";
import type { Block } from "./session";
import { NO_RECALL, sentPrompts, stepPromptRecall } from "./promptRecall";

const user = (text: string, extra: Partial<Block> = {}): Block => ({
  id: text,
  role: "user",
  text,
  ...extra,
});

describe("prompt recall (L-231)", () => {
  it("lists this chat's sent messages, newest first", () => {
    const blocks: Block[] = [
      user("first"),
      { id: "r", role: "assistant", text: "reply" },
      user("  second  "),
      user("second"),
      user("draft", { draft: true }),
      user("app turn", { internal: true }),
      user("   "),
      user("third"),
    ];
    expect(sentPrompts(blocks)).toEqual(["third", "second", "first"]);
  });

  it("Up in an empty box steps back, Down steps forward to empty", () => {
    const prompts = ["c", "b", "a"];
    const one = stepPromptRecall(NO_RECALL, "ArrowUp", "", prompts)!;
    expect(one).toEqual({ index: 0, text: "c" });
    const two = stepPromptRecall(one, "ArrowUp", "c", prompts)!;
    expect(two).toEqual({ index: 1, text: "b" });
    expect(stepPromptRecall(two, "ArrowDown", "b", prompts)).toEqual(one);
    expect(stepPromptRecall(one, "ArrowDown", "c", prompts)).toEqual(NO_RECALL);
  });

  it("leaves the keys alone past the ends", () => {
    const prompts = ["a"];
    const last = { index: 0, text: "a" };
    expect(stepPromptRecall(last, "ArrowUp", "a", prompts)).toBeUndefined();
    expect(stepPromptRecall(NO_RECALL, "ArrowDown", "", prompts)).toBeUndefined();
    expect(stepPromptRecall(NO_RECALL, "ArrowUp", "", [])).toBeUndefined();
  });

  it("text the user typed or changed keeps the usual arrow keys", () => {
    const prompts = ["b", "a"];
    expect(stepPromptRecall(NO_RECALL, "ArrowUp", "typed", prompts)).toBeUndefined();
    const recalled = { index: 0, text: "b" };
    expect(stepPromptRecall(recalled, "ArrowUp", "b edited", prompts)).toBeUndefined();
  });
});

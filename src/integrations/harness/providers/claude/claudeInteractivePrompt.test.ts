import { describe, expect, it } from "vitest";
import { interactivePromptMatches } from "./claudeInteractivePrompt";

const wrap = (text: string, id = "faa9"): string =>
  `<pasted_content id="${id}">\n${text}\n</pasted_content>`;
const prompt =
  "create a new branch\nDiscuss the walkthrough\nKeep existing styles.";

describe("interactive native paste acceptance", () => {
  it("recognizes the reported c plus folded remainder as the original prompt", () => {
    expect(
      interactivePromptMatches(prompt, `c\n\n${wrap(prompt.slice(1))}`),
    ).toBe(true);
  });
  it.each(["", "\n", "\n\n"])(
    "allows native paste separators (%j)",
    (separator) => {
      expect(
        interactivePromptMatches(
          prompt,
          `c${separator}${wrap(prompt.slice(1))}${separator}`,
        ),
      ).toBe(true);
    },
  );
  it("preserves Unicode and the exact leading whitespace/punctuation paste", () => {
    const text = "\n  !नमस्ते\nNext line";
    expect(
      interactivePromptMatches(
        text,
        `${wrap("\n  !", "prefix")}\n\nन\n\n${wrap("मस्ते\nNext line", "suffix")}`,
      ),
    ).toBe(true);
  });
  it("recognizes a wholly pasted punctuation-only message", () => {
    expect(interactivePromptMatches("?!\n...", wrap("?!\n..."))).toBe(true);
  });
  it("preserves literal pasted-content markup as user data", () => {
    const text = `compare ${wrap("literal user text", "user")}\nKeep this exact.`;
    expect(interactivePromptMatches(text, text)).toBe(true);
    expect(
      interactivePromptMatches(text, `c\n\n${wrap(text.slice(1), "outer")}`),
    ).toBe(true);
    expect(
      interactivePromptMatches(
        text,
        "compare literal user text\nKeep this exact.",
      ),
    ).toBe(false);
  });
  it.each([
    `x\n\n${wrap(prompt.slice(1))}`,
    `c\n\n${wrap(prompt.slice(1, -1))}`,
    `c\n\n${wrap(prompt.slice(1).replace("branch", "worktree"))}`,
    `c\n\n${wrap(prompt.slice(1))}\nRun something else`,
    `c\n\n${wrap(prompt.slice(1)).replace('id="faa9"', 'other="faa9"')}`,
    `c\n\n${wrap(prompt.slice(1)).replace('id="faa9"', 'id="bad id"')}`,
    wrap(prompt),
    undefined,
  ])(
    "rejects different text or an unknown transport representation (%j)",
    (actual) => {
      expect(interactivePromptMatches(prompt, actual)).toBe(false);
    },
  );
  it("keeps compact acceptance separate from ordinary pasted prompts", () => {
    expect(interactivePromptMatches("/compact", "/compact")).toBe(true);
    expect(interactivePromptMatches("/compact", wrap("/compact"))).toBe(false);
  });
});

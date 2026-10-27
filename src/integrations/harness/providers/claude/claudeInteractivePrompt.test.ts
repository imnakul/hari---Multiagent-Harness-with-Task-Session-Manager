import { describe, expect, it } from "vitest";
import {
  interactivePromptMatches,
  interactivePromptNearlyMatches,
} from "./claudeInteractivePrompt";

const wrap = (text: string, id = "faa9"): string =>
  `<pasted_content id="${id}">\n${text}\n</pasted_content>`;
// Installed CLI 2.1.301's formatter repeats the ID in the closing tag and
// doesn't add another newline when the pasted text already ends with one.
const nativeWrap = (text: string, id = "7f52"): string =>
  `\n\n<pasted_content id="${id}">\n${text}${text.endsWith("\n") ? "" : "\n"}</pasted_content id="${id}">\n`;
const prompt =
  "create a new branch\nDiscuss the walkthrough\nKeep existing styles.";

describe("interactive native paste acceptance", () => {
  it("recognizes the installed CLI's matching-ID closing tag", () => {
    expect(
      interactivePromptMatches(prompt, `c${nativeWrap(prompt.slice(1))}`),
    ).toBe(true);
  });
  it.each(["", "\n", "\n\n"])(
    "preserves trailing paste newlines with native closing tags (%j)",
    (suffix) => {
      const text = prompt + suffix;
      expect(
        interactivePromptMatches(text, `c${nativeWrap(text.slice(1))}`),
      ).toBe(true);
    },
  );
  it("matches the complete native paste including Windows attachment references", () => {
    const text =
      'Students list page\nCheck the pagination and ranking.\n\nRead these attached files using your tools:\n"screen.png": "C:\\\\Users\\\\tester\\\\AppData\\\\Roaming\\\\MonoCode\\\\interactive-attachments\\\\screen.png"';
    expect(
      interactivePromptMatches(text, `S${nativeWrap(text.slice(1))}`),
    ).toBe(true);
    expect(
      interactivePromptMatches(
        text,
        `S${nativeWrap(text.slice(1).replace("screen.png", "other.png"))}`,
      ),
    ).toBe(false);
  });
  it("matches native closing IDs across leading and trailing paste parts", () => {
    const text = "\n  !नमस्ते\nNext line";
    expect(
      interactivePromptMatches(
        text,
        `${nativeWrap("\n  !", "abcd")}न${nativeWrap("मस्ते\nNext line", "ef12")}`,
      ),
    ).toBe(true);
  });
  it.each([
    `c${nativeWrap(prompt.slice(1)).replace('</pasted_content id="7f52">', '</pasted_content id="dead">')}`,
    `c${nativeWrap(prompt.slice(1, -1))}`,
    `c${nativeWrap(prompt.slice(1).replace("branch", "worktree"))}`,
    `c${nativeWrap(prompt.slice(1))}Extra request`,
  ])(
    "rejects mismatched native closing IDs or changed content (%j)",
    (actual) => {
      expect(interactivePromptMatches(prompt, actual)).toBe(false);
    },
  );
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

describe("near-match after a repaste (L-187)", () => {
  it("accepts the typed letter doubled or missing, with the paste intact", () => {
    for (const actual of [
      `cc${nativeWrap(prompt.slice(1))}`,
      `cc\n\n${wrap(prompt.slice(1))}`,
      nativeWrap(prompt.slice(1)).replace(/^\n\n/, ""),
      wrap(prompt.slice(1)),
    ]) {
      expect(interactivePromptMatches(prompt, actual)).toBe(false);
      expect(interactivePromptNearlyMatches(prompt, actual)).toBe(true);
    }
  });
  it("accepts a missing letter between two pastes, also merged into one", () => {
    const text = "\n  !नमस्ते\nNext line";
    expect(
      interactivePromptNearlyMatches(
        text,
        `${wrap("\n  !", "a")}${wrap("मस्ते\nNext line", "b")}`,
      ),
    ).toBe(true);
    expect(
      interactivePromptNearlyMatches(text, wrap("\n  !मस्ते\nNext line")),
    ).toBe(true);
  });
  it.each([
    `x${nativeWrap(prompt.slice(1))}`,
    `ccc${nativeWrap(prompt.slice(1))}`,
    `cc${nativeWrap(prompt.slice(1).replace("branch", "worktree"))}`,
    `c${nativeWrap(prompt.slice(1))}${nativeWrap(prompt.slice(1))}`,
    wrap(prompt.slice(2)),
    "Something else entirely",
    undefined,
  ])("still rejects other input (%j)", (actual) => {
    expect(interactivePromptNearlyMatches(prompt, actual)).toBe(false);
  });
  it("never near-matches compact, punctuation-only or one-letter prompts", () => {
    expect(interactivePromptNearlyMatches("/compact", "//compact")).toBe(false);
    expect(interactivePromptNearlyMatches("?!", "?!?!")).toBe(false);
    expect(interactivePromptNearlyMatches("C", "")).toBe(false);
    expect(interactivePromptNearlyMatches("C", "CC")).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import type { Block } from "../../sessions/model/session";
import {
  DEFAULT_IMPROVE_INSTRUCTIONS,
  buildImprovePrompt,
  improveBlockReason,
  missingTokens,
  parseImproveReply,
  protectedTokens,
  recentTurns,
  splitLeadingCommand,
  withLeadingCommand,
  type ImprovePromptInput,
} from "./promptImprove";

const input: ImprovePromptInput = {
  draft: "fix the sidebar spacing like last time",
  project: "mono-clone",
  turns: "",
  instructions: "",
  profile: "",
  glossary: "",
  rules: [],
  samples: [],
  learn: false,
};

describe("improveBlockReason (L-252)", () => {
  it("asks for a prompt when there is nothing but a command", () => {
    expect(improveBlockReason("")).toBe("Write a prompt first");
    expect(improveBlockReason("  /plan  ")).toBe("Write a prompt first");
  });
  it("asks for more words below the minimum", () => {
    expect(improveBlockReason("fix it now")).toBe(
      "Write a few more words first",
    );
    expect(improveBlockReason("/plan fix it now")).toBe(
      "Write a few more words first",
    );
  });
  it("allows a real draft", () => {
    expect(improveBlockReason("fix the sidebar spacing please")).toBeNull();
  });
});

describe("leading commands", () => {
  it("keeps a leading /command out of the rewrite and puts it back", () => {
    const split = splitLeadingCommand("/review check the diff for bugs");
    expect(split).toEqual({
      prefix: "/review ",
      body: "check the diff for bugs",
    });
    expect(withLeadingCommand(split.prefix, "Review the diff for bugs.")).toBe(
      "/review Review the diff for bugs.",
    );
  });
  it("adds a space when the command had none", () => {
    expect(withLeadingCommand("/plan", "Plan it.")).toBe("/plan Plan it.");
  });
  it("leaves text without a command alone", () => {
    expect(splitLeadingCommand("see src/a.ts")).toEqual({
      prefix: "",
      body: "see src/a.ts",
    });
    expect(withLeadingCommand("", "x")).toBe("x");
  });
});

describe("protectedTokens", () => {
  it("finds paths, files, mentions, URLs, IDs, code and attachments", () => {
    const tokens = protectedTokens(
      "In src/app/App.tsx and @docs/NOTES.md, see https://example.com/a/b, fix L-252 and #123, run `npm run build`, look at [Image #1] and settings.ts.",
    );
    expect(tokens).toEqual(
      expect.arrayContaining([
        "src/app/App.tsx",
        "@docs/NOTES.md",
        "https://example.com/a/b",
        "L-252",
        "#123",
        "`npm run build`",
        "[Image #1]",
        "settings.ts",
      ]),
    );
  });
  it("does not split a URL into extra tokens", () => {
    expect(
      protectedTokens("read https://example.com/docs/guide.md now"),
    ).toEqual(["https://example.com/docs/guide.md"]);
  });
  it("finds Windows paths", () => {
    expect(protectedTokens("open E:\\Developing\\app\\main.rs")).toContain(
      "E:\\Developing\\app\\main.rs",
    );
  });
  it("reports what a rewrite dropped", () => {
    expect(
      missingTokens("fix `foo()` in src/a.ts", "Fix foo in the file."),
    ).toEqual(["`foo()`", "src/a.ts"]);
    expect(
      missingTokens("fix `foo()` in src/a.ts", "Fix `foo()` in src/a.ts."),
    ).toEqual([]);
  });
});

describe("recentTurns", () => {
  it("keeps the last user and agent messages, oldest first, without drafts", () => {
    const blocks: Block[] = [
      { id: "u1", role: "user", text: "First ask" },
      { id: "a1", role: "assistant", text: "First answer" },
      { id: "s1", role: "system", text: "ignored" },
      { id: "d1", role: "user", text: "a queued draft", draft: true },
      { id: "u2", role: "user", text: "Second ask" },
    ];
    expect(recentTurns(blocks)).toBe(
      "Owner: First ask\n\nAgent: First answer\n\nOwner: Second ask",
    );
  });
  it("clips long messages", () => {
    const turn = recentTurns([
      { id: "a1", role: "assistant", text: "x".repeat(900) },
    ]);
    expect(turn).toBe(`Agent: ${"x".repeat(700)}…`);
  });
  it("is empty for a new chat", () => {
    expect(recentTurns([])).toBe("");
  });
});

describe("buildImprovePrompt", () => {
  it("uses the default instructions, marks a new chat and leaves learning out", () => {
    const prompt = buildImprovePrompt(input);
    expect(prompt).toContain(DEFAULT_IMPROVE_INSTRUCTIONS);
    expect(prompt).toContain("Do not use any tools.");
    expect(prompt).toContain("Project: mono-clone");
    expect(prompt).toContain("<turns>\n(new chat)\n</turns>");
    expect(prompt).toContain(
      "<draft>\nfix the sidebar spacing like last time\n</draft>",
    );
    expect(prompt).not.toContain("<known_rules>");
  });
  it("uses custom instructions and sends memory when learning", () => {
    const prompt = buildImprovePrompt({
      ...input,
      instructions: "Write one line.",
      profile: "- I say panel for the Session overview",
      glossary: "Hari = the phone companion",
      rules: ["never commit opencode.json"],
      samples: [{ rewrite: "Fix it.", sent: "Fix the sidebar." }],
      learn: true,
    });
    expect(prompt).toContain("Write one line.");
    expect(prompt).not.toContain(DEFAULT_IMPROVE_INSTRUCTIONS);
    expect(prompt).toContain(
      "<profile>\n- I say panel for the Session overview\n</profile>",
    );
    expect(prompt).toContain(
      "<glossary>\nHari = the phone companion\n</glossary>",
    );
    expect(prompt).toContain(
      "<known_rules>\n- never commit opencode.json\n</known_rules>",
    );
    expect(prompt).toContain(
      "Your rewrite:\nFix it.\nWhat the owner sent:\nFix the sidebar.",
    );
  });
});

describe("parseImproveReply", () => {
  const draft = "fix the bug in src/a.ts";
  it("reads the rewrite and what to learn", () => {
    const reply = parseImproveReply(
      "<prompt>\nFix: the bug in src/a.ts.\n</prompt>\n<learned>\nstyle: short numbered lists\nterm: Hari = phone app\nrule: never commit opencode.json\nnoise line\n</learned>",
      draft,
    );
    expect(reply).toEqual({
      prompt: "Fix: the bug in src/a.ts.",
      learned: {
        styles: ["short numbered lists"],
        terms: ["Hari = phone app"],
        rules: ["never commit opencode.json"],
      },
    });
  });
  it("removes a code fence around the rewrite", () => {
    expect(
      parseImproveReply("<prompt>\n```\nFix src/a.ts.\n```\n</prompt>", draft)
        ?.prompt,
    ).toBe("Fix src/a.ts.");
  });
  it("keeps at most three learned lines of each kind", () => {
    const lines = Array.from(
      { length: 5 },
      (_, index) => `rule: rule ${index}`,
    ).join("\n");
    const reply = parseImproveReply(
      `<prompt>Fix src/a.ts.</prompt><learned>${lines}</learned>`,
      draft,
    );
    expect(reply?.learned.rules).toEqual(["rule 0", "rule 1", "rule 2"]);
  });
  it("rejects replies without a prompt, empty, too long, or missing a protected token", () => {
    expect(parseImproveReply("Fix src/a.ts.", draft)).toBeNull();
    expect(parseImproveReply("<prompt>  </prompt>", draft)).toBeNull();
    expect(
      parseImproveReply(`<prompt>src/a.ts ${"x".repeat(800)}</prompt>`, draft),
    ).toBeNull();
    expect(
      parseImproveReply("<prompt>Fix the bug in the file.</prompt>", draft),
    ).toBeNull();
  });
});

// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import type { Block } from "./session";
import {
  appendSessionNotes,
  autoNotesAfter,
  autoNotesOn,
  blocksAfter,
  buildNotesPrompt,
  buildTidyPrompt,
  DEFAULT_NOTES_INSTRUCTIONS,
  loadSessionMetadataAi,
  markAutoNotesDone,
  NOTHING_NEW,
  notesSummary,
  parseLabelReply,
  parseNotesReply,
  parseSessionMetadataAi,
  parseTidyReply,
  splitHeadingTag,
  saveSessionMetadataAi,
  setAutoNotes,
  withoutLeftOff,
} from "./sessionMetadataAi";

beforeEach(() => localStorage.clear());

describe("session metadata AI settings (L-190)", () => {
  it("defaults, parses and keeps a stable value between changes", () => {
    expect(parseSessionMetadataAi(null)).toEqual({ helper: null, instructions: "", autoDefault: false });
    expect(
      parseSessionMetadataAi({ helper: { provider: "codex", model: "m" }, instructions: "x", autoDefault: true }),
    ).toEqual({ helper: { provider: "codex", model: "m" }, instructions: "x", autoDefault: true });
    const first = loadSessionMetadataAi();
    expect(loadSessionMetadataAi()).toBe(first);
    saveSessionMetadataAi({ helper: null, instructions: "", autoDefault: true });
    expect(loadSessionMetadataAi()).not.toBe(first);
    expect(loadSessionMetadataAi().autoDefault).toBe(true);
  });

  it("uses the chat's own Auto switch over the default, and keeps the marker", () => {
    expect(autoNotesOn("a")).toBe(false);
    saveSessionMetadataAi({ helper: null, instructions: "", autoDefault: true });
    expect(autoNotesOn("a")).toBe(true);
    setAutoNotes("a", false);
    expect(autoNotesOn("a")).toBe(false);
    markAutoNotesDone("a", "b7");
    expect(autoNotesAfter("a")).toBe("b7");
    expect(autoNotesOn("a")).toBe(false);
  });
});

describe("blocksAfter", () => {
  const blocks: Block[] = [
    { id: "1", role: "user", text: "a" },
    { id: "2", role: "assistant", text: "b" },
    { id: "3", role: "user", text: "c" },
    { id: "4", role: "assistant", text: "d", streaming: true },
  ];
  it("returns the finished blocks after the marker, or all when it is missing", () => {
    expect(blocksAfter(blocks, "2").map((block) => block.id)).toEqual(["3"]);
    expect(blocksAfter(blocks, null).map((block) => block.id)).toEqual(["1", "2", "3"]);
    expect(blocksAfter(blocks, "gone").map((block) => block.id)).toEqual(["1", "2", "3"]);
  });
});

describe("prompts and replies", () => {
  it("builds the notes prompt with the rules, style, notes and transcript", () => {
    const prompt = buildNotesPrompt({ transcript: "T", notes: "", instructions: "", scope: "update" });
    expect(prompt).toContain(DEFAULT_NOTES_INSTRUCTIONS);
    // L-193: no "(continued)" headings; routine steps are skipped.
    expect(prompt).toContain('Never write "(continued)"');
    expect(prompt).toContain("Skip routine steps");
    expect(prompt).toContain("At most 60 words");
    expect(prompt).toContain("**Left off:**");
    expect(prompt).toContain(NOTHING_NEW);
    expect(prompt).toContain("only the turns since");
    expect(prompt).toContain("(empty: this is the first entry)");
    const long = buildNotesPrompt({ transcript: "T", notes: "x".repeat(30_000), instructions: "Mine", scope: "full" });
    expect(long).toContain("[earlier notes omitted]");
    expect(long).toContain("<style>\nMine\n</style>");
  });

  it("cleans a label reply", () => {
    expect(parseLabelReply('Label: "Rubrics editor + KaTeX fixes."\nmore')).toBe("Rubrics editor + KaTeX fixes");
    expect(parseLabelReply("  \n ")).toBeNull();
  });

  it("reads a notes reply", () => {
    expect(parseNotesReply("NOTHING_NEW.")).toEqual({ kind: "none" });
    expect(parseNotesReply("```md\n- a\n```")).toEqual({ kind: "add", text: "- a" });
    expect(parseNotesReply("")).toBeNull();
    expect(parseNotesReply("x".repeat(13_000))).toBeNull();
  });
});

describe("appendSessionNotes", () => {
  const notes = "**Rubrics (open-ended)**\n- Editor\n\n**Left off:** testing";

  it("replaces only the closing Left off line", () => {
    expect(withoutLeftOff(notes)).toBe("**Rubrics (open-ended)**\n- Editor\n\n");
    expect(withoutLeftOff("- **Left off:** a\n- keep")).toBe("\n- keep");
  });

  it("continues the last heading's list, or starts a new block", () => {
    expect(appendSessionNotes(notes, "- Scoring\n\n**Left off:** done")).toBe(
      "**Rubrics (open-ended)**\n- Editor\n- Scoring\n\n**Left off:** done",
    );
    expect(appendSessionNotes(notes, "**Tamil edition (feature)**\n- Fonts")).toBe(
      "**Rubrics (open-ended)**\n- Editor\n\n**Tamil edition (feature)**\n- Fonts",
    );
    expect(appendSessionNotes("", "- a")).toBe("- a");
    expect(appendSessionNotes(notes, "  ")).toBe(notes);
  });
});

describe("tidy summary (L-193)", () => {
  it("sizes the tidy prompt to the notes, within limits", () => {
    const words = (count: number) => Array.from({ length: count }, () => "word").join(" ");
    expect(buildTidyPrompt({ notes: words(10), instructions: "" })).toContain("At most 80 words.");
    expect(buildTidyPrompt({ notes: words(200), instructions: "" })).toContain("At most 140 words.");
    expect(buildTidyPrompt({ notes: words(5000), instructions: "" })).toContain("At most 400 words.");
    const prompt = buildTidyPrompt({ notes: "## A\n- one", instructions: "Mine" });
    expect(prompt).toContain("<style>\nMine\n</style>");
    expect(prompt).toContain("<notes>\n## A\n- one\n</notes>");
    expect(prompt).toContain("Skip routine steps");
  });

  it("accepts a tidied reply and rejects unusable ones", () => {
    expect(parseTidyReply("```md\n## A\n- one\n```")).toBe("## A\n- one");
    expect(parseTidyReply("   ")).toBeNull();
    expect(parseTidyReply(`${NOTHING_NEW}.`)).toBeNull();
    expect(parseTidyReply("x".repeat(12_001))).toBeNull();
  });
});

describe("notesSummary topic merge (L-193)", () => {
  it("shows a repeated heading as one topic, at its newest place", () => {
    const notes = ["## Panel", "- a", "## Build", "- b", "## Panel", "- c"].join("\n");
    expect(notesSummary(notes).groups).toEqual([
      { heading: "Panel", body: "- a\n- c" },
      { heading: "Build", body: "- b" },
    ]);
  });

  it("folds (continued) headings into their topic", () => {
    const notes = [
      "## Panel tabs (feature)",
      "- a",
      "## Other",
      "- b",
      "## Panel tabs (continued)",
      "- c",
      "## Other - continued",
      "- d",
    ].join("\n");
    expect(notesSummary(notes).groups).toEqual([
      { heading: "Other", body: "- b\n- d" },
      { heading: "Panel tabs (feature)", body: "- a\n- c" },
    ]);
  });

  it("keeps different kinds of one name apart, and never merges headless text", () => {
    const notes = ["Intro.", "## Tabs (bug fix)", "- a", "## Tabs (feature)", "- b"].join("\n");
    expect(notesSummary(notes).groups).toEqual([
      { heading: "Tabs (feature)", body: "- b" },
      { heading: "Tabs (bug fix)", body: "- a" },
      { heading: "", body: "Intro." },
    ]);
  });
});

describe("notesSummary (L-192)", () => {
  it("lifts Left off out and groups the rest by heading, newest first", () => {
    const notes = [
      "Started on the panel.",
      "",
      "## Day 1",
      "- Picked SQLite",
      "**Day 2**",
      "- Wired the UI",
      "- **Left off:** styling the tabs",
    ].join("\n");
    expect(notesSummary(notes)).toEqual({
      leftOff: "styling the tabs",
      groups: [
        { heading: "Day 2", body: "- Wired the UI" },
        { heading: "Day 1", body: "- Picked SQLite" },
        { heading: "", body: "Started on the panel." },
      ],
    });
  });

  it("returns nothing for empty notes and keeps headings without points", () => {
    expect(notesSummary("")).toEqual({ leftOff: null, groups: [] });
    expect(notesSummary("# Plan\r\n**Left off:**")).toEqual({
      leftOff: null,
      groups: [{ heading: "Plan", body: "" }],
    });
  });

  it("splits a heading's bracketed kind into a tag", () => {
    expect(splitHeadingTag("Students pagination overlap (bug fix)")).toEqual({
      name: "Students pagination overlap",
      tag: "bug fix",
    });
    expect(splitHeadingTag("Plan")).toEqual({ name: "Plan", tag: null });
    // Brackets in the middle, or a long aside, stay part of the name.
    expect(splitHeadingTag("Fix (again) the build")).toEqual({ name: "Fix (again) the build", tag: null });
    expect(splitHeadingTag("Move (a very long explanation in brackets)").tag).toBeNull();
    expect(splitHeadingTag("(feature)")).toEqual({ name: "(feature)", tag: null });
  });
});

import { describe, expect, it } from "vitest";
import { CLAUDE_EXECUTION_SETTING, mobileModelSettings, mobileQuestionReply } from "./mobileWorkspace";

const prompt = {
  requestId: 1,
  questions: [
    {
      id: "colour",
      prompt: "Which colour?",
      multiSelect: false,
      allowCustom: true,
      options: [
        { id: "red", label: "Red" },
        { id: "blue", label: "Blue" },
      ],
    },
    {
      id: "size",
      prompt: "Which sizes?",
      multiSelect: true,
      allowCustom: false,
      options: [
        { id: "s", label: "Small" },
        { id: "l", label: "Large" },
      ],
    },
  ],
};

describe("mobile question replies", () => {
  it("keeps the questions and options asked, and a deliberate partial answer", () => {
    expect(
      mobileQuestionReply(
        { kind: "answered", answers: { colour: ["red"], size: ["s", "xl"], other: ["x"] } },
        prompt,
      ),
    ).toEqual({ kind: "answered", answers: { colour: ["red"], size: ["s"] } });
    expect(
      mobileQuestionReply(
        { kind: "answered", answers: { colour: ["__custom__"] }, custom: { colour: " Teal " } },
        prompt,
      ),
    ).toEqual({ kind: "answered", answers: { colour: ["__custom__"] }, custom: { colour: "Teal" } });
  });

  it("skips only when asked to, rejecting answers that leave nothing answered", () => {
    expect(mobileQuestionReply({ kind: "skipped" }, prompt)).toEqual({ kind: "skipped" });
    expect(mobileQuestionReply({ kind: "answered", answers: { colour: ["green"] } }, prompt)).toBeUndefined();
    expect(
      mobileQuestionReply(
        { kind: "answered", answers: { colour: ["__custom__"] }, custom: { colour: "x".repeat(10_001) } },
        prompt,
      ),
    ).toBeUndefined();
    expect(mobileQuestionReply({ kind: "maybe" }, prompt)).toBeUndefined();
    expect(mobileQuestionReply(null, prompt)).toBeUndefined();
  });

  it("reads a reply typed in the phone's notification (L-278)", () => {
    const one = { requestId: 2, questions: [prompt.questions[0]!] };
    expect(mobileQuestionReply({ kind: "text", text: " blue " }, one)).toEqual({
      kind: "answered",
      answers: { colour: ["blue"] },
    });
    expect(mobileQuestionReply({ kind: "text", text: "Teal" }, one)).toEqual({
      kind: "answered",
      answers: { colour: ["__custom__"] },
      custom: { colour: "Teal" },
    });
    const sizes = { requestId: 3, questions: [prompt.questions[1]!] };
    expect(mobileQuestionReply({ kind: "text", text: "large" }, sizes)).toEqual({
      kind: "answered",
      answers: { size: ["l"] },
    });
    expect(mobileQuestionReply({ kind: "text", text: "Huge" }, sizes)).toBeUndefined();
    const withOther = {
      requestId: 4,
      questions: [
        { ...prompt.questions[1]!, options: [...prompt.questions[1]!.options, { id: "o", label: "Other" }] },
      ],
    };
    expect(mobileQuestionReply({ kind: "text", text: "Huge" }, withOther)).toEqual({
      kind: "answered",
      answers: { size: ["o"] },
      custom: { size: "Huge" },
    });
    expect(mobileQuestionReply({ kind: "text", text: "Red" }, prompt)).toBeUndefined();
    expect(mobileQuestionReply({ kind: "text", text: "  " }, one)).toBeUndefined();
    expect(mobileQuestionReply({ kind: "text", text: "x".repeat(10_001) }, one)).toBeUndefined();
  });
});

describe("phone model settings (fork L-235)", () => {
  const effort = {
    id: "effort",
    label: "Effort",
    kind: "select" as const,
    value: "high",
    options: [{ value: "high", label: "High" }],
  };

  it("offers Claude's Structured / Interactive mode on local projects", () => {
    expect(mobileModelSettings("claude", [effort], false)).toEqual([effort, CLAUDE_EXECUTION_SETTING]);
    expect(CLAUDE_EXECUTION_SETTING.options.map((option) => option.value)).toEqual([
      "structured",
      "interactive",
    ]);
  });

  it("leaves other providers and remote projects as they are", () => {
    expect(mobileModelSettings("codex", [effort], false)).toEqual([effort]);
    expect(mobileModelSettings("claude", [effort], true)).toEqual([effort]);
    expect(mobileModelSettings("claude", undefined, true)).toEqual([]);
  });
});

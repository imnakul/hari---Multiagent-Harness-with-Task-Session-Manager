import fixture from "./fixtures/interactive-cli-2.1.301.json";
import { describe, expect, it } from "vitest";
import {
  interactiveTranscriptEvents,
  isClaudeInteractive,
  isEmptyInteractivePrompt,
  isInteractiveTerminalReply,
  newTranscriptState,
  type PromptScreen,
} from "./claudeInteractiveProtocol";
import {
  mergeModelSettings,
  resolveModel,
} from "../../../../features/sessions/model/models";

const screen: PromptScreen = {
  before: "❯ ",
  after: "",
  afterIsDim: false,
  above: "────────────────────",
  below: "────────────────────",
  screen: "? for shortcuts",
};

describe("interactive input safety", () => {
  it("recognizes only terminal query replies without treating them as human input", () => {
    expect(isInteractiveTerminalReply("\x1b[?1;2c")).toBe(true);
    expect(isInteractiveTerminalReply("\x1b]10;rgb:ffff/ffff/ffff\x1b\\")).toBe(
      true,
    );
    expect(isInteractiveTerminalReply("hello\r")).toBe(false);
    expect(isInteractiveTerminalReply("\x1b[200~hello\x1b[201~\r")).toBe(false);
  });
  it("requires a framed, empty native input at the cursor", () => {
    expect(isEmptyInteractivePrompt(screen)).toBe(true);
    expect(
      isEmptyInteractivePrompt({
        ...screen,
        after: "Try asking about a file",
        afterIsDim: true,
      }),
    ).toBe(true);
    for (const change of [
      { before: "❯ unfinished" },
      { after: "unfinished" },
      { above: "" },
      { below: "" },
      { before: "> " },
    ]) {
      expect(isEmptyInteractivePrompt({ ...screen, ...change })).toBe(false);
    }
  });
  it.each([
    "Enter to select",
    "Esc to cancel",
    "Do you trust this folder?",
    "Select a model",
    "esc to interrupt",
    "Type to search",
  ])("does not send into %s", (menu) => {
    expect(isEmptyInteractivePrompt({ ...screen, screen: menu })).toBe(false);
  });
  it("keeps the selected Claude transport through model settings normalization", () => {
    expect(isClaudeInteractive()).toBe(false);
    const settings = mergeModelSettings(
      resolveModel("claude", "claude:sonnet-5"),
      { claudeExecution: "interactive", effort: "medium" },
    );
    expect(settings.claudeExecution).toBe("interactive");
    expect(isClaudeInteractive(settings)).toBe(true);
  });
});

describe("native JSONL rendering", () => {
  it("renders the reply captured from a real interactive CLI turn", () => {
    const state = newTranscriptState();
    const events = fixture.transcript.flatMap((row) =>
      interactiveTranscriptEvents(JSON.stringify(row), state),
    );
    expect(events.filter((event) => event.type === "message.delta")).toEqual([
      {
        type: "message.delta",
        text: "Local fixture reply. No external model was contacted.",
      },
    ]);
  });
  it("deduplicates snapshots, tools, tool results and request-level usage", () => {
    const state = newTranscriptState();
    const row = {
      type: "assistant",
      uuid: "a",
      message: {
        id: "api-a",
        model: "claude-sonnet-5",
        content: [{ type: "text", text: "Hello" }],
        usage: { input_tokens: 10, output_tokens: 2 },
      },
    };
    expect(interactiveTranscriptEvents(JSON.stringify(row), state)).toEqual(
      expect.arrayContaining([{ type: "message.delta", text: "Hello" }]),
    );
    expect(interactiveTranscriptEvents(JSON.stringify(row), state)).toEqual([]);
    row.message.content[0].text = "Hello again";
    expect(interactiveTranscriptEvents(JSON.stringify(row), state)).toEqual([
      { type: "message.delta", text: " again" },
    ]);
    const tool = {
      type: "assistant",
      uuid: "b",
      message: {
        id: "api-b",
        model: "claude-sonnet-5",
        content: [
          {
            type: "tool_use",
            id: "read-1",
            name: "Read",
            input: { file_path: "/repo/test.ts" },
          },
        ],
        usage: { input_tokens: 20, output_tokens: 3 },
      },
    };
    const events = interactiveTranscriptEvents(JSON.stringify(tool), state);
    expect(events.filter((e) => e.type === "tool.started")).toHaveLength(1);
    expect(events.find((e) => e.type === "usage")).toMatchObject({
      turn: { input: 30, output: 5 },
    });
    expect(interactiveTranscriptEvents(JSON.stringify(tool), state)).toEqual(
      [],
    );
    const result = JSON.stringify({
      type: "user",
      uuid: "c",
      message: {
        content: [
          { type: "tool_result", tool_use_id: "read-1", content: "done" },
        ],
      },
    });
    expect(interactiveTranscriptEvents(result, state)).toEqual([
      {
        type: "tool.updated",
        callId: "read-1",
        status: "completed",
        detail: "done",
      },
    ]);
    expect(interactiveTranscriptEvents(result, state)).toEqual([]);
  });
  it("rejects malformed complete lines and ignores sidechain content and user echoes", () => {
    const state = newTranscriptState();
    for (const row of [
      JSON.stringify({
        type: "assistant",
        isSidechain: true,
        uuid: "x",
        message: { content: [{ type: "text", text: "child" }] },
      }),
      JSON.stringify({
        type: "user",
        uuid: "u",
        message: { content: [{ type: "text", text: "prompt" }] },
      }),
    ]) {
      expect(interactiveTranscriptEvents(row, state)).toEqual([]);
    }
    expect(() => interactiveTranscriptEvents("{broken", state)).toThrow(
      "invalid complete JSONL",
    );
  });
});

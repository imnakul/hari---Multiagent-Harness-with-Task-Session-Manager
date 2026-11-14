import { describe, expect, it } from "vitest";
import {
  asideTitle,
  classifyAsideRequest,
  parseAsideRequest,
  promptWithHistory,
} from "./asideRequest";

const SYSTEM = { role: "system", content: "You are Aside, a browser agent." };
const NOTE = {
  role: "user",
  content: "<system_message>Page: Example Domain — https://example.com</system_message>",
};
const tools = [{ type: "function", function: { name: "repl" } }];

function turn(messages: unknown[], extra: Record<string, unknown> = {}) {
  return classifyAsideRequest(
    parseAsideRequest({ model: "claude/opus", stream: true, tools, messages, ...extra }),
  );
}

describe("parseAsideRequest", () => {
  it("reads text parts, notes images and keeps the effort", () => {
    const request = parseAsideRequest({
      model: "claude/opus",
      stream: true,
      reasoning_effort: "high",
      max_completion_tokens: 4000,
      tools,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "look" },
            { type: "image_url", image_url: { url: "data:" } },
          ],
        },
      ],
    });
    expect(request).toMatchObject({
      model: "claude/opus",
      stream: true,
      effort: "high",
      toolCount: 1,
      maxTokens: 4000,
      messages: [{ role: "user", text: "look", hasImage: true }],
    });
  });

  it("rejects malformed bodies", () => {
    expect(() => parseAsideRequest(null)).toThrow("JSON object");
    expect(() => parseAsideRequest({ messages: [] })).toThrow("model");
    expect(() => parseAsideRequest({ model: "m", messages: [] })).toThrow("messages");
    expect(() => parseAsideRequest({ model: "m", messages: [{ role: "bot" }] })).toThrow("role");
  });
});

describe("classifyAsideRequest", () => {
  it("answers the chat-title request locally", () => {
    const work = classifyAsideRequest(
      parseAsideRequest({
        model: "claude/opus",
        max_completion_tokens: 96,
        messages: [
          { role: "system", content: "You name conversations in a few words." },
          { role: "user", content: "what's on this page, briefly?" },
        ],
      }),
    );
    expect(work).toEqual({ kind: "title", title: "What's on this page briefly" });
  });

  it("answers the memory-extraction request locally", () => {
    const work = turn([
      SYSTEM,
      NOTE,
      { role: "user", content: "hello" },
      { role: "assistant", content: "Hi" },
      { role: "user", content: "You are now acting as the memory extraction subagent. …" },
    ]);
    expect(work).toEqual({ kind: "memory" });
  });

  it("forwards the newest text with the page and keys on the user texts", () => {
    const work = turn([
      SYSTEM,
      NOTE,
      { role: "user", content: "hello" },
      { role: "assistant", content: "Hi there" },
      NOTE,
      { role: "user", content: "summarise it" },
      { role: "user", content: "<recalled_memories>likes tea</recalled_memories>" },
    ]);
    expect(work).toMatchObject({
      kind: "turn",
      texts: ["hello", "summarise it"],
      priorTexts: ["hello"],
      prompt: "summarise it\n\n<aside_page>\nPage: Example Domain — https://example.com\n</aside_page>",
      history: "User: hello\n\nAssistant: Hi there",
      droppedImages: false,
    });
  });

  it("refuses a request that ends with a tool result", () => {
    const work = turn([
      SYSTEM,
      { role: "user", content: "go" },
      { role: "assistant", content: null },
      { role: "tool", content: "output" },
    ]);
    expect(work.kind).toBe("unsupported");
  });
});

describe("asideTitle", () => {
  it("takes the first six words without tags or punctuation edges", () => {
    expect(asideTitle("<b>hey!</b> can you, please, read this whole long page now")).toBe(
      "Hey can you please read this",
    );
    expect(asideTitle("   ")).toBe("New chat");
  });
});

describe("promptWithHistory", () => {
  it("prefixes earlier exchanges only when there are some", () => {
    expect(promptWithHistory("next", "")).toBe("next");
    expect(promptWithHistory("next", "User: a")).toContain("<aside_history>\nUser: a\n</aside_history>\n\nnext");
  });
});

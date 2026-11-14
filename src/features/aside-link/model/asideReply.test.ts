import { describe, expect, it } from "vitest";
import { newDefaultSession, type Block, type Session } from "../../sessions/model/session";
import { NEW_CURSOR, replyProgress } from "./asideReply";

function session(blocks: Block[], busy: boolean): Session {
  return { ...newDefaultSession("C:/cli"), blocks, busy };
}
const user = (id: string, appRequestId?: string): Block => ({ id, role: "user", text: "q", appRequestId });
const said = (id: string, text: string): Block => ({ id, role: "assistant", text });

describe("replyProgress", () => {
  it("streams only new text and finishes once the session goes quiet", () => {
    let step = replyProgress(session([user("u", "r")], true), "r", NEW_CURSOR);
    expect(step).toMatchObject({ content: "", done: false });
    step = replyProgress(session([user("u", "r"), said("a", "Hel")], true), "r", step.cursor);
    expect(step.content).toBe("Hel");
    step = replyProgress(session([user("u", "r"), said("a", "Hello")], true), "r", step.cursor);
    expect(step.content).toBe("lo");
    step = replyProgress(
      session([user("u", "r"), said("a", "Hello"), said("b", "Next")], false),
      "r",
      step.cursor,
    );
    expect(step).toMatchObject({ content: "\n\nNext", done: true });
  });

  it("reports tool steps and waits for approval as thinking", () => {
    const tool: Block = { id: "t", role: "tool", text: "Read file", tool: { kind: "read" } };
    const approval: Block = { id: "p", role: "approval", text: "Allow?", approval: { requestId: 1 } };
    const step = replyProgress(session([user("u", "r"), tool, approval], true), "r", NEW_CURSOR);
    expect(step.reasoning).toContain("• ");
    expect(step.reasoning).toContain("Waiting for your approval in MonoCode");
    const again = replyProgress(session([user("u", "r"), tool, approval], true), "r", step.cursor);
    expect(again.reasoning).toBe("");
  });

  it("ignores other turns and is not done before its message lands", () => {
    const blocks = [user("old", "x"), said("a", "old answer"), user("u", "r"), said("b", "new")];
    expect(replyProgress(session(blocks, false), "r", NEW_CURSOR).content).toBe("new");
    expect(replyProgress(session([user("old", "x")], false), "r", NEW_CURSOR).done).toBe(false);
  });

  it("passes on an error notice", () => {
    const notice: Block = { id: "e", role: "system", text: "Usage limit reached", notice: "error" };
    const step = replyProgress(session([user("u", "r"), notice], false), "r", {
      ...NEW_CURSOR,
      sawBusy: true,
    });
    expect(step).toMatchObject({ content: "⚠ Usage limit reached", done: true });
  });
});

import { describe, expect, it } from "vitest";
import { zenChatGroups, zenChats, zenChatSources, type ZenChat } from "./zenRecent";

const chat = (id: string, cwd: string, updatedAt: number): ZenChat => ({
  id,
  cwd,
  title: id,
  harness: "codex",
  model: "",
  updatedAt,
});

describe("Zen's recent chats (L-230)", () => {
  it("one entry per chat, newest activity first", () => {
    const chats = zenChats([
      { ...chat("a", "/p", 10), title: "old" },
      { ...chat("b", "/p", 20) },
      { ...chat("a", "/p", 30), title: "new" },
    ]);
    expect(chats.map((each) => each.id)).toEqual(["a", "b"]);
    expect(chats[0]!.title).toBe("new");
  });

  it("a chat any source hides stays out", () => {
    const chats = zenChats([
      chat("a", "/p", 10),
      { ...chat("a", "/p", 5), hidden: true },
      chat("b", "/p", 1),
    ]);
    expect(chats.map((each) => each.id)).toEqual(["b"]);
  });

  it("working wins over waiting, from any source", () => {
    const [only] = zenChats([
      { ...chat("a", "/p", 10), status: "waiting" },
      { ...chat("a", "/p", 0), status: "working" },
    ]);
    expect(only!.status).toBe("working");
  });

  it("keeps an account from an older source", () => {
    const [only] = zenChats([
      { ...chat("a", "/p", 0), providerAccountId: "acct" },
      chat("a", "/p", 10),
    ]);
    expect(only!.providerAccountId).toBe("acct");
  });

  it("groups by project, projects by their newest chat, Other last", () => {
    const groups = zenChatGroups([
      chat("a", "/one", 50),
      chat("x", "", 45),
      chat("b", "/two", 40),
      chat("c", "/one", 30),
      chat("y", "~", 20),
    ]);
    expect(groups.map((group) => group.cwd)).toEqual(["/one", "/two", null]);
    expect(groups[0]!.chats.map((each) => each.id)).toEqual(["a", "c"]);
    expect(groups[2]!.chats.map((each) => each.id)).toEqual(["x", "y"]);
  });

  it("hides workers, hidden and archived chats, automations, Monos and hidden runs", () => {
    const saved = (id: string, extra: object = {}) => ({
      ...chat(id, "/p", 10),
      ...extra,
    });
    const chats = zenChats(
      zenChatSources({
        history: [
          saved("keep"),
          saved("hidden", { sidebarHidden: true }),
          saved("worker", { orchestrationLeadId: "lead" }),
          saved("archived", { archived: true }),
          saved("auto", { automationId: "a1" }),
          saved("mono"),
        ],
        sessions: [
          { ...chat("open", "/p", 0) },
          { ...chat("blank", "/p", 0) },
          { ...chat("auto-open", "/p", 0), automationId: "a1" },
        ],
        cards: [
          {
            ...chat("run", "/p", 20),
            sessionId: "run",
            runId: "r1",
            hiddenRunId: "r1",
            waiting: true,
          },
          {
            ...chat("ask", "/p", 30),
            sessionId: "ask",
            runId: "r2",
            waiting: true,
          },
          {
            ...chat("auto-card", "/p", 40),
            sessionId: "auto-card",
            runId: "r3",
            waiting: true,
            automation: true,
          },
        ],
        working: new Set(["open"]),
        listed: (session) => session.id !== "blank",
        hiddenId: (id) => id === "mono",
      }),
    );
    expect(chats.map((each) => [each.id, each.status])).toEqual([
      ["ask", "waiting"],
      ["keep", undefined],
      ["open", "working"],
    ]);
  });
});

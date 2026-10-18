import { afterEach, describe, expect, it, vi } from "vitest";
import {
  HISTORY_PAGE_ITEMS,
  historyBlocks,
  isHistoryBlock,
  NativeHistoryStore,
  parseProviderHistory,
  reconcileNativeHistory,
  saveClaudeComposerSeed,
  seedClaudeComposerFromHistory,
  trimHistoryBefore,
  visibleHistoryItems,
  withHistory,
  type HistoryLoader,
} from "./history";
import {
  newSession,
  type Block,
  type Session,
} from "../../sessions/model/session";
import {
  resetHarnessModelOverlays,
  setHarnessModels,
} from "../../sessions/model/models";

afterEach(() => resetHarnessModelOverlays());

const jsonl = (...rows: unknown[]): string => rows.map((row) => JSON.stringify(row)).join("\n") + "\n";

const claudeFixture = jsonl(
  { type: "summary", summary: "ignored" },
  { type: "user", timestamp: "2026-10-04T00:00:00Z", message: { role: "user", content: "How do I add a route?" } },
  { type: "assistant", timestamp: "2026-10-04T00:00:05Z", message: { role: "assistant", content: [
    { type: "thinking", thinking: "hidden" },
    { type: "text", text: "Use the router." },
    { type: "tool_use", name: "Edit", input: { file_path: "a.ts" } },
  ] } },
  { type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "SECRET OUTPUT" }] } },
  { type: "user", isMeta: true, message: { role: "user", content: "meta" } },
  { type: "user", isSidechain: true, message: { role: "user", content: "subagent" } },
  { type: "user", message: { role: "user", content: "<command-name>/clear</command-name>" } },
  { type: "user", message: { role: "user", content: [{ type: "text", text: "Thanks" }] } },
);

const codexFixture = jsonl(
  { type: "session_meta", payload: { id: "x" } },
  { type: "response_item", payload: { type: "message", role: "developer", content: [{ type: "input_text", text: "dev instructions" }] } },
  { type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "<environment_context>cwd</environment_context>" }] } },
  { type: "response_item", timestamp: "2026-10-04T00:00:00Z", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "Fix the bug" }] } },
  { type: "response_item", payload: { type: "reasoning", summary: [] } },
  { type: "response_item", payload: { type: "function_call", name: "shell", arguments: "{}" } },
  { type: "response_item", payload: { type: "function_call_output", output: "SECRET" } },
  { type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "Fixed." }] } },
  "not json",
);

describe("parseProviderHistory", () => {
  it("keeps Claude user text, assistant text and tool names only", () => {
    const items = parseProviderHistory("claude", claudeFixture, "0");
    expect(items.map((i) => [i.role, i.text])).toEqual([
      ["user", "How do I add a route?"],
      ["assistant", "Use the router."],
      ["tool", "Edit"],
      ["user", "Thanks"],
    ]);
    expect(items[0].at).toBe(Date.parse("2026-10-04T00:00:00Z"));
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
    expect(JSON.stringify(items)).not.toContain("SECRET");
  });

  it("keeps only the bound Claude session and attaches explicit assistant model settings", () => {
    const items = parseProviderHistory(
      "claude",
      jsonl(
        {
          type: "assistant",
          sessionId: "other-session",
          message: { model: "claude-opus-4-5", content: "Wrong session" },
        },
        {
          type: "assistant",
          sessionId: "native-session",
          message: {
            model: "claude-sonnet-4-5",
            modelSettings: { effort: "high" },
            content: [
              {
                type: "tool_use",
                name: "Task",
                input: { model: "nested-helper-model", effort: "max" },
              },
              { type: "text", text: "The root assistant replied." },
            ],
          },
        },
        {
          type: "assistant",
          sessionId: "native-session",
          isSidechain: true,
          message: { model: "claude-opus-4-5", content: "Helper reply" },
        },
        {
          type: "assistant",
          sessionId: "native-session",
          message: {
            model: "claude-opus-4-5",
            effort: "invented",
            content: "An unsupported effort is not shown.",
          },
        },
      ),
      "0",
      "native-session",
    );
    expect(items.map((item) => item.text)).toEqual([
      "The root assistant replied.",
      "Task",
      "An unsupported effort is not shown.",
    ]);
    expect(items[0]?.turnModel).toMatchObject({
      harness: "claude",
      id: "claude-sonnet-4-5",
      settings: { effort: "high" },
    });
    const blocks = historyBlocks(items);
    expect(blocks[0]?.turnModel?.id).toBe("claude-sonnet-4-5");
    expect(items[2]?.turnModel).toMatchObject({
      harness: "claude",
      id: "claude-opus-4-5",
    });
    expect(items[2]?.turnModel).not.toHaveProperty("settings");
    expect(JSON.stringify(items)).not.toContain("nested-helper-model");
  });

  it("hides Claude Code's auto-compaction summary, flagged or matched by text", () => {
    const summary =
      "This session is being continued from a previous conversation that ran out of context. Summary: ...";
    const items = parseProviderHistory(
      "claude",
      jsonl(
        { type: "user", message: { role: "user", content: "Before" } },
        { type: "user", isCompactSummary: true, message: { role: "user", content: "Flagged summary" } },
        { type: "user", message: { role: "user", content: summary } },
        { type: "user", message: { role: "user", content: [{ type: "text", text: summary }] } },
        { type: "user", message: { role: "user", content: "After" } },
      ),
      "0",
    );
    expect(items.map((item) => item.text)).toEqual(["Before", "After"]);
  });

  it("keeps Codex messages and tool names, skipping injected context and reasoning", () => {
    const items = parseProviderHistory("codex", codexFixture as string, "7");
    expect(items.map((i) => [i.role, i.text])).toEqual([
      ["user", "Fix the bug"],
      ["tool", "shell"],
      ["assistant", "Fixed."],
    ]);
    expect(items[0].id.startsWith("history:7:")).toBe(true);
  });

  it("survives torn lines, empty input and unknown shapes", () => {
    expect(parseProviderHistory("claude", "", "0")).toEqual([]);
    expect(parseProviderHistory("claude", '{"type":"user"\n[1,2]\n{"type":"assistant","message":5}\n', "0")).toEqual([]);
  });

  it("caps very large messages", () => {
    const big = "x".repeat(50_000);
    const [item] = parseProviderHistory("claude", jsonl({ type: "user", message: { content: big } }), "0");
    expect(item.text.length).toBeLessThan(20_100);
    expect(item.text.endsWith("[truncated]")).toBe(true);
  });
});

describe("seedClaudeComposerFromHistory", () => {
  it("uses known native model metadata for a new blank chat without rewriting history", () => {
    setHarnessModels("claude", [
      {
        id: "claude:opus-4.5",
        harness: "claude",
        name: "Opus 4.5",
        nativeId: "claude-opus-4-5",
        settings: [
          {
            id: "effort",
            label: "Reasoning",
            kind: "select",
            value: "high",
            options: [
              { value: "low", label: "Low" },
              { value: "high", label: "High" },
            ],
          },
        ],
      },
    ]);
    const session = newSession("claude", "/repo", "claude:sonnet-5");
    const items = parseProviderHistory(
      "claude",
      jsonl({
        type: "assistant",
        message: {
          model: "claude-opus-4-5",
          modelSettings: { effort: "high" },
          content: "Native answer",
        },
      }),
      "0",
    );
    const seeded = seedClaudeComposerFromHistory(session, items);
    expect(seeded.model).toBe("claude:opus-4.5");
    expect(seeded.modelSettings).toMatchObject({ effort: "high" });
    expect(seeded.blocks).toBe(session.blocks);
    expect(items[0].turnModel?.settings).toEqual({ effort: "high" });
  });

  it("keeps history effort metadata when no loaded catalog supports composer effort", () => {
    const session = newSession("claude", "/repo", "claude:sonnet-5");
    const items = parseProviderHistory(
      "claude",
      jsonl({
        type: "assistant",
        message: {
          model: "claude-opus-4-5",
          effort: "high",
          content: "Native answer",
        },
      }),
      "0",
    );

    const seeded = seedClaudeComposerFromHistory(session, items);
    expect(seeded.model).toBe("claude:opus-4.5");
    expect(seeded.modelSettings?.effort).toBeUndefined();
    expect(items[0].turnModel?.settings).toEqual({ effort: "high" });
  });

  it("uses the latest trusted model from a tool-only assistant record", () => {
    const session = newSession("claude", "/repo", "claude:sonnet-5");
    const items = parseProviderHistory(
      "claude",
      jsonl({
        type: "assistant",
        sessionId: "native-session",
        message: {
          model: "claude-opus-4-5",
          content: [{ type: "tool_use", name: "Read", input: {} }],
        },
      }),
      "0",
      "native-session",
    );
    expect(items).toMatchObject([
      { role: "tool", text: "Read", turnModel: { id: "claude-opus-4-5" } },
    ]);
    expect(seedClaudeComposerFromHistory(session, items).model).toBe(
      "claude:opus-4.5",
    );
  });

  it("retries both async saves from the latest session controls", async () => {
    setHarnessModels("claude", [
      {
        id: "claude:opus-4.5",
        harness: "claude",
        name: "Opus 4.5",
        nativeId: "claude-opus-4-5",
        settings: [
          {
            id: "effort",
            label: "Reasoning",
            kind: "select",
            value: "high",
            options: [
              { value: "low", label: "Low" },
              { value: "high", label: "High" },
            ],
          },
        ],
      },
    ]);
    const captured = newSession("claude", "/repo", "claude:sonnet-5");
    const seeded = seedClaudeComposerFromHistory(
      captured,
      parseProviderHistory(
        "claude",
        jsonl({
          type: "assistant",
          message: {
            model: "claude-opus-4-5",
            modelSettings: { effort: "high" },
            content: "Native answer",
          },
        }),
        "0",
      ),
    );
    let latest: Session | undefined = captured;
    const applied: Session[] = [];
    const saves: Array<{
      session: Session;
      resolve: (saved: boolean) => void;
    }> = [];
    const operation = saveClaudeComposerSeed(seeded, {
      getLatest: () => latest,
      isAvailable: () => true,
      isSameNativeSession: (session) =>
        session.id === captured.id &&
        session.harness === captured.harness &&
        session.cwd === captured.cwd,
      canSeed: (session) =>
        session.model === captured.model &&
        JSON.stringify(session.modelSettings) ===
          JSON.stringify(captured.modelSettings) &&
        !session.busy &&
        !session.externalTurnId &&
        !session.blocks.some((block) => block.role === "user"),
      save: (session) =>
        new Promise((resolve) => saves.push({ session, resolve })),
      apply: (session) => applied.push(session),
    });

    await vi.waitFor(() => expect(saves).toHaveLength(1));
    latest = {
      ...latest!,
      runtimeMode: "auto-accept-edits",
      title: "Changed during the first save",
    };
    saves[0].resolve(true);

    await vi.waitFor(() => expect(saves).toHaveLength(2));
    latest = {
      ...latest!,
      remoteControlStatus: "on",
      workspaceMode: "worktree",
      worktreeCwd: "/repo/.worktrees/native",
    };
    saves[1].resolve(true);

    await vi.waitFor(() => expect(saves).toHaveLength(3));
    expect(saves[2].session).toMatchObject({
      model: "claude:opus-4.5",
      modelSettings: { effort: "high" },
      runtimeMode: "auto-accept-edits",
      title: "Changed during the first save",
      remoteControlStatus: "on",
      workspaceMode: "worktree",
      worktreeCwd: "/repo/.worktrees/native",
    });
    saves[2].resolve(true);

    const result = await operation;
    expect(result.kind).toBe("saved");
    expect(applied).toHaveLength(1);
    if (result.kind === "saved") {
      expect(result.session.runtimeMode).toBe("auto-accept-edits");
      expect(result.session.remoteControlStatus).toBe("on");
      expect(result.session.worktreeCwd).toBe("/repo/.worktrees/native");
      expect(applied[0]).toMatchObject({
        runtimeMode: "auto-accept-edits",
        remoteControlStatus: "on",
        worktreeCwd: "/repo/.worktrees/native",
      });
    }
  });

  it("does not apply a seed after close, a newer choice, or a save error", async () => {
    const captured = newSession("claude", "/repo", "claude:sonnet-5");
    const seeded = { ...captured, model: "claude:opus-4.5" };
    const makeDependencies = (
      getLatest: () => Session | undefined,
      isAvailable: () => boolean,
      save: (session: Session) => Promise<boolean>,
      applied: Session[],
    ) => ({
      getLatest,
      isAvailable,
      isSameNativeSession: (session: Session) =>
        session.id === captured.id && session.harness === captured.harness,
      canSeed: (session: Session) => session.model === captured.model,
      save,
      apply: (session: Session) => applied.push(session),
    });

    let closedLatest: Session | undefined = captured;
    let open = true;
    const afterClose: Session[] = [];
    const closed = await saveClaudeComposerSeed(
      seeded,
      makeDependencies(
        () => closedLatest,
        () => open,
        async () => {
          closedLatest = undefined;
          open = false;
          return true;
        },
        afterClose,
      ),
    );
    expect(closed.kind).toBe("skipped");
    expect(afterClose).toEqual([]);

    let changedLatest: Session | undefined = captured;
    const afterChoice: Session[] = [];
    let writes = 0;
    const changedChoice = await saveClaudeComposerSeed(
      seeded,
      makeDependencies(
        () => changedLatest,
        () => true,
        async (session) => {
          writes++;
          if (writes === 1)
            changedLatest = { ...session, model: "claude:haiku-4.5" };
          return true;
        },
        afterChoice,
      ),
    );
    expect(changedChoice.kind).toBe("skipped");
    expect(writes).toBe(2);
    expect(afterChoice).toEqual([]);

    let changingLatest: Session | undefined = captured;
    const afterExhaustion: Session[] = [];
    let changingWrites = 0;
    const exhausted = await saveClaudeComposerSeed(seeded, {
      ...makeDependencies(
        () => changingLatest,
        () => true,
        async (session) => {
          changingWrites++;
          changingLatest = {
            ...session,
            title: `Changed during write ${changingWrites}`,
          };
          return true;
        },
        afterExhaustion,
      ),
      maxAttempts: 1,
    });
    expect(exhausted.kind).toBe("error");
    expect(changingWrites).toBe(2);
    expect(afterExhaustion).toEqual([]);

    const afterError: Session[] = [];
    const failed = await saveClaudeComposerSeed(
      seeded,
      makeDependencies(
        () => captured,
        () => true,
        async () => {
          throw new Error("storage unavailable");
        },
        afterError,
      ),
    );
    expect(failed.kind).toBe("error");
    expect(afterError).toEqual([]);
  });

  it("does not replace a user's selected composer after a turn exists", () => {
    const session = newSession("claude", "/repo", "claude:sonnet-5");
    session.blocks = [{ id: "user", role: "user", text: "My own turn" }];
    const seeded = seedClaudeComposerFromHistory(session, [
      {
        id: "history:assistant",
        role: "assistant",
        text: "Native answer",
        turnModel: {
          harness: "claude",
          id: "claude-opus-4-5",
          name: "Opus 4.5",
        },
      },
    ]);
    expect(seeded).toBe(session);
    expect(seeded.model).toBe("claude:sonnet-5");
  });
});

describe("trimHistoryBefore", () => {
  it("trims a saved phone turn and its undated suffix by native UUID despite receive-time skew", () => {
    const items = parseProviderHistory("claude", jsonl(
      { type: "user", uuid: "old", message: { content: "Earlier prompt" } },
      { type: "assistant", message: { content: "Earlier reply" } },
      { type: "user", uuid: "phone", timestamp: "2026-10-04T00:00:00Z", message: { content: "Phone prompt" } },
      { type: "assistant", message: { content: "Phone reply" } },
    ), "0");
    const receiveTime = Date.parse("2026-10-04T00:00:02Z");
    expect(trimHistoryBefore(items, receiveTime, new Set(["phone"])).map((item) => item.text))
      .toEqual(["Earlier prompt", "Earlier reply"]);
    expect(trimHistoryBefore(items, undefined, new Set(["old"]))).toEqual([]);
    expect(trimHistoryBefore(items, undefined, new Set(["missing"]))).toEqual(items);
  });
  it("drops items MonoCode already holds as its own turns", () => {
    const items = parseProviderHistory("claude", claudeFixture, "0");
    const cutoff = Date.parse("2026-10-04T00:00:03Z");
    expect(trimHistoryBefore(items, cutoff).map((i) => i.text)).toEqual(["How do I add a route?", "Thanks"]);
    expect(trimHistoryBefore(items, undefined)).toHaveLength(items.length);
  });
});

describe("display blocks", () => {
  it("interleaves external follow-ups between and after local turns without summary transfer", () => {
    const base = Date.parse("2026-10-06T00:00:00Z");
    const local: Block[] = [
      { id: "u1", role: "user", text: "Local one", startedAt: base + 10_000, durationMs: 5_000 },
      { id: "a1", role: "assistant", text: "Rich local one" },
      { id: "u2", role: "user", text: "Local two", startedAt: base + 40_000, durationMs: 5_000 },
      { id: "a2", role: "assistant", text: "Rich local two" },
    ];
    const items = [
      { id: "history:old", role: "user" as const, text: "Original", at: base },
      { id: "history:own1", role: "user" as const, text: "Local one", at: base + 11_000 },
      { id: "history:reply1", role: "assistant" as const, text: "Native duplicate one" },
      { id: "history:external", role: "user" as const, text: "Desktop follow-up", at: base + 25_000 },
      { id: "history:answer", role: "assistant" as const, text: "Desktop answer" },
      { id: "history:own2", role: "user" as const, text: "Local two", at: base + 41_000 },
      { id: "history:reply2", role: "assistant" as const, text: "Native duplicate two" },
      { id: "history:latest", role: "user" as const, text: "Latest external", at: base + 55_000 },
    ];
    const shown = reconcileNativeHistory(items, local);
    expect(shown.map((block) => block.text)).toEqual([
      "Original", "Local one", "Rich local one", "Desktop follow-up", "Desktop answer", "Local two", "Rich local two", "Latest external",
    ]);
    expect(local).toHaveLength(4);
    expect(local.some(isHistoryBlock)).toBe(false);
    expect(shown.find((block) => block.id === "a1")).toBe(local[1]);
  });

  it("does not confuse two different prompts near the same timestamp, or repeated text days apart", () => {
    const local: Block[] = [{ id: "u", role: "user", text: "Continue", startedAt: 100_000, durationMs: 1000 }];
    const shown = reconcileNativeHistory([
      { id: "history:1", role: "user", text: "Different phone prompt", at: 102_000 },
      { id: "history:2", role: "user", text: "Continue", at: 200_000 },
    ], local);
    expect(shown.filter((block) => block.role === "user").map((block) => block.text)).toEqual(["Continue", "Different phone prompt", "Continue"]);
  });

  it("does not repeat an Interactive prompt that Claude stored as a folded paste with attachments", () => {
    const sent = "This is just not usable?\nLast time it failed.";
    const native =
      `T\n\n<pasted_content id="fa8f">\nhis is just not usable?\nLast time it failed.\n\n` +
      `Read these attached files using your tools:\n"image.png": "C:\\\\a.png"\n</pasted_content id="fa8f">\n`;
    const items = parseProviderHistory("claude", jsonl(
      { type: "user", uuid: "u1", timestamp: new Date(104_600).toISOString(), message: { role: "user", content: native } },
      { type: "assistant", uuid: "a1", timestamp: new Date(110_000).toISOString(), message: { role: "assistant", content: [{ type: "text", text: "Native copy of the reply" }] } },
    ), "0");
    expect(items[0].text).toBe(`${sent}\n\nRead these attached files using your tools:\n"image.png": "C:\\\\a.png"`);
    const local: Block[] = [
      { id: "u", role: "user", text: sent, startedAt: 100_000, durationMs: 100_000 },
      { id: "r", role: "assistant", text: "Saved reply" },
    ];
    expect(reconcileNativeHistory(items, local)).toBe(local);
  });

  it("deduplicates phone turns by native identity even without timestamps", () => {
    const local: Block[] = [{ id: "phone", role: "user", text: "Phone prompt", providerMessageId: "uuid" }, { id: "reply", role: "assistant", text: "Saved phone reply" }];
    const shown = reconcileNativeHistory([
      { id: "history:1", role: "user", text: "Phone prompt", nativeId: "uuid" },
      { id: "history:2", role: "assistant", text: "Duplicate reply" },
      { id: "history:3", role: "user", text: "Later external prompt" },
    ], local);
    expect(shown.map((block) => block.text)).toEqual(["Phone prompt", "Saved phone reply", "Later external prompt"]);
  });

  it("never matches an unsent draft to a native turn", () => {
    const local: Block[] = [{ id: "draft", role: "user", text: "Same text", startedAt: 1000, draft: true }];
    const shown = reconcileNativeHistory([{ id: "history:1", role: "user", text: "Same text", at: 1000 }], local);
    expect(shown.filter((block) => block.role === "user")).toHaveLength(2);
  });

  it("keeps a second identical prompt within the same second once the local turn is matched", () => {
    const local: Block[] = [{ id: "u", role: "user", text: "Continue", startedAt: 1000, durationMs: 1000 }];
    const shown = reconcileNativeHistory([
      { id: "history:own", role: "user", text: "Continue", at: 1001 },
      { id: "history:second", role: "user", text: "Continue", at: 1500 },
    ], local);
    expect(shown.filter((block) => block.role === "user").map((block) => block.id)).toEqual(["u", "history:second"]);
  });

  it("keeps an Operator turn only once when native history includes the production instruction suffix", () => {
    const local: Block[] = [
      { id: "operator", role: "user", text: "/operator Check the task", startedAt: 1000, durationMs: 1000, monocode: true },
      { id: "answer", role: "assistant", text: "Local answer" },
    ];
    const shown = reconcileNativeHistory([
      { id: "history:own", role: "user", text: "Check the task\n\n<monocode_app>\nOperator instructions\n</monocode_app>", at: 1100 },
      { id: "history:answer", role: "assistant", text: "Duplicate native answer" },
      { id: "history:other", role: "user", text: "Check another task", at: 2100 },
    ], local);
    expect(shown.map((block) => block.text)).toEqual(["/operator Check the task", "Local answer", "Check another task"]);
  });

  it("builds every native content block without a manufactured history notice", () => {
    const items = parseProviderHistory("claude", claudeFixture, "0");
    const blocks = historyBlocks(items);
    expect(blocks.every(isHistoryBlock)).toBe(true);
    expect(blocks.find((b) => b.role === "tool")?.tool?.status).toBe("completed");
    expect(blocks.map((block) => block.text)).toEqual(items.map((item) => item.text));
    expect(blocks.some((block) => block.role === "system")).toBe(false);
    expect(historyBlocks([])).toEqual([]);
  });

  it("keeps each new local reply last when native history is reconciled again", () => {
    const items: HistoryItem[] = [
      { id: "history:old-user", role: "user", text: "Earlier question", at: 1000 },
      { id: "history:old-answer", role: "assistant", text: "Earlier answer", at: 2000 },
    ];
    const local: Block[] = [
      { id: "user", role: "user", text: "Continue", startedAt: 10000 },
      { id: "answer", role: "assistant", text: "New reply" },
    ];
    expect(reconcileNativeHistory(items, [])).toEqual(historyBlocks(items));
    expect(reconcileNativeHistory(items, local).at(-1)).toBe(local[1]);
    const next: Block[] = [...local,
      { id: "next-user", role: "user", text: "Continue again", startedAt: 20000 },
      { id: "next-answer", role: "assistant", text: "Latest reply" },
    ];
    const shown = reconcileNativeHistory(items, next);
    expect(shown.map((block) => block.text)).toEqual([
      "Earlier question", "Earlier answer", "Continue", "New reply", "Continue again", "Latest reply",
    ]);
    expect(shown.at(-1)).toBe(next.at(-1));
    expect(shown.some((block) => block.role === "system")).toBe(false);
    expect(local).toHaveLength(2);
  });

  it("puts history above session blocks without mutating the session", () => {
    const session = newSession("claude", "/work", "m");
    session.blocks = [{ id: "real-1", role: "user", text: "new turn" }];
    const history = historyBlocks(parseProviderHistory("claude", claudeFixture, "0"));
    const shown = withHistory(history, session.blocks);
    expect(shown.at(-1)?.id).toBe("real-1");
    expect(session.blocks).toHaveLength(1);
    expect(session.blocks.some(isHistoryBlock)).toBe(false);
    expect(withHistory([], session.blocks)).toBe(session.blocks);
  });
});

function loaderFor(chunks: Record<number, { text: string; start: number; hasEarlier: boolean }>, bound = true): HistoryLoader & { reads: number[] } {
  const reads: number[] = [];
  return {
    reads,
    source: async () => (bound ? { key: "k" } : null),
    read: async ({ end }) => {
      reads.push(end ?? -1);
      const chunk = chunks[end ?? -1];
      if (!chunk) throw new Error("file moved");
      return chunk;
    },
  };
}

describe("NativeHistoryStore", () => {
  it("ignores an older read after explicit reopen starts a new history request", async () => {
    let finishOld: (chunk: { text: string; start: number; hasEarlier: boolean }) => void = () => undefined;
    let reads = 0;
    const store = new NativeHistoryStore({
      source: async () => ({ key: "k" }),
      read: async () => ++reads === 1 ? new Promise((resolve) => { finishOld = resolve; }) : ({ text: jsonl({ type: "user", message: { content: "Fresh" } }), start: 0, hasEarlier: false }),
    });
    const old = store.ensureLoaded("s", "claude", "default");
    await Promise.resolve();
    store.forget("s");
    await store.ensureLoaded("s", "claude", "default");
    finishOld({ text: jsonl({ type: "user", message: { content: "Stale" } }), start: 0, hasEarlier: false });
    await old;
    expect(visibleHistoryItems(store.get("s")).map((item) => item.text)).toEqual(["Fresh"]);
  });
  it("loads once per session, read-only, and exposes parsed items", async () => {
    const loader = loaderFor({ [-1]: { text: claudeFixture, start: 100, hasEarlier: false } });
    const store = new NativeHistoryStore(loader);
    await store.ensureLoaded("s1", "claude", "default");
    await store.ensureLoaded("s1", "claude", "default");
    expect(loader.reads).toEqual([-1]);
    const state = store.get("s1");
    expect(state.status).toBe("ready");
    expect(visibleHistoryItems(state)).toHaveLength(4);
  });

  it("shows nothing for chats without a native binding or for other providers", async () => {
    const loader = loaderFor({}, false);
    const store = new NativeHistoryStore(loader);
    await store.ensureLoaded("s1", "claude", "default");
    expect(store.get("s1").status).toBe("none");
    await store.ensureLoaded("s2", "cursor", "default");
    expect(store.get("s2").status).toBe("none");
    expect(loader.reads).toEqual([]);
  });

  it("reports why history is unavailable and can retry", async () => {
    const loader = loaderFor({});
    const store = new NativeHistoryStore(loader);
    await store.ensureLoaded("s1", "codex", "default");
    expect(store.get("s1")).toMatchObject({ status: "error", message: "file moved" });
    await store.ensureLoaded("s1", "codex", "default");
    expect(loader.reads).toEqual([-1]);
    await store.ensureLoaded("s1", "codex", "default", true);
    expect(loader.reads).toEqual([-1, -1]);
  });

  it("reveals parsed items in steps, then pages an earlier file chunk", async () => {
    const many = jsonl(...Array.from({ length: HISTORY_PAGE_ITEMS + 50 }, (_, i) => ({ type: "user", message: { content: `m${i}` } })));
    const loader = loaderFor({
      [-1]: { text: many, start: 500, hasEarlier: true },
      500: { text: jsonl({ type: "user", message: { content: "oldest" } }), start: 0, hasEarlier: false },
    });
    const store = new NativeHistoryStore(loader);
    await store.ensureLoaded("s1", "claude", "default");
    expect(visibleHistoryItems(store.get("s1"))).toHaveLength(HISTORY_PAGE_ITEMS);
    await store.showEarlier("s1");
    expect(visibleHistoryItems(store.get("s1"))).toHaveLength(HISTORY_PAGE_ITEMS + 50);
    expect(loader.reads).toEqual([-1]);
    await store.showEarlier("s1");
    expect(loader.reads).toEqual([-1, 500]);
    const state = store.get("s1");
    expect(state).toMatchObject({ status: "ready", hasEarlier: false });
    expect(visibleHistoryItems(state)[0].text).toBe("oldest");
  });

  it("keeps loaded history when an earlier chunk fails", async () => {
    const loader = loaderFor({ [-1]: { text: claudeFixture, start: 9, hasEarlier: true } });
    const store = new NativeHistoryStore(loader);
    await store.ensureLoaded("s1", "claude", "default");
    await store.showEarlier("s1");
    const state = store.get("s1");
    expect(state).toMatchObject({ status: "ready", earlierError: "file moved", loadingEarlier: false });
    expect(visibleHistoryItems(state)).toHaveLength(4);
  });

  it("drops a deleted chat and ignores a read that finishes afterwards", async () => {
    let finish: (chunk: { text: string; start: number; hasEarlier: boolean }) => void = () => undefined;
    const store = new NativeHistoryStore({
      source: async () => ({ key: "k" }),
      read: () => new Promise((resolve) => { finish = resolve; }),
    });
    const pending = store.ensureLoaded("s1", "claude", "default");
    await Promise.resolve();
    await Promise.resolve();
    store.forget("s1");
    finish({ text: claudeFixture, start: 0, hasEarlier: false });
    await pending;
    expect(store.get("s1").status).toBe("none");
  });
});

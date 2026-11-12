import { beforeEach, describe, expect, it, vi } from "vitest";

const sent: string[] = [];
let onLine: ((line: string) => void) | undefined;

vi.mock("../../core/child", () => ({
  resolveCommandCodeBinary: async () => ({ path: "/fake/cmdc" }),
  spawnChild: async () => undefined,
  killChild: async () => undefined,
  unwatchChild: () => undefined,
  watchChild: (_id: string, line: (value: string) => void) => {
    onLine = line;
  },
  writeChild: async (_id: string, line: string) => {
    sent.push(line);
  },
}));

const { sendCommandCodeTurn, stopCommandCodeSession } = await import("./commandCode");
import type { HarnessEvent } from "../../core/types";

type Sent = {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
};

const parse = (): Sent[] => sent.map((line) => JSON.parse(line) as Sent);
const requests = (method: string) => parse().filter((message) => message.method === method);

function reply(id: number | undefined, result: unknown) {
  onLine!(JSON.stringify({ jsonrpc: "2.0", id, result }));
}

function replyError(id: number | undefined, message: string) {
  onLine!(JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32602, message } }));
}

function notify(update: Record<string, unknown>) {
  onLine!(
    JSON.stringify({
      jsonrpc: "2.0",
      method: "session/update",
      params: { sessionId: "cc-1", update },
    }),
  );
}

async function waitFor(predicate: () => boolean, label: string) {
  for (let index = 0; index < 200; index += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(
    `timed out waiting for ${label}; sent=${JSON.stringify(parse().map((message) => message.method ?? `reply:${message.id}`))}`,
  );
}

async function next(method: string, count = 1): Promise<Sent> {
  await waitFor(() => requests(method).length >= count, method);
  return requests(method)[count - 1]!;
}

async function start() {
  reply((await next("initialize")).id, { protocolVersion: 1 });
  reply((await next("session/new")).id, {
    sessionId: "cc-1",
    modes: { currentModeId: "default" },
    models: { currentModelId: "stealth/glyph-cluster:free" },
    configOptions: [
      {
        id: "effort",
        type: "select",
        currentValue: "low",
        options: [{ value: "low" }, { value: "medium" }, { value: "high" }],
      },
    ],
  });
}

describe("Command Code live ACP sequence", () => {
  beforeEach(() => {
    sent.length = 0;
    onLine = undefined;
  });

  it("selects model, effort and mode, then streams the reply", async () => {
    const events: HarnessEvent[] = [];
    const turn = sendCommandCodeTurn({
      sessionId: "cc-live-new",
      cwd: "/repo",
      model: "command-code:claude-sonnet-5-5",
      modelSettings: { effort: "high" },
      runtimeMode: "auto-accept-edits",
      text: "inspect this",
      onEvent: (event) => events.push(event),
    });
    await start();

    const setModel = await next("session/set_model");
    expect(setModel.params).toEqual({ sessionId: "cc-1", modelId: "claude-sonnet-5-5" });
    reply(setModel.id, {});

    const setEffort = await next("session/set_config_option");
    expect(setEffort.params).toEqual({ sessionId: "cc-1", configId: "effort", value: "high" });
    reply(setEffort.id, {});

    const setMode = await next("session/set_mode");
    expect(setMode.params?.modeId).toBe("auto-accept");
    reply(setMode.id, {});

    const prompt = await next("session/prompt");
    expect(prompt.params?.prompt).toEqual([{ type: "text", text: "inspect this" }]);
    notify({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "pong" } });
    reply(prompt.id, { stopReason: "end_turn" });
    await turn;

    expect(events).toContainEqual({ type: "session.providerBound", providerSessionId: "cc-1" });
    expect(events.some((event) => event.type === "message.delta")).toBe(true);
    expect(events).toContainEqual({ type: "message.completed" });
    await stopCommandCodeSession("cc-live-new");
  });

  it("keeps the session's model when Command Code rejects a saved one", async () => {
    const events: HarnessEvent[] = [];
    const turn = sendCommandCodeTurn({
      sessionId: "cc-live-stale",
      cwd: "/repo",
      model: "command-code:retired/model",
      // Not offered by this model: skipped instead of failing the turn.
      modelSettings: { effort: "xhigh" },
      runtimeMode: "supervised",
      text: "hi",
      onEvent: (event) => events.push(event),
    });
    await start();

    replyError((await next("session/set_model")).id, "Unknown model");
    const prompt = await next("session/prompt");
    expect(requests("session/set_config_option")).toHaveLength(0);
    // Supervised maps to Command Code's own default mode, so no switch.
    expect(requests("session/set_mode")).toHaveLength(0);
    reply(prompt.id, { stopReason: "end_turn" });
    await turn;

    expect(
      events.some(
        (event) => event.type === "status" && event.text.includes("retired/model"),
      ),
    ).toBe(true);
    await stopCommandCodeSession("cc-live-stale");
  });

  it("runs plan turns in plan mode, denies edits, and stays unbound when ephemeral", async () => {
    const events: HarnessEvent[] = [];
    const turn = sendCommandCodeTurn({
      sessionId: "cc-live-plan",
      cwd: "/repo",
      model: "command-code:default",
      runtimeMode: "full-access",
      intent: "plan",
      ephemeral: true,
      text: "plan it",
      onEvent: (event) => events.push(event),
    });
    await start();

    const setMode = await next("session/set_mode");
    expect(setMode.params?.modeId).toBe("plan");
    reply(setMode.id, {});
    const prompt = await next("session/prompt");
    expect(requests("session/set_model")).toHaveLength(0);

    onLine!(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 900,
        method: "session/request_permission",
        params: {
          sessionId: "cc-1",
          toolCall: { toolCallId: "edit-1", title: "Edit src/a.ts", kind: "edit" },
          options: [
            { optionId: "allow-once", kind: "allow_once", name: "Allow" },
            { optionId: "reject-once", kind: "reject_once", name: "Reject" },
          ],
        },
      }),
    );
    await waitFor(() => parse().some((message) => message.id === 900), "permission reply");
    const answer = parse().find((message) => message.id === 900)!;
    expect(answer.result).toEqual({
      outcome: { outcome: "selected", optionId: "reject-once" },
    });

    reply(prompt.id, { stopReason: "end_turn" });
    await turn;
    expect(events.some((event) => event.type === "session.providerBound")).toBe(false);
    expect(events.some((event) => event.type === "approval.requested")).toBe(false);
    await stopCommandCodeSession("cc-live-plan");
  });
});

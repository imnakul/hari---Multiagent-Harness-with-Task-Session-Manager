import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  newSession,
  type RuntimeMode,
} from "../../../../features/sessions/model/session";
import { applyHarnessEvent } from "../../core/apply";

let onStdout: ((line: string) => void) | undefined;
let onChildExit: ((code: number | null) => void) | undefined;
let onSseEvent: ((event: Record<string, unknown>) => void) | undefined;
let onSseEnd: ((error?: string) => void) | undefined;
let sessionMessages: unknown[] = [];
let mcpStatuses: unknown = {};
let openCodeVersion = "opencode 1.14.19";
/** v2 inbox ids handed out, in order, by the prompt and compact routes. */
let admittedIds: Record<string, string[]> = {};
/** Runs before an admission response returns, as a fast server would. */
let onAdmit: ((path: string, id: string | undefined) => void) | undefined;
let v2SessionDirectory = "/repo";
let v2ForkDirectory: string | undefined;
let v2MoveApplies = true;
let v2ForkFailure: { status: number; body: string } | undefined;
const spawnChild = vi.fn(async () => {
  onStdout?.("opencode server listening on http://127.0.0.1:4096");
});
const killChild = vi.fn(async () => undefined);
const closeHarnessSse = vi.fn(async (_id: string) => undefined);
const harnessHttp = vi.fn(
  async (input: {
    url: string;
    method: string;
    body?: string;
  }): Promise<{ status: number; body: string }> => {
    const url = new URL(input.url);
    if (
      input.method === "GET" &&
      (url.pathname === "/mcp" || url.pathname === "/api/mcp")
    ) {
      return { status: 200, body: JSON.stringify(mcpStatuses) };
    }
    if (input.method === "POST" && url.pathname === "/session") {
      return { status: 200, body: JSON.stringify({ id: "session_1" }) };
    }
    if (input.method === "POST" && url.pathname === "/session/session_1/fork") {
      return { status: 200, body: JSON.stringify({ id: "session_2" }) };
    }
    if (input.method === "GET" && url.pathname === "/session/session_2") {
      return {
        status: 200,
        body: JSON.stringify({ id: "session_2", directory: "/repo" }),
      };
    }
    // v2 reports a session's folder only under `location`.
    const v2Session = (id: string, directory: string) => ({
      status: 200,
      body: JSON.stringify({ data: { id, location: { directory } } }),
    });
    if (input.method === "POST" && url.pathname === "/api/session") {
      return v2Session("session_1", url.searchParams.get("directory") ?? "");
    }
    if (input.method === "GET" && url.pathname === "/api/session/session_1") {
      return v2Session("session_1", v2SessionDirectory);
    }
    if (input.method === "POST" && url.pathname === "/api/session/session_1/fork") {
      if (v2ForkFailure) return v2ForkFailure;
      v2ForkDirectory = v2SessionDirectory;
      return v2Session("session_fork", v2ForkDirectory);
    }
    if (input.method === "POST" && url.pathname === "/api/session/session_fork/move") {
      if (v2MoveApplies) {
        v2ForkDirectory = (JSON.parse(input.body ?? "{}") as { directory: string })
          .directory;
      }
      return { status: 204, body: "" };
    }
    if (input.method === "GET" && url.pathname === "/api/session/session_fork") {
      return v2Session("session_fork", v2ForkDirectory ?? "");
    }
    if (input.method === "GET" && /^\/api\/session\/[^/]+\/message$/.test(url.pathname)) {
      return { status: 200, body: JSON.stringify({ data: sessionMessages }) };
    }
    if (
      (input.method === "POST" && url.pathname === "/session") ||
      (input.method === "GET" && url.pathname === "/session/session_1")
    ) {
      return {
        status: 200,
        body: JSON.stringify({ id: "session_1", directory: "/repo" }),
      };
    }
    if (
      input.method === "GET" &&
      url.pathname === "/session/session_1/message"
    ) {
      return { status: 200, body: JSON.stringify(sessionMessages) };
    }
    const admitted =
      input.method === "POST" ? admittedIds[url.pathname]?.shift() : undefined;
    if (
      input.method === "POST" &&
      /^\/api\/session\/[^/]+\/(?:prompt|compact)$/.test(url.pathname)
    ) {
      onAdmit?.(url.pathname, admitted);
    }
    if (admitted) {
      return { status: 200, body: JSON.stringify({ data: { id: admitted } }) };
    }
    return { status: 204, body: "" };
  },
);

vi.mock("../../core/child", () => ({
  closeHarnessSse,
  execChild: async (_command: string, args: string[]) =>
    args[0] !== "service"
      ? openCodeVersion
      : args[1] === "get"
        ? "secret"
        : "http://127.0.0.1:4096",
  freeHarnessPort: async () => 4096,
  harnessHttp,
  killChild,
  openHarnessSse: async () => undefined,
  resolveOpenCodeBinary: async () => ({ path: "/fake/opencode" }),
  spawnChild,
  unwatchChild: () => undefined,
  watchChild: (
    _id: string,
    stdout: (line: string) => void,
    exit: (code: number | null) => void,
  ) => {
    onStdout = stdout;
    onChildExit = exit;
  },
  watchSse: (
    _id: string,
    event: (data: string) => void,
    end?: (error?: string) => void,
  ) => {
    onSseEvent = (value) => event(JSON.stringify(value));
    onSseEnd = end;
  },
}));

const {
  __openCodeTestReset,
  bindOpenCodeSession,
  cancelOpenCodeTurn,
  forgetOpenCodeSession,
  compactOpenCodeContext,
  respondOpenCodeApproval,
  respondOpenCodeQuestion,
  rewindOpenCodeLastTurn,
  sendOpenCodeTurn,
  stopOpenCodeSession,
} = await import("./opencode");
import type { HarnessEvent } from "../../core/types";
import { NativeForkError, type NativeForkRequest } from "../../core/types";

const waitFor = async (predicate: () => boolean, label: string) => {
  for (let index = 0; index < 200; index += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`timed out waiting for ${label}`);
};

function turn(
  events: HarnessEvent[],
  options: {
    runtimeMode?: RuntimeMode;
    onAccepted?: () => void;
    fork?: NativeForkRequest;
    intent?: "plan";
    sessionId?: string;
    cwd?: string;
    providerAccountId?: string;
    appAccess?: boolean;
  } = {},
) {
  return sendOpenCodeTurn({
    sessionId: options.sessionId ?? "opencode-live",
    fork: options.fork,
    cwd: options.cwd ?? "/repo",
    providerAccountId: options.providerAccountId,
    appAccess: options.appAccess,
    intent: options.intent,
    model: "opencode:openrouter/anthropic/claude-sonnet-4.6",
    runtimeMode: options.runtimeMode ?? "supervised",
    text: "delegate the investigation",
    attachments: [],
    onAccepted: options.onAccepted,
    onEvent: (event) => events.push(event),
  });
}

async function startTurn(events: HarnessEvent[]) {
  const done = turn(events);
  await waitFor(
    () =>
      harnessHttp.mock.calls.some(([input]) =>
        input.url.includes("/prompt_async"),
      ),
    "prompt",
  );
  return { done };
}

function sessionCreated(id: string, parentID?: string) {
  onSseEvent?.({
    type: "session.created",
    properties: { sessionID: id, info: { id, parentID, directory: "/repo" } },
  });
}

function askPermission(sessionID: string, id = "permission_child") {
  onSseEvent?.({
    type: "permission.asked",
    properties: {
      id,
      sessionID,
      permission: "external_directory",
      patterns: ["/home/user/*"],
      metadata: { filepath: "/home/user/.gitconfig" },
      tool: { messageID: "message_child", callID: `call_${id}` },
    },
  });
}

function idle(sessionID = "session_1") {
  onSseEvent?.({
    type: "session.status",
    properties: { sessionID, status: { type: "idle" } },
  });
}

beforeEach(() => {
  onStdout = undefined;
  onChildExit = undefined;
  onSseEvent = undefined;
  onSseEnd = undefined;
  sessionMessages = [];
  mcpStatuses = {};
  openCodeVersion = "opencode 1.14.19";
  admittedIds = {};
  onAdmit = undefined;
  v2SessionDirectory = "/repo";
  v2ForkDirectory = undefined;
  v2MoveApplies = true;
  v2ForkFailure = undefined;
  spawnChild.mockClear();
  killChild.mockClear();
  closeHarnessSse.mockClear();
  harnessHttp.mockClear();
  __openCodeTestReset();
});

afterEach(async () => {
  await stopOpenCodeSession("opencode-live");
  __openCodeTestReset();
});

function askMcp(tool: string, id: string, permission = tool): void {
  const messageID = `message_${id}`;
  const callID = `call_${id}`;
  onSseEvent?.({
    type: "message.part.updated",
    properties: {
      sessionID: "session_1",
      part: {
        id: `part_${id}`,
        type: "tool",
        messageID,
        callID,
        tool,
        state: { status: "running", input: {} },
      },
    },
  });
  onSseEvent?.({
    type: "permission.asked",
    properties: {
      id,
      sessionID: "session_1",
      permission,
      patterns: ["*"],
      tool: { messageID, callID },
    },
  });
}

function approvals(
  events: HarnessEvent[],
): Extract<HarnessEvent, { type: "approval.requested" }>[] {
  return events.filter((event) => event.type === "approval.requested");
}

async function waitReply(id: string): Promise<void> {
  await waitFor(
    () =>
      harnessHttp.mock.calls.some(
        ([input]) => new URL(input.url).pathname === `/permission/${id}/reply`,
      ),
    "permission reply",
  );
}

async function beginNext(
  events: HarnessEvent[],
  options: Parameters<typeof turn>[1] = {},
): Promise<{ done: Promise<void> }> {
  const before = harnessHttp.mock.calls.filter(([input]) =>
    input.url.includes("/prompt_async"),
  ).length;
  const done = turn(events, options);
  await waitFor(
    () =>
      harnessHttp.mock.calls.filter(([input]) =>
        input.url.includes("/prompt_async"),
      ).length > before,
    "next prompt",
  );
  return { done };
}

async function grantMcp(events: HarnessEvent[], id = "first"): Promise<void> {
  askMcp("socraticode_status", id);
  await waitFor(
    () =>
      approvals(events).some(
        (event) => event.serverScope?.serverName === "socraticode",
      ),
    "server action",
  );
  const approval = approvals(events).at(-1)!;
  respondOpenCodeApproval(
    "opencode-live",
    approval.requestId,
    "allow",
    "server",
  );
  await waitReply(id);
}

describe("OpenCode MCP server session approvals", () => {
  beforeEach(() => {
    mcpStatuses = {
      socraticode: { status: "connected" },
      other: { status: "connected" },
    };
  });

  it("deduplicates requests while native server discovery is pending", async () => {
    const events: HarnessEvent[] = [];
    const { done } = await startTurn(events);
    let release:
      ((response: { status: number; body: string }) => void) | undefined;
    harnessHttp.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    askMcp("socraticode_search", "duplicate");
    askMcp("socraticode_search", "duplicate");
    await waitFor(() => release !== undefined, "native discovery");
    release?.({ status: 200, body: JSON.stringify(mcpStatuses) });
    await waitFor(() => approvals(events).length === 1, "single prompt");
    expect(
      harnessHttp.mock.calls.filter(
        ([input]) => new URL(input.url).pathname === "/mcp",
      ),
    ).toHaveLength(1);
    respondOpenCodeApproval(
      "opencode-live",
      approvals(events)[0].requestId,
      "allow",
    );
    await waitReply("duplicate");
    idle();
    await done;
  });

  it("cannot approve or display a request cancelled during native discovery", async () => {
    const events: HarnessEvent[] = [];
    const { done } = await startTurn(events);
    let release:
      ((response: { status: number; body: string }) => void) | undefined;
    harnessHttp.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    askMcp("socraticode_search", "cancelled-lookup");
    await waitFor(() => release !== undefined, "native discovery");
    await cancelOpenCodeTurn("opencode-live");
    release?.({ status: 200, body: JSON.stringify(mcpStatuses) });
    await done;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(approvals(events)).toHaveLength(0);
    expect(
      harnessHttp.mock.calls.some(
        ([input]) =>
          new URL(input.url).pathname === "/permission/cancelled-lookup/reply",
      ),
    ).toBe(false);
  });

  it("retains Allow once when the native server lookup is unavailable", async () => {
    const events: HarnessEvent[] = [];
    const { done } = await startTurn(events);
    harnessHttp.mockResolvedValueOnce({ status: 404, body: "not available" });
    askMcp("socraticode_search", "unavailable-lookup");
    await waitFor(() => approvals(events).length === 1, "ordinary fallback");
    expect(approvals(events)[0].serverScope).toBeUndefined();
    respondOpenCodeApproval(
      "opencode-live",
      approvals(events)[0].requestId,
      "allow",
      "server",
    );
    await waitReply("unavailable-lookup");
    expect(events.some((event) => event.type === "session.error")).toBe(false);
    expect(
      events.filter((event) => event.type === "approval.resolved").at(-1)
        ?.scope,
    ).toBeUndefined();
    idle();
    await done;
  });

  it("allows other tools from the same server, preserves restart, and isolates other servers and chats", async () => {
    const events: HarnessEvent[] = [];
    const first = await startTurn(events);
    await grantMcp(events);
    askMcp("socraticode_search", "search");
    await waitReply("search");
    expect(approvals(events)).toHaveLength(1);
    askMcp("other_read", "other");
    await waitFor(
      () => approvals(events).length === 2,
      "other server approval",
    );
    expect(approvals(events)[1].serverScope?.serverName).toBe("other");
    respondOpenCodeApproval(
      "opencode-live",
      approvals(events)[1].requestId,
      "deny",
    );
    await waitReply("other");
    idle();
    await first.done;
    await stopOpenCodeSession("opencode-live");
    const resumed = await beginNext(events);
    askMcp("socraticode_summary", "resumed");
    await waitReply("resumed");
    expect(approvals(events)).toHaveLength(2);
    idle();
    await resumed.done;
    await stopOpenCodeSession("opencode-live");
    const fresh = await beginNext(events, { sessionId: "new-chat" });
    askMcp("socraticode_search", "new-chat");
    await waitFor(() => approvals(events).length === 3, "new chat approval");
    respondOpenCodeApproval("new-chat", approvals(events)[2].requestId, "deny");
    await waitReply("new-chat");
    idle();
    await fresh.done;
    await stopOpenCodeSession("new-chat");
  });

  it("keeps Allow once and Deny scoped to the current request", async () => {
    const events: HarnessEvent[] = [];
    const { done } = await startTurn(events);
    for (const [index, decision, scope] of [
      [0, "allow", undefined],
      [1, "deny", "server"],
      [2, "deny", undefined],
    ] as const) {
      askMcp("socraticode_search", `once-${index}`);
      await waitFor(
        () => approvals(events).length > index,
        "ordinary approval",
      );
      respondOpenCodeApproval(
        "opencode-live",
        approvals(events)[index].requestId,
        decision,
        scope,
      );
      await waitReply(`once-${index}`);
    }
    expect(
      events
        .filter((event) => event.type === "approval.resolved")
        .every((event) => event.scope === undefined),
    ).toBe(true);
    idle();
    await done;
  });

  it("revalidates registered server names before replaying and rejects ambiguous prefixes", async () => {
    const events: HarnessEvent[] = [];
    const { done } = await startTurn(events);
    await grantMcp(events);
    mcpStatuses = {
      socraticode: { status: "connected" },
      socraticode_tools: { status: "connected" },
    };
    askMcp("socraticode_tools_search", "ambiguous");
    await waitFor(() => approvals(events).length === 2, "ambiguous approval");
    expect(approvals(events)[1].serverScope).toBeUndefined();
    respondOpenCodeApproval(
      "opencode-live",
      approvals(events)[1].requestId,
      "allow",
      "server",
    );
    await waitReply("ambiguous");
    expect(
      events.filter((event) => event.type === "approval.resolved").at(-1)
        ?.scope,
    ).toBeUndefined();
    idle();
    await done;
  });

  it("does not offer server grants without a matching native tool call", async () => {
    const events: HarnessEvent[] = [];
    const { done } = await startTurn(events);
    askMcp("socraticode_search", "unrelated", "external_directory");
    await waitFor(() => approvals(events).length === 1, "unrelated permission");
    expect(approvals(events)[0].serverScope).toBeUndefined();
    respondOpenCodeApproval(
      "opencode-live",
      approvals(events)[0].requestId,
      "deny",
      "server",
    );
    await waitReply("unrelated");
    onSseEvent?.({
      type: "permission.asked",
      properties: {
        id: "no-tool",
        sessionID: "session_1",
        permission: "socraticode_search",
        patterns: ["*"],
      },
    });
    await waitFor(() => approvals(events).length === 2, "missing tool prompt");
    expect(approvals(events)[1].serverScope).toBeUndefined();
    respondOpenCodeApproval(
      "opencode-live",
      approvals(events)[1].requestId,
      "deny",
    );
    await waitReply("no-tool");
    idle();
    await done;
  });

  it("keeps Plan restrictions even when a server was allowed", async () => {
    const events: HarnessEvent[] = [];
    const first = await startTurn(events);
    await grantMcp(events);
    idle();
    await first.done;
    const planned = await beginNext(events, { intent: "plan" });
    askMcp("socraticode_mutate", "plan");
    await waitReply("plan");
    expect(
      harnessHttp.mock.calls.find(
        ([input]) => new URL(input.url).pathname === "/permission/plan/reply",
      )?.[0].body,
    ).toBe(JSON.stringify({ reply: "reject" }));
    expect(approvals(events)).toHaveLength(1);
    idle();
    await planned.done;
  });

  it.each([{ cwd: "/different" }, { providerAccountId: "different-account" }])(
    "clears grants when folder/account changes: %j",
    async (options) => {
      const events: HarnessEvent[] = [];
      const first = await startTurn(events);
      await grantMcp(events);
      idle();
      await first.done;
      const second = await beginNext(events, options);
      askMcp("socraticode_search", "changed");
      await waitFor(
        () => approvals(events).length === 2,
        "changed identity approval",
      );
      respondOpenCodeApproval(
        "opencode-live",
        approvals(events)[1].requestId,
        "deny",
      );
      await waitReply("changed");
      idle();
      await second.done;
    },
  );

  it("clears server grants when the chat is forgotten", async () => {
    const events: HarnessEvent[] = [];
    const first = await startTurn(events);
    await grantMcp(events);
    idle();
    await first.done;
    await forgetOpenCodeSession("opencode-live");
    const second = await beginNext(events);
    askMcp("socraticode_search", "forgotten");
    await waitFor(
      () => approvals(events).length === 2,
      "forgotten grant prompt",
    );
    respondOpenCodeApproval(
      "opencode-live",
      approvals(events)[1].requestId,
      "deny",
    );
    await waitReply("forgotten");
    idle();
    await second.done;
  });

  it("does not store a server grant after a failed approval reply", async () => {
    const events: HarnessEvent[] = [];
    const first = await startTurn(events);
    askMcp("socraticode_status", "failed");
    await waitFor(() => approvals(events).length === 1, "server action");
    harnessHttp.mockResolvedValueOnce({ status: 500, body: "reply failed" });
    respondOpenCodeApproval(
      "opencode-live",
      approvals(events)[0].requestId,
      "allow",
      "server",
    );
    await waitFor(
      () => events.some((event) => event.type === "session.error"),
      "reply failure",
    );
    await first.done;
    const second = await beginNext(events);
    askMcp("socraticode_search", "retry");
    await waitFor(() => approvals(events).length === 2, "grant not stored");
    respondOpenCodeApproval(
      "opencode-live",
      approvals(events)[1].requestId,
      "deny",
    );
    await waitReply("retry");
    idle();
    await second.done;
  });

  it("does not store a grant when stopped during the approval write", async () => {
    const events: HarnessEvent[] = [];
    const first = await startTurn(events);
    askMcp("socraticode_status", "stopped");
    await waitFor(() => approvals(events).length === 1, "server action");
    let release:
      ((reply: { status: number; body: string }) => void) | undefined;
    harnessHttp.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    respondOpenCodeApproval(
      "opencode-live",
      approvals(events)[0].requestId,
      "allow",
      "server",
    );
    await waitFor(() => release !== undefined, "response write");
    await stopOpenCodeSession("opencode-live");
    release?.({ status: 204, body: "" });
    await first.done;
    const second = await beginNext(events);
    askMcp("socraticode_search", "after-stop");
    await waitFor(
      () => approvals(events).length === 2,
      "no stale server grant",
    );
    respondOpenCodeApproval(
      "opencode-live",
      approvals(events)[1].requestId,
      "deny",
    );
    await waitReply("after-stop");
    idle();
    await second.done;
  });

  it("attributes v2 direct MCP approval from the verified server list and source IDs", async () => {
    openCodeVersion = "opencode v2.0.19";
    mcpStatuses = [
      { name: "socraticode", status: { status: "connected" } },
      { name: "other", status: { status: "connected" } },
    ];
    admittedIds["/api/session/session_1/prompt"] = ["admitted_v2_mcp"];
    const events: HarnessEvent[] = [];
    const done = turn(events);
    await waitFor(
      () =>
        harnessHttp.mock.calls.some(
          ([input]) =>
            new URL(input.url).pathname === "/api/session/session_1/prompt",
        ),
      "v2 prompt",
    );
    onSseEvent?.({
      id: "evt_mcp_tool",
      type: "session.tool.called",
      data: {
        sessionID: "session_1",
        id: "call_v2_mcp",
        assistantMessageID: "message_v2_mcp",
        name: "socraticode_status",
        input: {},
      },
    });
    onSseEvent?.({
      id: "evt_mcp_permission",
      type: "permission.asked",
      data: {
        id: "per_v2_mcp",
        sessionID: "session_1",
        action: "socraticode_status",
        resources: ["*"],
        source: {
          type: "tool",
          messageID: "message_v2_mcp",
          id: "call_v2_mcp",
        },
      },
    });
    onSseEvent?.({
      id: "evt_mcp_admitted",
      type: "session.inbox.delivered",
      data: { sessionID: "session_1", inboxID: "admitted_v2_mcp" },
    });

    await waitFor(
      () =>
        approvals(events).some(
          (event) => event.serverScope?.serverName === "socraticode",
        ),
      "v2 verified MCP approval scope",
    );
    const approval = approvals(events).at(-1)!;
    respondOpenCodeApproval(
      "opencode-live",
      approval.requestId,
      "allow",
      "server",
    );
    await waitFor(
      () =>
        harnessHttp.mock.calls.some(
          ([input]) =>
            input.method === "POST" &&
            new URL(input.url).pathname ===
              "/api/session/session_1/permission/per_v2_mcp/reply",
        ),
      "v2 scoped permission reply",
    );
    const reply = harnessHttp.mock.calls.find(
      ([input]) =>
        input.method === "POST" &&
        new URL(input.url).pathname ===
          "/api/session/session_1/permission/per_v2_mcp/reply",
    )?.[0];
    expect(JSON.parse(reply?.body ?? "{}")).toEqual({ decision: "once" });

    onSseEvent?.({
      id: "evt_mcp_complete",
      type: "session.execution.succeeded",
      data: { sessionID: "session_1" },
    });
    await done;
  });
});

describe("OpenCode native fork", () => {
  it("forks a v2 session before the selected message using the verified boundary field", async () => {
    openCodeVersion = "opencode v2.0.15";
    sessionMessages = [{ info: { id: "msg_9", role: "user" }, parts: [] }];
    const events: HarnessEvent[] = [];
    const done = turn(events, {
      fork: { sourceProviderSessionId: "session_1", forkPoint: "msg_9" },
    });

    await waitFor(
      () =>
        harnessHttp.mock.calls.some(
          ([input]) => new URL(input.url).pathname === "/api/session/session_fork/prompt",
        ),
      "v2 fork prompt",
    );
    const fork = harnessHttp.mock.calls.find(
      ([input]) => input.method === "POST" && new URL(input.url).pathname === "/api/session/session_1/fork",
    )?.[0];
    expect(JSON.parse(fork?.body ?? "{}")).toEqual({ before: "msg_9" });
    expect(events).toContainEqual({
      type: "session.providerBound",
      providerSessionId: "session_fork",
    });
    onSseEvent?.({
      id: "evt_fork_complete",
      type: "session.execution.succeeded",
      data: { sessionID: "session_fork" },
    });
    await done;
  });

  it("checks the exclusive boundary, forks, updates permissions and prompts the returned session", async () => {
    sessionMessages = [{ info: { id: "msg_9", role: "user" }, parts: [] }];
    const events: HarnessEvent[] = [];
    const done = turn(events, {
      fork: { sourceProviderSessionId: "session_1", forkPoint: "msg_9" },
    });
    await waitFor(
      () =>
        harnessHttp.mock.calls.some(([input]) =>
          input.url.includes("/prompt_async"),
        ),
      "prompt",
    );
    const calls = harnessHttp.mock.calls.map(([input]) => input);
    const messages = calls.findIndex((input) =>
      input.url.includes("/session/session_1/message"),
    );
    const fork = calls.findIndex((input) =>
      input.url.includes("/session/session_1/fork"),
    );
    const update = calls.findIndex(
      (input) =>
        input.method === "PATCH" &&
        new URL(input.url).pathname === "/session/session_2",
    );
    const prompt = calls.findIndex((input) =>
      input.url.includes("/session/session_2/prompt_async"),
    );
    expect(messages).toBeGreaterThanOrEqual(0);
    expect(fork).toBeGreaterThan(messages);
    expect(update).toBeGreaterThan(fork);
    expect(prompt).toBeGreaterThan(update);
    expect(JSON.parse(calls[fork].body ?? "{}")).toEqual({
      messageID: "msg_9",
    });
    expect(events).toContainEqual({
      type: "session.providerBound",
      providerSessionId: "session_2",
    });
    idle("session_2");
    await done;
    await stopOpenCodeSession("opencode-live");
    harnessHttp.mockClear();
    const next = turn(events, {
      fork: { sourceProviderSessionId: "session_1", forkPoint: "msg_9" },
    });
    await waitFor(
      () =>
        harnessHttp.mock.calls.some(([input]) =>
          input.url.includes("/prompt_async"),
        ),
      "next prompt",
    );
    expect(
      harnessHttp.mock.calls.some(([input]) => input.url.includes("/fork")),
    ).toBe(false);
    idle("session_2");
    await next;
  });
  it("unknown message id rejects before any fork or prompt", async () => {
    await expect(
      turn([], {
        fork: { sourceProviderSessionId: "session_1", forkPoint: "unknown" },
      }),
    ).rejects.toEqual(
      new NativeForkError("OpenCode couldn't find where this turn ends."),
    );
    expect(
      harnessHttp.mock.calls.some(
        ([input]) =>
          input.url.includes("/fork") || input.url.includes("/prompt_async"),
      ),
    ).toBe(false);
  });
  it("records the first main user id once per turn, ignoring hidden and child messages", async () => {
    const events: HarnessEvent[] = [];
    const { done } = await startTurn(events);
    const message = (sessionID: string, id: string, agent?: string) =>
      onSseEvent?.({
        type: "message.updated",
        properties: { info: { sessionID, id, role: "user", agent } },
      });
    message("child", "child-user");
    message("session_1", "hidden", "compaction");
    message("session_1", "main-user");
    message("session_1", "other-user");
    expect(events.filter((event) => event.type === "turn.started")).toEqual([
      { type: "turn.started", providerTurnId: "main-user" },
    ]);
    idle();
    await done;
    harnessHttp.mockClear();
    const next = await startTurn(events);
    message("session_1", "next-user");
    idle();
    await next.done;
    expect(
      events.filter((event) => event.type === "turn.started"),
    ).toHaveLength(2);
  });
});

it("reports when OpenCode accepts a turn", async () => {
  const events: HarnessEvent[] = [];
  const onAccepted = vi.fn();
  const done = turn(events, { onAccepted });

  await waitFor(() => onAccepted.mock.calls.length === 1, "turn acceptance");
  idle();
  await done;
  expect(onAccepted).toHaveBeenCalledOnce();
});

it("ends a 1.x turn on session.status, not the deprecated session.idle", async () => {
  const events: HarnessEvent[] = [];
  const { done } = await startTurn(events);
  let finished = false;
  void done.then(() => (finished = true));
  onSseEvent?.({ type: "session.idle", properties: { sessionID: "session_1" } });
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(finished).toBe(false);
  idle();
  await done;
  expect(events).toContainEqual({ type: "message.completed" });
});

it("uses the v2 API and completes from a v2 event envelope", async () => {
  openCodeVersion = "opencode v2.0.15";
  const events: HarnessEvent[] = [];
  const done = turn(events);
  await waitFor(
    () =>
      harnessHttp.mock.calls.some(
        ([input]) =>
          new URL(input.url).pathname === "/api/session/session_1/prompt",
      ),
    "v2 prompt",
  );
  expect(
    harnessHttp.mock.calls.map(([input]) => new URL(input.url).pathname),
  ).toEqual(
    expect.arrayContaining([
      "/api/session",
      "/api/session/session_1/model",
      "/api/session/session_1/agent",
      "/api/session/session_1/prompt",
    ]),
  );
  expect(spawnChild).not.toHaveBeenCalled();
  onSseEvent?.({
    id: "evt_idle",
    type: "session.idle",
    data: { sessionID: "session_1" },
  });
  await done;
  expect(events).toContainEqual({ type: "message.completed" });
});

it("renders a v2 turn streamed as session step, text, reasoning, and tool events", async () => {
  openCodeVersion = "opencode v2.0.15";
  const events: HarnessEvent[] = [];
  const done = turn(events);
  await waitFor(
    () =>
      harnessHttp.mock.calls.some(
        ([input]) =>
          new URL(input.url).pathname === "/api/session/session_1/prompt",
      ),
    "v2 prompt",
  );
  const sessionID = "session_1";
  const model = { id: "mimo-v2.6-flash-free", providerID: "opencode" };
  const send = (type: string, data: Record<string, unknown>) =>
    onSseEvent?.({ id: `evt_${type}`, type, data: { sessionID, ...data } });

  send("session.execution.started", {});
  send("session.step.started", { agent: "build", model, assistantMessageID: "msg_a" });
  send("session.reasoning.started", { assistantMessageID: "msg_a", ordinal: 0 });
  send("session.reasoning.delta", { assistantMessageID: "msg_a", ordinal: 0, delta: "Plan it." });
  send("session.tool.input.started", { assistantMessageID: "msg_a", id: "call_1", name: "shell" });
  send("session.reasoning.ended", { assistantMessageID: "msg_a", ordinal: 0, text: "Plan it." });
  send("session.tool.called", {
    assistantMessageID: "msg_a",
    id: "call_1",
    input: { command: "echo MONOCODE_TOOL_TEST" },
  });
  send("session.tool.success", {
    assistantMessageID: "msg_a",
    id: "call_1",
    content: [{ type: "text", text: "MONOCODE_TOOL_TEST\n" }],
    metadata: { status: "completed", exit: 0 },
  });
  send("session.step.ended", {
    assistantMessageID: "msg_a",
    finish: "tool-calls",
    tokens: { input: 100, output: 5, reasoning: 2, cache: { read: 50, write: 0 } },
  });
  send("session.step.started", { agent: "build", model, assistantMessageID: "msg_b" });
  send("session.text.started", { assistantMessageID: "msg_b", ordinal: 0 });
  send("session.text.delta", { assistantMessageID: "msg_b", ordinal: 0, delta: "DO" });
  send("session.text.delta", { assistantMessageID: "msg_b", ordinal: 0, delta: "NE" });
  send("session.text.ended", { assistantMessageID: "msg_b", ordinal: 0, text: "DONE" });
  send("session.step.ended", { assistantMessageID: "msg_b", finish: "stop" });
  send("session.execution.succeeded", {});
  await done;

  const text = events
    .filter((event) => event.type === "message.delta")
    .map((event) => (event as { text: string }).text)
    .join("");
  expect(text).toBe("DONE");
  expect(events).toContainEqual({ type: "reasoning.delta", text: "Plan it." });
  expect(events).toContainEqual(
    expect.objectContaining({ type: "tool.started", callId: "call_1", kind: "shell" }),
  );
  expect(events).toContainEqual(
    expect.objectContaining({
      type: "tool.updated",
      callId: "call_1",
      status: "completed",
      detail: "MONOCODE_TOOL_TEST\n",
    }),
  );
  expect(events).toContainEqual(expect.objectContaining({ type: "context" }));
  expect(events).toContainEqual({ type: "message.completed" });
});

it("surfaces a failed v2 execution as a session error", async () => {
  openCodeVersion = "opencode v2.0.15";
  const events: HarnessEvent[] = [];
  const done = turn(events);
  await waitFor(
    () =>
      harnessHttp.mock.calls.some(
        ([input]) =>
          new URL(input.url).pathname === "/api/session/session_1/prompt",
      ),
    "v2 prompt",
  );
  onSseEvent?.({
    type: "session.execution.failed",
    data: { sessionID: "session_1", error: { type: "provider", message: "Rate limited" } },
  });
  await done.catch(() => undefined);
  expect(events).toContainEqual({ type: "session.error", message: "Rate limited" });
});

describe("OpenCode 2.x resumed session folders", () => {
  const paths = () =>
    harnessHttp.mock.calls.map(
      ([input]) => `${input.method} ${new URL(input.url).pathname}`,
    );
  const resumeTurn = async (events: HarnessEvent[] = []) => {
    bindOpenCodeSession("opencode-live", "session_1", "/repo");
    const done = turn(events);
    await waitFor(
      () => paths().some((path) => path.endsWith("/prompt")) || events.some((e) => e.type === "session.error"),
      "prompt",
    );
    onSseEvent?.({
      type: "session.execution.succeeded",
      data: { sessionID: paths().some((p) => p.includes("session_fork/prompt")) ? "session_fork" : "session_1" },
    });
    return done;
  };

  beforeEach(() => {
    openCodeVersion = "opencode v2.0.19";
  });

  it("adopts a session that already works in the current folder", async () => {
    v2SessionDirectory = "/repo/";
    await resumeTurn();
    expect(paths()).toContain("POST /api/session/session_1/prompt");
    expect(paths().some((path) => path.includes("/fork"))).toBe(false);
  });

  it("forks a session from another folder and moves the fork here", async () => {
    v2SessionDirectory = "/repo-old-worktree";
    const events: HarnessEvent[] = [];
    await resumeTurn(events);
    const move = harnessHttp.mock.calls.find(
      ([input]) => new URL(input.url).pathname === "/api/session/session_fork/move",
    );
    expect(JSON.parse(move?.[0].body ?? "{}")).toMatchObject({ directory: "/repo" });
    expect(paths()).toContain("POST /api/session/session_fork/prompt");
    expect(paths()).not.toContain("POST /api/session/session_1/move");
    expect(paths()).not.toContain("POST /api/session/session_1/prompt");
    expect(events).toContainEqual({
      type: "session.providerBound",
      providerSessionId: "session_fork",
    });
  });

  it("deletes the fork and fails when the move does not take effect", async () => {
    v2SessionDirectory = "/repo-old-worktree";
    v2MoveApplies = false;
    bindOpenCodeSession("opencode-live", "session_1", "/repo");
    await expect(turn([])).rejects.toThrow("did not move the forked session");
    expect(paths()).toContain("DELETE /api/session/session_fork");
    expect(paths().some((path) => path.endsWith("/prompt"))).toBe(false);
  });

  it("starts a new session when the other folder's session has no history", async () => {
    v2SessionDirectory = "/repo-old-worktree";
    v2ForkFailure = {
      status: 400,
      body: JSON.stringify({
        _tag: "InvalidRequestError",
        message: "Cannot fork empty session: session_1",
        kind: "empty_session",
      }),
    };
    await resumeTurn();
    const create = harnessHttp.mock.calls.find(
      ([input]) =>
        input.method === "POST" && new URL(input.url).pathname === "/api/session",
    );
    expect(JSON.parse(create?.[0].body ?? "{}")).toMatchObject({
      location: { directory: "/repo" },
    });
  });
});

describe("OpenCode 2.x completion correlation", () => {
  const PROMPT = "/api/session/session_1/prompt";
  const COMPACT = "/api/session/session_1/compact";
  const v2 = (type: string, data: Record<string, unknown> = {}) =>
    onSseEvent?.({ id: `evt_${type}`, type, data: { sessionID: "session_1", ...data } });
  const calls = (path: string) =>
    harnessHttp.mock.calls.filter(([input]) => new URL(input.url).pathname === path)
      .length;
  const settled = (promise: Promise<unknown>) => {
    let done = false;
    promise.then(
      () => (done = true),
      () => (done = true),
    );
    return () => done;
  };
  const drain = () => new Promise((resolve) => setTimeout(resolve, 20));
  const replyText = (events: HarnessEvent[]) =>
    events
      .filter((event) => event.type === "message.delta")
      .map((event) => (event as { text: string }).text)
      .join("");
  const compact = (events: HarnessEvent[]) =>
    compactOpenCodeContext({
      sessionId: "opencode-live",
      cwd: "/repo",
      model: "opencode:openrouter/anthropic/claude-sonnet-4.6",
      runtimeMode: "supervised",
      onEvent: (event) => events.push(event),
    });

  beforeEach(() => {
    openCodeVersion = "opencode v2.0.19";
  });

  it("does not let a stopped run's late interrupt finish the next turn", async () => {
    admittedIds[PROMPT] = ["msg_first", "msg_second"];
    const first = turn([]);
    await waitFor(() => calls(PROMPT) === 1, "first prompt");
    await drain();
    v2("session.execution.started");
    v2("session.inbox.delivered", { inboxID: "msg_first" });
    await cancelOpenCodeTurn("opencode-live");
    await first;

    // The interrupt response returns before its event; the event lands while
    // the next prompt is being admitted.
    onAdmit = (_path, id) => {
      if (id === "msg_second") v2("session.execution.interrupted", { reason: "user" });
    };
    const events: HarnessEvent[] = [];
    const second = turn(events);
    const secondDone = settled(second);
    await waitFor(() => calls(PROMPT) === 2, "second prompt");
    await drain();
    v2("session.execution.interrupted", { reason: "user" });
    await drain();
    expect(secondDone()).toBe(false);
    expect(events).not.toContainEqual({ type: "message.completed" });

    v2("session.execution.started");
    v2("session.inbox.delivered", { inboxID: "msg_second" });
    v2("session.text.delta", { assistantMessageID: "msg_reply", delta: "SECOND_DONE" });
    v2("session.execution.succeeded");
    await second;
    expect(replyText(events)).toBe("SECOND_DONE");
    expect(events).toContainEqual({ type: "message.completed" });
  });

  it("finishes a run that completed before its admission response", async () => {
    admittedIds[PROMPT] = ["msg_fast"];
    onAdmit = (_path, id) => {
      v2("session.execution.started");
      v2("session.inbox.delivered", { inboxID: id });
      v2("session.text.delta", { assistantMessageID: "msg_reply", delta: "FAST" });
      v2("session.execution.succeeded");
    };
    const events: HarnessEvent[] = [];
    await turn(events);
    expect(replyText(events)).toBe("FAST");
    expect(events).toContainEqual({ type: "message.completed" });
  });

  describe.each(["with an inbox id", "without an inbox id"])(
    "early completion %s",
    (admission) => {
      it.each(["succeeded", "failed", "interrupted"])(
        "preserves an early %s event when delivery is not reported",
        async (execution) => {
          if (admission === "with an inbox id") {
            admittedIds[PROMPT] = ["msg_fast"];
          }
          onAdmit = () => {
            v2("session.text.delta", {
              assistantMessageID: "msg_reply",
              delta: "FAST",
            });
            v2(`session.execution.${execution}`, {
              error: { message: "Rate limited" },
              reason: "shutdown",
            });
          };
          const events: HarnessEvent[] = [];
          const done = turn(events);
          const finished = settled(done);
          await waitFor(finished, "early terminal completion");
          await done;
          expect(replyText(events)).toBe("FAST");
          if (execution === "failed") {
            expect(events).toContainEqual({
              type: "session.error",
              message: "Rate limited",
            });
          } else {
            expect(events).toContainEqual({ type: "message.completed" });
          }
        },
      );
    },
  );

  it("keeps early completion with delivery but no admission id", async () => {
    onAdmit = () => {
      v2("session.inbox.delivered", { inboxID: "msg_fast" });
      v2("session.execution.succeeded");
    };
    const events: HarnessEvent[] = [];
    const done = turn(events);
    await waitFor(settled(done), "id-less early completion");
    await done;
    expect(events).toContainEqual({ type: "message.completed" });
  });

  it("preserves the first early outcome instead of a later idle event", async () => {
    admittedIds[PROMPT] = ["msg_fail"];
    onAdmit = () => {
      v2("session.execution.failed", { error: { message: "Rate limited" } });
      v2("session.idle");
    };
    const events: HarnessEvent[] = [];
    const done = turn(events);
    await waitFor(settled(done), "first early outcome");
    await done;
    expect(events).toContainEqual({ type: "session.error", message: "Rate limited" });
    expect(events).not.toContainEqual({ type: "message.completed" });
  });

  it("does not replay an uncorrelated early outcome when delivery becomes available", async () => {
    admittedIds[PROMPT] = ["msg_current"];
    onAdmit = () => {
      v2("session.execution.interrupted", { reason: "user" });
      v2("session.inbox.delivered", { inboxID: "msg_current" });
    };
    const events: HarnessEvent[] = [];
    const done = turn(events);
    const finished = settled(done);
    await waitFor(() => calls(PROMPT) === 1, "prompt");
    await drain();
    expect(finished()).toBe(false);
    expect(events).not.toContainEqual({ type: "message.completed" });

    v2("session.text.delta", { assistantMessageID: "msg_reply", delta: "CURRENT" });
    v2("session.execution.succeeded");
    await done;
    expect(replyText(events)).toBe("CURRENT");
  });

  it("reports a failed run as a session error", async () => {
    admittedIds[PROMPT] = ["msg_fail"];
    const events: HarnessEvent[] = [];
    const done = turn(events);
    await waitFor(() => calls(PROMPT) === 1, "prompt");
    await drain();
    v2("session.inbox.delivered", { inboxID: "msg_fail" });
    v2("session.execution.failed", { error: { message: "Rate limited" } });
    await done;
    expect(events).toContainEqual({ type: "session.error", message: "Rate limited" });
  });

  it("ends the active turn on a v2 session error and shows the message", async () => {
    admittedIds[PROMPT] = ["msg_boom"];
    const events: HarnessEvent[] = [];
    const done = turn(events);
    await waitFor(() => calls(PROMPT) === 1, "prompt");
    await drain();
    v2("session.error", { error: { message: "Provider exploded" } });
    await done;
    expect(events).toContainEqual({ type: "session.error", message: "Provider exploded" });
  });

  it("shows a stale failed run between turns without finishing the next turn", async () => {
    admittedIds[PROMPT] = ["msg_first", "msg_second"];
    const firstEvents: HarnessEvent[] = [];
    const first = turn(firstEvents);
    await waitFor(() => calls(PROMPT) === 1, "first prompt");
    await drain();
    v2("session.execution.started");
    v2("session.inbox.delivered", { inboxID: "msg_first" });
    v2("session.execution.succeeded");
    await first;

    v2("session.execution.failed", { error: { message: "Late failure" } });
    expect(firstEvents).toContainEqual({ type: "session.error", message: "Late failure" });

    const events: HarnessEvent[] = [];
    const second = turn(events);
    const secondDone = settled(second);
    await waitFor(() => calls(PROMPT) === 2, "second prompt");
    await drain();
    expect(secondDone()).toBe(false);

    v2("session.execution.started");
    v2("session.inbox.delivered", { inboxID: "msg_second" });
    v2("session.text.delta", { assistantMessageID: "msg_reply", delta: "SECOND_DONE" });
    v2("session.execution.succeeded");
    await second;
    expect(replyText(events)).toBe("SECOND_DONE");
    expect(events).not.toContainEqual(expect.objectContaining({ type: "session.error" }));
  });

  it("keeps uncorrelated completion when the server never reports delivery", async () => {
    admittedIds[PROMPT] = ["msg_untracked"];
    const done = turn([]);
    await waitFor(() => calls(PROMPT) === 1, "prompt");
    await drain();
    v2("session.execution.succeeded");
    await done;
  });

  it("waits for compaction to end before sending the next prompt", async () => {
    admittedIds[COMPACT] = ["msg_compact"];
    admittedIds[PROMPT] = ["msg_after"];
    const compaction = compact([]);
    const compacted = settled(compaction);
    await waitFor(() => calls(COMPACT) === 1, "compact");
    await drain();
    v2("session.execution.started");
    v2("session.inbox.delivered", { inboxID: "msg_compact" });
    v2("session.compaction.started", { reason: "manual", inputID: "msg_compact" });

    const events: HarnessEvent[] = [];
    const next = turn(events);
    await drain();
    expect(compacted()).toBe(false);
    expect(calls(PROMPT)).toBe(0);

    v2("session.compaction.ended", { reason: "manual", text: "summary" });
    await compaction;
    await waitFor(() => calls(PROMPT) === 1, "prompt after compaction");
    await drain();
    // The compaction's execution goes on to run the queued prompt.
    v2("session.inbox.delivered", { inboxID: "msg_after" });
    v2("session.text.delta", { assistantMessageID: "msg_reply", delta: "AFTER" });
    v2("session.execution.succeeded");
    await next;
    expect(replyText(events)).toBe("AFTER");
  });

  it("waits for compaction to end when admission returns no inbox id", async () => {
    const compaction = compact([]);
    const compacted = settled(compaction);
    await waitFor(() => calls(COMPACT) === 1, "compact");
    await drain();
    expect(compacted()).toBe(false);
    v2("session.compaction.ended", { reason: "manual", text: "summary" });
    await compaction;
  });

  describe.each(["with an inbox id", "without an inbox id"])(
    "early compaction %s",
    (admission) => {
      it.each(["ended", "failed"])(
        "preserves an early compaction.%s event when delivery is not reported",
        async (outcome) => {
          if (admission === "with an inbox id") {
            admittedIds[COMPACT] = ["msg_compact"];
          }
          onAdmit = () => {
            v2(`session.compaction.${outcome}`, {
              error: { message: "Context too large" },
            });
          };
          const done = compact([]);
          await waitFor(settled(done), "early compaction completion");
          if (outcome === "failed") {
            await expect(done).rejects.toThrow("Context too large");
          } else {
            await done;
          }
        },
      );
    },
  );

  it("fails compaction when OpenCode reports a compaction failure", async () => {
    admittedIds[COMPACT] = ["msg_compact"];
    const compaction = compact([]);
    await waitFor(() => calls(COMPACT) === 1, "compact");
    await drain();
    v2("session.inbox.delivered", { inboxID: "msg_compact" });
    v2("session.compaction.failed", {
      reason: "manual",
      inputID: "msg_compact",
      error: { message: "Context too large" },
    });
    await expect(compaction).rejects.toThrow("Context too large");
  });

  it("fails compaction when its run is interrupted before it ends", async () => {
    admittedIds[COMPACT] = ["msg_compact"];
    const compaction = compact([]);
    await waitFor(() => calls(COMPACT) === 1, "compact");
    await drain();
    v2("session.inbox.delivered", { inboxID: "msg_compact" });
    v2("session.compaction.started", { reason: "manual", inputID: "msg_compact" });
    v2("session.execution.interrupted", { reason: "shutdown" });
    await expect(compaction).rejects.toThrow("interrupted");
  });

  it("settles compaction when the user stops it", async () => {
    admittedIds[COMPACT] = ["msg_compact"];
    const compaction = compact([]);
    await waitFor(() => calls(COMPACT) === 1, "compact");
    await drain();
    await cancelOpenCodeTurn("opencode-live");
    await compaction;
  });

  it("fails compaction when the event stream ends", async () => {
    admittedIds[COMPACT] = ["msg_compact"];
    const compaction = compact([]);
    await waitFor(() => calls(COMPACT) === 1, "compact");
    await drain();
    onSseEnd?.("stream closed");
    await expect(compaction).rejects.toThrow("stream closed");
  });
});

describe("OpenCode subagent trails", () => {
  const part = (sessionID: string, value: Record<string, unknown>) =>
    onSseEvent?.({
      type: "message.part.updated",
      properties: { part: { sessionID, ...value } },
    });
  const message = (
    sessionID: string,
    id: string,
    role = "assistant",
    agent?: string,
    modelID?: string,
  ) =>
    onSseEvent?.({
      type: "message.updated",
      properties: { info: { sessionID, id, role, agent, modelID } },
    });
  const task = (callID: string, child: string) =>
    part("session_1", {
      id: `part_${callID}`,
      type: "tool",
      tool: "task",
      callID,
      state: {
        status: "running",
        title: `Task ${callID}`,
        metadata: { sessionId: child },
      },
    });

  it("pairs concurrent children by metadata and replays their latest parts after creating the row", async () => {
    const events: HarnessEvent[] = [];
    const { done } = await startTurn(events);
    sessionCreated("child_b", "session_1");
    sessionCreated("child_a", "session_1");
    message("child_a", "msg_a", "assistant", undefined, "claude-haiku-4-5");
    message("child_b", "msg_b");
    part("child_b", {
      id: "prose_b",
      messageID: "msg_b",
      type: "text",
      text: "Second child",
    });
    for (let i = 0; i < 70; i++) {
      part("child_a", {
        id: "prose_a",
        messageID: "msg_a",
        type: "text",
        text: `First child ${i}`,
      });
    }
    task("a", "child_a");
    task("b", "child_b");
    idle("child_a");
    expect(events.some((event) => event.type === "message.completed")).toBe(
      false,
    );
    idle();
    await done;
    const session = events.reduce(
      applyHarnessEvent,
      newSession("opencode", "/repo"),
    );
    expect(
      session.blocks.find((block) => block.tool?.callId === "a")?.agentRun
        ?.model,
    ).toBe("claude-haiku-4-5");
    expect(
      session.blocks.find((block) => block.tool?.callId === "a")?.agentRun
        ?.steps,
    ).toEqual([expect.objectContaining({ text: "First child 69" })]);
    expect(
      session.blocks.find((block) => block.tool?.callId === "b")?.agentRun
        ?.steps,
    ).toEqual([expect.objectContaining({ text: "Second child" })]);
    expect(events.filter((event) => event.type === "message.delta")).toEqual(
      [],
    );
  });

  it("streams child reasoning and tools, including nested tasks, without user or hidden text", async () => {
    const events: HarnessEvent[] = [];
    const { done } = await startTurn(events);
    task("a", "child");
    sessionCreated("child", "session_1");
    message("child", "user_msg", "user");
    message("child", "hidden_msg", "assistant", "compaction");
    message("child", "assistant_msg");
    part("child", {
      id: "input",
      type: "text",
      messageID: "user_msg",
      text: "Private prompt",
    });
    part("child", {
      id: "hidden",
      type: "text",
      messageID: "hidden_msg",
      text: "Hidden summary",
    });
    part("child", {
      id: "think",
      type: "reasoning",
      messageID: "assistant_msg",
      text: "Trace ",
    });
    onSseEvent?.({
      type: "message.part.delta",
      properties: {
        sessionID: "child",
        partID: "think",
        field: "text",
        delta: "imports",
      },
    });
    part("child", {
      id: "read",
      type: "tool",
      tool: "read",
      callID: "read",
      messageID: "assistant_msg",
      state: { status: "running", input: { filePath: "auth.ts" } },
    });
    part("child", {
      id: "read",
      type: "tool",
      tool: "read",
      callID: "read",
      messageID: "assistant_msg",
      state: {
        status: "error",
        input: { filePath: "auth.ts" },
        error: "File missing",
      },
    });
    sessionCreated("grandchild", "child");
    message("grandchild", "nested_msg");
    part("grandchild", {
      id: "nested_text",
      type: "text",
      messageID: "nested_msg",
      text: "Nested answer",
    });
    part("child", {
      id: "nested_call",
      type: "tool",
      tool: "task",
      callID: "nested_call",
      messageID: "assistant_msg",
      state: { status: "running", metadata: { sessionId: "grandchild" } },
    });
    // Another session on the same server is not part of this run.
    sessionCreated("unrelated");
    message("unrelated", "other_msg");
    part("unrelated", {
      id: "other",
      type: "text",
      messageID: "other_msg",
      text: "Other session",
    });
    idle();
    await done;
    const session = events.reduce(
      applyHarnessEvent,
      newSession("opencode", "/repo"),
    );
    const steps = session.blocks.find((block) => block.tool?.callId === "a")
      ?.agentRun?.steps;
    expect(steps?.map((step) => step.text)).toEqual([
      "Trace imports",
      "Read auth.ts",
      "Subagent",
      "Nested answer",
    ]);
    expect(steps?.find((step) => step.toolKind === "read")?.status).toBe(
      "failed",
    );
    expect(steps?.find((step) => step.toolKind === "read")?.detail).toBe(
      "File missing",
    );
    expect(
      session.blocks.filter((block) => block.role === "assistant"),
    ).toEqual([]);
  });
});

describe("OpenCode event stream recovery", () => {
  it("reverts a rejected file turn before continuing a resumed session", async () => {
    sessionMessages = [
      {
        info: {
          id: "message_bad_file",
          sessionID: "session_1",
          role: "user",
          time: { created: 1 },
        },
        parts: [
          {
            type: "file",
            mime: "application/octet-stream",
            filename: "Info.plist",
          },
        ],
      },
      {
        info: {
          id: "message_bad_reply",
          parentID: "message_bad_file",
          sessionID: "session_1",
          role: "assistant",
          time: { created: 2 },
          error: {
            data: {
              message:
                "'file part media type application/octet-stream' functionality not supported.",
            },
          },
        },
        parts: [],
      },
    ];
    bindOpenCodeSession("opencode-live", "session_1", "/repo");

    const events: HarnessEvent[] = [];
    const done = turn(events);
    await waitFor(
      () =>
        harnessHttp.mock.calls.some(([input]) =>
          input.url.includes("/session/session_1/revert"),
        ),
      "attachment turn recovery",
    );
    await waitFor(
      () =>
        harnessHttp.mock.calls.some(([input]) =>
          input.url.includes("/prompt_async"),
        ),
      "resumed prompt",
    );

    const revertIndex = harnessHttp.mock.calls.findIndex(([input]) =>
      input.url.includes("/session/session_1/revert"),
    );
    const promptIndex = harnessHttp.mock.calls.findIndex(([input]) =>
      input.url.includes("/prompt_async"),
    );
    expect(revertIndex).toBeGreaterThanOrEqual(0);
    expect(promptIndex).toBeGreaterThan(revertIndex);
    expect(harnessHttp.mock.calls[revertIndex]?.[0]).toMatchObject({
      method: "POST",
      body: JSON.stringify({ messageID: "message_bad_file" }),
    });

    idle();
    await done;
    expect(events).toContainEqual({ type: "message.completed" });
  });

  it("preserves history when a later assistant turn succeeded", async () => {
    sessionMessages = [
      {
        info: {
          id: "message_bad_file",
          role: "user",
          time: { created: 1 },
        },
        parts: [{ type: "file", mime: "application/octet-stream" }],
      },
      {
        info: {
          id: "message_bad_reply",
          parentID: "message_bad_file",
          role: "assistant",
          time: { created: 2 },
          error: {
            data: {
              message:
                "'file part media type application/octet-stream' functionality not supported.",
            },
          },
        },
        parts: [],
      },
      {
        info: {
          id: "message_recovered_reply",
          role: "assistant",
          time: { created: 3 },
        },
        parts: [{ type: "text", text: "Recovered" }],
      },
    ];
    bindOpenCodeSession("opencode-live", "session_1", "/repo");

    const events: HarnessEvent[] = [];
    const done = turn(events);
    await waitFor(
      () =>
        harnessHttp.mock.calls.some(([input]) =>
          input.url.includes("/prompt_async"),
        ),
      "resumed prompt",
    );
    expect(
      harnessHttp.mock.calls.some(([input]) => input.url.includes("/revert")),
    ).toBe(false);

    idle();
    await done;
  });

  it("fails a cleanly-ended stream and reconnects on the next turn", async () => {
    const firstEvents: HarnessEvent[] = [];
    const first = turn(firstEvents);
    await waitFor(
      () =>
        harnessHttp.mock.calls.some(([input]) =>
          String(input.url).includes("/prompt_async"),
        ),
      "first prompt",
    );

    onSseEnd?.();
    await expect(first).rejects.toThrow(
      "OpenCode event stream ended unexpectedly.",
    );
    expect(firstEvents).toContainEqual({
      type: "session.error",
      message: "OpenCode event stream ended unexpectedly.",
    });

    const secondEvents: HarnessEvent[] = [];
    const second = turn(secondEvents);
    await waitFor(() => spawnChild.mock.calls.length === 2, "fresh transport");
    await waitFor(
      () =>
        harnessHttp.mock.calls.filter(([input]) =>
          String(input.url).includes("/prompt_async"),
        ).length === 2,
      "second prompt",
    );
    onSseEvent?.({
      type: "session.status",
      properties: { sessionID: "session_1", status: { type: "idle" } },
    });
    await second;
    expect(secondEvents).toContainEqual({ type: "message.completed" });
  });
});

describe("OpenCode edit recovery", () => {
  it("reverts the latest user message before resending an edited prompt", async () => {
    sessionMessages = [
      {
        info: {
          id: "message_first",
          role: "user",
          time: { created: 1 },
        },
      },
      {
        info: {
          id: "message_first_reply",
          role: "assistant",
          time: { created: 2 },
        },
      },
      {
        info: {
          id: "message_latest",
          role: "user",
          time: { created: 3 },
        },
      },
    ];
    bindOpenCodeSession("opencode-live", "session_1", "/repo");

    const rewind = rewindOpenCodeLastTurn({
      sessionId: "opencode-live",
      cwd: "/repo",
      model: "opencode:openrouter/anthropic/claude-sonnet-4.6",
      runtimeMode: "supervised",
      onEvent: () => undefined,
    });
    await waitFor(
      () =>
        harnessHttp.mock.calls.some(([input]) =>
          input.url.includes("/session/session_1/revert"),
        ),
      "edited message revert",
    );

    const request = harnessHttp.mock.calls.find(([input]) =>
      input.url.includes("/session/session_1/revert"),
    )?.[0];
    expect(request).toMatchObject({
      method: "POST",
      body: JSON.stringify({ messageID: "message_latest" }),
    });
    expect(await rewind).toEqual({ submitted: false });
  });

  it("uses response order when a user timestamp is missing", async () => {
    sessionMessages = [
      {
        info: {
          id: "message_older",
          role: "user",
          time: { created: 100 },
        },
      },
      {
        info: {
          id: "message_latest",
          role: "user",
        },
      },
    ];
    bindOpenCodeSession("opencode-live", "session_1", "/repo");

    const rewind = rewindOpenCodeLastTurn({
      sessionId: "opencode-live",
      cwd: "/repo",
      model: "opencode:openrouter/anthropic/claude-sonnet-4.6",
      runtimeMode: "supervised",
      onEvent: () => undefined,
    });
    await waitFor(
      () =>
        harnessHttp.mock.calls.some(([input]) =>
          input.url.includes("/session/session_1/revert"),
        ),
      "edited message revert",
    );

    const request = harnessHttp.mock.calls.find(([input]) =>
      input.url.includes("/session/session_1/revert"),
    )?.[0];
    expect(request).toMatchObject({
      method: "POST",
      body: JSON.stringify({ messageID: "message_latest" }),
    });
    await expect(rewind).resolves.toEqual({ submitted: false });
  });
});
describe("OpenCode access modes", () => {
  it("updates a live session when access changes and auto-allows residual full-access prompts", async () => {
    const events: HarnessEvent[] = [];
    const first = turn(events);
    await waitFor(
      () =>
        harnessHttp.mock.calls.some(([input]) =>
          input.url.includes("/prompt_async"),
        ),
      "first prompt",
    );
    idle();
    await first;

    const second = turn(events, { runtimeMode: "full-access" });
    await waitFor(
      () =>
        harnessHttp.mock.calls.some(
          ([input]) =>
            input.method === "PATCH" &&
            new URL(input.url).pathname === "/session/session_1",
        ),
      "permission update",
    );
    expect(harnessHttp).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "PATCH",
        url: "http://127.0.0.1:4096/session/session_1?directory=%2Frepo",
        body: JSON.stringify({
          permission: [{ permission: "*", pattern: "*", action: "allow" }],
        }),
      }),
    );
    await waitFor(
      () =>
        harnessHttp.mock.calls.filter(([input]) =>
          input.url.includes("/prompt_async"),
        ).length === 2,
      "second prompt",
    );

    askPermission("session_1", "permission_residual");
    await waitFor(
      () =>
        harnessHttp.mock.calls.some(
          ([input]) =>
            new URL(input.url).pathname ===
            "/permission/permission_residual/reply",
        ),
      "automatic full-access reply",
    );
    expect(harnessHttp).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ reply: "once" }),
      }),
    );
    expect(events.some((event) => event.type === "approval.requested")).toBe(
      false,
    );

    idle();
    await second;
  });
});

describe("OpenCode child permission routing", () => {
  it("queues simultaneous child questions so each stays reachable", async () => {
    const events: HarnessEvent[] = [];
    const { done } = await startTurn(events);
    for (const id of ["child_a", "child_b"]) {
      sessionCreated(id, "session_1");
      onSseEvent?.({
        type: "question.asked",
        properties: {
          id: `question_${id}`,
          sessionID: id,
          questions: [
            {
              question: `Question from ${id}`,
              options: [{ label: "Proceed" }],
            },
          ],
        },
      });
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(
      events.filter((event) => event.type === "question.asked"),
    ).toHaveLength(1);
    for (const id of ["child_a", "child_b"]) {
      const session = events.reduce(
        applyHarnessEvent,
        newSession("opencode", "/repo"),
      );
      const request = session.pendingQuestion!;
      expect(request.questions[0].prompt).toBe(`Question from ${id}`);
      respondOpenCodeQuestion("opencode-live", request.requestId, {
        kind: "skipped",
      });
      await waitFor(
        () =>
          harnessHttp.mock.calls.some(([input]) =>
            input.url.includes(`/question/question_${id}/reject`),
          ),
        "question response",
      );
    }
    expect(
      events.reduce(applyHarnessEvent, newSession("opencode", "/repo"))
        .pendingQuestion,
    ).toBeUndefined();
    idle();
    await done;
  });

  it("ends the turn visibly when a child approval reply fails", async () => {
    const events: HarnessEvent[] = [];
    const { done } = await startTurn(events);
    sessionCreated("session_child", "session_1");
    askPermission("session_child");
    await waitFor(
      () => events.some((event) => event.type === "approval.requested"),
      "child approval",
    );
    const approval = events.find(
      (event) => event.type === "approval.requested",
    )!;
    harnessHttp.mockResolvedValueOnce({
      status: 500,
      body: "Permission reply failed",
    });
    respondOpenCodeApproval("opencode-live", approval.requestId, "allow");
    await waitFor(
      () => events.some((event) => event.type === "session.error"),
      "permission failure",
    );
    await done;
    expect(events).toContainEqual({
      type: "session.error",
      message: "Could not route OpenCode event: Permission reply failed",
    });
  });

  it.each([
    ["session_1", "allow", "once"],
    ["session_1", "deny", "reject"],
    ["session_child", "allow", "once"],
    ["session_child", "deny", "reject"],
    ["session_grandchild", "allow", "once"],
    ["session_grandchild", "deny", "reject"],
  ] as const)(
    "routes %s permission with %s",
    async (sessionID, decision, reply) => {
      const events: HarnessEvent[] = [];
      const { done } = await startTurn(events);
      sessionCreated("session_child", "session_1");
      sessionCreated("session_grandchild", "session_child");
      askPermission(sessionID);

      await waitFor(
        () => events.some((event) => event.type === "approval.requested"),
        "approval",
      );
      const approval = events.find(
        (event) => event.type === "approval.requested",
      )!;
      expect(approval).toMatchObject({
        kind: "external_directory",
        callId: "call_permission_child",
        title: expect.stringContaining("/home/user"),
      });
      const session = events.reduce(
        applyHarnessEvent,
        newSession("opencode", "/repo"),
      );
      expect(
        session.blocks.find(
          (block) => block.approval?.requestId === approval.requestId,
        ),
      ).toMatchObject({
        tool: { callId: "call_permission_child", kind: "external_directory" },
        approval: { requestId: approval.requestId },
      });
      expect(events).not.toContainEqual({ type: "message.completed" });
      respondOpenCodeApproval("opencode-live", approval.requestId, decision);
      await waitFor(
        () =>
          harnessHttp.mock.calls.some(
            ([input]) =>
              new URL(input.url).pathname ===
              "/permission/permission_child/reply",
          ),
        "permission reply",
      );
      expect(harnessHttp).toHaveBeenCalledWith(
        expect.objectContaining({
          method: "POST",
          url: "http://127.0.0.1:4096/permission/permission_child/reply?directory=%2Frepo",
          body: JSON.stringify({ reply }),
        }),
      );
      expect(events).toContainEqual({
        type: "approval.resolved",
        requestId: approval.requestId,
        decision,
      });
      const resolved = events.reduce(
        applyHarnessEvent,
        newSession("opencode", "/repo"),
      );
      expect(
        resolved.blocks.find(
          (block) => block.approval?.requestId === approval.requestId,
        )?.approval?.decided,
      ).toBe(decision);

      idle("session_child");
      expect(events).not.toContainEqual({ type: "message.completed" });
      idle();
      await done;
      expect(events).toContainEqual({ type: "message.completed" });
      expect(events.some((event) => event.type === "session.error")).toBe(
        false,
      );
    },
  );

  it("looks up ancestry for an existing child whose creation was not observed", async () => {
    const events: HarnessEvent[] = [];
    const { done } = await startTurn(events);
    harnessHttp
      .mockResolvedValueOnce({
        status: 200,
        body: JSON.stringify({
          id: "session_grandchild",
          parentID: "session_child",
        }),
      })
      .mockResolvedValueOnce({
        status: 200,
        body: JSON.stringify({ id: "session_child", parentID: "session_1" }),
      });
    askPermission("session_grandchild");
    await waitFor(
      () => events.some((event) => event.type === "approval.requested"),
      "existing child approval",
    );
    for (const sessionID of ["session_grandchild", "session_child"]) {
      expect(harnessHttp).toHaveBeenCalledWith(
        expect.objectContaining({
          method: "GET",
          url: `http://127.0.0.1:4096/session/${sessionID}?directory=%2Frepo`,
        }),
      );
    }
    await cancelOpenCodeTurn("opencode-live");
    await done;
    expect(harnessHttp).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "http://127.0.0.1:4096/permission/permission_child/reply?directory=%2Frepo",
        body: JSON.stringify({ reply: "reject" }),
      }),
    );
  });

  it("ignores unrelated sessions and child transcript, status, and error events", async () => {
    const events: HarnessEvent[] = [];
    const { done } = await startTurn(events);
    sessionCreated("session_child", "session_1");
    sessionCreated("session_other");
    sessionCreated("session_other_child", "session_other");
    const before = [...events];
    askPermission("session_other_child");
    for (const sessionID of ["session_child", "session_other"]) {
      onSseEvent?.({
        type: "message.updated",
        properties: {
          info: {
            id: "message_child",
            sessionID,
            role: "assistant",
            tokens: { input: 123 },
          },
        },
      });
      onSseEvent?.({
        type: "message.part.updated",
        properties: {
          part: {
            id: "part_child",
            sessionID,
            type: "text",
            text: "Child-only text",
          },
        },
      });
      onSseEvent?.({
        type: "message.part.updated",
        properties: {
          part: {
            id: "tool_child",
            sessionID,
            type: "tool",
            tool: "read",
            state: { status: "completed" },
          },
        },
      });
      idle(sessionID);
      onSseEvent?.({
        type: "session.error",
        properties: { sessionID, error: { message: "Child failed" } },
      });
    }
    idle();
    await done;
    expect(events).toEqual([
      ...before,
      { type: "message.completed" },
      { type: "reasoning.completed" },
    ]);
    expect(
      harnessHttp.mock.calls.some(([input]) =>
        input.url.includes("/permission/"),
      ),
    ).toBe(false);
  });

  it("keeps concurrent child requests distinct and deduplicates repeated events", async () => {
    const events: HarnessEvent[] = [];
    const { done } = await startTurn(events);
    sessionCreated("session_child", "session_1");
    onSseEvent?.({
      type: "session.updated",
      properties: { info: { id: "session_sibling", parentID: "session_1" } },
    });
    askPermission("session_child", "permission_a");
    askPermission("session_sibling", "permission_b");
    askPermission("session_child", "permission_a");
    await waitFor(
      () =>
        events.filter((event) => event.type === "approval.requested").length >=
        2,
      "two approvals",
    );
    const approvals = events.filter(
      (event) => event.type === "approval.requested",
    );
    expect(approvals).toHaveLength(2);
    expect(approvals[0].requestId).not.toBe(approvals[1].requestId);
    respondOpenCodeApproval("opencode-live", approvals[1].requestId, "deny");
    respondOpenCodeApproval("opencode-live", approvals[0].requestId, "allow");
    idle();
    await done;
    const replies = harnessHttp.mock.calls.filter(([input]) =>
      input.url.includes("/permission/"),
    );
    expect(
      replies.map(([input]) => [
        new URL(input.url).pathname,
        JSON.parse(input.body!),
      ]),
    ).toEqual([
      ["/permission/permission_b/reply", { reply: "reject" }],
      ["/permission/permission_a/reply", { reply: "once" }],
    ]);
  });

  it("surfaces ancestry lookup errors instead of silently losing requests", async () => {
    const events: HarnessEvent[] = [];
    const { done } = await startTurn(events);
    harnessHttp.mockResolvedValueOnce({
      status: 500,
      body: "Session lookup failed",
    });
    askPermission("session_child");
    await done;
    expect(events).toContainEqual({
      type: "session.error",
      message: "Could not route OpenCode event: Session lookup failed",
    });
    expect(events.some((event) => event.type === "approval.requested")).toBe(
      false,
    );
  });

  it("does not show a late child approval after cancellation", async () => {
    const events: HarnessEvent[] = [];
    const { done } = await startTurn(events);
    let resolveLookup!: (response: { status: number; body: string }) => void;
    harnessHttp.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveLookup = resolve;
        }),
    );
    askPermission("session_child");
    await cancelOpenCodeTurn("opencode-live");
    resolveLookup({
      status: 200,
      body: JSON.stringify({ id: "session_child", parentID: "session_1" }),
    });
    await done;
    expect(events.some((event) => event.type === "approval.requested")).toBe(
      false,
    );
  });

  it.each(["answered", "skipped"] as const)(
    "routes child questions when %s",
    async (kind) => {
      const events: HarnessEvent[] = [];
      const { done } = await startTurn(events);
      sessionCreated("session_child", "session_1");
      onSseEvent?.({
        type: "question.asked",
        properties: {
          id: "question_child",
          sessionID: "session_child",
          questions: [
            {
              question: "Which directory?",
              options: [{ label: "Repo", description: "Use the repository" }],
            },
          ],
        },
      });
      await waitFor(
        () => events.some((event) => event.type === "question.asked"),
        "child question",
      );
      const request = events.find((event) => event.type === "question.asked")!;
      const question = request.questions[0];
      respondOpenCodeQuestion(
        "opencode-live",
        request.requestId,
        kind === "answered"
          ? { kind, answers: { [question.id]: [question.options[0].id] } }
          : { kind },
      );
      idle();
      await done;
      expect(harnessHttp).toHaveBeenCalledWith(
        expect.objectContaining({
          method: "POST",
          url: `http://127.0.0.1:4096/question/question_child/${kind === "answered" ? "reply" : "reject"}?directory=%2Frepo`,
          body: JSON.stringify(
            kind === "answered" ? { answers: [["Repo"]] } : {},
          ),
        }),
      );
      expect(events).toContainEqual({
        type: "question.resolved",
        requestId: request.requestId,
        decision: kind,
      });
    },
  );
});

it("closes an event stream that ended on its own when the session stops", async () => {
  const events: HarnessEvent[] = [];
  const { done } = await startTurn(events);
  onSseEnd?.("stream closed");
  await done.catch(() => undefined);
  closeHarnessSse.mockClear();

  await stopOpenCodeSession("opencode-live");
  expect(closeHarnessSse).toHaveBeenCalledWith("opencode-live");
});

it("closes the event stream after the server exits on its own", async () => {
  const events: HarnessEvent[] = [];
  const { done } = await startTurn(events);
  onChildExit?.(1);
  await expect(done).rejects.toThrow("OpenCode server exited");
  expect(events).toContainEqual({ type: "session.ended", code: 1 });

  await stopOpenCodeSession("opencode-live");
  expect(closeHarnessSse).toHaveBeenCalledExactlyOnceWith("opencode-live");
  expect(killChild).toHaveBeenCalledExactlyOnceWith("opencode-live");
});

it("still kills the child when closing an ended stream fails", async () => {
  const events: HarnessEvent[] = [];
  const { done } = await startTurn(events);
  onSseEnd?.("stream closed");
  await expect(done).rejects.toThrow("stream closed");
  closeHarnessSse.mockClear();
  killChild.mockClear();
  closeHarnessSse.mockRejectedValueOnce(new Error("SSE close failed"));

  await expect(stopOpenCodeSession("opencode-live")).resolves.toBeUndefined();
  expect(closeHarnessSse).toHaveBeenCalledExactlyOnceWith("opencode-live");
  expect(killChild).toHaveBeenCalledExactlyOnceWith("opencode-live");
});

describe("OpenCode 2.x Operator server (L-193)", () => {
  const v2Prompt = (events: HarnessEvent[], appAccess: boolean) => {
    const before = harnessHttp.mock.calls.length;
    const done = turn(events, { appAccess });
    return {
      done,
      prompted: () =>
        waitFor(
          () =>
            harnessHttp.mock.calls
              .slice(before)
              .some(([input]) => new URL(input.url).pathname === "/api/session/session_1/prompt"),
          "v2 prompt",
        ),
    };
  };
  const finish = () =>
    onSseEvent?.({
      id: `evt_done_${Math.random()}`,
      type: "session.execution.succeeded",
      data: { sessionID: "session_1" },
    });

  beforeEach(() => {
    openCodeVersion = "opencode v2.0.32";
    spawnChild.mockImplementation(async () => {
      onStdout?.("server listening on http://127.0.0.1:4100");
      onStdout?.("server password private-pass");
    });
  });
  afterEach(() => {
    spawnChild.mockImplementation(async () => {
      onStdout?.("opencode server listening on http://127.0.0.1:4096");
    });
  });

  it("starts a private server for an Operator turn so the app connection reaches its shell", async () => {
    const events: HarnessEvent[] = [];
    const first = v2Prompt(events, true);
    await first.prompted();
    expect(spawnChild).toHaveBeenCalledWith(
      "opencode-live",
      "/fake/opencode",
      ["serve", "--hostname=127.0.0.1", "--port=4096"],
      "/repo",
      undefined,
      "opencode",
    );
    const prompt = harnessHttp.mock.calls.find(
      ([input]) => new URL(input.url).pathname === "/api/session/session_1/prompt",
    )?.[0] as { url: string; headers?: Record<string, string> };
    expect(new URL(prompt.url).origin).toBe("http://127.0.0.1:4100");
    expect(prompt.headers?.Authorization).toBe(
      `Basic ${btoa("opencode:private-pass")}`,
    );
    finish();
    await first.done;
  });

  it("moves a chat from the shared service to a private server when Operator turns on", async () => {
    const events: HarnessEvent[] = [];
    const plain = v2Prompt(events, false);
    await plain.prompted();
    expect(spawnChild).not.toHaveBeenCalled();
    finish();
    await plain.done;

    const operator = v2Prompt(events, true);
    await operator.prompted();
    expect(spawnChild).toHaveBeenCalledTimes(1);
    // The same OpenCode conversation continues on the new server.
    expect(
      harnessHttp.mock.calls.some(
        ([input]) =>
          input.url.startsWith("http://127.0.0.1:4100") &&
          new URL(input.url).pathname === "/api/session/session_1" &&
          input.method === "GET",
      ),
    ).toBe(true);
    finish();
    await operator.done;

    // Later turns keep the private server, with or without Operator.
    const after = v2Prompt(events, false);
    await after.prompted();
    expect(spawnChild).toHaveBeenCalledTimes(1);
    finish();
    await after.done;
  });
});

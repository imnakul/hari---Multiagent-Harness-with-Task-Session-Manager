// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { newSession } from "../../sessions/model/session";
import { ClickupError } from "../../clickup/model/clickupApi";
import { runClickupAction } from "../../clickup/model/clickupAgent";
import { createClickupStore } from "../../clickup/model/clickupStore";
import { LIST_INFO, MEMBER_ANA, makeTask } from "../../clickup/model/clickupTestKit";
import { handleAgentApp, type AgentAppHost } from "./agentApp";

vi.mock("../../../integrations/harness/core/availability", () => ({
  isHarnessAvailable: (id: string) => id === "codex" || id === "claude",
}));

const LISTS = [{ id: "9001", name: "Sprint" }];

function agentDeps(overrides: { connected?: boolean; apiError?: ClickupError } = {}) {
  const api = {
    list: vi.fn().mockResolvedValue(LIST_INFO),
    members: vi.fn().mockResolvedValue([MEMBER_ANA]),
    tasks: vi.fn().mockResolvedValue({ tasks: [makeTask("1"), makeTask("2", { status: { status: "complete", type: "closed", color: "" } })], lastPage: true }),
    createTask: vi.fn().mockResolvedValue(makeTask("new")),
    updateTask: vi.fn().mockResolvedValue(makeTask("1", { dateUpdated: 2000 })),
    isConnected: vi.fn().mockResolvedValue(overrides.connected ?? true),
    task: overrides.apiError
      ? vi.fn().mockRejectedValue(overrides.apiError)
      : vi.fn().mockResolvedValue(makeTask("1")),
  };
  return { api, deps: { lists: LISTS, store: createClickupStore(api), api } };
}

describe("ClickUp agent actions (L-381)", () => {
  it("lists the lists with statuses and member names (AC-C13)", async () => {
    const { deps } = agentDeps();
    const result = await runClickupAction("clickup.lists", {}, deps);
    expect(result).toEqual({
      lists: [{ id: "9001", name: "Sprint", statuses: ["to do", "in progress", "complete"], members: ["Ana"] }],
    });
  });

  it("reads open tasks only unless includeClosed is set (AC-C13)", async () => {
    const { deps } = agentDeps();
    const open = (await runClickupAction("clickup.tasks", {}, deps)) as { tasks: unknown[] };
    expect(open.tasks).toHaveLength(1);
    const all = (await runClickupAction("clickup.tasks", { includeClosed: true }, deps)) as { tasks: unknown[] };
    expect(all.tasks).toHaveLength(2);
  });

  it("creates a task by list name and assignee username (AC-C14)", async () => {
    const { api, deps } = agentDeps();
    const result = await runClickupAction(
      "clickup.create",
      { list: "sprint", name: "Fix it", assignees: ["ana"], priority: "high", dueDate: "2026-07-01" },
      deps,
    );
    expect(result).toEqual({ id: "new", url: "https://app.clickup.com/t/new" });
    const [listId, input] = api.createTask.mock.calls[0];
    expect(listId).toBe("9001");
    expect(input).toMatchObject({ name: "Fix it", assignees: [1], priority: 2, due_date_time: false });
  });

  it("updates with done:true by moving to the first closed status (AC-C15)", async () => {
    const { api, deps } = agentDeps();
    const result = (await runClickupAction("clickup.update", { id: "1", done: true }, deps)) as { changed: boolean };
    expect(result.changed).toBe(true);
    expect(api.updateTask).toHaveBeenCalledWith("1", { status: "complete" });
  });

  it("makes no request when nothing changes (AC-C15)", async () => {
    const { api, deps } = agentDeps();
    const result = (await runClickupAction("clickup.update", { id: "1" }, deps)) as { changed: boolean };
    expect(result.changed).toBe(false);
    expect(api.updateTask).not.toHaveBeenCalled();
  });

  it("explains when ClickUp is not connected (AC-C18)", async () => {
    const { deps } = agentDeps({ connected: false });
    await expect(runClickupAction("clickup.lists", {}, deps)).rejects.toThrow(/not connected/i);
  });

  it("names the options for an unknown list or assignee (AC-C19)", async () => {
    const { deps } = agentDeps();
    await expect(runClickupAction("clickup.create", { list: "Nope", name: "x" }, deps)).rejects.toThrow(
      /Unknown list/,
    );
    await expect(
      runClickupAction("clickup.create", { name: "x", assignees: ["zed"] }, deps),
    ).rejects.toThrow(/Unknown assignee zed; members: Ana/);
  });

  it("never carries the token or a raw error into the message (AC-C20)", async () => {
    const { deps } = agentDeps({ apiError: new ClickupError("auth", undefined, "pk_secret_token") });
    const failure = await runClickupAction("clickup.update", { id: "1", name: "x" }, deps).catch(
      (error: unknown) => error,
    );
    expect(String(failure)).not.toContain("pk_secret_token");
  });
});

function hostWith(linked: string | null, run = vi.fn(async () => ({ ok: true }))): {
  host: AgentAppHost;
  run: typeof run;
} {
  const host = {
    isMono: () => false,
    clickup: { linkedProject: () => linked, run },
  } as unknown as AgentAppHost;
  return { host, run };
}

describe("ClickUp through the app command (L-381)", () => {
  it("runs for a session in the linked project (AC-C17)", async () => {
    const source = newSession("codex", "/work/app", "codex:test");
    const { host, run } = hostWith("/work/app");
    await handleAgentApp(source, "r1", "clickup.lists", {}, host);
    expect(run).toHaveBeenCalledWith("clickup.lists", {});
  });

  it("refuses a session from another project (AC-C17)", async () => {
    const source = newSession("codex", "/work/other", "codex:test");
    const { host, run } = hostWith("/work/app");
    await expect(handleAgentApp(source, "r2", "clickup.tasks", {}, host)).rejects.toThrow("ClickUp is linked to app.");
    expect(run).not.toHaveBeenCalled();
  });

  it("refuses a Mono that does not work on the linked project (AC-C17)", async () => {
    const source = newSession("codex", "/work/other", "codex:test");
    const { host, run } = hostWith("/work/app");
    host.isMono = () => true;
    host.monoOf = () => ({ id: "m", projects: ["/work/other"] });
    await expect(handleAgentApp(source, "r3", "clickup.tasks", {}, host)).rejects.toThrow("ClickUp is linked to app.");
    expect(run).not.toHaveBeenCalled();
  });

  it("allows any session when no project is linked", async () => {
    const source = newSession("codex", "/anywhere", "codex:test");
    const { host, run } = hostWith(null);
    await handleAgentApp(source, "r4", "clickup.lists", {}, host);
    expect(run).toHaveBeenCalledTimes(1);
  });
});

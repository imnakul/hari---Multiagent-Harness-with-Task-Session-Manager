import { describe, expect, it, vi } from "vitest";
import { ClickupError, type ClickupTask } from "./clickupApi";
import { createClickupStore } from "./clickupStore";
import { LIST_INFO, MEMBER_ANA, makeTask } from "./clickupTestKit";

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

type TasksReply = { tasks: ClickupTask[]; lastPage: boolean };

function makeApi(overrides: Record<string, unknown> = {}) {
  return {
    list: vi.fn().mockResolvedValue(LIST_INFO),
    members: vi.fn().mockResolvedValue([MEMBER_ANA]),
    tasks: vi.fn().mockResolvedValue({ tasks: [makeTask("1")], lastPage: true } satisfies TasksReply),
    createTask: vi.fn().mockResolvedValue(makeTask("new")),
    updateTask: vi.fn().mockResolvedValue(makeTask("1", { name: "saved", dateUpdated: 2000 })),
    ...overrides,
  };
}

describe("clickupStore (L-381)", () => {
  it("runs one save when the same task is saved twice at once (AC-C4)", async () => {
    const gate = deferred<ClickupTask>();
    const api = makeApi({ updateTask: vi.fn().mockReturnValue(gate.promise) });
    const store = createClickupStore(api);
    const first = store.updateTask("1", "9001", { name: "a" });
    const second = await store.updateTask("1", "9001", { name: "a" });
    expect(second).toBeNull();
    gate.resolve(makeTask("1"));
    await first;
    expect(api.updateTask).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot().savingTaskIds).toEqual([]);
  });

  it("does not start a second refresh while one is loading, and keeps the newest result (AC-C5)", async () => {
    const slow = deferred<TasksReply>();
    const tasks = vi
      .fn()
      .mockReturnValueOnce(slow.promise)
      .mockResolvedValueOnce({ tasks: [makeTask("fresh")], lastPage: true });
    const store = createClickupStore(makeApi({ tasks }));
    const first = store.refresh("9001", { force: true });
    await store.refresh("9001", { force: true });
    expect(tasks).toHaveBeenCalledTimes(1);
    slow.resolve({ tasks: [makeTask("old")], lastPage: true });
    await first;
    await store.refresh("9001", { force: true });
    expect(store.getSnapshot().lists["9001"]?.tasks.map((task) => task.id)).toEqual(["fresh"]);
  });

  it("keeps a save that is newer than a refresh result (AC-C5)", async () => {
    const api = makeApi();
    const store = createClickupStore(api);
    await store.refresh("9001");
    await store.updateTask("1", "9001", { name: "saved" });
    api.tasks.mockResolvedValueOnce({ tasks: [makeTask("1", { name: "stale", dateUpdated: 1000 })], lastPage: true });
    await store.refresh("9001", { force: true });
    expect(store.getSnapshot().lists["9001"]?.tasks[0]?.name).toBe("saved");
  });

  it("blocks further requests after a 429 until the wait ends (AC-C6)", async () => {
    let clock = 0;
    const api = makeApi({ tasks: vi.fn().mockRejectedValue(new ClickupError("rateLimited", 30)) });
    const store = createClickupStore(api, () => clock);
    await store.refresh("9001", { force: true });
    expect(store.getSnapshot().retryAt).toBe(30_000);
    api.tasks.mockClear();
    await store.refresh("9001", { force: true });
    expect(api.tasks).not.toHaveBeenCalled();
    clock = 31_000;
    api.tasks.mockResolvedValue({ tasks: [], lastPage: true });
    await store.refresh("9001", { force: true });
    expect(api.tasks).toHaveBeenCalledTimes(1);
  });

  it("makes a list read-only after a 403 on save (AC-C8)", async () => {
    const api = makeApi({ updateTask: vi.fn().mockRejectedValue(new ClickupError("forbidden")) });
    const store = createClickupStore(api);
    await expect(store.updateTask("1", "9001", { name: "x" })).rejects.toMatchObject({ kind: "forbidden" });
    expect(store.getSnapshot().readOnlyLists).toEqual(["9001"]);
  });

  it("asks to connect again when the token is rejected (AC-C10)", async () => {
    const store = createClickupStore(makeApi({ tasks: vi.fn().mockRejectedValue(new ClickupError("auth")) }));
    await store.refresh("9001", { force: true });
    expect(store.getSnapshot().needsConnect).toBe(true);
    expect(store.getSnapshot().lists["9001"]?.load.kind).toBe("error");
  });

  it("shows created tasks first and loads meta when members are not readable", async () => {
    const api = makeApi({ members: vi.fn().mockRejectedValue(new ClickupError("forbidden")) });
    const store = createClickupStore(api);
    await store.loadMeta("9001");
    expect(store.getSnapshot().lists["9001"]?.meta?.name).toBe("Sprint");
    await store.createTask("9001", { name: "new" });
    expect(store.getSnapshot().createdIds).toEqual(["new"]);
    expect(store.getSnapshot().lists["9001"]?.tasks[0]?.id).toBe("new");
  });
});

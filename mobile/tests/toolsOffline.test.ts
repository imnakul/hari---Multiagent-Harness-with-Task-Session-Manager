import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createTask,
  listNotes,
  listTasks,
  readNote,
  saveNote,
  updateTask,
  type Command,
  type Note,
  type NoteItem,
  type TaskItem,
} from "@/features/tools/tools";
import {
  overlayNote,
  overlayNotes,
  overlayTasks,
  parseList,
  parseTaskItem,
  pruneNotes,
  queuedNoteBase,
  rememberNote,
  NOTE_BODIES_MAX,
} from "@/features/tools/toolsOverlay";

// Fork (Hari, L-281): Tasks and Notes offline. The link and the phone's storage
// are stand-ins: `link.live` says whether the computer answers, and the outbox
// is a plain list.
const saved = new Map<string, string>();
const link = vi.hoisted(() => ({
  live: true,
  outbox: [] as { id: string; kind: string; payload: unknown }[],
  next: 0,
}));

vi.mock("expo-sqlite/kv-store", () => ({
  default: {
    getItemSync: (key: string) => saved.get(key) ?? null,
    setItemSync: (key: string, value: string) => void saved.set(key, value),
  },
}));
vi.mock("@/features/link/linkStream", () => ({
  linkComputer: () => "fp-1",
  linkCanQueue: () => true,
  linkStreamLive: () => link.live,
  pendingLinkItems: () => [...link.outbox],
  sendLinkItem: (kind: string, payload: unknown) => {
    const id = `item-${(link.next += 1)}`;
    link.outbox.push({ id, kind, payload });
    return id;
  },
  dropLinkItems: (match: (item: { kind: string; payload: unknown }) => boolean) => {
    link.outbox = link.outbox.filter((item) => !match(item));
  },
}));

const task = (id: string, change: Partial<TaskItem> = {}): TaskItem => ({
  id,
  title: id,
  excerpt: "",
  status: "todo",
  tags: [],
  projectCwd: null,
  sourceSessionId: null,
  createdAt: 1,
  updatedAt: 1,
  completedAt: null,
  archived: false,
  focusDate: null,
  focusDays: [],
  ...change,
});

const note = (id: string, change: Partial<Note> = {}): Note => ({
  id,
  slug: id,
  title: id,
  body: `# ${id}`,
  tags: [],
  sourceCwd: null,
  sourceSessionId: null,
  createdAt: 1,
  updatedAt: 1,
  ...change,
});

const item = (id: string, updatedAt = 1): NoteItem => ({
  id,
  title: id,
  excerpt: "",
  tags: [],
  sourceCwd: null,
  updatedAt,
});

/** A computer that answers from these lists, or not at all when the link is down. */
function computer(tasks: TaskItem[], notes: Note[]): Command {
  return async <T>(method: string, params?: object): Promise<T> => {
    if (!link.live) throw new Error("not connected");
    const id = params && "id" in params ? params.id : null;
    const answers: Record<string, unknown> = {
      "tasks.list": { tasks },
      "notes.list": { notes: notes.map((each) => item(each.id, each.updatedAt)) },
      "notes.read": { note: notes.find((each) => each.id === id) },
    };
    // The test owns the answer shapes; the screen code trusts the computer the same way.
    return answers[method] as T;
  };
}

beforeEach(() => {
  saved.clear();
  link.live = true;
  link.outbox = [];
});

describe("stored lists", () => {
  it("keeps the entries that still read and drops the rest", () => {
    expect(parseList("nope", parseTaskItem)).toBeNull();
    const read = parseList([task("a"), { id: "b" }, null, task("c", { status: "completed" })], parseTaskItem);
    expect(read?.map((each) => each.id)).toEqual(["a", "c"]);
  });

  it("keeps the last read notes first, up to the limit", () => {
    let bodies: Note[] = [];
    for (let index = 0; index < NOTE_BODIES_MAX + 5; index += 1) bodies = rememberNote(bodies, note(`n${index}`));
    bodies = rememberNote(bodies, note("n50", { body: "again" }));
    expect(bodies).toHaveLength(NOTE_BODIES_MAX);
    expect(bodies[0]).toMatchObject({ id: "n50", body: "again" });
  });

  it("forgets full notes the computer deleted", () => {
    expect(pruneNotes([note("a"), note("b")], [item("b")]).map((each) => each.id)).toEqual(["b"]);
  });
});

describe("waiting edits laid over", () => {
  it("shows a task made offline first and applies updates in order", () => {
    const shown = overlayTasks(
      [task("a")],
      [
        { id: "1", kind: "tasks.create", payload: { id: "new", body: "# Buy milk", editedAt: 5 } },
        { id: "2", kind: "tasks.update", payload: { id: "a", status: "completed", editedAt: 6 } },
        { id: "3", kind: "tasks.update", payload: { id: "a", title: " Renamed ", editedAt: 7 } },
      ],
    );
    expect(shown.map((each) => each.id)).toEqual(["new", "a"]);
    expect(shown[0]).toMatchObject({ title: "Buy milk", status: "todo", updatedAt: 5 });
    expect(shown[1]).toMatchObject({ status: "completed", completedAt: 6, title: "Renamed", updatedAt: 7 });
  });

  it("doesn't show a created task twice once the computer has it", () => {
    const shown = overlayTasks([task("new")], [
      { id: "1", kind: "tasks.create", payload: { id: "new", title: "x", editedAt: 5 } },
    ]);
    expect(shown).toHaveLength(1);
  });

  it("puts a note saved offline first, keeping its tags and folder", () => {
    const shown = overlayNotes(
      [item("a", 9), { ...item("b", 3), tags: ["work"], sourceCwd: "E:\\Code" }],
      [{ id: "1", kind: "notes.save", payload: { id: "b", title: "", body: "Plan\nmore", editedAt: 10 } }],
    );
    expect(shown.map((each) => each.id)).toEqual(["b", "a"]);
    expect(shown[0]).toMatchObject({ title: "Plan", tags: ["work"], sourceCwd: "E:\\Code", updatedAt: 10 });
  });

  it("keeps the computer's time on an open note, the base its next save names", () => {
    const shown = overlayNote("a", note("a", { updatedAt: 4 }), [
      { id: "1", kind: "notes.save", payload: { id: "a", title: "A", body: "new", editedAt: 9 } },
    ]);
    expect(shown).toMatchObject({ body: "new", updatedAt: 4 });
    expect(overlayNote("x", null, [])).toBeNull();
  });

  it("names the first waiting save's base for later saves of the same note", () => {
    const pending = [{ id: "1", kind: "notes.save", payload: { id: "a", baseUpdatedAt: 4, editedAt: 5 } }];
    expect(queuedNoteBase("a", 9, pending)).toBe(4);
    expect(queuedNoteBase("b", 9, pending)).toBe(9);
  });
});

describe("offline Tasks", () => {
  it("shows the saved list when the computer is out of reach", async () => {
    const command = computer([task("a"), task("b")], []);
    expect((await listTasks(command)).offline).toBe(false);
    link.live = false;
    const listed = await listTasks(command, true);
    expect(listed).toMatchObject({ offline: true });
    expect(listed.items.map((each) => each.id)).toEqual(["a", "b"]);
  });

  it("fails as before when nothing was saved", async () => {
    link.live = false;
    await expect(listTasks(computer([], []), true)).rejects.toThrow("not connected");
  });

  it("queues changes with the base the phone saw, and shows them at once", async () => {
    const command = computer([task("a", { updatedAt: 3 })], []);
    await listTasks(command, true);
    link.live = false;

    const done = await updateTask(command, "a", { status: "completed" });
    const made = await createTask(command, { title: "Call back" });

    expect(done).toMatchObject({ id: "a", status: "completed" });
    expect(made).toMatchObject({ title: "Call back", status: "todo" });
    expect(link.outbox.map((each) => each.kind)).toEqual(["tasks.update", "tasks.create"]);
    expect(link.outbox[0].payload).toMatchObject({ id: "a", status: "completed", baseUpdatedAt: 3 });
    const listed = await listTasks(command, true);
    expect(listed.items.map((each) => [each.id, each.status])).toEqual([
      [made.id, "todo"],
      ["a", "completed"],
    ]);
  });

  it("refuses an offline change to a task the phone never saw", async () => {
    link.live = false;
    await expect(updateTask(computer([], []), "zz", { status: "completed" })).rejects.toThrow(
      "isn’t saved on this phone",
    );
    expect(link.outbox).toHaveLength(0);
  });
});

describe("offline Notes", () => {
  it("opens a note read before, and explains one it never read", async () => {
    const command = computer([], [note("a", { body: "kept" })]);
    await readNote(command, "a");
    link.live = false;
    expect((await readNote(command, "a")).body).toBe("kept");
    await expect(readNote(command, "b")).rejects.toThrow("isn’t saved on this phone yet");
  });

  it("keeps one waiting save per note, naming the first base", async () => {
    const command = computer([], [note("a", { updatedAt: 4 })]);
    await listNotes(command, true);
    await readNote(command, "a");
    link.live = false;

    const first = await saveNote(command, { id: "a", title: "A", body: "one", baseUpdatedAt: 4 });
    const second = await saveNote(command, { id: "a", title: "A", body: "two", baseUpdatedAt: 4, queue: true });

    expect(first).toMatchObject({ conflict: false, queued: expect.any(String) });
    expect(second.conflict === false && second.queued).not.toBe(first.conflict === false && first.queued);
    expect(second).toMatchObject({ conflict: false, queued: expect.any(String) });
    expect(link.outbox).toHaveLength(1);
    expect(link.outbox[0].payload).toMatchObject({ id: "a", body: "two", baseUpdatedAt: 4 });
    expect((await readNote(command, "a")).body).toBe("two");
    const listed = await listNotes(command, true);
    expect(listed).toMatchObject({ offline: true });
    expect(listed.items[0]).toMatchObject({ id: "a", excerpt: "two" });
  });

  it("keeps saving to the outbox once an editor queued, even with the link back", async () => {
    const command = computer([], [note("a")]);
    await saveNote(command, { id: "a", title: "A", body: "one", baseUpdatedAt: 1, queue: true });
    expect(link.outbox).toHaveLength(1);
  });
});

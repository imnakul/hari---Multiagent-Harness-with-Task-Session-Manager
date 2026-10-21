import { describe, expect, it } from "vitest";
import {
  appendNoteReference,
  composeNoteMessage,
  injectNotePrompt,
  isNoteMentionPath,
  noteCardMeta,
  noteMentionLabel,
  notePreview,
  noteProjectChoices,
  noteSourceProject,
  noteSlugsInText,
  notesAsProjectFiles,
  normalizeNoteTags,
  noteTitle,
  rankNoteFiles,
  type Note,
} from "./notes";

function note(
  partial: Partial<Note> & Pick<Note, "id" | "slug" | "title">,
): Note {
  return {
    body: "",
    tags: [],
    slugPending: false,
    createdAt: 1,
    updatedAt: 1,
    ...partial,
  };
}

describe("noteTitle", () => {
  it("uses the first heading", () => {
    expect(noteTitle("intro\n# Auth approach\n\nbody")).toBe("Auth approach");
  });

  it("falls back to the first prose line", () => {
    expect(noteTitle("Ship the notes overlay first.")).toBe(
      "Ship the notes overlay first.",
    );
  });

  it("returns Untitled when empty", () => {
    expect(noteTitle("   \n```\ncode\n```\n")).toBe("Untitled");
  });
});

describe("normalizeNoteTags", () => {
  it("normalizes, deduplicates, and drops empty tags", () => {
    expect(
      normalizeNoteTags([" Ideas ", "#Project Docs", "ideas", "###"]),
    ).toEqual(["ideas", "project-docs"]);
  });
});

describe("notePreview", () => {
  it("skips the title heading", () => {
    expect(notePreview("# Auth\n\nKeep it global.", "Auth")).toBe(
      "Keep it global.",
    );
  });
});

describe("noteSourceProject", () => {
  it("uses the folder name", () => {
    expect(noteSourceProject("/Users/me/code/agent-terminal")).toBe(
      "agent-terminal",
    );
  });

  it("uses the folder name for Windows paths", () => {
    expect(
      noteSourceProject("E:\\Developing\\Knoarc\\rigorup-active\\Teacher"),
    ).toBe("Teacher");
  });

  it("returns null when there is no project", () => {
    expect(noteSourceProject(undefined)).toBeNull();
    expect(noteSourceProject("~")).toBeNull();
    expect(noteSourceProject("/")).toBeNull();
  });
});

describe("noteProjectChoices", () => {
  it("puts the current project first and Personal last", () => {
    const choices = noteProjectChoices("/repo/web", [
      { path: "/repo/api" },
      { path: "/repo/web" },
    ]);
    expect(choices.map((choice) => choice.id)).toEqual([
      "project:/repo/web",
      "project:/repo/api",
      "personal",
    ]);
    expect(choices[0]).toMatchObject({ kind: "project", current: true });
    expect(choices[2]).toMatchObject({ kind: "personal", current: false });
  });

  it("dedupes across separators and lists every project", () => {
    const recents = [
      { path: "E:\\a\\one" },
      { path: "E:/a/one" },
      { path: "/b/two" },
      { path: "/c/three" },
      { path: "/d/four" },
      { path: "/e/five" },
      { path: "/f/six" },
      { path: "/g/seven" },
    ];
    const choices = noteProjectChoices(undefined, recents);
    const projects = choices.filter((choice) => choice.kind === "project");
    // One separator-variant duplicate removed; no cap (L-169).
    expect(projects.map((choice) => choice.id)).toEqual([
      "project:E:\\a\\one",
      "project:/b/two",
      "project:/c/three",
      "project:/d/four",
      "project:/e/five",
      "project:/f/six",
      "project:/g/seven",
    ]);
    expect(choices[choices.length - 1]).toMatchObject({
      id: "personal",
      current: true,
    });
  });

  it("marks Personal current when there is no project context", () => {
    const choices = noteProjectChoices("~", []);
    expect(choices).toEqual([{ id: "personal", kind: "personal", current: true }]);
  });
});

describe("note mentions", () => {
  it("collects unique @note/slug tokens", () => {
    expect(
      noteSlugsInText("See @note/auth and @note/auth plus @note/plan-2."),
    ).toEqual(["auth", "plan-2"]);
  });

  it("injects referenced bodies after the prompt", () => {
    expect(
      injectNotePrompt("Use this.", [
        note({
          id: "n1",
          slug: "auth",
          title: "Auth",
          body: "Use a cookie.",
        }),
      ]),
    ).toBe('Use this.\n\n---\nReferenced note "Auth":\n\nUse a cookie.');
  });

  it("maps notes to mention files", () => {
    const files = notesAsProjectFiles([
      note({ id: "abc", slug: "auth", title: "Auth" }),
    ]);
    expect(files[0]).toEqual({
      name: "Auth",
      path: "note:abc",
      relative: "note/auth",
    });
    expect(isNoteMentionPath(files[0]!.path)).toBe(true);
    expect(
      noteMentionLabel(note({ id: "abc", slug: "auth", title: "Auth" })),
    ).toBe("note/auth");
  });
});

describe("composeNoteMessage", () => {
  const card = {
    id: "n1",
    slug: "auth",
    title: "Auth",
    body: "Use a cookie.",
  };

  it("sends a lead-in plus the note when the textarea is empty", () => {
    expect(composeNoteMessage(card, "  ")).toBe(
      'Use this note.\n\n---\nReferenced note "Auth":\n\nUse a cookie.',
    );
  });

  it("keeps the user's message and appends the note", () => {
    expect(composeNoteMessage(card, "Start with the cookie.")).toBe(
      'Start with the cookie.\n\n---\nReferenced note "Auth":\n\nUse a cookie.',
    );
  });

  it("passes the draft through when there is no card", () => {
    expect(composeNoteMessage(undefined, " hello ")).toBe("hello");
  });
});

describe("noteCardMeta", () => {
  it("drops the body so the thread chip can persist without the prompt dump", () => {
    expect(
      noteCardMeta({
        id: "n1",
        slug: "overview",
        title: "Overview",
        body: "long secret body",
        sourceCwd: "/tmp/project",
      }),
    ).toEqual({
      id: "n1",
      slug: "overview",
      title: "Overview",
      sourceCwd: "/tmp/project",
    });
  });
});

describe("appendNoteReference", () => {
  it("separates from existing draft text", () => {
    expect(appendNoteReference("hello", "Auth", "Use a cookie.")).toBe(
      "hello\n\nNote: Auth\n\nUse a cookie.\n\n",
    );
    expect(appendNoteReference("", "Auth", "Use a cookie.")).toBe(
      "Note: Auth\n\nUse a cookie.\n\n",
    );
  });
});

describe("rankNoteFiles", () => {
  const notes = [
    note({ id: "a", slug: "alpha", title: "Alpha", updatedAt: 2 }),
    note({ id: "b", slug: "beta", title: "Beta plan", updatedAt: 3 }),
  ];

  it("keeps recency order without a query", () => {
    expect(rankNoteFiles(notes, "").map((file) => file.path)).toEqual([
      "note:b",
      "note:a",
    ]);
  });

  it("fuzzy-matches titles", () => {
    expect(rankNoteFiles(notes, "plan").map((file) => file.path)).toEqual([
      "note:b",
    ]);
  });

  it("fuzzy-matches tags", () => {
    const tagged = [
      note({
        id: "a",
        slug: "reference",
        title: "Reference",
        tags: ["important-links"],
      }),
    ];
    expect(rankNoteFiles(tagged, "important").map((file) => file.path)).toEqual(
      ["note:a"],
    );
  });
});

describe("noteMentionLabel", () => {
  it("prefixes the slug", () => {
    expect(
      noteMentionLabel(note({ id: "n", slug: "auth", title: "Auth" })),
    ).toBe("note/auth");
  });
});

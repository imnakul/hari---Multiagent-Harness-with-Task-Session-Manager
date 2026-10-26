import {
  LoaderCircle,
  Plus,
  Search,
  File,
  Trash2,
  X,
} from "../../../shared/ui/icons";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { MarkdownDetailTabs } from "../../sessions/ui/MarkdownDetailTabs";
import { useMarkdownMode } from "../../sessions/ui/MarkdownModeToggle";
import {
  PersonalMark,
  ProjectMark,
  useProjectMarks,
  type ProjectMarks,
} from "../../projects/ui/ProjectMark";
import { SearchableProjectPicker } from "../../projects/ui/SearchableProjectPicker";
import { OverlayNav } from "../../../app/shell/TitleBar";
import { WindowControls } from "../../../app/shell/WindowControls";
import { useDragResize } from "../../../shared/hooks/useDragResize";
import { useLockOverscroll } from "../../../shared/hooks/useLockOverscroll";
import { formatRelativeTime } from "../../inbox/model/githubTasks";
import {
  createNote,
  deleteNote,
  loadNotes,
  MAX_NOTE_TAGS,
  NOTES_CHANGED_EVENT,
  normalizeNoteTags,
  notePreview,
  noteProjectChoices,
  noteSourceProject,
  noteTitle,
  peekNotes,
  upsertNote,
  requestAddNoteToChat,
  type Note,
} from "../notes";
import {
  InsertImageButton,
  MarkdownImageOverlay,
  useMarkdownImages,
} from "./useMarkdownImages";
import { projectName } from "../../../shared/lib/paths";
import { IS_MAC } from "../../../platform/tauri/platform";
import { inProjectScope } from "../../projects/model/projectScope";
import {
  looksLikeProject,
  type RecentProject,
} from "../../projects/model/recents";
import { AgentMarkdown } from "../../sessions/ui/AgentMarkdown";
import { ChevronDown } from "../../../shared/ui/icons";
import {
  ExplorerMenu,
  type ExplorerMenuItem,
} from "../../files/ui/ExplorerMenu";
import { loadRecents } from "../../projects/model/recents";
import { SharedHoverHighlight } from "../../sessions/ui/SharedHoverHighlight";
import { type NoteProjectChoice } from "../notes";

import { MarkdownEditorPanel } from "../../sessions/ui/MarkdownEditorPanel";
import type { MarkdownCaretTarget } from "../../sessions/ui/markdownCaret";

const MIN_WIDTH = 240;
const MAX_WIDTH = 420;
const DEFAULT_WIDTH = 280;

let rememberedWidth = DEFAULT_WIDTH;
let rememberedNoteId: string | null = null;

// Keep pending saves ordered across editor unmounts and reopened notes.
const noteSaveQueues = new Map<
  string,
  { pending: Promise<void>; saved?: Note }
>();

function enqueueNoteSave(
  id: string,
  save: (latest?: Note) => void | Promise<Note | void>,
) {
  const queue = noteSaveQueues.get(id) ?? { pending: Promise.resolve() };
  const persist = async () => {
    const saved = await save(queue.saved);
    if (saved) queue.saved = saved;
  };
  const pending = queue.pending.then(persist, persist).finally(() => {
    if (queue.pending === pending) noteSaveQueues.delete(id);
  });
  queue.pending = pending;
  noteSaveQueues.set(id, queue);
  return pending;
}

type Props = {
  tabbed?: boolean;
  active?: boolean;
  besideRail?: boolean;
  compactRail?: boolean;
  cwd?: string;
  /** Lists only this project and project-less notes when set. */
  scopeProject?: string;
  recents?: RecentProject[];
  onClose: () => void;
  onToggleSidebar?: () => void;
};

export function NotesView({
  tabbed = false,
  active = true,
  besideRail = false,
  compactRail = false,
  cwd,
  scopeProject,
  recents = [],
  onClose,
  onToggleSidebar,
}: Props) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const listLock = useLockOverscroll<HTMLDivElement>();
  const resize = useDragResize({
    min: MIN_WIDTH,
    max: () => Math.min(MAX_WIDTH, Math.round(window.innerWidth * 0.5)),
    defaultWidth: DEFAULT_WIDTH,
    initial: rememberedWidth,
    onCommit: (width) => {
      rememberedWidth = width;
    },
  });
  const [notes, setNotes] = useState<Note[]>(() => peekNotes() ?? []);
  const [loading, setLoading] = useState(() => peekNotes() == null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    const cached = peekNotes();
    return (
      cached?.find((note) => note.id === rememberedNoteId)?.id ??
      cached?.[0]?.id ??
      rememberedNoteId
    );
  });
  const [creating, setCreating] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const menuRef = useRef(menu);
  menuRef.current = menu;
  const plusRef = useRef<HTMLButtonElement>(null);
  const marks = useProjectMarks();

  const refresh = useCallback(async () => {
    try {
      const next = await loadNotes(true);
      setNotes(next);
      setError(null);
      setSelectedId((current) => {
        const preferred = current ?? rememberedNoteId;
        if (preferred && next.some((note) => note.id === preferred)) {
          return preferred;
        }
        return next[0]?.id ?? null;
      });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    window.addEventListener(NOTES_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(NOTES_CHANGED_EVENT, refresh);
  }, [refresh]);

  useEffect(() => {
    rememberedNoteId = selectedId;
  }, [selectedId]);

  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // The create menu dismisses itself; don't close the whole view under it.
      if (menuRef.current) return;
      event.preventDefault();
      event.stopPropagation();
      onCloseRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active]);

  const scoped = useMemo(
    () =>
      scopeProject
        ? notes.filter((note) => inProjectScope(note.sourceCwd, scopeProject))
        : notes,
    [notes, scopeProject],
  );

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return scoped;
    return scoped.filter((note) => {
      const project = noteSourceProject(note.sourceCwd)?.toLowerCase() ?? "";
      return (
        note.title.toLowerCase().includes(needle) ||
        note.body.toLowerCase().includes(needle) ||
        note.slug.toLowerCase().includes(needle) ||
        note.tags.some((tag) => tag.includes(needle.replace(/^#/, ""))) ||
        project.includes(needle)
      );
    });
  }, [scoped, query]);

  // A note from another project stays remembered, but a scoped list opens on
  // its own first note instead.
  const selected =
    visible.find((note) => note.id === selectedId) ??
    scoped.find((note) => note.id === selectedId) ??
    (scopeProject ? (visible[0] ?? null) : null);

  const createChoices = useMemo<NoteProjectChoice[]>(
    () => (menu ? noteProjectChoices(cwd, loadRecents()) : []),
    [cwd, menu],
  );

  const createMenuItems = useMemo<ExplorerMenuItem[]>(() => {
    const items: ExplorerMenuItem[] = [];
    for (const choice of createChoices) {
      if (choice.kind === "personal") items.push({ kind: "sep" });
      items.push({
        kind: "item",
        id: choice.id,
        label:
          choice.kind === "personal" ? "Personal" : projectName(choice.path),
        checked: choice.current,
      });
    }
    return items;
  }, [createChoices]);

  const onCreate = async (sourceCwd?: string) => {
    if (creating) return;
    setCreating(true);
    try {
      // A blank title marks the note's generated slug as pending.
      const note = await createNote({
        title: "",
        body: "",
        ...(sourceCwd && looksLikeProject(sourceCwd) ? { sourceCwd } : {}),
      });
      setNotes(await loadNotes(true));
      setSelectedId(note.id);
      setQuery("");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  };

  const openCreateMenu = () => {
    const rect = plusRef.current?.getBoundingClientRect();
    if (!rect) {
      void onCreate(cwd);
      return;
    }
    setMenu({ x: rect.left, y: rect.bottom + 4 });
  };

  const onPickProject = (choices: NoteProjectChoice[], id: string) => {
    setMenu(null);
    const choice = choices.find((item) => item.id === id);
    if (!choice) return;
    void onCreate(choice.kind === "project" ? choice.path : undefined);
  };

  const onSaved = (note: Note) => {
    setNotes((current) => {
      const next = current.map((item) => (item.id === note.id ? note : item));
      next.sort(
        (a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id),
      );
      return next;
    });
  };

  const onDelete = async (id: string) => {
    try {
      await deleteNote(id);
      const next = await loadNotes(true);
      setNotes(next);
      setSelectedId((current) => {
        if (current !== id) return current;
        return next[0]?.id ?? null;
      });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const onAddToChat = (note: Note) => {
    requestAddNoteToChat(note);
    onClose();
  };

  const list = (
    <div
      ref={resize.setPaneRef}
      className="relative flex h-full min-h-0 shrink-0 flex-col border-r border-stroke"
    >
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-stroke px-2">
        <div className="relative flex h-7 min-w-0 flex-1 items-center">
          <Search className="pointer-events-none absolute left-2 size-3 shrink-0 opacity-50" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter notes"
            aria-label="Filter notes"
            spellCheck={false}
            autoComplete="off"
            className="h-7 w-full rounded-md bg-transparent pl-7 pr-2 text-[12px] text-content outline-none placeholder:text-content/40"
          />
        </div>
        <button
          ref={plusRef}
          type="button"
          title="New note"
          aria-label="New note"
          disabled={creating}
          onClick={() => void onCreate(cwd)}
          className="grid size-6 shrink-0 place-items-center rounded-md text-content/45 hover:bg-content/10 hover:text-content disabled:opacity-40"
        >
          {creating ? (
            <LoaderCircle
              className="size-3.5 animate-spin"
              strokeWidth={1.75}
            />
          ) : (
            <Plus className="size-3.5" strokeWidth={1.75} />
          )}
        </button>
        <button
          type="button"
          title="Choose where the note is filed"
          aria-label="Choose where the note is filed"
          aria-expanded={menu !== null}
          disabled={creating}
          onClick={openCreateMenu}
          className="grid size-6 shrink-0 place-items-center rounded-md text-content/45 hover:bg-content/10 hover:text-content disabled:opacity-40"
        >
          <ChevronDown className="size-3.5" strokeWidth={1.75} />
        </button>
      </div>
      {menu ? (
        <ExplorerMenu
          x={menu.x}
          y={menu.y}
          ariaLabel="Choose where the note is filed"
          header={
            <p className="px-2 py-1 text-[11px] text-content/50">
              File note under…
            </p>
          }
          items={createMenuItems}
          onPick={(id) => onPickProject(createChoices, id)}
          onClose={() => setMenu(null)}
        />
      ) : null}
      <div
        ref={listLock}
        className="relative min-h-0 flex-1 overflow-y-auto overscroll-none"
      >
        <SharedHoverHighlight />
        {error && notes.length === 0 ? (
          <p className="px-3 py-2 text-[12px] text-content/50">{error}</p>
        ) : loading && notes.length === 0 ? (
          <div className="flex justify-center py-10 text-content/40">
            <LoaderCircle className="size-4 animate-spin" strokeWidth={1.75} />
          </div>
        ) : visible.length === 0 ? (
          <p className="px-3 py-2 text-[12px] text-content/50">
            {query.trim()
              ? "No matching notes"
              : "No notes yet. Save a turn from the transcript, or create one here."}
          </p>
        ) : (
          <ul
            data-shared-hover-continuity
            className="flex flex-col gap-0.5 p-1.5"
          >
            {visible.map((note) => (
              <li key={note.id}>
                <NoteCard
                  note={note}
                  active={selected?.id === note.id}
                  marks={marks}
                  onSelect={() => setSelectedId(note.id)}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize notes list"
        className={`absolute inset-y-0 -right-px z-10 w-1.5 cursor-col-resize touch-none ${
          resize.dragging ? "bg-content/15" : "hover:bg-content/10"
        }`}
        onPointerDown={resize.onPointerDown}
        onDoubleClick={resize.onDoubleClick}
      />
    </div>
  );

  return (
    <div
      role="region"
      aria-label="Notes"
      data-app-notes
      className="flex min-h-0 min-w-0 flex-1 flex-col text-content"
    >
      {!tabbed ? (
        <div
          data-app-view-header
          className="flex h-10 shrink-0 select-none items-center border-b border-stroke"
          data-tauri-drag-region="deep"
        >
          {IS_MAC && compactRail ? <div className="w-4 shrink-0" /> : null}
          {IS_MAC && !besideRail ? <div className="w-[78px] shrink-0" /> : null}
          {besideRail ? null : (
            <OverlayNav onBack={onClose} onToggleSidebar={onToggleSidebar} />
          )}
          <div className="flex min-w-0 flex-1 items-center gap-2 px-3 text-[13px]">
            <File
              className="size-3.5 shrink-0 text-content/45"
              strokeWidth={1.75}
            />
            <span className="min-w-0 truncate text-content">Notes</span>
          </div>
          {IS_MAC ? null : <WindowControls />}
        </div>
      ) : null}
      <div className="flex min-h-0 min-w-0 flex-1">
        {list}
        <NoteDetail
          note={selected}
          recents={recents}
          activeCwd={cwd}
          onSaved={onSaved}
          onDelete={onDelete}
          onAddToChat={onAddToChat}
        />
      </div>
    </div>
  );
}

function NoteCard({
  note,
  active,
  marks,
  onSelect,
}: {
  note: Note;
  active: boolean;
  marks: ProjectMarks;
  onSelect: () => void;
}) {
  const preview = notePreview(note.body, note.title);
  const project = noteSourceProject(note.sourceCwd);
  const time = formatRelativeTime(new Date(note.updatedAt).toISOString());
  const hint = [note.title, project].filter(Boolean).join(" · ");
  return (
    <button
      type="button"
      data-shared-hover-item
      data-shared-hover-preserve={active ? "" : undefined}
      title={hint}
      aria-current={active ? "true" : undefined}
      onClick={onSelect}
      className={`flex w-full flex-col rounded-md border px-2.5 py-2 text-left ${
        active
          ? "border-transparent bg-selection text-content"
          : "border-transparent text-content/80 hover:bg-content/5 hover:text-content"
      }`}
    >
      <span className="flex items-center gap-2">
        {project && note.sourceCwd ? (
          <span className="min-w-0 flex-1 text-[11px] text-content/50">
            <ProjectMark cwd={note.sourceCwd} {...marks} />
          </span>
        ) : (
          <span className="min-w-0 flex-1 text-[11px] text-content/50">
            <PersonalMark />
          </span>
        )}
        {time ? (
          <span className="shrink-0 text-[11px] tabular-nums text-content/45">
            {time}
          </span>
        ) : null}
      </span>
      <span className="mt-1 line-clamp-1 text-[13px] font-semibold leading-snug text-content">
        {note.title}
      </span>
      {preview ? (
        <span className="mt-1 line-clamp-1 text-[12px] leading-snug text-content/45">
          {preview}
        </span>
      ) : null}
      {(note.tags?.length ?? 0) > 0 ? (
        <span className="mt-1.5 flex min-w-0 items-center gap-1 overflow-hidden">
          {(note.tags ?? []).slice(0, 3).map((tag) => (
            <span
              key={tag}
              className="max-w-24 truncate rounded bg-content/8 px-1.5 py-0.5 text-[10px] leading-none text-content/55"
            >
              #{tag}
            </span>
          ))}
          {(note.tags?.length ?? 0) > 3 ? (
            <span className="shrink-0 text-[10px] text-content/40">
              +{(note.tags?.length ?? 0) - 3}
            </span>
          ) : null}
        </span>
      ) : null}
    </button>
  );
}

function NoteDetail({
  note,
  recents = [],
  activeCwd,
  onSaved,
  onDelete,
  onAddToChat,
}: {
  note: Note | null;
  recents?: RecentProject[];
  activeCwd?: string;
  onSaved: (note: Note) => void;
  onDelete: (id: string) => void | Promise<void>;
  onAddToChat: (note: Note) => void;
}) {
  if (!note) {
    return (
      <div className="flex h-full min-w-0 flex-1 flex-col items-center justify-center px-6 text-center">
        <File className="mb-3 size-6 text-content/30" strokeWidth={1.75} />
        <p className="text-[13px] text-content/45">Select a note</p>
      </div>
    );
  }
  return (
    <NoteEditor
      key={note.id}
      note={note}
      recents={recents}
      activeCwd={activeCwd}
      onSaved={onSaved}
      onDelete={onDelete}
      onAddToChat={onAddToChat}
    />
  );
}

function NoteEditor({
  note,
  recents = [],
  activeCwd,
  onSaved,
  onDelete,
  onAddToChat,
}: {
  note: Note;
  recents?: RecentProject[];
  activeCwd?: string;
  onSaved: (note: Note) => void;
  onDelete: (id: string) => void | Promise<void>;
  onAddToChat: (note: Note) => void;
}) {
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();
  const marks = useProjectMarks();
  const blank = !note.body.trim() && note.title === "Untitled";
  // Live is the default view: read and edit in one place.
  const [mode, setMode] = useMarkdownMode(note.id, "live");
  type Edits = Partial<Pick<Note, "title" | "body" | "tags">>;
  const [edits, setEdits] = useState<Edits>({});
  const title = edits.title ?? note.title;
  const body = edits.body ?? note.body;
  const tags = edits.tags ?? note.tags;
  // Keep only an unsaved choice locally so completed moves survive reopening.
  const [projectChange, setProjectChange] = useState<{ path: string } | null>(
    null,
  );
  const sourceCwd = projectChange?.path ?? note.sourceCwd;
  const [saveError, setSaveError] = useState<string | null>(null);
  const editsRef = useRef(edits);
  const bodyRef = useRef(body);
  const projectChangeRef = useRef(projectChange);
  const noteRef = useRef(note);
  const titleFieldRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<MarkdownCaretTarget | null>(null);
  const skipSave = useRef(false);
  const saveTimer = useRef<number | null>(null);
  // Title the user finished typing (blur/close). Any later title edit drops
  // it; a save clears it only if the same request is still current.
  const finalizeRef = useRef<{ title: string } | null>(null);
  const onSavedRef = useRef(onSaved);
  bodyRef.current = body;
  noteRef.current = note;
  onSavedRef.current = onSaved;
  const time = formatRelativeTime(new Date(note.updatedAt).toISOString());

  useEffect(() => {
    if (blank) setMode("live");
    // New untitled notes open ready to type, not behind the preview.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const editNote = useCallback((change: Edits) => {
    const next = { ...editsRef.current, ...change };
    editsRef.current = next;
    if (change.body !== undefined) bodyRef.current = change.body;
    setEdits(next);
  }, []);

  const titleFocused = useRef(false);
  const persist = useCallback(async (latest?: Note) => {
    if (skipSave.current) return;
    const current = latest ?? noteRef.current;
    const changes = editsRef.current;
    const nextBody = changes.body ?? current.body;
    const titleFocused = document.activeElement === titleFieldRef.current;
    const nextTitle =
      (changes.title ?? current.title).trim() ||
      (titleFocused ? current.title : noteTitle(nextBody));
    const nextTags = changes.tags ?? current.tags;
    const nextProject = projectChangeRef.current;
    const acceptSaved = (saved: Note) => {
      noteRef.current = saved;
      // A completed save only clears the edits included in that request.
      const remaining = { ...editsRef.current };
      // Keep the focused draft, including blanks and spaces, until blur.
      // Leave the draft for a queued blur or unmount save to commit as well.
      if (
        remaining.title === changes.title &&
        !titleFocused &&
        document.activeElement !== titleFieldRef.current
      ) {
        delete remaining.title;
      }
      if (remaining.body === changes.body) delete remaining.body;
      if (remaining.tags === changes.tags) delete remaining.tags;
      editsRef.current = remaining;
      bodyRef.current = remaining.body ?? saved.body;
      setEdits(remaining);
      if (projectChangeRef.current === nextProject) {
        projectChangeRef.current = null;
        setProjectChange(null);
      }
      setSaveError(null);
    };
    // Bound to the finished title so a newer partial edit never finalizes.
    const finalizeRequest = finalizeRef.current;
    const finalizeSlug = finalizeRequest?.title === nextTitle;
    if (
      !finalizeSlug &&
      nextTitle === current.title &&
      nextBody === current.body &&
      sameTags(nextTags, current.tags) &&
      (!nextProject || nextProject.path === current.sourceCwd)
    ) {
      acceptSaved(current);
      return current;
    }
    try {
      const saved = await upsertNote({
        id: current.id,
        title: nextTitle,
        body: nextBody,
        tags: nextTags,
        ...(finalizeSlug ? { finalizeSlug } : {}),
        ...(nextProject ? { sourceCwd: nextProject.path } : {}),
      });
      if (finalizeSlug && finalizeRef.current === finalizeRequest) {
        finalizeRef.current = null;
      }
      acceptSaved(saved);
      onSavedRef.current(saved);
      return saved;
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : String(err));
      return current;
    }
  }, []);

  const saveNow = useCallback(() => {
    if (saveTimer.current != null) window.clearTimeout(saveTimer.current);
    saveTimer.current = null;
    return enqueueNoteSave(note.id, persist);
  }, [note.id, persist]);

  const scheduleSave = useCallback(() => {
    if (saveTimer.current != null) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      saveTimer.current = null;
      void saveNow();
    }, 400);
  }, [saveNow]);

  const images = useMarkdownImages({
    ownerId: note.id,
    caretRef: editorRef,
    getValue: () => bodyRef.current,
    onInsert: (next) => {
      editNote({ body: next });
      scheduleSave();
    },
    onError: setSaveError,
  });

  useEffect(() => {
    return () => {
      // Only notes whose slug is still pending need a finalizing save.
      if (noteRef.current.slugPending) {
        finalizeRef.current = {
          title:
            (editsRef.current.title ?? noteRef.current.title).trim() ||
            noteTitle(bodyRef.current),
        };
      }
      void saveNow();
    };
  }, [saveNow]);

  const onTitleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    event.currentTarget.blur();
  };

  const canAddToChat = Boolean(body.trim());
  const draft: Note = {
    ...note,
    title: title.trim() || noteTitle(body),
    body,
    tags,
    sourceCwd,
  };

  return (
    <div
      ref={lockOverscroll}
      className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-none"
    >
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-8 py-8">
        <header className="flex flex-col gap-3">
          <div className="flex min-w-0 items-center gap-2 text-[12px] text-content/50">
            <File className="size-3.5 shrink-0" strokeWidth={1.75} />
            <span>Note</span>
            {note.slug ? (
              <span className="min-w-0 truncate">{note.slug}</span>
            ) : null}
            {note.sourceCwd ? (
              <ProjectMark cwd={note.sourceCwd} {...marks} />
            ) : (
              <PersonalMark />
            )}
            <SearchableProjectPicker
              cwd={sourceCwd ?? "~"}
              recents={recents}
              mode="move"
              railCwd={activeCwd}
              buttonClassName="px-1.5"
              onSelectProject={(path) => {
                const change = { path };
                projectChangeRef.current = change;
                setProjectChange(change);
                void saveNow();
              }}
            />
          </div>
          <input
            ref={titleFieldRef}
            value={title}
            onChange={(event) => {
              finalizeRef.current = null;
              editNote({ title: event.target.value });
              scheduleSave();
            }}
            onFocus={() => {
              titleFocused.current = true;
            }}
            onBlur={() => {
              titleFocused.current = false;
              const next = title.trim() || noteTitle(body);
              if (next !== title) editNote({ title: next });
              if (noteRef.current.slugPending) {
                finalizeRef.current = { title: next };
              }
              void saveNow();
            }}
            onKeyDown={onTitleKeyDown}
            aria-label="Note title"
            className="w-full border-0 bg-transparent p-0 text-[20px] font-semibold leading-tight text-content outline-none placeholder:text-content/35"
            placeholder="Untitled"
          />
          {time ? (
            <div className="text-[12px] text-content/50">Updated {time}</div>
          ) : null}
          <NoteTagsEditor
            tags={tags}
            onChange={(next) => {
              editNote({ tags: next });
              scheduleSave();
            }}
          />
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              type="button"
              disabled={!canAddToChat}
              onClick={() => onAddToChat(draft)}
              className="inline-flex items-center gap-1 rounded-md bg-content px-3 h-6.5 text-[12px] text-background-base hover:bg-content/80 disabled:cursor-default disabled:opacity-40"
            >
              Add to chat
            </button>
            <button
              type="button"
              onClick={() => {
                skipSave.current = true;
                if (saveTimer.current != null)
                  window.clearTimeout(saveTimer.current);
                void enqueueNoteSave(note.id, () => onDelete(note.id));
              }}
              className="inline-flex items-center gap-1.5 rounded-md px-3 h-7 text-[12px] text-content/70 hover:bg-content/10 hover:text-red-400"
            >
              <Trash2 className="size-3.5" strokeWidth={1.75} />
              Delete
            </button>
          </div>
          {saveError ? (
            <div
              role="alert"
              className="flex items-center gap-2 text-[12px] text-red-400/90"
            >
              <span>Could not save note: {saveError}</span>
              <button
                type="button"
                onClick={() => {
                  setSaveError(null);
                  void saveNow();
                }}
                className="shrink-0 underline hover:no-underline"
              >
                Retry
              </button>
            </div>
          ) : null}
        </header>
        <MarkdownDetailTabs
          mode={mode}
          onChange={setMode}
          markdown={body}
          label="Note sections"
          actions={<InsertImageButton images={images} />}
        />
        <div
          ref={images.dropZoneRef}
          aria-busy={images.busy}
          className={`relative min-h-[448px] rounded-lg border transition-colors ${
            images.dragging
              ? "border-accent/60 bg-accent/5"
              : "border-transparent"
          }`}
          {...images.dropZoneProps}
        >
          <MarkdownImageOverlay images={images} />
          <MarkdownEditorPanel
            mode={mode}
            onModeChange={setMode}
            value={body}
            onChange={(next) => {
              editNote({ body: next });
              scheduleSave();
            }}
            caretRef={editorRef}
            label="Note Markdown"
            placeholder="Write…"
            autoFocus={blank}
            minHeightClass="min-h-[448px]"
            preview={<AgentMarkdown text={body} cwd={sourceCwd} hardBreaks />}
            emptyPreview={
              <p className="text-[13px] text-content/45">No description</p>
            }
          />
        </div>
      </div>
    </div>
  );
}

export function NoteTagsEditor({
  label = "Add note tag",
  tags = [],
  onChange,
}: {
  label?: string;
  tags?: string[];
  onChange: (tags: string[]) => void;
}) {
  const safeTags = tags ?? [];
  const [value, setValue] = useState("");

  const addTag = (input = value) => {
    const next = normalizeNoteTags([...safeTags, input]);
    setValue("");
    if (!sameTags(next, safeTags)) onChange(next);
  };

  return (
    <div
      className="flex min-w-0 flex-wrap items-center gap-1.5"
      aria-label="Tags"
    >
      <span className="mr-0.5 text-[11px] text-content/45">Tags</span>
      {safeTags.map((tag) => (
        <span
          key={tag}
          className="inline-flex h-6 max-w-48 items-center gap-1 rounded-md bg-content/8 pl-2 pr-1 text-[11px] text-content/70"
        >
          <span className="truncate">#{tag}</span>
          <button
            type="button"
            title={`Remove #${tag}`}
            aria-label={`Remove #${tag}`}
            onClick={() => onChange(safeTags.filter((item) => item !== tag))}
            className="grid size-4 shrink-0 place-items-center rounded text-content/40 hover:bg-content/10 hover:text-content"
          >
            <X className="size-2.5" strokeWidth={1.75} />
          </button>
        </span>
      ))}
      {tags.length < MAX_NOTE_TAGS ? (
        <input
          value={value}
          onChange={(event) => {
            const next = event.target.value;
            if (next.endsWith(",")) addTag(next.slice(0, -1));
            else setValue(next);
          }}
          onBlur={() => {
            if (value.trim()) addTag();
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === ",") {
              event.preventDefault();
              addTag();
              return;
            }
            if (event.key === "Backspace" && !value && tags.length > 0) {
              onChange(tags.slice(0, -1));
            }
          }}
          aria-label={label}
          placeholder="Add tag…"
          spellCheck={false}
          autoComplete="off"
          className="h-6 min-w-20 flex-1 border-0 bg-transparent px-1 text-[11px] text-content outline-none placeholder:text-content/35"
        />
      ) : null}
    </div>
  );
}

function sameTags(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    left.every((tag, index) => tag === right[index])
  );
}


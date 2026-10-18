import { isBoardStatus } from "../../session-board/sessionBoard";
import type { sessionTodoManager } from "../../session-board/sessionTodos";
import { parseQuickAttachments } from "../../quick-composer/model/quickAttachments";
import {
  filterTasks,
  localDay,
  parseTaskStatus,
  taskStatus,
  type Task,
  type TaskUpsert,
  type TaskChanges,
  type TaskFilters,
} from "../../tasks";
import { isHarnessAvailable } from "../../../integrations/harness/core/availability";
import { looksLikeProject } from "../../projects/model/recents";
import {
  mergeModelSettings,
  modelEffortSetting,
  modelsFor,
  preferredModelId,
  resolveModel,
} from "../../sessions/model/models";
import {
  HARNESSES,
  RUNTIME_MODE_HINT,
  RUNTIME_MODE_LABEL,
  RUNTIME_MODES,
  type HarnessId,
  type Session,
} from "../../sessions/model/session";
import {
  addSessionToFolder,
  createFolderWithSessions,
  loadSessionFolders,
  placeSessionInFolder,
  saveSessionFolders,
  setFolderCustomColor,
} from "../../sessions/model/sessionFolders";
import {
  normalizeNoteTags,
  noteTitle,
  type Note,
  type NoteUpsert,
} from "../../notes";
import {
  ARTIFACT_KINDS,
  type Artifact,
  type ArtifactCard,
  type ArtifactKind,
  type ArtifactUpsert,
} from "../../artifacts/artifacts";
import type { QuickLaunch } from "../../quick-composer/model/quickComposer";
import type { Worktree, Worktrees } from "../../source-control/model/worktrees";
import { pathKey, projectName } from "../../../shared/lib/paths";
import type { SplitDir } from "../../workspace/model/layout";
import { consumeOperatorCommand } from "../../sessions/model/operatorCommand";
import {
  sessionConversationPage,
  type SessionReadOptions,
} from "./sessionConversation";
import {
  CARD_FIELDS,
  parseCard,
  type MonoCard,
} from "../../monos/model/monoCards";
import {
  HABITS_MAX,
  checkHabitsNow,
  habitRunningSince,
  habitSchedule,
  habitScheduleLabel,
  newHabit,
  nextHabitRunAt,
  type Habit,
} from "../../monos/model/monoHabits";
import {
  memoryWithinBudget,
  MonoFileConflict,
  type AgentFilePath,
  type MonoFiles,
} from "../../monos/model/monoFiles";
import {
  addMemoryEntry,
  archiveMemoryEntries,
  fitMemoryBudget,
  memoryDate,
  memoryEntry,
  removeMemoryEntry,
  searchMemory,
  sinceDate,
  supersedeMemoryEntry,
  topicName,
} from "../../monos/model/monoMemory";

export type AppSessionListing = {
  id: string;
  title: string;
  harness: HarnessId;
  model: string;
  busy: boolean;
  hasDraft: boolean;
  archived: boolean;
};

export type AppSessionPlacement = {
  direction: SplitDir;
  besideSessionId: string;
};

export type AgentAppHost = {
  start(
    launch: QuickLaunch,
    id: string,
    placement?: AppSessionPlacement,
    notifyMonoId?: string,
  ): Promise<void>;
  sessions(cwd: string): Promise<AppSessionListing[]>;
  session(id: string): Promise<Session | null>;
  readConversation?(
    session: Session,
    options: SessionReadOptions,
  ): Promise<ReturnType<typeof sessionConversationPage>>;
  send(
    id: string,
    prompt: string,
    requestId: string,
    notifyMonoId?: string,
  ): Promise<{ alreadySubmitted: boolean }>;
  draft(
    id: string,
    prompt: string,
    requestId: string,
  ): Promise<{ alreadySaved: boolean; draft: boolean }>;
  stop(id: string): Promise<void>;
  remove(id: string, mode: "archive" | "delete"): Promise<void>;
  worktrees(cwd: string): Promise<Worktrees>;
  createWorktree(
    cwd: string,
    branch: string,
    base: string,
    existing: boolean,
  ): Promise<Worktree>;
  sessionManager?: ReturnType<typeof sessionTodoManager>;
  tasks?(): Promise<Task[]>;
  task?(id: string): Promise<Task | null>;
  saveTask?(task: TaskUpsert): Promise<Task>;
  updateTask?(id: string, changes: TaskChanges): Promise<Task>;
  deleteTask?(id: string): Promise<void>;
  notes(): Promise<Note[]>;
  note(id: string): Promise<Note | null>;
  saveNote(note: NoteUpsert): Promise<Note>;
  artifacts?(): Promise<Artifact[]>;
  artifact?(id: string): Promise<Artifact | null>;
  saveArtifact?(artifact: ArtifactUpsert): Promise<Artifact>;
  postArtifact?(sourceSessionId: string, card: ArtifactCard): void | Promise<void>;
  /** Whether the session is a Mono's own conversation, which owns memory. */
  isMono(sessionId: string): boolean;
  /**
   * The Mono a session works for: its own conversation or one of its habit
   * runs. Its projects are the ones it may name with "project".
   */
  monoOf?(sessionId: string): {
    id: string;
    projects: readonly string[];
    showStartedSessionsInSidebar?: boolean;
    /** Files the sessions it starts into a folder named after it. */
    folder?: { name: string; color: string };
  } | undefined;
  /** A hidden run of one of a Mono's habits: it may remember, not schedule. */
  isHabitRun?(sessionId: string): boolean;
  /** Puts a card in the Mono's chat, or holds it for a habit run's report. */
  postCard?(sourceSessionId: string, card: MonoCard): void;
  habits?: {
    load(monoId: string): Promise<Habit[]>;
    update<T>(
      monoId: string,
      change: (habits: Habit[]) => { habits: Habit[]; result: T },
    ): Promise<T>;
  };
  agentFiles(monoId: string): Promise<MonoFiles>;
  readAgentFile(
    monoId: string,
    path: AgentFilePath,
  ): Promise<{ text: string | null; hash: string }>;
  /** Throws `MonoFileConflict` when the file moved past `hash`. */
  writeAgentFile(
    monoId: string,
    path: AgentFilePath,
    text: string,
    hash: string,
  ): Promise<string>;
  /** The clock entries are dated by; tests pin it. */
  now?(): Date;
};

const FIELDS = new Map<string, readonly string[]>([
  [
    "session_manager.list",
    ["status", "projectCwd", "query", "limit", "offset"],
  ],
  ["session_manager.read", ["id"]],
  [
    "session_manager.write",
    [
      "id",
      "title",
      "projectCwd",
      "prompt",
      "harness",
      "model",
      "modelSettings",
      "effort",
      "runtimeMode",
      "attachments",
      "workspaceMode",
      "worktreeBase",
      "worktreeCwd",
    ],
  ],
  ["session_manager.start", ["id"]],
  ["session_manager.delete", ["id"]],
  ["session_manager.remove", ["id", "runId"]],
  ["session_manager.clear", ["status", "projectCwd"]],
  ["models.list", []],
  ["sessions.list", ["project"]],
  ["sessions.read", ["sessionId", "before", "limit", "maxChars", "project"]],
  ["sessions.send", ["sessionId", "prompt", "project", "notifyOnComplete"]],
  ["sessions.draft", ["sessionId", "prompt", "project"]],
  ["sessions.stop", ["sessionId", "project"]],
  ["sessions.archive", ["sessionId", "project"]],
  ["sessions.delete", ["sessionId", "project"]],
  [
    "sessions.start",
    [
      "prompt",
      "draft",
      "harness",
      "model",
      "modelSettings",
      "effort",
      "runtimeMode",
      "reveal",
      "workspaceMode",
      "worktreeBase",
      "worktreeCwd",
      "placement",
      "besideSessionId",
      "project",
      "notifyOnComplete",
    ],
  ],
  ["worktrees.list", ["project"]],
  ["worktrees.create", ["branch", "base", "existing", "project"]],
  ["folders.list", ["project"]],
  ["folders.move", ["sessionId", "folderId", "newFolderName", "project"]],
  [
    "tasks.list",
    [
      "status",
      "statuses",
      "tags",
      "tagMatch",
      "projectCwd",
      "project",
      "query",
      "archived",
      "focus",
      "limit",
      "offset",
    ],
  ],
  ["tasks.read", ["id"]],
  [
    "tasks.write",
    [
      "id",
      "title",
      "body",
      "status",
      "tags",
      "projectCwd",
      "project",
      "sourceSessionId",
      "sourceBlockId",
      "focusDate",
      "archived",
    ],
  ],
  ["tasks.delete", ["id"]],
  ["notes.list", ["limit", "offset"]],
  ["notes.read", ["id"]],
  ["notes.write", ["id", "title", "body", "tags"]],
  ["artifacts.list", ["kind", "limit", "offset"]],
  ["artifacts.read", ["id"]],
  ["artifacts.write", ["id", "kind", "title", "body", "summary"]],
  ["soul.read", []],
  ["soul.update", ["text", "expectedHash"]],
  ["memory.read", ["topic"]],
  ["memory.search", ["query", "since"]],
  ["memory.add", ["fact", "topic", "until"]],
  ["memory.replace", ["find", "fact", "topic", "until"]],
  ["memory.remove", ["find", "topic"]],
  ["habits.list", []],
  ["habits.add", ["name", "instructions", "schedule"]],
  ["habits.update", ["id", "name", "instructions", "schedule", "enabled"]],
  ["habits.run", ["id"]],
  ["habits.remove", ["id"]],
  ["chat.card", [...CARD_FIELDS]],
]);

function fields(action: string, input: Record<string, unknown>) {
  const allowed = FIELDS.get(action);
  if (!allowed) throw new Error(`Unknown app action: ${action}`);
  const unknown = Object.keys(input).filter((key) => !allowed.includes(key));
  if (unknown.length)
    throw new Error(`Unknown ${action} fields: ${unknown.join(", ")}`);
}

function requiredString(value: unknown, name: string, max = 30_000): string {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw new Error(
      `${name} must be a non-empty string under ${max} characters`,
    );
  return value.trim();
}

function agentPrompt(value: unknown): string {
  const prompt = requiredString(value, "prompt", 240_000);
  if (consumeOperatorCommand(prompt).matched)
    throw new Error("App calls cannot enable /operator in another session");
  return prompt;
}

function completionRecipient(
  source: Session,
  input: Record<string, unknown>,
  host: AgentAppHost,
  defaultForMono = false,
): string | undefined {
  const requested = input.notifyOnComplete;
  if (requested !== undefined && typeof requested !== "boolean")
    throw new Error("notifyOnComplete must be a boolean");
  const isMono = host.isMono(source.id);
  if (!(requested ?? (defaultForMono && isMono && !input.draft)))
    return undefined;
  if (!isMono)
    throw new Error(
      "Completion notifications are only available in a Mono's chat",
    );
  if (input.draft === true)
    throw new Error("An unsent draft cannot send a completion notification");
  return source.id;
}

function optionalString(
  value: unknown,
  name: string,
  max = 512,
): string | undefined {
  return value === undefined ? undefined : requiredString(value, name, max);
}

function noteBody(value: unknown): string {
  if (typeof value !== "string" || value.length > 240_000)
    throw new Error("body must be a string under 240000 characters");
  return value.replace(/\r\n?/g, "\n");
}

function noteTags(value: unknown): string[] {
  if (
    !Array.isArray(value) ||
    value.length > 20 ||
    value.some((tag) => typeof tag !== "string" || tag.length > 48)
  )
    throw new Error(
      "tags must be an array of at most 20 strings under 48 characters each",
    );
  return normalizeNoteTags(value as string[]);
}

function taskId(value: unknown): string {
  const id = requiredString(value, "id", 256);
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error("Invalid task/session ID");
  return id;
}
function taskProject(value: unknown): string | null {
  if (value === null) return null;
  const path = requiredString(value, "projectCwd", 4096);
  if (
    new TextEncoder().encode(path).length > 4096 ||
    /[\u0000-\u001f\u007f]/.test(path) ||
    !looksLikeProject(path)
  )
    throw new Error("projectCwd must be a project path, or null for Personal");
  return path;
}

/**
 * `project` (path or name) as a task's project, the same way the other Mono
 * actions take it. Undefined when not given; refuses `projectCwd` beside it.
 */
function taskProjectAlias(
  source: Session,
  input: Record<string, unknown>,
  host: AgentAppHost,
): string | undefined {
  if (input.project === undefined) return undefined;
  if (input.projectCwd !== undefined)
    throw new Error("Use project or projectCwd, not both");
  return requireProject(source, input, host);
}

/**
 * The project an action works in. A session works in its own; a Mono works on
 * several, so it names one with "project" (its path or name), and may leave it
 * out when it has one project or is in one of its own.
 */
function requireProject(
  source: Session,
  input: Record<string, unknown>,
  host: AgentAppHost,
): string {
  const mono = host.monoOf?.(source.id);
  const named = optionalString(input.project, "project", 4096);
  if (!mono) {
    if (named) throw new Error("project is only for a Mono");
    if (!looksLikeProject(source.cwd))
      throw new Error("Choose a project folder in this session first");
    return source.cwd;
  }
  const choices = () =>
    mono.projects.length
      ? mono.projects.map((path) => `${projectName(path)} (${path})`).join(", ")
      : "none yet; the user adds them from your details panel";
  if (named) {
    const byPath = mono.projects.find(
      (path) => pathKey(path) === pathKey(named),
    );
    const byName = mono.projects.filter((path) => projectName(path) === named);
    const match = byPath ?? (byName.length === 1 ? byName[0] : undefined);
    if (!match)
      throw new Error(`Not one of your projects. Yours: ${choices()}`);
    return match;
  }
  const own = mono.projects.find(
    (path) => pathKey(path) === pathKey(source.cwd),
  );
  if (own) return own;
  if (mono.projects.length === 1) return mono.projects[0];
  throw new Error(`Pass "project" to choose one. Yours: ${choices()}`);
}

/** A Mono's chat lives outside its projects; project access follows its roster. */
export function canAccessAgentAppProject(
  source: Session,
  cwd: string,
  monoProjects?: readonly string[],
): boolean {
  return (monoProjects ?? [source.cwd]).some(
    (project) => pathKey(project) === pathKey(cwd),
  );
}

function assertMonoProjectAccess(
  source: Session,
  cwd: string | null | undefined,
  host: AgentAppHost,
): void {
  const mono = host.monoOf?.(source.id);
  if (mono && (!cwd || !canAccessAgentAppProject(source, cwd, mono.projects))) {
    throw new Error("This project is not assigned to your Mono");
  }
}

function defaultAssignedProject(source: Session, host: AgentAppHost): string {
  const mono = host.monoOf?.(source.id);
  if (!mono) {
    if (!looksLikeProject(source.cwd))
      throw new Error("Choose a project folder in this session first");
    return source.cwd;
  }
  const own = mono.projects.find(
    (path) => pathKey(path) === pathKey(source.cwd),
  );
  if (own) return own;
  if (mono.projects.length === 1) return mono.projects[0];
  throw new Error(
    mono.projects.length
      ? 'Pass "projectCwd" to choose one of your projects.'
      : "Your Mono has no assigned projects",
  );
}

async function projectSession(
  source: Session,
  id: string,
  input: Record<string, unknown>,
  host: AgentAppHost,
): Promise<Session> {
  const cwd = requireProject(source, input, host);
  if (!(await host.sessions(cwd)).some((session) => session.id === id))
    throw new Error("Session was not found in this project");
  const target = await host.session(id);
  if (!target || pathKey(target.cwd) !== pathKey(cwd))
    throw new Error("Session was not found in this project");
  return target;
}

/** Two short body paragraphs, with a hard cap independent of Markdown length. */
export function notePreview(body: string): string {
  return body
    .trim()
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 2)
    .join("\n\n")
    .slice(0, 400);
}

/**
 * Puts a session a Mono started into the sidebar folder named after it,
 * making that folder in its color the first time.
 */
function fileInMonoFolder(
  cwd: string,
  sessionId: string,
  folder: { name: string; color: string },
): void {
  const folders = loadSessionFolders(cwd);
  const own = folders.find((entry) => entry.name === folder.name);
  if (own) {
    saveSessionFolders(cwd, addSessionToFolder(folders, own.id, sessionId));
    return;
  }
  const created = createFolderWithSessions(folders, [sessionId], folder.name);
  saveSessionFolders(
    cwd,
    setFolderCustomColor(created.folders, created.id, folder.color),
  );
}

function startLaunch(
  source: Session,
  input: Record<string, unknown>,
  host: AgentAppHost,
): QuickLaunch {
  const cwd = requireProject(source, input, host);
  const prompt = agentPrompt(input.prompt);
  const draft = input.draft ?? false;
  if (typeof draft !== "boolean") throw new Error("draft must be a boolean");
  const harness = input.harness ?? source.harness;
  if (!HARNESSES.includes(harness as HarnessId))
    throw new Error("Unknown harness; run models.list for available providers");
  const chosenHarness = harness as HarnessId;
  if (!isHarnessAvailable(chosenHarness))
    throw new Error(`${chosenHarness} is not available in MonoCode`);
  const requestedModel = optionalString(input.model, "model");
  const model = requestedModel
    ? modelsFor(chosenHarness).find((entry) => entry.id === requestedModel)
    : resolveModel(
        chosenHarness,
        chosenHarness === source.harness
          ? source.model
          : preferredModelId(chosenHarness),
      );
  if (!model || model.harness !== chosenHarness)
    throw new Error("Unknown model; run models.list for exact model IDs");
  const rawSettings = input.modelSettings;
  if (
    rawSettings !== undefined &&
    (!rawSettings ||
      typeof rawSettings !== "object" ||
      Array.isArray(rawSettings))
  )
    throw new Error(
      "modelSettings must be an object of setting IDs and values",
    );
  const requestedSettings = {
    ...((rawSettings ?? {}) as Record<string, unknown>),
  };
  if (input.effort !== undefined) {
    const effort = modelEffortSetting(model);
    if (!effort)
      throw new Error(`${model.id} does not expose an effort setting`);
    requestedSettings[effort.id] = requiredString(input.effort, "effort", 128);
  }
  for (const [key, value] of Object.entries(requestedSettings)) {
    const setting = model.settings?.find((entry) => entry.id === key);
    if (
      !setting ||
      typeof value !== "string" ||
      !setting.options.some((option) => option.value === value)
    )
      throw new Error(
        `Invalid model setting ${key}; run models.list for allowed values`,
      );
  }
  const runtimeMode = input.runtimeMode ?? source.runtimeMode;
  if (!RUNTIME_MODES.includes(runtimeMode as Session["runtimeMode"]))
    throw new Error(`runtimeMode must be one of: ${RUNTIME_MODES.join(", ")}`);
  const reveal = input.reveal ?? false;
  if (typeof reveal !== "boolean") throw new Error("reveal must be a boolean");
  const workspaceMode = input.workspaceMode ?? "current";
  if (workspaceMode !== "current" && workspaceMode !== "worktree")
    throw new Error("workspaceMode must be current or worktree");
  const worktreeBase = optionalString(input.worktreeBase, "worktreeBase");
  if (worktreeBase && workspaceMode !== "worktree")
    throw new Error("worktreeBase requires workspaceMode worktree");
  const worktreeCwd = optionalString(input.worktreeCwd, "worktreeCwd");
  if (worktreeCwd && workspaceMode !== "current")
    throw new Error("worktreeCwd requires workspaceMode current");
  const startingMono = host.monoOf?.(source.id);
  const currentWorktree =
    worktreeCwd ||
    (pathKey(cwd) === pathKey(source.cwd) ? source.worktreeCwd : undefined);
  return {
    cwd,
    prompt,
    // Only a Mono's own preference hides what it starts. A regular session
    // with /operator has no Mono, and its launches belong in the sidebar.
    ...(startingMono && startingMono.showStartedSessionsInSidebar !== true
      ? { sidebarHidden: true }
      : {}),
    ...(draft ? { draft: true } : {}),
    harness: chosenHarness,
    model: model.id,
    modelSettings: mergeModelSettings(model, {
      ...(chosenHarness === source.harness && model.id === source.model
        ? source.modelSettings
        : {}),
      ...(requestedSettings as Record<string, string>),
    }),
    runtimeMode: runtimeMode as Session["runtimeMode"],
    // A Mono delegates work without navigating the user out of their chat.
    reveal: host.isMono(source.id) ? false : reveal,
    workspaceMode,
    ...(workspaceMode === "current" && currentWorktree
      ? { worktreeCwd: currentWorktree }
      : {}),
    ...(worktreeBase ? { worktreeBase } : {}),
  };
}

function memoryPath(topic: unknown): AgentFilePath {
  return topic === undefined
    ? "MEMORY.md"
    : `memory/${topicName(requiredString(topic, "topic", 80))}.md`;
}

async function handleSoul(
  source: Session,
  action: string,
  input: Record<string, unknown>,
  host: AgentAppHost,
): Promise<unknown> {
  const monoId = host.isMono(source.id)
    ? host.monoOf?.(source.id)?.id
    : undefined;
  if (!monoId)
    throw new Error("Only a Mono's own conversation can manage its soul");
  if (action === "soul.read") {
    const files = await host.agentFiles(monoId);
    return { file: "SOUL.md", text: files.soul, hash: files.soulHash };
  }
  if (typeof input.text !== "string" || input.text.length > 240_000)
    throw new Error("text must be a string under 240000 characters");
  const expectedHash = requiredString(input.expectedHash, "expectedHash", 128);
  try {
    const hash = await host.writeAgentFile(
      monoId,
      "SOUL.md",
      input.text,
      expectedHash,
    );
    return { file: "SOUL.md", updated: true, hash };
  } catch (error) {
    if (error instanceof MonoFileConflict)
      throw new Error(
        "SOUL.md changed since you read it. Run soul.read and reapply the user's requested changes to the current text before calling soul.update again.",
      );
    throw error;
  }
}

/**
 * Read, change and write one memory file over the version it read, again
 * from the top when the user saved the same file in between.
 */
async function editAgentFile<T>(
  host: AgentAppHost,
  monoId: string,
  path: AgentFilePath,
  edit: (text: string) => { text: string; result: T },
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const current = await host.readAgentFile(monoId, path);
    const fallback =
      current.text == null && path !== "MEMORY.md"
        ? `# ${path.slice("memory/".length, -".md".length)}\n\n`
        : "";
    const next = edit(current.text ?? fallback);
    try {
      if (next.text !== (current.text ?? ""))
        await host.writeAgentFile(monoId, path, next.text, current.hash);
      return next.result;
    } catch (error) {
      if (!(error instanceof MonoFileConflict) || attempt >= 2) throw error;
    }
  }
}

/**
 * Keeps MEMORY.md within what loads. The archive is written first, so a line
 * is never out of one file without already being in the other. If the user
 * saved MEMORY.md in between, the trim waits for the next write.
 */
async function keepMemoryInBudget(
  host: AgentAppHost,
  monoId: string,
  keep: string,
  date: string,
): Promise<string[]> {
  const memory = await host.readAgentFile(monoId, "MEMORY.md");
  const fitted = fitMemoryBudget(memory.text ?? "", keep, date);
  if (!fitted.moved.length) return [];
  await editAgentFile(host, monoId, "memory/archive.md", (archive) => ({
    text: archiveMemoryEntries(archive, fitted.moved, date),
    result: undefined,
  }));
  try {
    await host.writeAgentFile(monoId, "MEMORY.md", fitted.text, memory.hash);
  } catch (error) {
    if (!(error instanceof MonoFileConflict)) throw error;
    return [];
  }
  return fitted.moved;
}

async function handleMemory(
  source: Session,
  action: string,
  input: Record<string, unknown>,
  host: AgentAppHost,
): Promise<unknown> {
  const monoId = host.monoOf?.(source.id)?.id;
  if (!monoId) throw new Error("Memory belongs to the Mono's conversation");
  const path = memoryPath(input.topic);
  const date = memoryDate(host.now?.() ?? new Date());
  const until = optionalString(input.until, "until", 10);
  const report = async (result: Record<string, unknown>, keep?: string) => {
    const moved =
      path === "MEMORY.md" && keep
        ? await keepMemoryInBudget(host, monoId, keep, date)
        : [];
    return {
      file: path,
      ...result,
      ...(moved.length
        ? { movedToArchive: moved.length, moved: moved.slice(0, 5) }
        : {}),
    };
  };
  switch (action) {
    case "memory.search": {
      const query =
        input.query === undefined
          ? ""
          : requiredString(input.query, "query", 500);
      const since =
        input.since === undefined
          ? undefined
          : sinceDate(
              requiredString(input.since, "since", 20),
              host.now?.() ?? new Date(),
            );
      const files = await host.agentFiles(monoId);
      const paths: AgentFilePath[] = [
        "MEMORY.md",
        ...files.topics.map((topic) => `memory/${topic}.md` as const),
        "memory/archive.md",
      ];
      const texts = await Promise.all(
        paths.map(async (file) => ({
          file,
          text:
            file === "MEMORY.md"
              ? files.memory
              : ((await host.readAgentFile(monoId, file)).text ?? ""),
        })),
      );
      const hits = searchMemory(texts, query, { since });
      return hits.length
        ? { hits }
        : {
            hits,
            note: "Nothing in memory matches. It may never have been saved.",
          };
    }
    case "memory.read": {
      if (path !== "MEMORY.md") {
        const topic = await host.readAgentFile(monoId, path);
        if (topic.text == null) throw new Error("No such memory topic");
        return { file: path, text: topic.text };
      }
      const files = await host.agentFiles(monoId);
      const budget = memoryWithinBudget(files.memory);
      return {
        file: path,
        text: files.memory,
        lines: budget.lines,
        notLoaded: budget.droppedLines,
        topics: files.topics,
      };
    }
    case "memory.add": {
      const entry = memoryEntry(
        requiredString(input.fact, "fact"),
        date,
        until,
      );
      const added = await editAgentFile(host, monoId, path, (text) => {
        const next = addMemoryEntry(text, entry);
        return { text: next.text, result: next.added };
      });
      return added
        ? report({ added: entry }, entry)
        : { file: path, alreadyRemembered: true };
    }
    case "memory.replace": {
      const find = requiredString(input.find, "find", 2000);
      const entry = memoryEntry(
        requiredString(input.fact, "fact"),
        date,
        until,
      );
      await editAgentFile(host, monoId, path, (text) => ({
        text: supersedeMemoryEntry(text, find, entry, date),
        result: undefined,
      }));
      return report({ superseded: find, added: entry }, entry);
    }
    case "memory.remove": {
      const find = requiredString(input.find, "find", 2000);
      const removed = await editAgentFile(host, monoId, path, (text) => {
        const next = removeMemoryEntry(text, find);
        return { text: next.text, result: next.removed };
      });
      return { file: path, removed };
    }
  }
  throw new Error(`Unknown app action: ${action}`);
}

function habitView(habit: Habit) {
  return {
    id: habit.id,
    name: habit.name,
    instructions: habit.instructions,
    schedule: habitScheduleLabel(habit.schedule),
    enabled: habit.enabled,
    nextRun: habit.enabled ? new Date(habit.nextRunAt).toLocaleString() : null,
    ...(habitRunningSince(habit.id) != null ? { running: true } : {}),
    ...(habit.lastRunAt
      ? {
          lastRun: new Date(habit.lastRunAt).toLocaleString(),
          lastOutcome: habit.lastOutcome,
          ...(habit.lastError ? { lastError: habit.lastError } : {}),
        }
      : {}),
  };
}

async function handleHabits(
  source: Session,
  action: string,
  input: Record<string, unknown>,
  host: AgentAppHost,
): Promise<unknown> {
  const habits = host.habits;
  // A habit's own run cannot schedule more runs.
  const monoId = host.isMono(source.id)
    ? host.monoOf?.(source.id)?.id
    : undefined;
  if (!habits || !monoId)
    throw new Error("Only a Mono's own conversation can manage its habits");
  const now = host.now?.() ?? new Date();
  const find = (list: Habit[]) => {
    const id = requiredString(input.id, "id", 128);
    const habit = list.find((entry) => entry.id === id);
    if (!habit) throw new Error("No habit with that id; run habits.list");
    return habit;
  };
  switch (action) {
    case "habits.list":
      return { habits: (await habits.load(monoId)).map(habitView) };
    case "habits.add": {
      const name = requiredString(input.name, "name", 80);
      const instructions = requiredString(
        input.instructions,
        "instructions",
        4_000,
      );
      const schedule = habitSchedule(input.schedule);
      const habit = await habits.update(monoId, (list) => {
        if (list.length >= HABITS_MAX)
          throw new Error(`A Mono can have at most ${HABITS_MAX} habits`);
        const created = newHabit(
          { name, instructions, schedule },
          now.getTime(),
        );
        return { habits: [...list, created], result: created };
      });
      return { habit: habitView(habit) };
    }
    case "habits.update": {
      const patch = {
        ...(input.name === undefined
          ? {}
          : { name: requiredString(input.name, "name", 80) }),
        ...(input.instructions === undefined
          ? {}
          : {
              instructions: requiredString(
                input.instructions,
                "instructions",
                4_000,
              ),
            }),
        ...(input.schedule === undefined
          ? {}
          : { schedule: habitSchedule(input.schedule) }),
      };
      if (input.enabled !== undefined && typeof input.enabled !== "boolean")
        throw new Error("enabled must be true or false");
      const habit = await habits.update(monoId, (list) => {
        const current = find(list);
        const next: Habit = {
          ...current,
          ...patch,
          ...(input.enabled === undefined
            ? {}
            : { enabled: input.enabled as boolean }),
        };
        // A new schedule, or turning it back on, counts from now.
        if (patch.schedule || (next.enabled && !current.enabled))
          next.nextRunAt = nextHabitRunAt(next.schedule, now.getTime());
        return {
          habits: list.map((entry) => (entry.id === next.id ? next : entry)),
          result: next,
        };
      });
      return { habit: habitView(habit) };
    }
    case "habits.run": {
      const running = habitRunningSince(requiredString(input.id, "id", 128));
      if (running != null)
        throw new Error(
          `That habit is already running (started ${new Date(running).toLocaleTimeString()}); its result will be posted here when it ends`,
        );
      const habit = await habits.update(monoId, (list) => {
        const next = { ...find(list), runRequested: true };
        return {
          habits: list.map((entry) => (entry.id === next.id ? next : entry)),
          result: next,
        };
      });
      checkHabitsNow();
      return {
        habit: habitView(habit),
        note: "It starts now, on its own. Whatever it finds is posted to this chat, or nothing if there is nothing to say.",
      };
    }
    case "habits.remove": {
      const removed = await habits.update(monoId, (list) => {
        const habit = find(list);
        return {
          habits: list.filter((entry) => entry.id !== habit.id),
          result: habit,
        };
      });
      return { removed: removed.name };
    }
  }
  throw new Error(`Unknown app action: ${action}`);
}

function artifactKind(value: unknown): ArtifactKind {
  if (value === undefined) return "document";
  if (ARTIFACT_KINDS.includes(value as ArtifactKind))
    return value as ArtifactKind;
  throw new Error('Unsupported artifact kind; use "document" or "html"');
}

async function handleArtifacts(
  source: Session,
  requestId: string,
  action: string,
  input: Record<string, unknown>,
  host: AgentAppHost,
): Promise<unknown> {
  if (!(host.isMono(source.id) || host.isHabitRun?.(source.id)))
    throw new Error("Only a Mono can create or read artifacts");
  if (!host.artifact) throw new Error("Artifacts are unavailable");
  if (action === "artifacts.list") {
    if (!host.artifacts) throw new Error("Artifacts are unavailable");
    const kind =
      input.kind === undefined ? undefined : artifactKind(input.kind);
    const limit = input.limit ?? 30;
    const offset = input.offset ?? 0;
    if (
      !Number.isInteger(limit) ||
      (limit as number) < 1 ||
      (limit as number) > 100
    )
      throw new Error("limit must be an integer from 1 to 100");
    if (!Number.isInteger(offset) || (offset as number) < 0)
      throw new Error("offset must be a non-negative integer");
    const artifacts = (await host.artifacts()).filter(
      (artifact) => kind === undefined || artifact.kind === kind,
    );
    return {
      total: artifacts.length,
      offset,
      artifacts: artifacts
        .slice(offset as number, (offset as number) + (limit as number))
        .map(({ id, kind, title, updatedAt }) => ({
          id,
          kind,
          title,
          updatedAt,
        })),
    };
  }
  if (action === "artifacts.read") {
    const artifact = await host.artifact(requiredString(input.id, "id", 256));
    if (!artifact) throw new Error("Artifact was not found");
    return artifact;
  }
  if (!host.saveArtifact || !host.postArtifact)
    throw new Error("Artifacts are unavailable");
  const kind = artifactKind(input.kind);
  const id = optionalString(input.id, "id", 256);
  if (id && !/^[A-Za-z0-9_-]+$/.test(id))
    throw new Error("Invalid artifact ID");
  const title =
    input.title === undefined
      ? undefined
      : requiredString(input.title, "title", 200);
  const body = input.body === undefined ? undefined : noteBody(input.body);
  const summary =
    input.summary === undefined
      ? undefined
      : requiredString(input.summary, "summary", 280);
  let artifact: Artifact;
  if (id) {
    if (title === undefined && body === undefined)
      throw new Error("Supply title or body to update an artifact");
    const current = await host.artifact(id);
    if (!current) throw new Error("Artifact was not found");
    if (current.kind !== kind)
      throw new Error("An artifact's kind cannot be changed");
    artifact = await host.saveArtifact({
      id,
      kind,
      title: title ?? current.title,
      body: body ?? current.body,
    });
  } else {
    if (body === undefined)
      throw new Error("body is required to create an artifact");
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(requestId))
      throw new Error("Invalid request ID");
    const createdId = `artifact-${source.id}-${requestId}`;
    const existing = await host.artifact(createdId);
    if (
      existing &&
      (existing.kind !== kind ||
        existing.title !== (title ?? noteTitle(body)) ||
        existing.body !== body)
    )
      throw new Error("Request ID was already used for another artifact");
    artifact =
      existing ??
      (await host.saveArtifact({
        id: createdId,
        kind,
        title: title ?? noteTitle(body),
        body,
        sourceSessionId: source.id,
        ...(looksLikeProject(source.cwd) ? { sourceCwd: source.cwd } : {}),
      }));
  }
  const card: ArtifactCard = {
    id: artifact.id,
    kind: artifact.kind,
    title: artifact.title,
    ...(summary ? { summary } : {}),
  };
  await host.postArtifact(source.id, card);
  return { ...card, saved: true, attached: true };
}

export async function handleAgentApp(
  source: Session,
  requestId: string,
  action: string,
  input: Record<string, unknown>,
  host: AgentAppHost,
): Promise<unknown> {
  fields(action, input);
  if (action.startsWith("artifacts."))
    return handleArtifacts(source, requestId, action, input, host);
  if (action.startsWith("soul."))
    return handleSoul(source, action, input, host);
  if (action.startsWith("memory."))
    return handleMemory(source, action, input, host);
  if (action.startsWith("habits."))
    return handleHabits(source, action, input, host);
  if (action === "chat.card") {
    if (
      !host.postCard ||
      !(host.isMono(source.id) || host.isHabitRun?.(source.id))
    )
      throw new Error("Only a Mono can put cards in its chat");
    const card = parseCard(input);
    host.postCard(source.id, card);
    return {
      posted: card.type,
      note: host.isMono(source.id)
        ? "It shows in the chat where you are in your reply."
        : "It goes out with your report, after its text; if you stay quiet, it is dropped.",
    };
  }
  switch (action) {
    case "session_manager.list": {
      if (!host.sessionManager)
        throw new Error("Session Manager is unavailable");
      const status =
        input.status === undefined
          ? undefined
          : requiredString(input.status, "status", 30);
      if (status !== undefined && !isBoardStatus(status))
        throw new Error("Unknown Session Manager status");
      let projectCwd =
        input.projectCwd === undefined
          ? undefined
          : taskProject(input.projectCwd);
      if (projectCwd === null)
        throw new Error("Session Manager Todos require a project");
      if (host.monoOf?.(source.id)) {
        projectCwd ??= defaultAssignedProject(source, host);
        assertMonoProjectAccess(source, projectCwd, host);
      }
      const query =
        input.query === undefined
          ? undefined
          : requiredString(input.query, "query", 1000);
      const limit = input.limit ?? 30,
        offset = input.offset ?? 0;
      if (
        !Number.isInteger(limit) ||
        (limit as number) < 1 ||
        (limit as number) > 100 ||
        !Number.isInteger(offset) ||
        (offset as number) < 0
      )
        throw new Error("Use limit 1–100 and a non-negative offset");
      const cards = await host.sessionManager.list({
        status,
        projectCwd,
        query,
      });
      return {
        total: cards.length,
        offset,
        cards: cards.slice(
          offset as number,
          (offset as number) + (limit as number),
        ),
      };
    }
    case "session_manager.read": {
      if (!host.sessionManager)
        throw new Error("Session Manager is unavailable");
      const card = await host.sessionManager.read(taskId(input.id));
      if (card) assertMonoProjectAccess(source, card.cwd, host);
      return card;
    }
    case "session_manager.write": {
      if (!host.sessionManager)
        throw new Error("Session Manager is unavailable");
      const id = input.id === undefined ? undefined : taskId(input.id);
      if (id && Object.keys(input).length === 1)
        throw new Error("Supply fields to update a Todo");
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(requestId))
        throw new Error("Invalid request ID");
      const existing = id ? await host.sessionManager.read(id) : undefined;
      if (existing) assertMonoProjectAccess(source, existing.cwd, host);
      let projectCwd =
        input.projectCwd === undefined
          ? (existing?.cwd ?? undefined)
          : taskProject(input.projectCwd);
      projectCwd ??= existing?.cwd ?? defaultAssignedProject(source, host);
      if (projectCwd) assertMonoProjectAccess(source, projectCwd, host);
      if (!projectCwd)
        throw new Error("Session Manager Todos require a project");
      const prompt =
        input.prompt === undefined ? existing?.prompt : input.prompt;
      const attachments = parseQuickAttachments(
        input.attachments === undefined
          ? existing?.attachments
          : input.attachments,
      );
      if (!attachments)
        throw new Error(
          "attachments must be up to 20 persisted file/image descriptors with local paths",
        );
      if (
        typeof prompt !== "string" ||
        prompt.length > 240_000 ||
        (!prompt.trim() && !attachments.length)
      )
        throw new Error("Supply a prompt or attachments");
      if (prompt.trim()) agentPrompt(prompt);
      const projectChanged =
        existing && pathKey(existing.cwd) !== pathKey(projectCwd);
      const mode =
        input.workspaceMode ??
        (projectChanged ? "current" : existing?.workspaceMode) ??
        "current";
      const base = optionalString(
        input.worktreeBase ??
          (projectChanged || input.workspaceMode === "current"
            ? undefined
            : existing?.worktreeBase),
        "worktreeBase",
        400,
      );
      const tree = optionalString(
        input.worktreeCwd ??
          (projectChanged || input.workspaceMode === "worktree"
            ? undefined
            : existing?.worktreeCwd),
        "worktreeCwd",
        4096,
      );
      const template = existing
        ? {
            ...source,
            cwd: projectCwd,
            harness: existing.harness,
            model: existing.model ?? source.model,
            modelSettings: existing.modelSettings ?? {},
            runtimeMode: existing.runtimeMode ?? source.runtimeMode,
            worktreeCwd: tree,
          }
        : {
            ...source,
            cwd: projectCwd,
            worktreeCwd:
              pathKey(projectCwd) === pathKey(source.cwd)
                ? source.worktreeCwd
                : undefined,
          };
      const launch = startLaunch(
        template,
        {
          prompt: prompt.trim() ? prompt : "Attached files",
          harness: input.harness ?? existing?.harness,
          model: input.model ?? existing?.model,
          modelSettings: input.modelSettings ?? existing?.modelSettings,
          effort: input.effort,
          runtimeMode: input.runtimeMode ?? existing?.runtimeMode,
          workspaceMode: mode,
          ...(base ? { worktreeBase: base } : {}),
          ...(tree ? { worktreeCwd: tree } : {}),
        },
        host,
      );
      launch.prompt = prompt;
      launch.attachments = attachments;
      if (existing?.intent) launch.intent = existing.intent;
      launch.draft = true;
      launch.reveal = false;
      if (tree) {
        const available = (await host.worktrees(projectCwd)).worktrees.find(
          (entry) =>
            !entry.missing &&
            pathKey(entry.path) === pathKey(launch.worktreeCwd!),
        );
        if (!available)
          throw new Error("Worktree is unavailable in this project");
        launch.worktreeCwd =
          pathKey(available.path) === pathKey(projectCwd)
            ? undefined
            : available.path;
      }
      const title =
        input.title === undefined
          ? undefined
          : requiredString(input.title, "title", 200);
      return host.sessionManager.write(
        id ?? `app-todo-${source.id}-${requestId}`,
        launch,
        { edit: !!id, title, expectedRevision: existing?.revision },
      );
    }
    case "session_manager.start": {
      if (!host.sessionManager)
        throw new Error("Session Manager is unavailable");
      const id = taskId(input.id);
      const card = await host.sessionManager.read(id);
      if (card) assertMonoProjectAccess(source, card.cwd, host);
      return host.sessionManager.start(id, true);
    }
    case "session_manager.delete": {
      if (!host.sessionManager)
        throw new Error("Session Manager is unavailable");
      const id = taskId(input.id);
      const card = await host.sessionManager.read(id);
      if (card) assertMonoProjectAccess(source, card.cwd, host);
      return host.sessionManager.delete(id);
    }
    case "session_manager.remove": {
      if (!host.sessionManager)
        throw new Error("Session Manager is unavailable");
      const id = taskId(input.id);
      const card = await host.sessionManager.read(id);
      if (card) assertMonoProjectAccess(source, card.cwd, host);
      return host.sessionManager.remove(
        id,
        requiredString(input.runId, "runId", 512),
      );
    }
    case "session_manager.clear": {
      if (!host.sessionManager)
        throw new Error("Session Manager is unavailable");
      if (input.status !== "done" && input.status !== "stopped")
        throw new Error("Only done or stopped columns can be cleared");
      let project =
        input.projectCwd === undefined
          ? undefined
          : taskProject(input.projectCwd);
      if (project === null)
        throw new Error("Use a project path or omit projectCwd");
      if (host.monoOf?.(source.id)) {
        project ??= defaultAssignedProject(source, host);
        assertMonoProjectAccess(source, project, host);
      }
      return host.sessionManager.clear(input.status, project);
    }
    case "models.list":
      return {
        runtimeModes: RUNTIME_MODES.map((id) => ({
          id,
          label: RUNTIME_MODE_LABEL[id],
          description: RUNTIME_MODE_HINT[id],
        })),
        harnesses: HARNESSES.map((harness) => ({
          id: harness,
          available: isHarnessAvailable(harness),
          models: modelsFor(harness).map((model) => ({
            id: model.id,
            name: model.name,
            settings: model.settings ?? [],
          })),
        })),
      };
    case "sessions.list": {
      const cwd = requireProject(source, input, host);
      return { cwd, sessions: await host.sessions(cwd) };
    }
    case "sessions.read": {
      const id = requiredString(input.sessionId, "sessionId", 256);
      const target =
        id === source.id && host.isMono?.(id)
          ? source
          : await projectSession(source, id, input, host);
      const options = {
        before: optionalString(input.before, "before", 256),
        limit: input.limit as number | undefined,
        maxChars: input.maxChars as number | undefined,
      };
      return host.readConversation
        ? host.readConversation(target, options)
        : sessionConversationPage(target, options);
    }
    case "sessions.send": {
      const id = requiredString(input.sessionId, "sessionId", 256);
      const prompt = agentPrompt(input.prompt);
      const notifyMonoId = completionRecipient(source, input, host);
      if (id === source.id)
        throw new Error(
          "Use the current conversation to continue this session",
        );
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(requestId))
        throw new Error("Invalid request ID");
      await projectSession(source, id, input, host);
      const result = await host.send(
        id,
        prompt,
        `app-${source.id}-${requestId}`,
        ...(notifyMonoId ? [notifyMonoId] : []),
      );
      return {
        sessionId: id,
        submitted: true,
        ...result,
        ...(notifyMonoId ? { notifyOnComplete: true } : {}),
      };
    }
    case "sessions.draft": {
      const id = requiredString(input.sessionId, "sessionId", 256);
      const prompt = agentPrompt(input.prompt);
      if (id === source.id)
        throw new Error("Use the composer to save a draft in this session");
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(requestId))
        throw new Error("Invalid request ID");
      await projectSession(source, id, input, host);
      const result = await host.draft(
        id,
        prompt,
        `app-${source.id}-${requestId}`,
      );
      return { sessionId: id, saved: true, ...result };
    }
    case "sessions.stop":
    case "sessions.archive":
    case "sessions.delete": {
      const id = requiredString(input.sessionId, "sessionId", 256);
      if (id === source.id)
        throw new Error("Cannot stop, archive or delete the calling session");
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(requestId))
        throw new Error("Invalid request ID");
      const target = await projectSession(source, id, input, host);
      if (
        target.orchestrationLeadId ||
        host.isMono(id) ||
        host.isHabitRun?.(id)
      )
        throw new Error("Only regular project sessions can be managed here");
      if (action === "sessions.stop") {
        await host.stop(id);
        return { sessionId: id, stopped: true };
      }
      const mode = action === "sessions.archive" ? "archive" : "delete";
      await host.remove(id, mode);
      return {
        sessionId: id,
        [mode === "archive" ? "archived" : "deleted"]: true,
      };
    }
    case "sessions.start": {
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(requestId))
        throw new Error(
          "request ID must use letters, digits, underscores or hyphens",
        );
      const launch = startLaunch(source, input, host);
      const notifyMonoId = completionRecipient(source, input, host, true);
      if (input.worktreeCwd !== undefined) {
        const chosen = (await host.worktrees(launch.cwd)).worktrees.find(
          (tree) =>
            !tree.missing &&
            pathKey(tree.path) === pathKey(launch.worktreeCwd!),
        );
        if (!chosen)
          throw new Error(
            "Worktree is unavailable in this project; run worktrees.list",
          );
        launch.worktreeCwd =
          pathKey(chosen.path) === pathKey(launch.cwd)
            ? undefined
            : chosen.path;
      }
      const placement = input.placement ?? "tab";
      if (placement !== "tab" && placement !== "right" && placement !== "down")
        throw new Error("placement must be tab, right or down");
      if (input.besideSessionId !== undefined && placement === "tab")
        throw new Error("besideSessionId requires placement right or down");
      const besideSessionId =
        placement === "tab"
          ? undefined
          : (optionalString(input.besideSessionId, "besideSessionId", 256) ??
            source.id);
      const id = `app-${source.id}-${requestId}`;
      if (besideSessionId)
        await host.start(
          launch,
          id,
          { direction: placement as SplitDir, besideSessionId },
          ...(notifyMonoId ? [notifyMonoId] : []),
        );
      else if (notifyMonoId)
        await host.start(launch, id, undefined, notifyMonoId);
      else await host.start(launch, id);
      const folder = host.monoOf?.(source.id)?.folder;
      if (folder && !launch.sidebarHidden)
        fileInMonoFolder(launch.cwd, id, folder);
      return {
        id,
        cwd: launch.cwd,
        harness: launch.harness,
        model: launch.model,
        submitted: !launch.draft,
        draft: !!launch.draft,
        ...(notifyMonoId ? { notifyOnComplete: true } : {}),
      };
    }
    case "worktrees.list":
      return host.worktrees(requireProject(source, input, host));
    case "worktrees.create": {
      const cwd = requireProject(source, input, host);
      const branch = requiredString(input.branch, "branch", 400);
      const existing = input.existing ?? false;
      if (typeof existing !== "boolean")
        throw new Error("existing must be a boolean");
      const base = optionalString(input.base, "base", 400);
      if (existing && base)
        throw new Error("base cannot be set for an existing branch");
      return host.createWorktree(cwd, branch, base ?? "HEAD", existing);
    }
    case "folders.list": {
      const cwd = requireProject(source, input, host);
      return {
        cwd,
        folders: loadSessionFolders(cwd).map(({ id, name, sessionIds }) => ({
          id,
          name,
          sessionIds,
        })),
      };
    }
    case "folders.move": {
      const cwd = requireProject(source, input, host);
      const sessionId = requiredString(input.sessionId, "sessionId", 256);
      const folderId = optionalString(input.folderId, "folderId", 256);
      const newFolderName = optionalString(
        input.newFolderName,
        "newFolderName",
        100,
      );
      if (!!folderId === !!newFolderName)
        throw new Error("Supply exactly one of folderId or newFolderName");
      if (
        !(await host.sessions(cwd)).some((session) => session.id === sessionId)
      )
        throw new Error("Session was not found in this project");
      const folders = loadSessionFolders(cwd);
      if (folderId && !folders.some((folder) => folder.id === folderId))
        throw new Error("Folder was not found in this project");
      const next = placeSessionInFolder(
        folders,
        sessionId,
        folderId
          ? { kind: "existing", folderId }
          : { kind: "new", name: newFolderName! },
      );
      saveSessionFolders(cwd, next);
      const folder = next.find((entry) => entry.sessionIds.includes(sessionId));
      return { sessionId, folderId: folder?.id, folderName: folder?.name };
    }
    case "tasks.list": {
      if (!host.tasks) throw new Error("Tasks are unavailable in this app");
      if (input.status !== undefined && input.statuses !== undefined)
        throw new Error("Use status or statuses, not both");
      const filters: TaskFilters = {};
      if (input.status !== undefined)
        filters.statuses = [taskStatus(input.status)];
      if (input.statuses !== undefined) {
        if (!Array.isArray(input.statuses) || input.statuses.length > 7)
          throw new Error(
            "statuses must be an array of up to seven task statuses",
          );
        filters.statuses = input.statuses.map(taskStatus);
      }
      if (input.tags !== undefined) filters.tags = noteTags(input.tags);
      if (input.tagMatch !== undefined) {
        if (input.tagMatch !== "all" && input.tagMatch !== "any")
          throw new Error("tagMatch must be all or any");
        filters.tagMatch = input.tagMatch;
      }
      const aliasedProject = taskProjectAlias(source, input, host);
      if (aliasedProject) filters.projectCwd = aliasedProject;
      if (input.projectCwd !== undefined) {
        const projectCwd = taskProject(input.projectCwd);
        if (projectCwd === null && host.monoOf?.(source.id))
          throw new Error("Mono task access requires an assigned project");
        if (projectCwd) assertMonoProjectAccess(source, projectCwd, host);
        filters.projectCwd = projectCwd;
      }
      if (input.query !== undefined) {
        if (typeof input.query !== "string" || input.query.length > 1000)
          throw new Error("query must be a string under 1000 characters");
        filters.query = input.query;
      }
      if (input.archived !== undefined) {
        if (
          input.archived !== true &&
          input.archived !== false &&
          input.archived !== "all"
        )
          throw new Error('archived must be true, false or "all"');
        filters.archived = input.archived;
      }
      if (input.focus !== undefined) {
        if (typeof input.focus !== "boolean")
          throw new Error("focus must be true or false");
        if (input.focus) filters.day = localDay();
      }
      const limit = input.limit ?? 30,
        offset = input.offset ?? 0;
      if (
        !Number.isInteger(limit) ||
        (limit as number) < 1 ||
        (limit as number) > 100
      )
        throw new Error("limit must be an integer from 1 to 100");
      if (!Number.isInteger(offset) || (offset as number) < 0)
        throw new Error("offset must be a non-negative integer");
      let rows = filterTasks(await host.tasks(), filters);
      const mono = host.monoOf?.(source.id);
      if (mono && input.projectCwd === undefined && !aliasedProject) {
        rows = rows.filter(
          (task) =>
            !!task.projectCwd &&
            canAccessAgentAppProject(source, task.projectCwd, mono.projects),
        );
      }
      return {
        total: rows.length,
        offset,
        tasks: rows
          .slice(offset as number, (offset as number) + (limit as number))
          .map(({ body, ...task }) => ({
            ...task,
            preview: notePreview(body),
          })),
      };
    }
    case "tasks.read": {
      if (!host.task) throw new Error("Tasks are unavailable in this app");
      const task = await host.task(taskId(input.id));
      if (!task) throw new Error("Task was not found");
      assertMonoProjectAccess(source, task.projectCwd, host);
      return task;
    }
    case "tasks.delete": {
      if (!host.deleteTask || !host.task)
        throw new Error("Tasks are unavailable in this app");
      const id = taskId(input.id);
      const task = await host.task(id);
      if (!task) throw new Error("Task was not found");
      assertMonoProjectAccess(source, task.projectCwd, host);
      await host.deleteTask(id);
      return { id, deleted: true };
    }
    case "tasks.write": {
      if (!host.task || !host.saveTask || !host.updateTask)
        throw new Error("Tasks are unavailable in this app");
      const id = input.id === undefined ? undefined : taskId(input.id);
      const existing = id ? await host.task(id) : undefined;
      if (id && !existing) throw new Error("Task was not found");
      if (existing) assertMonoProjectAccess(source, existing.projectCwd, host);
      const changes: TaskChanges = {};
      if (input.title !== undefined)
        changes.title = requiredString(input.title, "title", 200);
      if (input.body !== undefined) changes.body = noteBody(input.body);
      if (input.status !== undefined) {
        // Retired names still work: draft → todo, deferred → archived todo.
        const parsed = parseTaskStatus(input.status);
        changes.status = parsed.status;
        if (parsed.archive) changes.archived = true;
      }
      if (input.archived !== undefined) {
        if (typeof input.archived !== "boolean")
          throw new Error("archived must be true or false");
        changes.archived = input.archived;
      }
      if (input.focusDate !== undefined) {
        if (
          input.focusDate !== null &&
          (typeof input.focusDate !== "string" ||
            !/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(
              input.focusDate,
            ))
        )
          throw new Error("focusDate must be YYYY-MM-DD or null");
        changes.focusDate = input.focusDate;
        changes.today = localDay();
      }
      if (input.tags !== undefined) changes.tags = noteTags(input.tags);
      const aliasedProject = taskProjectAlias(source, input, host);
      if (aliasedProject) changes.projectCwd = aliasedProject;
      if (input.projectCwd !== undefined) {
        changes.projectCwd = taskProject(input.projectCwd);
        assertMonoProjectAccess(source, changes.projectCwd, host);
      }
      if (input.sourceSessionId !== undefined)
        changes.sourceSessionId =
          input.sourceSessionId === null ? null : taskId(input.sourceSessionId);
      if (input.sourceBlockId === null) changes.sourceBlockId = null;
      else if (input.sourceBlockId !== undefined) {
        const block = requiredString(input.sourceBlockId, "sourceBlockId", 512);
        if (
          new TextEncoder().encode(block).length > 512 ||
          /[\u0000-\u001f\u007f]/.test(block)
        )
          throw new Error("Invalid sourceBlockId");
        changes.sourceBlockId = block;
      }
      if (id) {
        if (!Object.keys(changes).length)
          throw new Error("Supply fields to update a task");
        return host.updateTask(id, changes);
      }
      if (changes.title === undefined && changes.body === undefined)
        throw new Error("Supply title or body to create a task");
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(requestId))
        throw new Error("Invalid request ID");
      const created: TaskUpsert = {
        id: `app-${source.id}-${requestId}`,
        title: changes.title ?? noteTitle(changes.body ?? ""),
        body: changes.body ?? "",
        status: changes.status ?? "todo",
        tags: changes.tags ?? [],
        focusDays: [],
        projectCwd:
          changes.projectCwd === null
            ? undefined
            : (changes.projectCwd ??
              (host.monoOf?.(source.id)
                ? defaultAssignedProject(source, host)
                : looksLikeProject(source.cwd)
                  ? source.cwd
                  : undefined)),
        sourceSessionId:
          changes.sourceSessionId === null
            ? undefined
            : (changes.sourceSessionId ?? source.id),
        sourceBlockId: changes.sourceBlockId ?? undefined,
        ...(changes.focusDate ? { focusDate: changes.focusDate } : {}),
        ...(changes.archived ? { archived: true } : {}),
      };
      const createdExisting = await host.task(created.id);
      if (createdExisting) {
        const { archived, ...fields } = created;
        if (
          Object.entries(fields).some(
            ([key, value]) =>
              JSON.stringify(createdExisting[key as keyof Task]) !==
              JSON.stringify(value),
          ) ||
          Boolean(archived) !== (createdExisting.archivedAt !== undefined)
        )
          throw new Error("Request ID was already used for another task");
        return createdExisting;
      }
      return host.saveTask(created);
    }
    case "notes.list": {
      const limit = input.limit ?? 30;
      const offset = input.offset ?? 0;
      if (
        !Number.isInteger(limit) ||
        (limit as number) < 1 ||
        (limit as number) > 100
      )
        throw new Error("limit must be an integer from 1 to 100");
      if (!Number.isInteger(offset) || (offset as number) < 0)
        throw new Error("offset must be a non-negative integer");
      const notes = await host.notes();
      return {
        total: notes.length,
        offset,
        notes: notes
          .slice(offset as number, (offset as number) + (limit as number))
          .map((note) => ({
            id: note.id,
            title: note.title,
            preview: notePreview(note.body),
            tags: note.tags,
            sourceCwd: note.sourceCwd,
          })),
      };
    }
    case "notes.read": {
      const id = requiredString(input.id, "id", 256);
      const note = await host.note(id);
      if (!note) throw new Error("Note was not found");
      return note;
    }
    case "notes.write": {
      const id = optionalString(input.id, "id", 256);
      if (id && !/^[A-Za-z0-9_-]+$/.test(id))
        throw new Error("Invalid note ID");
      const title =
        input.title === undefined
          ? undefined
          : requiredString(input.title, "title", 200);
      const body = input.body === undefined ? undefined : noteBody(input.body);
      const tags = input.tags === undefined ? undefined : noteTags(input.tags);
      if (id) {
        if (title === undefined && body === undefined && tags === undefined)
          throw new Error("Supply title, body or tags to update a note");
        const current = await host.note(id);
        if (!current) throw new Error("Note was not found");
        return host.saveNote({
          id,
          title: title ?? current.title,
          body: body ?? current.body,
          tags: tags ?? current.tags,
        });
      }
      if (body === undefined)
        throw new Error("body is required to create a note");
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(requestId))
        throw new Error("Invalid request ID");
      const createdId = `app-${source.id}-${requestId}`;
      const existing = await host.note(createdId);
      if (existing) {
        if (
          existing.title !== (title ?? noteTitle(body)) ||
          existing.body !== body ||
          JSON.stringify(existing.tags) !== JSON.stringify(tags ?? [])
        )
          throw new Error("Request ID was already used for another note");
        return existing;
      }
      return host.saveNote({
        id: createdId,
        title: title ?? noteTitle(body),
        body,
        tags: tags ?? [],
        sourceSessionId: source.id,
        ...(looksLikeProject(source.cwd) ? { sourceCwd: source.cwd } : {}),
      });
    }
  }
}

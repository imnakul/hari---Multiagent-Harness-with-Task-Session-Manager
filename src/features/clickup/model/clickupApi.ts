import { invoke } from "@tauri-apps/api/core";

/** Fork (L-381): typed wrappers over the `clickup_*` commands. The token never passes through here after `setToken`. */

export type ClickupErrorKind =
  | "notConnected"
  | "auth"
  | "forbidden"
  | "notFound"
  | "rateLimited"
  | "invalid"
  | "server"
  | "network";

const ERROR_KINDS: readonly ClickupErrorKind[] = [
  "notConnected",
  "auth",
  "forbidden",
  "notFound",
  "rateLimited",
  "invalid",
  "server",
  "network",
];

export class ClickupError extends Error {
  constructor(
    readonly kind: ClickupErrorKind,
    readonly retryAfterSeconds: number | null = null,
    message: string = kind,
  ) {
    super(message);
    this.name = "ClickupError";
  }
}

export interface ClickupMember {
  id: number;
  username: string;
  email: string;
  initials: string;
  color: string;
  profilePicture: string | null;
}
export interface ClickupStatus {
  status: string;
  type: string;
  color: string;
  orderindex: number;
}
export interface ClickupListInfo {
  id: string;
  name: string;
  statuses: ClickupStatus[];
  permissionLevel: string | null;
}
/** A custom field's value as display text (L-381); `date` fields carry milliseconds as text. */
export interface ClickupCustomField {
  id: string;
  name: string;
  type: string;
  text: string;
  color: string | null;
}
export interface ClickupTask {
  id: string;
  name: string;
  markdownDescription: string | null;
  status: { status: string; type: string; color: string };
  priority: 1 | 2 | 3 | 4 | null;
  assignees: ClickupMember[];
  startDate: number | null;
  dueDate: number | null;
  dateUpdated: number;
  dateCreated: number | null;
  dateClosed: number | null;
  customId: string | null;
  tags: string[];
  customFields: ClickupCustomField[];
  url: string;
  listId: string;
}
/** The fields a write may carry, in ClickUp's own names. Only changed fields are present. */
export interface ClickupTaskInput {
  name?: string;
  markdown_content?: string;
  status?: string;
  priority?: number | null;
  assignees?: number[] | { add: number[]; rem: number[] };
  start_date?: number | null;
  start_date_time?: boolean;
  due_date?: number | null;
  due_date_time?: boolean;
}

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const str = (value: unknown): string => (typeof value === "string" ? value : "");
const num = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);
const numOrNull = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

function toError(raw: unknown): ClickupError {
  if (raw instanceof ClickupError) return raw;
  if (isObject(raw) && typeof raw.kind === "string") {
    const kind = ERROR_KINDS.find((candidate) => candidate === raw.kind);
    if (kind) {
      return new ClickupError(
        kind,
        kind === "rateLimited" ? Math.max(1, num(raw.retryAfterSeconds) || 60) : null,
        kind === "invalid" ? str(raw.message) || "ClickUp rejected the request." : kind,
      );
    }
  }
  return new ClickupError("network");
}

async function call(command: string, args?: Record<string, unknown>): Promise<unknown> {
  try {
    return await invoke<unknown>(command, args);
  } catch (error) {
    throw toError(error);
  }
}

export function parseMember(raw: unknown): ClickupMember {
  const value = isObject(raw) ? raw : {};
  return {
    id: num(value.id),
    username: str(value.username),
    email: str(value.email),
    initials: str(value.initials),
    color: str(value.color),
    profilePicture: typeof value.profilePicture === "string" ? value.profilePicture : null,
  };
}

function parseCustomField(raw: unknown): ClickupCustomField {
  const value = isObject(raw) ? raw : {};
  return {
    id: str(value.id),
    name: str(value.name),
    type: str(value.type),
    text: str(value.text),
    color: typeof value.color === "string" && value.color ? value.color : null,
  };
}

export interface ClickupAttachment {
  id: string;
  title: string;
  /** Always http(s); Rust drops anything else. */
  url: string;
  extension: string;
  size: number | null;
  date: number | null;
}
export interface ClickupChecklist {
  id: string;
  name: string;
  items: { id: string; name: string; resolved: boolean }[];
}
export interface ClickupSubtask {
  id: string;
  name: string;
  status: string;
  color: string;
  url: string | null;
}
export interface ClickupComment {
  id: string;
  text: string;
  user: ClickupMember;
  date: number | null;
}
/** Fork (L-381): everything the detail panel shows beyond the list row. */
export interface ClickupTaskDetails {
  task: ClickupTask;
  attachments: ClickupAttachment[];
  checklists: ClickupChecklist[];
  subtasks: ClickupSubtask[];
  linkedTaskIds: string[];
  dependencies: { id: string; kind: "waitingOn" | "blocking" }[];
  creator: ClickupMember | null;
  watchers: ClickupMember[];
  /** Milliseconds. */
  timeEstimate: number | null;
  timeSpent: number | null;
  points: number | null;
  parentId: string | null;
  comments: ClickupComment[];
  /** The task loaded but its comments didn't. */
  commentsFailed: boolean;
}

const list = <T>(value: unknown, parse: (entry: unknown) => T): T[] => (Array.isArray(value) ? value.map(parse) : []);
const textOrNull = (value: unknown): string | null => (typeof value === "string" && value ? value : null);
const webUrlOrNull = (value: unknown): string | null =>
  typeof value === "string" && /^https?:\/\//i.test(value) ? value : null;

export function parseTaskDetails(raw: unknown): ClickupTaskDetails {
  const value = isObject(raw) ? raw : {};
  return {
    task: parseTask(value.task),
    attachments: list(value.attachments, (entry) => {
      const file = isObject(entry) ? entry : {};
      return {
        id: str(file.id),
        title: str(file.title),
        url: webUrlOrNull(file.url) ?? "",
        extension: str(file.extension),
        size: numOrNull(file.size),
        date: numOrNull(file.date),
      };
    }).filter((file) => file.url),
    checklists: list(value.checklists, (entry) => {
      const checklist = isObject(entry) ? entry : {};
      return {
        id: str(checklist.id),
        name: str(checklist.name),
        items: list(checklist.items, (item) => {
          const row = isObject(item) ? item : {};
          return { id: str(row.id), name: str(row.name), resolved: row.resolved === true };
        }),
      };
    }),
    subtasks: list(value.subtasks, (entry) => {
      const sub = isObject(entry) ? entry : {};
      return { id: str(sub.id), name: str(sub.name), status: str(sub.status), color: str(sub.color), url: webUrlOrNull(sub.url) };
    }),
    linkedTaskIds: list(value.linkedTaskIds, str).filter(Boolean),
    dependencies: list(value.dependencies, (entry) => {
      const dep = isObject(entry) ? entry : {};
      return { id: str(dep.id), kind: dep.kind === "blocking" ? ("blocking" as const) : ("waitingOn" as const) };
    }).filter((dep) => dep.id),
    creator: isObject(value.creator) ? parseMember(value.creator) : null,
    watchers: list(value.watchers, parseMember),
    timeEstimate: numOrNull(value.timeEstimate),
    timeSpent: numOrNull(value.timeSpent),
    points: numOrNull(value.points),
    parentId: textOrNull(value.parentId),
    comments: list(value.comments, (entry) => {
      const comment = isObject(entry) ? entry : {};
      return { id: str(comment.id), text: str(comment.text), user: parseMember(comment.user), date: numOrNull(comment.date) };
    }).filter((comment) => comment.text.trim()),
    commentsFailed: value.commentsFailed === true,
  };
}

export function parseTask(raw: unknown): ClickupTask {
  const value = isObject(raw) ? raw : {};
  const status = isObject(value.status) ? value.status : {};
  const priority = numOrNull(value.priority);
  return {
    id: str(value.id),
    name: str(value.name),
    markdownDescription: typeof value.markdownDescription === "string" ? value.markdownDescription : null,
    status: { status: str(status.status), type: str(status.type), color: str(status.color) },
    priority: priority === 1 || priority === 2 || priority === 3 || priority === 4 ? priority : null,
    assignees: Array.isArray(value.assignees) ? value.assignees.map(parseMember) : [],
    startDate: numOrNull(value.startDate),
    dueDate: numOrNull(value.dueDate),
    dateUpdated: num(value.dateUpdated),
    dateCreated: numOrNull(value.dateCreated),
    dateClosed: numOrNull(value.dateClosed),
    customId: typeof value.customId === "string" && value.customId ? value.customId : null,
    tags: Array.isArray(value.tags) ? value.tags.filter((tag): tag is string => typeof tag === "string") : [],
    customFields: Array.isArray(value.customFields) ? value.customFields.map(parseCustomField).filter((field) => field.text) : [],
    url: str(value.url),
    listId: str(value.listId),
  };
}

function parseList(raw: unknown): ClickupListInfo {
  const value = isObject(raw) ? raw : {};
  return {
    id: str(value.id),
    name: str(value.name),
    statuses: Array.isArray(value.statuses)
      ? value.statuses.map((entry) => {
          const status = isObject(entry) ? entry : {};
          return {
            status: str(status.status),
            type: str(status.type),
            color: str(status.color),
            orderindex: num(status.orderindex),
          };
        })
      : [],
    permissionLevel: typeof value.permissionLevel === "string" ? value.permissionLevel : null,
  };
}

export const clickupApi = {
  async isConnected(): Promise<boolean> {
    const reply = await call("clickup_status");
    return isObject(reply) && reply.connected === true;
  },
  /** Sends the token to Rust once; it is validated there and kept only in the keychain. */
  async setToken(token: string): Promise<{ id: number; username: string }> {
    const trimmed = token.trim();
    if (!trimmed || trimmed.length > 200) throw new ClickupError("auth");
    const reply = await call("clickup_set_token", { token: trimmed });
    const value = isObject(reply) ? reply : {};
    return { id: num(value.id), username: str(value.username) };
  },
  /** The ClickUp user the stored token belongs to. */
  async me(): Promise<ClickupMember> {
    return parseMember(await call("clickup_me"));
  },
  async disconnect(): Promise<void> {
    await call("clickup_disconnect");
  },
  async list(listId: string): Promise<ClickupListInfo> {
    return parseList(await call("clickup_list", { listId }));
  },
  async members(listId: string): Promise<ClickupMember[]> {
    const reply = await call("clickup_list_members", { listId });
    return Array.isArray(reply) ? reply.map(parseMember) : [];
  },
  async tasks(
    listId: string,
    page: number,
    includeClosed: boolean,
  ): Promise<{ tasks: ClickupTask[]; lastPage: boolean }> {
    const reply = await call("clickup_tasks", { listId, page, includeClosed });
    const value = isObject(reply) ? reply : {};
    return {
      tasks: Array.isArray(value.tasks) ? value.tasks.map(parseTask) : [],
      lastPage: value.lastPage !== false,
    };
  },
  async task(taskId: string): Promise<ClickupTask> {
    return parseTask(await call("clickup_task", { taskId }));
  },
  /** The full task for the detail panel: attachments, checklists, subtasks, relations, comments. */
  async taskDetails(taskId: string): Promise<ClickupTaskDetails> {
    return parseTaskDetails(await call("clickup_task_details", { taskId }));
  },
  async createTask(listId: string, input: ClickupTaskInput): Promise<ClickupTask> {
    return parseTask(await call("clickup_create_task", { listId, input }));
  },
  async updateTask(taskId: string, input: ClickupTaskInput): Promise<ClickupTask> {
    return parseTask(await call("clickup_update_task", { taskId, input }));
  },
  /** Posts a plain-text comment as the connected user (nobody extra is notified). */
  async postComment(taskId: string, text: string): Promise<void> {
    await call("clickup_post_comment", { taskId, text });
  },
  /**
   * Downloads an attachment into the app cache through the connection (ClickUp
   * file links need a signed-in browser) and returns where it landed. Repeat
   * calls reuse the cached copy.
   */
  async downloadAttachment(taskId: string, attachmentId: string): Promise<ClickupDownloadedFile> {
    const value: unknown = await call("clickup_download_attachment", { taskId, attachmentId });
    const raw = isObject(value) ? value : {};
    const path = str(raw.path);
    if (!path) throw new ClickupError("server");
    return { path, name: str(raw.name) || "attachment", size: num(raw.size) };
  },
  /** Saves a copy of an attachment to a full file path the user picked. */
  async saveAttachment(taskId: string, attachmentId: string, destination: string): Promise<void> {
    await call("clickup_save_attachment", { taskId, attachmentId, destination });
  },

  /** Fork (L-395): uploads one file (a path on disk or base64 data) to a task. One try; not retried. */
  async uploadAttachment(
    taskId: string,
    file: { path?: string; data?: string; name: string; mimeType: string },
  ): Promise<{ id: string; title: string }> {
    const value: unknown = await call("clickup_upload_attachment", {
      taskId,
      path: file.path ?? null,
      data: file.data ?? null,
      name: file.name,
      mime: file.mimeType,
    });
    const raw = isObject(value) ? value : {};
    return { id: str(raw.id), title: str(raw.title) };
  },
};

export interface ClickupDownloadedFile {
  path: string;
  name: string;
  size: number;
}

export type ClickupApi = typeof clickupApi;

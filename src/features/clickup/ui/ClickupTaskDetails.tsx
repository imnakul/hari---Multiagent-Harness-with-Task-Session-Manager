import { save } from "@tauri-apps/plugin-dialog";
import { useEffect, useRef, useState, type JSX, type ReactNode } from "react";
import { copyFileToClipboard, openPathWithDefaultApp } from "../../../platform/tauri/fs";
import { openWebLink } from "../../browser/model/openWebLink";
import { Check, Copy, Download, ExternalLink, File, Loader, MessageSquare, Paperclip } from "../../../shared/ui/icons";
import {
  clickupApi,
  ClickupError,
  type ClickupAttachment,
  type ClickupMember,
  type ClickupTask,
  type ClickupTaskDetails as Details,
} from "../model/clickupApi";
import { describeClickupError } from "../model/clickupMessages";
import { ClickupAvatars, ClickupFieldValue, ClickupStatusPill, shortDate } from "./ClickupBits";
import { ClickupCopyButton } from "./ClickupCopyButton";

/**
 * Fork (L-381): the rest of a task under its editable fields: links,
 * attachments, subtasks, checklists, relations, people, numbers, custom
 * fields and comments. Attachments download through the connection to open,
 * copy or save on this computer; comments can be written unless the list is
 * read-only. Everything else opens in ClickUp or the browser.
 */

type Load = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; details: Details };

const SECTION_TITLE = "mb-1.5 flex items-center gap-1.5 text-[11.5px] font-medium uppercase tracking-wide text-content/45";
const LINK_ROW =
  "flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] text-content/85 transition-colors duration-100 hover:bg-content/[0.06] hover:text-content";
const TASK_URL = "https://app.clickup.com/t/";
const ICON_BUTTON =
  "grid size-7 shrink-0 place-items-center rounded-md text-content/55 transition-colors hover:bg-content/10 hover:text-content active:scale-96 disabled:opacity-40 disabled:hover:bg-transparent";
const MAX_COMMENT_CHARS = 10_000;

/** Web links in free text, without trailing punctuation or Markdown brackets. */
export function linksIn(text: string): string[] {
  const found = text.match(/https?:\/\/[^\s<>()[\]"'`]+/gi) ?? [];
  return found.map((url) => url.replace(/[.,;:!?*_]+$/, ""));
}

/**
 * Every link a task mentions, in reading order, once each: URL custom fields
 * first, then the description, then comments.
 */
export function taskLinks(task: ClickupTask, comments: readonly { text: string }[]): { url: string; source: string }[] {
  const seen = new Set<string>();
  const links: { url: string; source: string }[] = [];
  const add = (url: string, source: string): void => {
    if (!/^https?:\/\//i.test(url) || seen.has(url)) return;
    seen.add(url);
    links.push({ url, source });
  };
  for (const field of task.customFields) if (field.type === "url") add(field.text.trim(), field.name);
  for (const url of linksIn(task.markdownDescription ?? "")) add(url, "Description");
  for (const comment of comments) for (const url of linksIn(comment.text)) add(url, "Comment");
  return links;
}

function linkLabel(url: string): { host: string; path: string } {
  try {
    const parsed = new URL(url);
    return { host: parsed.host.replace(/^www\./, ""), path: `${parsed.pathname}${parsed.search}`.replace(/^\/$/, "") };
  } catch {
    return { host: url, path: "" };
  }
}

function fileSize(bytes: number | null): string {
  if (bytes === null || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function duration(ms: number | null): string {
  if (ms === null || ms <= 0) return "";
  const minutes = Math.round(ms / 60_000);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours ? (rest ? `${hours}h ${rest}m` : `${hours}h`) : `${rest}m`;
}

function Section({ title, icon, count, children }: { title: string; icon?: ReactNode; count?: number; children: ReactNode }): JSX.Element {
  return (
    <section aria-label={title} className="border-t border-stroke pt-3">
      <h3 className={SECTION_TITLE}>
        {icon}
        {title}
        {count !== undefined ? <span className="tabular-nums text-content/35">{count}</span> : null}
      </h3>
      {children}
    </section>
  );
}

function People({ members }: { members: readonly ClickupMember[] }): JSX.Element {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <ClickupAvatars members={members} />
      <span className="min-w-0 truncate">{members.map((member) => member.username).join(", ")}</span>
    </span>
  );
}

type FileAction = "open" | "copy" | "save";
type FileState =
  | { kind: "idle" }
  | { kind: "busy"; action: FileAction }
  | { kind: "done"; action: "copy" | "save" }
  | { kind: "error"; message: string };

const FAILED: Record<FileAction, string> = {
  open: "Couldn't open the file.",
  copy: "Couldn't copy the file.",
  save: "Couldn't save the file.",
};

function fileError(action: FileAction, error: unknown): string {
  return error instanceof ClickupError ? describeClickupError(error) : FAILED[action];
}

/**
 * One attachment: click to open it in this computer's default app, or copy the
 * file itself / save a copy. Each downloads it once into the app cache first.
 */
function AttachmentCard({ taskId, file, now }: { taskId: string; file: ClickupAttachment; now: number }): JSX.Element {
  const [state, setState] = useState<FileState>({ kind: "idle" });
  const busy = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  // "Copied" / "Saved" shows briefly, then the row goes back to its details.
  useEffect(() => {
    if (state.kind !== "done") return;
    const timer = window.setTimeout(() => setState({ kind: "idle" }), 1800);
    return () => window.clearTimeout(timer);
  }, [state]);

  const local = Boolean(file.id);
  const name = file.title || "attachment";
  const run = async (action: FileAction, work: () => Promise<boolean>): Promise<void> => {
    if (busy.current) return;
    busy.current = true;
    setState({ kind: "busy", action });
    try {
      const finished = await work();
      if (alive.current) setState(finished && action !== "open" ? { kind: "done", action } : { kind: "idle" });
    } catch (error) {
      if (alive.current) setState({ kind: "error", message: fileError(action, error) });
    } finally {
      busy.current = false;
    }
  };
  const download = async (): Promise<string> => (await clickupApi.downloadAttachment(taskId, file.id)).path;
  const open = (): void =>
    void run("open", async () => {
      await openPathWithDefaultApp(await download());
      return true;
    });
  const copy = (): void =>
    void run("copy", async () => {
      await copyFileToClipboard(await download());
      return true;
    });
  const saveAs = (): void =>
    void run("save", async () => {
      const target = await save({ defaultPath: file.title || undefined, title: "Save attachment" });
      if (!target) return false;
      await clickupApi.saveAttachment(taskId, file.id, target);
      return true;
    });

  const meta = [file.extension.toUpperCase(), fileSize(file.size), shortDate(file.date, now)].filter(Boolean).join(" · ");
  const working = state.kind === "busy";
  let note = meta;
  if (state.kind === "busy") note = state.action === "save" ? "Saving…" : "Downloading…";
  else if (state.kind === "done") note = state.action === "copy" ? "Copied" : "Saved";
  else if (state.kind === "error") note = state.message;

  return (
    <div className="flex min-w-0 items-center gap-0.5">
      <button
        type="button"
        className={LINK_ROW}
        title={local ? "Open " + name : file.title}
        aria-busy={working}
        disabled={working}
        onClick={local ? open : () => openWebLink(file.url)}
      >
        {working ? (
          <Loader aria-hidden className="size-4 shrink-0 animate-spin text-content/50" />
        ) : (
          <File aria-hidden className="size-4 shrink-0 text-content/50" />
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate">{file.title || "Attachment"}</span>
          {note ? (
            <span
              role={state.kind === "error" ? "alert" : "status"}
              className={state.kind === "error" ? "block truncate text-[11px] text-red-400" : "block truncate text-[11px] text-content/45"}
            >
              {note}
            </span>
          ) : null}
        </span>
      </button>
      {local ? (
        <>
          <button type="button" className={ICON_BUTTON} aria-label={"Copy " + name} title="Copy file" disabled={working} onClick={copy}>
            {state.kind === "done" && state.action === "copy" ? (
              <Check aria-hidden className="size-3.5" />
            ) : (
              <Copy aria-hidden className="size-3.5" />
            )}
          </button>
          <button type="button" className={ICON_BUTTON} aria-label={"Save " + name + " as"} title="Save as…" disabled={working} onClick={saveAs}>
            <Download aria-hidden className="size-3.5" />
          </button>
        </>
      ) : null}
      <button
        type="button"
        className={ICON_BUTTON}
        aria-label={"Open " + name + " in ClickUp"}
        title="Open in ClickUp"
        onClick={() => openWebLink(file.url)}
      >
        <ExternalLink aria-hidden className="size-3.5" />
      </button>
    </div>
  );
}

/** Writes a comment as the connected user; the list reloads once ClickUp has it. */
function CommentBox({ taskId, onPosted }: { taskId: string; onPosted: () => void }): JSX.Element {
  const [text, setText] = useState("");
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sending = useRef(false);

  const post = async (): Promise<void> => {
    if (sending.current || !text.trim()) return;
    sending.current = true;
    setPosting(true);
    setError(null);
    try {
      await clickupApi.postComment(taskId, text);
      setText("");
      onPosted();
    } catch (failure) {
      setError(failure instanceof ClickupError ? describeClickupError(failure) : "Couldn't reach ClickUp.");
    } finally {
      sending.current = false;
      setPosting(false);
    }
  };

  return (
    <form
      className="mt-2.5 flex flex-col gap-1.5"
      onSubmit={(event) => {
        event.preventDefault();
        void post();
      }}
    >
      <textarea
        value={text}
        rows={2}
        maxLength={MAX_COMMENT_CHARS}
        disabled={posting}
        aria-label="Write a comment"
        placeholder="Write a comment…"
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            void post();
          }
        }}
        className="w-full resize-y rounded-md border border-stroke bg-content/[0.04] px-2.5 py-1.5 text-[12.5px] text-content outline-none transition-colors placeholder:text-content/35 focus-visible:border-accent disabled:opacity-50"
      />
      {error ? (
        <p role="alert" className="text-[12px] text-red-400">
          {error}
        </p>
      ) : null}
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={posting || !text.trim()}
          className="inline-flex h-7 items-center rounded-md bg-content/10 px-2.5 text-[12px] text-content transition-colors hover:bg-content/15 active:scale-96 disabled:opacity-50"
        >
          {posting ? "Posting…" : "Comment"}
        </button>
        <span className="text-[11px] text-content/35">Posts as you · Ctrl+Enter</span>
      </div>
    </form>
  );
}

function TaskRef({ id, label }: { id: string; label: string }): JSX.Element {
  return (
    <button type="button" className={LINK_ROW} onClick={() => openWebLink(`${TASK_URL}${encodeURIComponent(id)}`)}>
      <span className="w-20 shrink-0 text-content/50">{label}</span>
      <span className="min-w-0 flex-1 truncate tabular-nums">#{id}</span>
      <ExternalLink aria-hidden className="size-3.5 shrink-0 text-content/40" />
    </button>
  );
}

function DetailRow({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <div className="flex min-h-7 items-center gap-3 px-2 text-[12.5px]">
      <dt className="w-28 shrink-0 text-content/50">{label}</dt>
      <dd className="min-w-0 flex-1 text-content/85">{children}</dd>
    </div>
  );
}

export function ClickupTaskDetails({ task, readOnly }: { task: ClickupTask; readOnly: boolean }): JSX.Element {
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const now = Date.now();

  // Refetch when the task changes underneath (a save, an agent edit); stale replies are dropped.
  useEffect(() => {
    let cancelled = false;
    setLoad((current) => (current.kind === "ready" ? current : { kind: "loading" }));
    clickupApi
      .taskDetails(task.id)
      .then((details) => {
        if (!cancelled) setLoad({ kind: "ready", details });
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoad({ kind: "error", message: describeClickupError(error) });
      });
    return () => {
      cancelled = true;
    };
  }, [task.id, task.dateUpdated, attempt]);

  if (load.kind === "loading") {
    return (
      <div aria-busy="true" aria-label="Loading task details" className="mt-4 space-y-2 border-t border-stroke pt-3">
        {[0, 1, 2].map((row) => (
          <div key={row} className="h-7 animate-pulse rounded-md bg-content/[0.06]" />
        ))}
      </div>
    );
  }
  if (load.kind === "error") {
    return (
      <div role="alert" className="mt-4 flex items-center gap-2 border-t border-stroke pt-3 text-[12.5px] text-content/60">
        <span className="min-w-0 flex-1">Couldn't load links, attachments and comments. {load.message}</span>
        <button
          type="button"
          className="h-7 shrink-0 rounded-md bg-content/10 px-2.5 text-[12px] text-content transition-colors hover:bg-content/15 active:scale-96"
          onClick={() => setAttempt((count) => count + 1)}
        >
          Try again
        </button>
      </div>
    );
  }

  const { details } = load;
  const links = taskLinks(details.task, details.comments);
  const waitingOn = details.dependencies.filter((dep) => dep.kind === "waitingOn");
  const blocking = details.dependencies.filter((dep) => dep.kind === "blocking");
  const otherFields = details.task.customFields.filter((field) => field.type !== "url");
  const hasRelations = details.parentId || waitingOn.length || blocking.length || details.linkedTaskIds.length;

  return (
    <div className="mt-4 flex flex-col gap-4">
      {links.length ? (
        <Section title="Links" icon={<ExternalLink aria-hidden className="size-3.5" />} count={links.length}>
          <ul>
            {links.map((link) => {
              const label = linkLabel(link.url);
              return (
                <li key={link.url}>
                  <button type="button" className={LINK_ROW} title={link.url} onClick={() => openWebLink(link.url)}>
                    <span className="min-w-0 flex-1 truncate">
                      <span className="text-content/90">{label.host}</span>
                      <span className="text-content/45">{label.path}</span>
                    </span>
                    <span className="shrink-0 text-[11px] text-content/40">{link.source}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </Section>
      ) : null}

      {details.attachments.length ? (
        <Section title="Attachments" icon={<Paperclip aria-hidden className="size-3.5" />} count={details.attachments.length}>
          <ul>
            {details.attachments.map((file) => (
              <li key={file.id || file.url}>
                <AttachmentCard taskId={details.task.id} file={file} now={now} />
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {details.subtasks.length ? (
        <Section title="Subtasks" count={details.subtasks.length}>
          <ul>
            {details.subtasks.map((sub) => (
              <li key={sub.id} className="group/subtask relative">
                <button
                  type="button"
                  className={`${LINK_ROW} pr-9`}
                  onClick={() => openWebLink(sub.url ?? `${TASK_URL}${encodeURIComponent(sub.id)}`)}
                >
                  <ClickupStatusPill name={sub.status} color={sub.color || null} />
                  <span className="min-w-0 flex-1 truncate">{sub.name}</span>
                  <ExternalLink aria-hidden className="size-3.5 shrink-0 text-content/40" />
                </button>
                {/* Fork (L-390): copy one subtask, shown on hover or keyboard focus. */}
                <ClickupCopyButton
                  task={{ id: sub.id, name: sub.name, markdownDescription: "" }}
                  label={`Copy subtask ${sub.name}`}
                  className={`${ICON_BUTTON} absolute right-0.5 top-1/2 -translate-y-1/2 opacity-0 transition-opacity group-hover/subtask:opacity-100 focus-visible:opacity-100 aria-busy:opacity-100`}
                />
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {details.checklists.map((checklist) => {
        const done = checklist.items.filter((item) => item.resolved).length;
        return (
          <Section key={checklist.id} title={checklist.name || "Checklist"}>
            <p className="-mt-1 mb-1 px-2 text-[11px] tabular-nums text-content/45">
              {done}/{checklist.items.length} done
            </p>
            <ul>
              {checklist.items.map((item) => (
                <li key={item.id} className="flex items-center gap-2 px-2 py-1 text-[12.5px]">
                  <span
                    aria-hidden
                    className={`grid size-3.5 shrink-0 place-items-center rounded border ${
                      item.resolved ? "border-accent bg-accent text-white" : "border-stroke"
                    }`}
                  >
                    {item.resolved ? <Check className="size-2.5" strokeWidth={2.5} /> : null}
                  </span>
                  <span className={item.resolved ? "text-content/45 line-through" : "text-content/85"}>{item.name}</span>
                  <span className="sr-only">{item.resolved ? "done" : "not done"}</span>
                </li>
              ))}
            </ul>
          </Section>
        );
      })}

      {hasRelations ? (
        <Section title="Relationships">
          <ul>
            {details.parentId ? (
              <li>
                <TaskRef id={details.parentId} label="Parent" />
              </li>
            ) : null}
            {waitingOn.map((dep) => (
              <li key={`w-${dep.id}`}>
                <TaskRef id={dep.id} label="Waiting on" />
              </li>
            ))}
            {blocking.map((dep) => (
              <li key={`b-${dep.id}`}>
                <TaskRef id={dep.id} label="Blocking" />
              </li>
            ))}
            {details.linkedTaskIds.map((id) => (
              <li key={`l-${id}`}>
                <TaskRef id={id} label="Linked" />
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Section title="Details">
        <dl>
          <DetailRow label="Task ID">#{details.task.customId || details.task.id}</DetailRow>
          {details.creator ? (
            <DetailRow label="Created by">
              <People members={[details.creator]} />
            </DetailRow>
          ) : null}
          {details.task.dateCreated ? <DetailRow label="Created">{shortDate(details.task.dateCreated, now)}</DetailRow> : null}
          {details.task.dateUpdated ? <DetailRow label="Updated">{shortDate(details.task.dateUpdated, now)}</DetailRow> : null}
          {details.task.dateClosed ? <DetailRow label="Closed">{shortDate(details.task.dateClosed, now)}</DetailRow> : null}
          {details.watchers.length ? (
            <DetailRow label="Watchers">
              <People members={details.watchers} />
            </DetailRow>
          ) : null}
          {details.timeEstimate ? <DetailRow label="Time estimate">{duration(details.timeEstimate)}</DetailRow> : null}
          {details.timeSpent ? <DetailRow label="Time tracked">{duration(details.timeSpent)}</DetailRow> : null}
          {details.points !== null ? <DetailRow label="Sprint points">{details.points}</DetailRow> : null}
          {details.task.tags.length ? <DetailRow label="Tags">{details.task.tags.join(", ")}</DetailRow> : null}
          {otherFields.map((field) => (
            <DetailRow key={field.id} label={field.name}>
              <ClickupFieldValue field={field} now={now} />
            </DetailRow>
          ))}
        </dl>
      </Section>

      <Section
        title="Comments"
        icon={<MessageSquare aria-hidden className="size-3.5" />}
        count={details.commentsFailed ? undefined : details.comments.length}
      >
        {details.commentsFailed ? (
          <p className="px-2 text-[12.5px] text-content/55">Couldn't load comments. Open the task in ClickUp to read them.</p>
        ) : details.comments.length === 0 ? (
          <p className="px-2 text-[12.5px] text-content/45">No comments.</p>
        ) : (
          <ol className="flex flex-col gap-2.5">
            {details.comments.map((comment) => (
              <li key={comment.id} className="rounded-md bg-content/[0.04] px-2.5 py-2">
                <p className="mb-1 flex items-center gap-1.5 text-[11.5px] text-content/50">
                  <ClickupAvatars members={[comment.user]} />
                  <span className="font-medium text-content/75">{comment.user.username || "Someone"}</span>
                  {comment.date ? <span>· {shortDate(comment.date, now)}</span> : null}
                </p>
                <p className="whitespace-pre-wrap break-words text-[12.5px] text-content/85">{comment.text.trim()}</p>
              </li>
            ))}
          </ol>
        )}
        {readOnly ? null : <CommentBox taskId={details.task.id} onPosted={() => setAttempt((count) => count + 1)} />}
      </Section>
    </div>
  );
}

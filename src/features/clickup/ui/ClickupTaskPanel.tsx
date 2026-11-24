import { useEffect, useMemo, useRef, useState, type JSX } from "react";
import { ChevronLeft, X } from "../../../shared/ui/icons";
import { ProjectChatList, type FocusChatInfo } from "../../focus/ui/FocusPicker";
import { useProjectMarks } from "../../projects/ui/ProjectMark";
import { projectName } from "../../../shared/lib/paths";
import { Popover } from "../../../shared/ui/Popover";
import type { ClickupListInfo, ClickupMember, ClickupTask, ClickupTaskInput } from "../model/clickupApi";
import { describeClickupError } from "../model/clickupMessages";
import {
  draftFromTask,
  dueBeforeStart,
  taskPatch,
  type ClickupTaskDraft,
} from "../model/clickupTasks";
import { ClickupCopyButton } from "./ClickupCopyButton";
import { ClickupTaskDetails } from "./ClickupTaskDetails";
import { ClickupTaskForm } from "./ClickupTaskForm";

const BUTTON =
  "inline-flex h-8 items-center rounded-md bg-content/10 px-3 text-[13px] text-content transition-colors hover:bg-content/15 active:scale-96 disabled:opacity-50";
const ICON_BUTTON =
  "grid size-7 shrink-0 place-items-center rounded-md text-content/60 transition-colors hover:bg-content/10 hover:text-content active:scale-96";
const MENU_ITEM =
  "flex w-full items-center px-3 py-1.5 text-left text-[13px] text-content/90 transition-colors hover:bg-content/[0.08] disabled:text-content/40 disabled:hover:bg-transparent";

export interface ClickupMonoChoice {
  id: string;
  name: string;
  /** A Mono that was never opened has no conversation to put a draft in. */
  started: boolean;
}

/**
 * Fork (L-381): one task's detail. Saves send only what changed since the
 * snapshot taken when the task was opened (or last saved), so a refresh that
 * brings a newer copy never overwrites untouched fields or loses edits.
 */
export function ClickupTaskPanel({
  task,
  listName,
  meta,
  members,
  readOnly,
  saving,
  monos,
  onClose,
  onSave,
  onNewSession,
  onGiveToMono,
  project,
  sessionStatus,
  onContinueSession,
}: {
  task: ClickupTask;
  listName: string;
  meta: ClickupListInfo | null;
  members: readonly ClickupMember[];
  readOnly: boolean;
  saving: boolean;
  monos: readonly ClickupMonoChoice[];
  onClose: () => void;
  onSave: (patch: ClickupTaskInput) => Promise<ClickupTask | null>;
  /** Both gather the task's details and files first, then hand them over. */
  onNewSession: () => Promise<void>;
  onGiveToMono: (monoId: string) => Promise<void>;
  /** Fork (L-389): the linked project, whose chats "Continue in a session" lists; null when none is linked. */
  project: string | null;
  sessionStatus?: (sessionId: string) => FocusChatInfo["status"];
  /** Sends the task to that chat now, or queues it while the chat is replying. */
  onContinueSession: (sessionId: string) => Promise<void>;
}): JSX.Element {
  const marks = useProjectMarks();
  const [snapshot, setSnapshot] = useState<ClickupTaskDraft>(() => draftFromTask(task));
  const [draft, setDraft] = useState<ClickupTaskDraft>(snapshot);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  // The Start session menu, or its chat list (Continue in a session).
  const [menuView, setMenuView] = useState<"menu" | "chats">("menu");
  const [starting, setStarting] = useState(false);
  const startWith = (handOff: () => Promise<void>): void => {
    setMenuOpen(false);
    if (starting) return;
    setStarting(true);
    setError(null);
    handOff()
      .catch((failure: unknown) => setError(describeClickupError(failure)))
      .finally(() => setStarting(false));
  };
  const menuAnchor = useRef<HTMLButtonElement>(null);
  const patch = useMemo(() => taskPatch(snapshot, draft), [snapshot, draft]);
  const dirty = Object.keys(patch).length > 0;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const sessionBusy = useRef(false);

  // A newer copy of this task (a refresh, an agent's edit) replaces a clean form only.
  useEffect(() => {
    if (dirtyRef.current) return;
    const next = draftFromTask(task);
    setSnapshot(next);
    setDraft(next);
  }, [task]);

  useEffect(() => {
    if (!savedAt) return;
    const timer = window.setTimeout(() => setSavedAt(0), 2000);
    return () => window.clearTimeout(timer);
  }, [savedAt]);

  const save = async (changes: ClickupTaskInput): Promise<void> => {
    if (saving || sessionBusy.current || Object.keys(changes).length === 0) return;
    sessionBusy.current = true;
    setError(null);
    try {
      const saved = await onSave(changes);
      if (saved) {
        const next = draftFromTask(saved);
        setSnapshot(next);
        setDraft(next);
        setSavedAt(Date.now());
      }
    } catch (failure) {
      setError(describeClickupError(failure));
    } finally {
      sessionBusy.current = false;
    }
  };

  const locked = readOnly || saving;

  return (
    <aside aria-label="Task" className="flex h-full min-h-0 w-full flex-col">
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-stroke px-3">
        <span className="min-w-0 flex-1 truncate text-[12px] text-content/60">{listName}</span>
        <ClickupCopyButton task={task} label="Copy task" className={ICON_BUTTON} />
        <button type="button" aria-label="Close task" title="Close" className={ICON_BUTTON} onClick={onClose}>
          <X aria-hidden className="size-4" />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {readOnly ? (
          <p role="status" className="mb-3 text-[12px] text-content/55">
            You can view this list but not edit it.
          </p>
        ) : null}
        <ClickupTaskForm
          lists={[]}
          listId={task.listId}
          draft={draft}
          onChange={setDraft}
          meta={meta}
          members={members}
          disabled={locked}
        />
        <ClickupTaskDetails task={task} readOnly={readOnly} />
      </div>
      <footer className="flex shrink-0 flex-col gap-2 border-t border-stroke p-3">
        {error ? (
          <p role="alert" className="text-[12.5px] text-red-400">
            {error}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={BUTTON}
            disabled={locked || !dirty || dueBeforeStart(draft) || !draft.name.trim()}
            onClick={() => void save(patch)}
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
          {savedAt ? (
            <span role="status" className="text-[12px] text-content/55">
              Saved
            </span>
          ) : null}
          <button
            ref={menuAnchor}
            type="button"
            className={BUTTON}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-busy={starting}
            disabled={starting}
            onClick={() => {
              setMenuView("menu");
              setMenuOpen((current) => !current);
            }}
          >
            {starting ? "Gathering files…" : "Start session"}
          </button>
          <a href={task.url} target="_blank" rel="noreferrer" className={`${BUTTON} no-underline`}>
            Open in ClickUp
          </a>
        </div>
      </footer>
      {menuOpen ? (
        <Popover
          anchor={menuAnchor}
          side="top"
          align="start"
          width={menuView === "chats" ? 320 : 240}
          onDismiss={() => setMenuOpen(false)}
          className={menuView === "chats" ? "flex flex-col overflow-hidden" : undefined}
        >
          {menuView === "chats" && project ? (
            <>
              <div className="flex h-8 shrink-0 items-center gap-1 border-b border-stroke px-1">
                <button
                  type="button"
                  aria-label="Back"
                  title="Back"
                  onClick={() => setMenuView("menu")}
                  className="grid size-6 shrink-0 place-items-center rounded-md text-content/55 hover:bg-content/8 hover:text-content"
                >
                  <ChevronLeft aria-hidden className="size-3.5" strokeWidth={1.75} />
                </button>
                <span className="min-w-0 truncate text-[12px] font-medium text-content/70">
                  Continue in a chat in {projectName(project)}
                </span>
              </div>
              <ProjectChatList
                className="h-[340px]"
                cwd={project}
                marks={marks}
                statusOf={sessionStatus}
                onPick={(sessionId) => startWith(() => onContinueSession(sessionId))}
              />
            </>
          ) : (
          <div role="menu" className="py-1">
            <button
              type="button"
              role="menuitem"
              className={MENU_ITEM}
              onClick={() => startWith(onNewSession)}
            >
              New session
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={!project}
              title={project ? "Sends the task to a chat; a chat that is replying gets it next" : "Link a project in ClickUp setup first"}
              className={MENU_ITEM}
              onClick={() => setMenuView("chats")}
            >
              Continue in a session…
            </button>
            {monos.length === 0 ? (
              <button type="button" role="menuitem" disabled className={MENU_ITEM}>
                No Mono has this project
              </button>
            ) : (
              <>
                <p className="px-3 pb-0.5 pt-1.5 text-[11px] text-content/45">Give to a Mono</p>
                {monos.map((mono) => (
                  <button
                    key={mono.id}
                    type="button"
                    role="menuitem"
                    disabled={!mono.started}
                    className={MENU_ITEM}
                    onClick={() => startWith(() => onGiveToMono(mono.id))}
                  >
                    <span className="min-w-0 flex-1 truncate">{mono.name}</span>
                    {mono.started ? null : <span className="text-[11px] text-content/40">Not started yet</span>}
                  </button>
                ))}
              </>
            )}
          </div>
          )}
        </Popover>
      ) : null}
    </aside>
  );
}

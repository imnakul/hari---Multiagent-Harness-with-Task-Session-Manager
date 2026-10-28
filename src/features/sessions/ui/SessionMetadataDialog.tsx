import {
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  writeSessionLabel,
  writeSessionNotes,
} from "../../../integrations/harness/core/sessionMetadataHelper";
import { IS_MAC } from "../../../platform/tauri/platform";
import { Loader, Sparkles } from "../../../shared/ui/icons";
import { Modal } from "../../../shared/ui/Modal";
import { Toggle } from "../../../shared/ui/Toggle";
import {
  hasSessionMetadata,
  loadSessionMetadataFor,
  parseSessionMetadataEditRequest,
  saveSessionMetadata,
  SESSION_LABEL_MAX,
  SESSION_METADATA_EDIT_EVENT,
  sessionMetadataError,
  type SessionMetadata,
  type SessionMetadataEditRequest,
} from "../model/sessionMetadata";
import {
  appendSessionNotes,
  autoNotesOn,
  markAutoNotesDone,
  setAutoNotes,
  subscribeAutoNotes,
} from "../model/sessionMetadataAi";
import { SessionStateContext } from "../model/sessionStateStore";
import { AgentMarkdown } from "./AgentMarkdown";
import { MarkdownDetailTabs } from "./MarkdownDetailTabs";
import type { MarkdownViewMode } from "./MarkdownModeToggle";
import type { MarkdownCaretTarget } from "./markdownCaret";
import { MarkdownEditorPanel } from "./MarkdownEditorPanel";

type SavedState =
  | { status: "loading" }
  | { status: "ready"; saved: SessionMetadata | null }
  | { status: "error"; message: string };

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

type AiRun = { kind: "label" | "notes"; controller: AbortController };

let editingSessionId: string | null = null;

/** True while the editor is open for this chat; Auto notes waits so Save cannot drop its points (L-190). */
export function sessionMetadataEditorOpen(sessionId: string): boolean {
  return editingSessionId === sessionId;
}

/**
 * Mounted once per window (L-181). Opens the Session metadata editor whenever
 * `requestSessionMetadataEdit(sessionId, title)` runs, e.g. from a chat's
 * context menu.
 */
export function SessionMetadataDialogHost(): ReactNode {
  const [request, setRequest] = useState<
    (SessionMetadataEditRequest & { id: number }) | null
  >(null);

  useEffect(() => {
    const onRequest = (event: Event): void => {
      if (!(event instanceof CustomEvent)) return;
      const parsed = parseSessionMetadataEditRequest(event.detail);
      if (parsed) setRequest({ ...parsed, id: Date.now() });
    };
    window.addEventListener(SESSION_METADATA_EDIT_EVENT, onRequest);
    return () =>
      window.removeEventListener(SESSION_METADATA_EDIT_EVENT, onRequest);
  }, []);

  if (!request) return null;
  const close = (): void => setRequest(null);
  return (
    <Modal
      title="Session metadata"
      description={request.title || undefined}
      onClose={close}
      fitViewport
    >
      <SessionMetadataEditor
        key={request.id}
        sessionId={request.sessionId}
        onDone={close}
      />
    </Modal>
  );
}

function SessionMetadataEditor({
  sessionId,
  onDone,
}: {
  sessionId: string;
  onDone: () => void;
}): ReactNode {
  const [savedState, setSavedState] = useState<SavedState>({
    status: "loading",
  });
  const [label, setLabel] = useState("");
  const [notes, setNotes] = useState("");
  const [mode, setMode] = useState<MarkdownViewMode>("live");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aiRun, setAiRun] = useState<AiRun | null>(null);
  const [aiNotice, setAiNotice] = useState<string | null>(null);
  const aiMarker = useRef<string | null>(null);
  const labelRef = useRef<HTMLInputElement>(null);
  const notesRef = useRef<MarkdownCaretTarget | null>(null);
  const labelId = useId();
  const counterId = useId();
  const store = useContext(SessionStateContext);
  const autoOn = useSyncExternalStore(subscribeAutoNotes, () =>
    autoNotesOn(sessionId),
  );

  useEffect(() => {
    editingSessionId = sessionId;
    return () => {
      if (editingSessionId === sessionId) editingSessionId = null;
    };
  }, [sessionId]);

  const aiRunRef = useRef<AiRun | null>(null);
  aiRunRef.current = aiRun;
  useEffect(() => () => aiRunRef.current?.controller.abort(), []);

  const chat = store?.session(sessionId);
  const aiUnavailable = !chat
    ? "Open this chat first, so the AI can read it"
    : chat.blocks.length === 0
      ? "This chat has nothing to read yet"
      : null;

  const runAi = async (kind: AiRun["kind"]): Promise<void> => {
    const session = store?.session(sessionId);
    if (!session || aiRun) return;
    const controller = new AbortController();
    setAiRun({ kind, controller });
    setAiNotice(null);
    setError(null);
    const finished = session.blocks.filter((block) => !block.streaming);
    const input = {
      blocks: finished,
      cwd: session.cwd,
      harness: session.harness,
      signal: controller.signal,
    };
    try {
      if (kind === "label") {
        const result = await writeSessionLabel(input);
        if (controller.signal.aborted) return;
        if (result.ok) setLabel(result.value);
        else if (!result.cancelled) setError(result.message);
        return;
      }
      const result = await writeSessionNotes({ ...input, notes, scope: "full" });
      if (controller.signal.aborted) return;
      if (!result.ok) {
        if (!result.cancelled) setError(result.message);
        return;
      }
      aiMarker.current = finished[finished.length - 1]?.id ?? null;
      if (result.value.kind === "none") setAiNotice("Nothing new to add.");
      else {
        const addition = result.value.text;
        setNotes((current) => appendSessionNotes(current, addition));
        setAiNotice("New notes added at the end. Save to keep them.");
      }
    } finally {
      setAiRun((current) => (current?.controller === controller ? null : current));
    }
  };

  /** Icon-only AI button that sits inside its field's top-right corner. */
  const aiButton = (
    kind: AiRun["kind"],
    title: string,
    place: string,
  ): ReactNode => {
    const running = aiRun?.kind === kind;
    return (
      <button
        type="button"
        disabled={!running && (!!aiRun || !!aiUnavailable || saving)}
        onClick={() => (running ? aiRun.controller.abort() : void runAi(kind))}
        title={running ? "Stop" : (aiUnavailable ?? title)}
        aria-label={running ? `Stop: ${title}` : title}
        className={`absolute z-10 grid size-6 place-items-center rounded-md text-content/50 transition-colors hover:bg-content/10 hover:text-content disabled:opacity-40 disabled:hover:bg-transparent ${place}`}
      >
        {running ? (
          <Loader aria-hidden className="size-3.5 motion-safe:animate-spin" />
        ) : (
          <Sparkles aria-hidden className="size-3.5" />
        )}
      </button>
    );
  };

  useEffect(() => {
    let cancelled = false;
    loadSessionMetadataFor(sessionId)
      .then((saved) => {
        if (cancelled) return;
        setLabel(saved?.label ?? "");
        setNotes(saved?.notes ?? "");
        setSavedState({ status: "ready", saved });
      })
      .catch((reason: unknown) => {
        if (!cancelled)
          setSavedState({ status: "error", message: errorMessage(reason) });
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  useEffect(() => {
    if (savedState.status !== "ready") return;
    labelRef.current?.focus();
    labelRef.current?.select();
  }, [savedState.status]);

  const save = async (nextLabel: string, nextNotes: string): Promise<void> => {
    const invalid = sessionMetadataError(nextLabel, nextNotes);
    if (invalid) {
      setError(invalid);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await saveSessionMetadata(sessionId, nextLabel, nextNotes);
      if (aiMarker.current) markAutoNotesDone(sessionId, aiMarker.current);
      onDone();
    } catch (reason) {
      setError(`Could not save: ${errorMessage(reason)}`);
      setSaving(false);
    }
  };

  if (savedState.status === "error")
    return (
      <div className="flex flex-col gap-3 p-4">
        <p role="alert" className="text-[12px] text-red-400">
          Could not load this chat's metadata: {savedState.message}
        </p>
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onDone}
            className="h-7 rounded-md px-2.5 text-[12px] text-content/60 hover:bg-content/10 hover:text-content"
          >
            Close
          </button>
        </div>
      </div>
    );

  const busy = saving || savedState.status === "loading";
  const saveBlocked = busy || !!aiRun;
  const labelLength = [...label].length;
  const canClear =
    savedState.status === "ready" && hasSessionMetadata(savedState.saved);

  return (
    <form
      aria-busy={savedState.status === "loading"}
      className="flex min-h-0 flex-col gap-3 p-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!saveBlocked) void save(label, notes);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
          event.preventDefault();
          if (!saveBlocked) void save(label, notes);
        }
      }}
    >
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-2">
          <label htmlFor={labelId} className="text-[12px] text-content/60">
            Label
          </label>
          <span
            id={counterId}
            className={`ml-auto text-[11px] tabular-nums ${
              labelLength > SESSION_LABEL_MAX
                ? "text-red-400"
                : "text-content/40"
            }`}
          >
            {labelLength}/{SESSION_LABEL_MAX}
          </span>
        </div>
        <div className="relative">
          <input
            id={labelId}
            ref={labelRef}
            value={label}
            disabled={busy || aiRun?.kind === "label"}
            aria-describedby={counterId}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="Shown in place of the chat title, e.g. Auth spike"
            autoComplete="off"
            className="h-8 w-full rounded-md border border-content/10 bg-transparent pl-2.5 pr-9 text-[13px] text-content outline-none placeholder:text-content/35 focus:border-content/25 disabled:opacity-60"
          />
          {aiButton("label", "Write the label with AI", "right-1 top-1")}
        </div>
      </div>
      <div className="flex min-h-0 flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="text-[12px] text-content/60">Notes</span>
          <label
            className="ml-auto flex items-center gap-2 text-[11px] text-content/55"
            title="A minute after each turn ends, the AI logs what is new in the Session panel's timeline. These notes stay as you wrote them"
          >
            Auto notes
            <Toggle
              label="Auto notes for this chat"
              on={autoOn}
              onChange={(on) => setAutoNotes(sessionId, on)}
            />
          </label>
        </div>
        <MarkdownDetailTabs
          mode={mode}
          onChange={setMode}
          markdown={notes}
          label="Notes view"
        />
        <div className="relative">
          {aiButton(
            "notes",
            "Add what is new in this chat to the notes with AI",
            "right-2 top-1.5",
          )}
          <div className="max-h-[45vh] min-h-40 overflow-y-auto rounded-md border border-content/10">
            <MarkdownEditorPanel
              mode={mode}
              onModeChange={setMode}
              value={notes}
              onChange={setNotes}
              caretRef={notesRef}
              label="Notes Markdown"
              placeholder="Plans, links, what is left…"
              lineNumbers={false}
              minHeightClass="min-h-40"
              paddingClass="py-2 pl-3 pr-10"
              sourceEndPadClass="pr-10"
              preview={<AgentMarkdown text={notes} hardBreaks />}
              emptyPreview={
                <p className="text-[13px] text-content/45">No notes</p>
              }
            />
          </div>
        </div>
      </div>
      {error ? (
        <p role="alert" className="text-[12px] text-red-400">
          {error}
        </p>
      ) : aiNotice ? (
        <p role="status" className="text-[12px] text-content/55">
          {aiNotice}
        </p>
      ) : null}
      <div className="flex items-center gap-2">
        {canClear ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void save("", "")}
            title="Remove the label and notes from this chat"
            className="h-7 rounded-md px-2.5 text-[12px] text-content/60 hover:bg-content/10 hover:text-content disabled:opacity-40"
          >
            Clear
          </button>
        ) : null}
        <span className="ml-auto text-[11px] text-content/40">
          {IS_MAC ? "⌘Return" : "Ctrl+Enter"} saves
        </span>
        <button
          type="button"
          disabled={saving}
          onClick={onDone}
          className="h-7 rounded-md px-2.5 text-[12px] text-content/60 hover:bg-content/10 hover:text-content"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={saveBlocked}
          className="h-7 rounded-md bg-accent px-3 text-[12px] font-medium text-white disabled:opacity-40"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}

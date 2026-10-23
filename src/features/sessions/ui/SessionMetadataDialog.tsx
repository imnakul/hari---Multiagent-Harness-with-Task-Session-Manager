import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { IS_MAC } from "../../../platform/tauri/platform";
import { Modal } from "../../../shared/ui/Modal";
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
import { AgentMarkdown } from "./AgentMarkdown";
import { MarkdownDetailTabs } from "./MarkdownDetailTabs";
import type { MarkdownViewMode } from "./MarkdownModeToggle";
import { MarkdownSourceEditor } from "./MarkdownSourceEditor";
import { useMarkdownEditGestures } from "./useMarkdownEditGestures";

type SavedState =
  | { status: "loading" }
  | { status: "ready"; saved: SessionMetadata | null }
  | { status: "error"; message: string };

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
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
  const [mode, setMode] = useState<MarkdownViewMode>("source");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const labelRef = useRef<HTMLInputElement>(null);
  const notesRef = useRef<HTMLTextAreaElement>(null);
  const editGestures = useMarkdownEditGestures({
    mode,
    onModeChange: setMode,
    markdown: notes,
    textareaRef: notesRef,
  });
  const labelId = useId();
  const counterId = useId();

  useEffect(() => {
    let cancelled = false;
    loadSessionMetadataFor(sessionId)
      .then((saved) => {
        if (cancelled) return;
        setLabel(saved?.label ?? "");
        setNotes(saved?.notes ?? "");
        // Existing notes open read-first; empty ones open ready to type.
        setMode(saved?.notes.trim() ? "preview" : "source");
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
  const labelLength = [...label].length;
  const canClear =
    savedState.status === "ready" && hasSessionMetadata(savedState.saved);

  return (
    <form
      aria-busy={savedState.status === "loading"}
      className="flex min-h-0 flex-col gap-3 p-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!busy) void save(label, notes);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
          event.preventDefault();
          if (!busy) void save(label, notes);
        }
      }}
    >
      <div className="flex flex-col gap-1">
        <div className="flex items-baseline justify-between">
          <label htmlFor={labelId} className="text-[12px] text-content/60">
            Label
          </label>
          <span
            id={counterId}
            className={`text-[11px] tabular-nums ${
              labelLength > SESSION_LABEL_MAX
                ? "text-red-400"
                : "text-content/40"
            }`}
          >
            {labelLength}/{SESSION_LABEL_MAX}
          </span>
        </div>
        <input
          id={labelId}
          ref={labelRef}
          value={label}
          disabled={busy}
          aria-describedby={counterId}
          onChange={(event) => setLabel(event.target.value)}
          placeholder="Shown in place of the chat title, e.g. Auth spike"
          autoComplete="off"
          className="h-8 rounded-md border border-content/10 bg-transparent px-2.5 text-[13px] text-content outline-none placeholder:text-content/35 focus:border-content/25 disabled:opacity-60"
        />
      </div>
      <div className="flex min-h-0 flex-col gap-1">
        <span className="text-[12px] text-content/60">Notes</span>
        <MarkdownDetailTabs
          mode={mode}
          onChange={setMode}
          markdown={notes}
          label="Notes view"
        />
        <div
          className="max-h-[45vh] min-h-40 overflow-y-auto rounded-md border border-content/10"
          onKeyDown={editGestures.onKeyDown}
        >
          {mode === "source" ? (
            <MarkdownSourceEditor
              textareaRef={notesRef}
              value={notes}
              onChange={setNotes}
              label="Notes Markdown"
              placeholder="Plans, links, what is left… (Markdown)"
              lineNumbers={false}
              className="min-h-40"
            />
          ) : (
            <div
              {...editGestures.previewProps}
              className="min-h-40 px-3 py-2 outline-none"
            >
              {notes.trim() ? (
                <AgentMarkdown text={notes} hardBreaks />
              ) : (
                <p className="text-[13px] text-content/45">No notes</p>
              )}
            </div>
          )}
        </div>
      </div>
      {error ? (
        <p role="alert" className="text-[12px] text-red-400">
          {error}
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
          disabled={busy}
          className="h-7 rounded-md bg-accent px-3 text-[12px] font-medium text-white disabled:opacity-40"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}

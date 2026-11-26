import { useEffect, useMemo, type ReactElement, type ReactNode } from "react";
import { CircleAlert, LoaderCircle, Plus, Trash2 } from "../../../shared/ui/icons";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";

export type AskThread = { id: string; title: string; updatedAt: number };
export type AskStatus = "idle" | "opening" | "error";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** `Ask · 26 Nov`: a thread's picker label, from its last activity. */
export function askThreadLabel(thread: AskThread): string {
  const date = new Date(thread.updatedAt);
  const day = `${date.getDate()} ${MONTHS[date.getMonth()] ?? ""}`;
  const title = thread.title.trim();
  return title && title !== "New chat" ? `${title} · ${day}` : `Ask · ${day}`;
}

const ICON_BUTTON =
  "grid size-7 shrink-0 place-items-center rounded-md text-content/60 transition-colors hover:bg-content/[0.07] hover:text-content disabled:opacity-40 active:scale-[0.96] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60";

/**
 * Fork (L-396): the Activity page's Ask tab. A thread bar (pick, new, delete)
 * above one embedded chat that can read the user's activity.
 */
export function ActivityAskPanel({
  chat,
  status,
  threads,
  activeId,
  onOpen,
  onDelete,
}: {
  chat: ReactNode;
  status: AskStatus;
  threads: readonly AskThread[];
  activeId: string | null;
  onOpen: (id?: string, fresh?: boolean) => void;
  onDelete: (id: string) => void;
}): ReactElement {
  // Opening the tab starts the last chat, or a new one, once.
  useEffect(() => {
    if (!chat && status === "idle") onOpen();
    // Only when the tab mounts without a chat; later opens come from the buttons.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const options = useMemo(
    () => threads.map((thread) => ({ value: thread.id, label: askThreadLabel(thread) })),
    [threads],
  );
  const busy = status === "opening";
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-stroke px-3">
        <div className="min-w-0 max-w-[320px] flex-1">
          <SearchableSelect
            label="Ask chats"
            variant="transparent"
            value={activeId ?? ""}
            options={options}
            placeholder="Ask chats"
            searchPlaceholder="Search Ask chats…"
            emptyLabel="No Ask chats yet"
            disabled={busy || options.length === 0}
            onChange={(id) => id && onOpen(id)}
          />
        </div>
        <button
          type="button"
          aria-label="New Ask chat"
          title="New chat"
          disabled={busy}
          className={ICON_BUTTON}
          onClick={() => onOpen(undefined, true)}
        >
          <Plus aria-hidden className="size-4" strokeWidth={1.75} />
        </button>
        <button
          type="button"
          aria-label="Delete this Ask chat"
          title="Delete chat"
          disabled={busy || !activeId}
          className={ICON_BUTTON}
          onClick={() => activeId && onDelete(activeId)}
        >
          <Trash2 aria-hidden className="size-4" strokeWidth={1.75} />
        </button>
      </div>
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        {chat ? (
          chat
        ) : status === "error" ? (
          <div role="alert" className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
            <CircleAlert aria-hidden className="size-6 text-content/35" strokeWidth={1.75} />
            <p className="text-[13px] text-content">Couldn&apos;t start an Ask chat.</p>
            <button
              type="button"
              className="h-7 rounded-md border border-content/15 px-3 text-[12px] text-content/80 transition-colors hover:bg-content/10 hover:text-content active:scale-[0.98]"
              onClick={() => onOpen()}
            >
              Retry
            </button>
          </div>
        ) : (
          <div role="status" className="flex flex-1 items-center justify-center gap-2 text-[12.5px] text-content/55">
            <LoaderCircle aria-hidden className="size-4 motion-safe:animate-spin" strokeWidth={1.75} />
            Starting an Ask chat…
          </div>
        )}
      </div>
    </div>
  );
}

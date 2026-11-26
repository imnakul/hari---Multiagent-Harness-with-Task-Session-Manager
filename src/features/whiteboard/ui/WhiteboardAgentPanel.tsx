import { useEffect, useState, type PointerEvent as ReactPointerEvent, type ReactElement, type ReactNode } from "react";
import { holdAttachmentPreviewUrl, loadAttachmentPreviewUrl } from "../../sessions/model/attachments";
import { usePathPointerDrag } from "../../sessions/hooks/usePathPointerDrag";
import {
  AiChat,
  Check,
  CircleAlert,
  Clock,
  LoaderCircle,
  Lock,
  PanelBottom,
  PanelRight,
  Paperclip,
  Plus,
  X,
} from "../../../shared/ui/icons";
import { loadSheetChat } from "../model/sheetStore";
import type { WhiteboardChatMessage, WhiteboardImageRef } from "../model/whiteboardAgent";
import { CHAT_SIZE_LIMITS, type ChatDock } from "../model/whiteboardPrefs";

export type WhiteboardChatStatus = "idle" | "opening" | "error";

const ICON_BUTTON =
  "flex size-6 items-center justify-center rounded-md text-content/55 transition-colors duration-100 hover:bg-content/10 hover:text-content disabled:opacity-40 active:scale-[0.96]";

/**
 * Fork (L-403): the Whiteboard's Agent panel. It holds the sheet's own chat (a
 * real chat with the normal composer, any harness, attachments and tools) and,
 * read only, the helper chat a sheet had before (L-194), from its saved file.
 */
export function WhiteboardAgentPanel({
  sheetId,
  sheetName,
  locked,
  chat,
  status,
  dock,
  size,
  onOpenChat,
  onDock,
  onResize,
  onClose,
}: {
  sheetId: string;
  sheetName: string;
  locked: boolean;
  /** The embedded chat for this sheet, or null while it opens. */
  chat: ReactNode;
  status: WhiteboardChatStatus;
  dock: ChatDock;
  /** Width beside the canvas, or height below it, in pixels. */
  size: number;
  /** Opens this sheet's chat; `fresh` starts a new one. */
  onOpenChat: (sheetId: string, fresh?: boolean) => void;
  onDock: (dock: ChatDock) => void;
  /** `done` is true when a drag or key press ends, so the size is saved. */
  onResize: (size: number, done: boolean) => void;
  onClose: () => void;
}): ReactElement {
  const [earlier, setEarlier] = useState<WhiteboardChatMessage[]>([]);
  const [showEarlier, setShowEarlier] = useState(false);

  // The sheet's chat opens with the panel and on every sheet switch.
  useEffect(() => {
    onOpenChat(sheetId);
    // Only on sheet changes; a retry or new chat comes from the buttons.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheetId]);

  useEffect(() => {
    let live = true;
    setEarlier([]);
    setShowEarlier(false);
    loadSheetChat(sheetId).then(
      (history) => {
        if (live) setEarlier(history);
      },
      // No earlier chat file, or an unreadable one: there is nothing to show.
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [sheetId]);

  // Drag the inner edge to resize: left edge beside the canvas, top edge below it.
  const startResize = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return;
    event.preventDefault();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const start = dock === "side" ? event.clientX : event.clientY;
    const from = size;
    let last = from;
    const move = (next: PointerEvent): void => {
      last = from + (start - (dock === "side" ? next.clientX : next.clientY));
      onResize(last, false);
    };
    const end = (): void => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
      onResize(last, true);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  };

  const limits = CHAT_SIZE_LIMITS[dock];
  const side = dock === "side";
  const busy = status === "opening";

  return (
    <aside
      aria-label="Whiteboard agent"
      data-whiteboard-chat
      className={`relative flex shrink-0 flex-col bg-content/[0.04] backdrop-blur-xl ${
        side ? "h-full border-l border-content/10" : "w-full border-t border-content/10"
      }`}
      style={side ? { width: size } : { height: size }}
    >
      <div
        role="separator"
        aria-orientation={side ? "vertical" : "horizontal"}
        aria-label="Resize agent panel"
        aria-valuemin={limits.min}
        aria-valuemax={limits.max}
        aria-valuenow={size}
        tabIndex={0}
        onPointerDown={startResize}
        onDoubleClick={() => onResize(limits.initial, true)}
        onKeyDown={(event) => {
          const grow = side ? "ArrowLeft" : "ArrowUp";
          const shrink = side ? "ArrowRight" : "ArrowDown";
          if (event.key !== grow && event.key !== shrink) return;
          event.preventDefault();
          onResize(size + (event.key === grow ? 16 : -16), true);
        }}
        title="Drag to resize; double-click to reset"
        className={`absolute z-10 outline-none transition-colors duration-100 hover:bg-accent/40 focus-visible:bg-accent/50 ${
          side ? "inset-y-0 -left-1 w-2 cursor-col-resize" : "inset-x-0 -top-1 h-2 cursor-row-resize"
        }`}
      />
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-content/10 pl-3 pr-1.5">
        <AiChat aria-hidden className="size-3.5 shrink-0 text-content/45" />
        <span className="min-w-0 flex-1 truncate text-[13px] text-content" title={sheetName}>
          {showEarlier ? "Earlier chat" : "Agent"}
        </span>
        {locked ? (
          <span title="Sheet is locked: the agent can answer but not draw" className="flex size-6 items-center justify-center text-content/45">
            <Lock aria-label="Sheet is locked" className="size-3.5" />
          </span>
        ) : null}
        {earlier.length ? (
          <button
            type="button"
            className={`${ICON_BUTTON} ${showEarlier ? "bg-content/10 text-content" : ""}`}
            aria-label="Earlier chat (read only)"
            aria-pressed={showEarlier}
            title={showEarlier ? "Back to the chat" : "Earlier chat (read only)"}
            onClick={() => setShowEarlier((open) => !open)}
          >
            <Clock aria-hidden className="size-3.5" />
          </button>
        ) : null}
        <button
          type="button"
          className={ICON_BUTTON}
          aria-label="New chat for this sheet"
          title="New chat"
          disabled={busy}
          onClick={() => {
            setShowEarlier(false);
            onOpenChat(sheetId, true);
          }}
        >
          <Plus aria-hidden className="size-3.5" />
        </button>
        <button
          type="button"
          className={ICON_BUTTON}
          aria-label={side ? "Move agent below the sheet" : "Move agent beside the sheet"}
          title={side ? "Move below" : "Move beside"}
          onClick={() => onDock(side ? "bottom" : "side")}
        >
          {side ? <PanelBottom aria-hidden className="size-3.5" /> : <PanelRight aria-hidden className="size-3.5" />}
        </button>
        <button type="button" className={ICON_BUTTON} aria-label="Hide agent" title="Hide agent" onClick={onClose}>
          <X aria-hidden className="size-3.5" />
        </button>
      </div>

      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        {showEarlier ? (
          <EarlierChat messages={earlier} />
        ) : chat ? (
          chat
        ) : status === "error" ? (
          <div role="alert" className="flex flex-1 flex-col items-center justify-center gap-3 px-4 text-center">
            <CircleAlert aria-hidden className="size-6 text-content/35" strokeWidth={1.75} />
            <p className="text-[13px] text-content">Couldn&apos;t start this sheet&apos;s chat.</p>
            <button
              type="button"
              className="h-7 rounded-md border border-content/15 px-3 text-[12px] text-content/80 transition-colors hover:bg-content/10 hover:text-content active:scale-[0.98]"
              onClick={() => onOpenChat(sheetId)}
            >
              Retry
            </button>
          </div>
        ) : (
          <div role="status" className="flex flex-1 items-center justify-center gap-2 text-[12.5px] text-content/55">
            <LoaderCircle aria-hidden className="size-4 motion-safe:animate-spin" strokeWidth={1.75} />
            Starting the chat…
          </div>
        )}
      </div>
    </aside>
  );
}

/** The helper chat a sheet had before L-403, read only. */
function EarlierChat({ messages }: { messages: readonly WhiteboardChatMessage[] }): ReactElement {
  return (
    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
      <p className="text-[11px] text-content/45">From the earlier Whiteboard helper. Read only.</p>
      {messages.map((message, index) =>
        message.role === "user" ? (
          <div key={index} className="flex flex-col items-end gap-1">
            {message.images?.length ? (
              <div className="flex max-w-[85%] flex-wrap justify-end gap-1">
                {message.images.map((image, at) => (
                  <SentImage key={`${image.path ?? image.name}:${at}`} image={image} />
                ))}
              </div>
            ) : null}
            {message.attachments?.length ? (
              <p className="flex max-w-[85%] items-center gap-1 truncate text-[11px] text-content/45">
                <Paperclip aria-hidden className="size-3 shrink-0" />
                <span className="truncate">{message.attachments.join(", ")}</span>
              </p>
            ) : null}
            <p className="max-w-[85%] whitespace-pre-wrap rounded-xl rounded-br-sm bg-content/10 px-2.5 py-1.5 text-[13px] text-content">
              {message.text}
            </p>
          </div>
        ) : (
          <div key={index} className="space-y-1">
            {message.text ? (
              <p className={`whitespace-pre-wrap text-[13px] ${message.error ? "text-red-300/90" : "text-content/85"}`}>
                {message.text}
              </p>
            ) : null}
            {message.note ? (
              <p className="inline-flex items-center gap-1 rounded-md bg-content/5 px-1.5 py-0.5 text-[11px] text-content/55">
                <Check aria-hidden className="size-3" />
                {message.note}
              </p>
            ) : null}
          </div>
        ),
      )}
    </div>
  );
}

/** A sent image in the earlier chat, read back from its saved copy. */
function SentImage({ image }: { image: WhiteboardImageRef }): ReactElement {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    const release = image.path ? holdAttachmentPreviewUrl(image.path) : null;
    if (image.path) {
      void loadAttachmentPreviewUrl(image.path).then((url) => {
        if (live) setSrc(url);
      });
    }
    return () => {
      live = false;
      release?.();
    };
  }, [image.path]);
  // Fork (L-261): drag a sent image onto a chat composer to attach it there.
  const drag = usePathPointerDrag(image.path, image.name);
  return src ? (
    <img
      src={src}
      alt={image.name}
      title={image.name}
      draggable={false}
      onPointerDown={drag.onPointerDown}
      className="size-16 rounded-lg object-cover outline outline-1 -outline-offset-1 outline-content/10"
    />
  ) : (
    <span
      title={image.name}
      onPointerDown={drag.onPointerDown}
      className="flex h-6 max-w-40 items-center gap-1 truncate rounded-md bg-content/10 px-1.5 text-[11px] text-content/55"
    >
      <Paperclip aria-hidden className="size-3 shrink-0" />
      <span className="truncate">{image.name}</span>
    </span>
  );
}

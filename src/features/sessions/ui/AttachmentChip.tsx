import { useState, type ReactNode } from "react";
import { Loader, X } from "../../../shared/ui/icons";
import {
  attachmentPreviewSrc,
  isAttachmentFolder,
  type PendingAttachment,
} from "../model/attachments";
import type { Attachment } from "../model/session";
import { FileTypeIcon } from "../../files/ui/FileTypeIcon";
import { ImageLightbox } from "../../../shared/ui/ImageLightbox";
import { Modal } from "../../../shared/ui/Modal";
import { useEffect } from "react";
import { loadAttachmentPreviewUrl } from "../model/attachments";

type Props = {
  attachment: Attachment;
  onRemove?: () => void;
  /** A sent image shown large on its own, like a photo in a messaging app. */
  photo?: boolean;
};

export function AttachmentChip({ attachment, onRemove, photo = false }: Props) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const preview = attachmentPreviewSrc(attachment);
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);

  // Reloaded sessions strip inline data, leaving image attachments with a
  // disk path only — fetch those bytes on demand for the thumbnail.
  const loadPath =
    attachment.kind === "image" && !preview ? (attachment.path ?? null) : null;

  useEffect(() => {
    if (!loadPath) {
      setLoadedUrl(null);
      return;
    }
    let cancelled = false;
    void loadAttachmentPreviewUrl(loadPath).then((url) => {
      if (!cancelled) setLoadedUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [loadPath]);

  const src = preview ?? loadedUrl ?? undefined;
  const image = attachment.kind === "image" && src;
  // Fork (L-207): an inline note (Browser picks, a console row) opens as text.
  const note = attachment.text != null;

  return (
    <>
      <div
        className={`group relative flex min-w-0 items-center gap-1.5 rounded-md ${
          image ? "" : "bg-content/10 py-0.5 pl-1 pr-1"
        }`}
        title={note ? undefined : (attachment.path ?? attachment.name)}
      >
        {image && src ? (
          <button
            type="button"
            aria-label={`Open ${attachment.name} full screen`}
            title={`Open ${attachment.name} full screen`}
            onClick={(event) => {
              event.stopPropagation();
              setPreviewOpen(true);
            }}
            className={`${photo ? "min-w-0 rounded-2xl" : "shrink-0 rounded-lg"} cursor-zoom-in focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent`}
          >
            <img
              src={src}
              alt=""
              draggable={false}
              className={
                photo
                  ? "block max-h-60 max-w-60 rounded-2xl object-cover"
                  : "size-9 rounded-lg object-cover"
              }
            />
          </button>
        ) : (
          <NoteButton
            note={note}
            label={attachment.name}
            onOpen={() => setPreviewOpen(true)}
          >
            <span className="grid size-5 shrink-0 place-items-center">
              <FileTypeIcon
                name={note ? "note.md" : attachment.name}
                isDir={isAttachmentFolder(attachment)}
                size={16}
              />
            </span>
            <span className="min-w-0 max-w-[140px] truncate text-[11px] leading-none text-content/80">
              {attachment.name}
            </span>
          </NoteButton>
        )}
        {onRemove ? (
          <button
            type="button"
            title="Remove"
            aria-label={`Remove ${attachment.name}`}
            onClick={(event) => {
              event.stopPropagation();
              onRemove();
            }}
            className={`grid shrink-0 place-items-center rounded-full text-content/70 hover:bg-content/15 hover:text-content ${
              image
                ? "absolute -right-1 -top-1 size-5 bg-content/20 opacity-100 shadow-sm backdrop-blur-sm"
                : "size-4 text-content/40"
            }`}
          >
            <X className="size-3" strokeWidth={2} />
          </button>
        ) : null}
      </div>
      {image && src && previewOpen ? (
        <ImageLightbox
          src={src}
          alt={attachment.name}
          onClose={() => setPreviewOpen(false)}
        />
      ) : null}
      {note && previewOpen ? (
        <Modal title={attachment.name} size="lg" onClose={() => setPreviewOpen(false)}>
          <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap break-words px-5 pb-5 font-mono text-[12px] leading-relaxed text-content/85">
            {attachment.text}
          </pre>
        </Modal>
      ) : null}
    </>
  );
}

function NoteButton({
  note,
  label,
  onOpen,
  children,
}: {
  note: boolean;
  label: string;
  onOpen: () => void;
  children: ReactNode;
}) {
  if (!note) return <>{children}</>;
  return (
    <button
      type="button"
      title={`Preview ${label}`}
      aria-label={`Preview ${label}`}
      onClick={(event) => {
        event.stopPropagation();
        onOpen();
      }}
      className="flex min-w-0 items-center gap-1.5 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      {children}
    </button>
  );
}

/**
 * Stands in for a paste until its attachment is ready (L-134). It cannot be
 * removed or opened: the real chip replaces it, and send waits for that.
 */
export function PendingAttachmentChip({
  pending,
}: {
  pending: PendingAttachment;
}) {
  const label = `Attaching ${pending.name}`;
  if (pending.previewUrl) {
    return (
      <div
        role="status"
        aria-label={label}
        title={label}
        className="relative size-9 shrink-0 overflow-hidden rounded-lg"
      >
        <img
          src={pending.previewUrl}
          alt=""
          draggable={false}
          className="size-9 rounded-lg object-cover opacity-60"
        />
        <span className="absolute inset-0 grid place-items-center bg-black/25">
          <Loader
            aria-hidden
            className="size-4 text-white motion-safe:animate-spin"
          />
        </span>
      </div>
    );
  }
  return (
    <div
      role="status"
      aria-label={label}
      title={label}
      className="flex min-w-0 items-center gap-1.5 rounded-md bg-content/10 py-0.5 pl-1 pr-1.5"
    >
      <span className="grid size-5 shrink-0 place-items-center">
        <Loader
          aria-hidden
          className="size-3.5 text-content/60 motion-safe:animate-spin"
        />
      </span>
      <span className="min-w-0 max-w-[140px] truncate text-[11px] leading-none text-content/60">
        {pending.name}
      </span>
    </div>
  );
}

import { getCurrentWebview } from "@tauri-apps/api/webview";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type DragEvent as ReactDragEvent,
  type ReactElement,
  type RefObject,
} from "react";
import { ImagePlus } from "../../../shared/ui/icons";
import type { MarkdownCaretTarget } from "../../sessions/ui/markdownCaret";
import {
  insertNoteImagesMarkdown,
  saveNoteImagesFromFiles,
  saveNoteImagesFromPaths,
  type NoteImageAsset,
} from "../noteImages";

type Range = { start: number; end: number };

export type MarkdownImages = {
  busy: boolean;
  dragging: boolean;
  dropZoneRef: RefObject<HTMLDivElement | null>;
  dropZoneProps: {
    onDragOver: (event: ReactDragEvent<HTMLDivElement>) => void;
    onDragLeave: (event: ReactDragEvent<HTMLDivElement>) => void;
    onDrop: (event: ReactDragEvent<HTMLDivElement>) => void;
    onPaste: (event: ReactClipboardEvent<HTMLDivElement>) => void;
  };
  /** Saves picked files at the current cursor (or the end when the field is hidden). */
  addFiles: (files: File[]) => void;
};

/**
 * Image drop, paste and pick for a Markdown body. Images are copied into
 * `note-assets/<ownerId>/` (notes and tasks share this store, keyed by their id)
 * and inserted as Markdown at the editor's selection (Live or Source).
 *
 * Both the native Tauri drop event and the DOM drop can fire for one drop; the
 * second within 250 ms is ignored.
 */
export function useMarkdownImages({
  ownerId,
  caretRef,
  getValue,
  onInsert,
  onError,
}: {
  ownerId: string;
  /** The editor on screen; null in Preview, where images go at the end. */
  caretRef: RefObject<MarkdownCaretTarget | null>;
  getValue: () => string;
  onInsert: (value: string) => void;
  onError: (message: string | null) => void;
}): MarkdownImages {
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const dropZoneRef = useRef<HTMLDivElement>(null);
  const lastDropAt = useRef(0);
  const latest = useRef({ getValue, onInsert, onError });
  latest.current = { getValue, onInsert, onError };

  const insertionRange = useCallback((): Range => {
    const editor = caretRef.current;
    if (!editor) {
      const end = latest.current.getValue().length;
      return { start: end, end };
    }
    return editor.selection();
  }, [caretRef]);

  const add = useCallback(
    async (load: () => Promise<NoteImageAsset[]>, range: Range) => {
      setBusy(true);
      setDragging(false);
      try {
        const images = await load();
        const inserted = insertNoteImagesMarkdown(
          latest.current.getValue(),
          range.start,
          range.end,
          images,
        );
        latest.current.onInsert(inserted.value);
        latest.current.onError(null);
        window.requestAnimationFrame(() => {
          caretRef.current?.focusAt(inserted.cursor);
        });
      } catch (err: unknown) {
        latest.current.onError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [caretRef],
  );

  const addFiles = useCallback(
    (files: File[]) => {
      if (files.length === 0) return;
      const range = insertionRange();
      void add(() => saveNoteImagesFromFiles(ownerId, files), range);
    },
    [add, insertionRange, ownerId],
  );

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    const toClientPoint = (x: number, y: number) => {
      const scale = window.devicePixelRatio || 1;
      if (scale !== 1 && (x > window.innerWidth || y > window.innerHeight)) {
        return { x: x / scale, y: y / scale };
      }
      return { x, y };
    };
    const overDropZone = (x: number, y: number) => {
      const zone = dropZoneRef.current;
      if (!zone) return false;
      const point = toClientPoint(x, y);
      const rect = zone.getBoundingClientRect();
      return (
        point.x >= rect.left &&
        point.x <= rect.right &&
        point.y >= rect.top &&
        point.y <= rect.bottom
      );
    };

    void getCurrentWebview()
      .onDragDropEvent((event) => {
        if (event.payload.type === "leave") {
          setDragging(false);
          return;
        }
        const { x, y } = event.payload.position;
        const over = overDropZone(x, y);
        if (event.payload.type === "enter" || event.payload.type === "over") {
          setDragging(over);
          return;
        }
        if (event.payload.type !== "drop") return;
        setDragging(false);
        if (!over || Date.now() - lastDropAt.current < 250) return;
        lastDropAt.current = Date.now();
        const range = insertionRange();
        const paths = event.payload.paths;
        void add(() => saveNoteImagesFromPaths(ownerId, paths), range);
      })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [add, insertionRange, ownerId]);

  return {
    busy,
    dragging,
    dropZoneRef,
    addFiles,
    dropZoneProps: {
      onDragOver: (event) => {
        if (!hasDroppedFiles(event.dataTransfer)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        setDragging(true);
      },
      onDragLeave: (event) => {
        const next = event.relatedTarget;
        if (next instanceof Node && event.currentTarget.contains(next)) return;
        setDragging(false);
      },
      onDrop: (event) => {
        if (!hasDroppedFiles(event.dataTransfer)) return;
        event.preventDefault();
        setDragging(false);
        if (Date.now() - lastDropAt.current < 250) return;
        lastDropAt.current = Date.now();
        addFiles([...event.dataTransfer.files]);
      },
      onPaste: (event) => {
        // Text pastes fall through to the field; only image data is taken.
        const images = pastedImages(event.clipboardData);
        if (images.length === 0) return;
        event.preventDefault();
        addFiles(images);
      },
    },
  };
}

/** Image files on a clipboard, with a default name for unnamed screenshots. */
export function pastedImages(data: DataTransfer | null): File[] {
  if (!data) return [];
  const files = [...data.files].filter((f) => f.type.startsWith("image/"));
  const found =
    files.length > 0
      ? files
      : [...data.items]
          .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
          .map((item) => item.getAsFile())
          .filter((f): f is File => f !== null);
  return found.map((file) =>
    file.name && file.name !== "image.png"
      ? file
      : new File([file], `pasted-${Date.now()}.${extension(file.type)}`, {
          type: file.type,
        }),
  );
}

function extension(type: string): string {
  const sub = type.split("/")[1] ?? "png";
  return sub === "jpeg" ? "jpg" : sub === "svg+xml" ? "svg" : sub;
}

function hasDroppedFiles(data: DataTransfer | null): data is DataTransfer {
  if (!data) return false;
  return [...data.types].some(
    (type) => type === "Files" || type === "application/x-moz-file",
  );
}

/** Drop overlay shown over the Markdown area while dragging or saving. */
export function MarkdownImageOverlay({
  images,
}: {
  images: MarkdownImages;
}): ReactElement | null {
  if (!images.dragging && !images.busy) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center rounded-lg bg-background-base/80 text-[12px] text-content/70 backdrop-blur-sm">
      {images.busy ? "Adding images…" : "Drop images here"}
    </div>
  );
}

/** Toolbar button that opens the system file picker for images. */
export function InsertImageButton({
  images,
}: {
  images: MarkdownImages;
}): ReactElement {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        type="button"
        aria-label="Insert image"
        title="Insert image"
        disabled={images.busy}
        className="grid size-7 shrink-0 place-items-center rounded-md text-content/50 hover:bg-content/10 hover:text-content focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40"
        onClick={() => input.current?.click()}
      >
        <ImagePlus className="size-3.5" />
      </button>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
        multiple
        hidden
        aria-hidden="true"
        tabIndex={-1}
        onChange={(event) => {
          const files = [...(event.currentTarget.files ?? [])];
          event.currentTarget.value = "";
          images.addFiles(files);
        }}
      />
    </>
  );
}

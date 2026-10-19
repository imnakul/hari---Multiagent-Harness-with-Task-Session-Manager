import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { readBinaryFile, REMOTE_PATH_PREFIX } from "../../../platform/tauri/fs";
import {
  isImagePath,
  sniffImageMime,
  videoMimeForPath,
} from "../../files/model/filePreview";
import { copyImage } from "../../../platform/tauri/clipboard";
import { ImageLightbox } from "../../../shared/ui/ImageLightbox";
import { Check, Copy, ExternalLink } from "../../../shared/ui/icons";

/** Whether a path names a file `LocalMedia` can show. */
export function isLocalMediaPath(path: string): boolean {
  return isImagePath(path) || videoMimeForPath(path) !== null;
}

type Media = { url: string; kind: "image" | "video"; blob?: Blob };

/**
 * A local image or video, shown in place of the reply's link to it. Files load
 * once they scroll near view, so a long history doesn't read every file up
 * front. Local videos stream through the asset protocol, which allows just that
 * file, so their size doesn't matter; images, and files on a connected
 * machine, are read whole within the preview limit. Clicking an image opens
 * it full size; its toolbar copies it or opens the file. Images are sniffed and
 * videos take only an explicit video MIME, as in the file viewer, so neither
 * can become a document. Anything unreadable falls back to the link it
 * replaced.
 */
export function LocalMedia({
  path,
  label,
  onOpen,
  fallback,
}: {
  path: string;
  label: string;
  onOpen?: () => void;
  fallback: ReactNode;
}) {
  const boxRef = useRef<HTMLSpanElement>(null);
  const [near, setNear] = useState(false);
  const [media, setMedia] = useState<Media | null>(null);
  const [failed, setFailed] = useState(false);
  const [zoomed, setZoomed] = useState(false);

  useEffect(() => {
    const box = boxRef.current;
    if (!box || near) return;
    if (typeof IntersectionObserver === "undefined") {
      setNear(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setNear(true);
      },
      { rootMargin: "400px" },
    );
    observer.observe(box);
    return () => observer.disconnect();
  }, [near]);

  useEffect(() => {
    if (!near) return;
    let cancelled = false;
    let created: string | null = null;
    setMedia(null);
    setFailed(false);
    const fail = () => {
      if (!cancelled) setFailed(true);
    };
    if (videoMimeForPath(path) && !path.startsWith(REMOTE_PATH_PREFIX)) {
      invoke<string>("allow_video_stream", { path }).then((allowed) => {
        if (!cancelled)
          setMedia({ url: convertFileSrc(allowed), kind: "video" });
      }, fail);
      return () => {
        cancelled = true;
      };
    }
    readBinaryFile(path).then((bytes) => {
      if (cancelled) return;
      const video = videoMimeForPath(path);
      const mime = video ?? sniffImageMime(bytes);
      if (!mime) {
        setFailed(true);
        return;
      }
      const blob = new Blob([bytes], { type: mime });
      created = URL.createObjectURL(blob);
      setMedia({ url: created, kind: video ? "video" : "image", blob });
    }, fail);
    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [near, path]);

  if (failed) return <>{fallback}</>;
  // One fixed 16:9 box from placeholder to playback, so loading never moves
  // the chat; media fits inside it, letterboxed.
  return (
    <span
      ref={boxRef}
      data-local-media={path}
      className="group relative my-2 block aspect-video w-80 max-w-full overflow-hidden rounded-xl border border-content/10 bg-content/5"
    >
      {!media ? null : media.kind === "video" ? (
        <video
          src={media.url}
          controls
          playsInline
          preload="metadata"
          aria-label={label}
          className="block size-full bg-black object-contain"
          onError={() => setFailed(true)}
        />
      ) : (
        <>
          <button
            type="button"
            aria-label={`View ${label || "image"} full size`}
            title="View full size"
            onClick={() => setZoomed(true)}
            className="block size-full cursor-zoom-in focus-visible:outline-none"
          >
            <img
              src={media.url}
              alt={label}
              draggable={false}
              onError={() => setFailed(true)}
              className="block size-full object-contain"
            />
          </button>
          <MediaToolbar image={media.blob} onOpen={onOpen} />
          {zoomed ? (
            <ImageLightbox
              src={media.url}
              alt={label}
              onClose={() => setZoomed(false)}
            />
          ) : null}
        </>
      )}
    </span>
  );
}

type CopyState = "idle" | "copied" | "failed";

/** Copy and Open buttons over an image; shown on hover or keyboard focus. */
function MediaToolbar({
  image,
  onOpen,
}: {
  image: Blob | undefined;
  onOpen?: () => void;
}) {
  const [copy, setCopy] = useState<CopyState>("idle");
  const timer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (timer.current != null) window.clearTimeout(timer.current);
    },
    [],
  );
  const settle = (state: CopyState) => {
    setCopy(state);
    if (timer.current != null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopy("idle"), 1500);
  };
  const copyLabel =
    copy === "copied" ? "Copied" : copy === "failed" ? "Copy failed" : "Copy image";
  return (
    <span className="absolute right-2 top-2 flex gap-1 opacity-0 transition-opacity duration-150 ease-out group-hover:opacity-100 group-focus-within:opacity-100 motion-reduce:transition-none">
      {image ? (
        <button
          type="button"
          aria-label={copyLabel}
          title={copyLabel}
          onClick={() => {
            copyImage(image).then(
              () => settle("copied"),
              (error: unknown) => {
                console.error("Failed to copy image:", error);
                settle("failed");
              },
            );
          }}
          className={MEDIA_BUTTON}
        >
          {copy === "copied" ? (
            <Check className="size-3.5" strokeWidth={2} aria-hidden />
          ) : (
            <Copy className="size-3.5" strokeWidth={1.75} aria-hidden />
          )}
        </button>
      ) : null}
      {onOpen ? (
        <button
          type="button"
          aria-label="Open file"
          title="Open file"
          onClick={onOpen}
          className={MEDIA_BUTTON}
        >
          <ExternalLink className="size-3.5" strokeWidth={1.75} aria-hidden />
        </button>
      ) : null}
    </span>
  );
}

const MEDIA_BUTTON =
  "grid size-7 place-items-center rounded-md border border-white/15 bg-black/55 text-white/85 backdrop-blur-md transition-[background-color,color,transform] duration-150 ease-out hover:bg-black/75 hover:text-white active:scale-96 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent motion-reduce:transition-none";

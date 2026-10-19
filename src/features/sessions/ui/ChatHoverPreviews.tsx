import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { readBinaryFile } from "../../../platform/tauri/fs";
import { Popover } from "../../../shared/ui/Popover";
import { sniffImageMime } from "../../files/model/filePreview";
import {
  fetchLinkPreviewMetadata,
  type LinkPreviewMetadata,
} from "../model/linkPreview";

const HOVER_OPEN_DELAY_MS = 350;
const HOVER_CLOSE_DELAY_MS = 120;

/**
 * Open-on-hover state with the delays the user link chips use, so a pointer
 * passing over a reply opens nothing. Focus opens it at once for keyboards.
 */
function useHoverCard() {
  const [open, setOpen] = useState(false);
  const openTimer = useRef<number | null>(null);
  const closeTimer = useRef<number | null>(null);
  const clear = () => {
    if (openTimer.current != null) window.clearTimeout(openTimer.current);
    if (closeTimer.current != null) window.clearTimeout(closeTimer.current);
    openTimer.current = null;
    closeTimer.current = null;
  };
  useEffect(() => clear, []);
  return {
    open,
    show: () => {
      if (closeTimer.current != null) window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
      if (open || openTimer.current != null) return;
      openTimer.current = window.setTimeout(() => {
        openTimer.current = null;
        setOpen(true);
      }, HOVER_OPEN_DELAY_MS);
    },
    showNow: () => {
      clear();
      setOpen(true);
    },
    keep: () => {
      if (closeTimer.current != null) window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    },
    hide: () => {
      clear();
      closeTimer.current = window.setTimeout(() => {
        closeTimer.current = null;
        setOpen(false);
      }, HOVER_CLOSE_DELAY_MS);
    },
    hideNow: () => {
      clear();
      setOpen(false);
    },
  };
}

function HoverCard({
  children,
  card,
  width,
  label,
}: {
  children: ReactNode;
  card: ReactNode;
  width: number;
  label: string;
}) {
  const anchor = useRef<HTMLSpanElement>(null);
  const id = useId();
  const hover = useHoverCard();
  return (
    <>
      <span
        ref={anchor}
        aria-describedby={hover.open ? id : undefined}
        onMouseEnter={hover.show}
        onMouseLeave={hover.hide}
        onFocus={hover.showNow}
        onBlur={hover.hideNow}
        onClickCapture={hover.hideNow}
      >
        {children}
      </span>
      {hover.open ? (
        <Popover
          anchor={anchor}
          side="top"
          align="start"
          gap={6}
          width={width}
          constrainHeight={false}
          onDismiss={hover.hideNow}
          id={id}
          role="tooltip"
          aria-label={label}
          className="p-2.5 font-sans text-content"
          onMouseEnter={hover.keep}
          onMouseLeave={hover.hide}
        >
          {card}
        </Popover>
      ) : null}
    </>
  );
}

/**
 * Hover card for a web link in a reply: the page's title and icon, fetched by
 * the native host only once the user hovers, so a reply full of links sends
 * no requests by itself. The host refuses private and local addresses.
 */
export function WebLinkHoverPreview({
  url,
  children,
}: {
  url: string;
  children: ReactNode;
}) {
  return (
    <HoverCard
      width={300}
      label={`Preview of ${url}`}
      card={<WebLinkCard url={url} />}
    >
      {children}
    </HoverCard>
  );
}

type LinkState =
  | { status: "loading" }
  | { status: "ready"; metadata: LinkPreviewMetadata }
  | { status: "unavailable" };

function WebLinkCard({ url }: { url: string }) {
  const [state, setState] = useState<LinkState>({ status: "loading" });
  const [iconFailed, setIconFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetchLinkPreviewMetadata(url).then(
      (metadata) => {
        if (!cancelled) setState({ status: "ready", metadata });
      },
      () => {
        if (!cancelled) setState({ status: "unavailable" });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [url]);
  let host = url;
  try {
    host = new URL(url).host.replace(/^www\./, "");
  } catch {
    /* the raw URL still names the link */
  }
  const metadata = state.status === "ready" ? state.metadata : null;
  const icon = iconFailed ? null : metadata?.faviconDataUrl;
  const title = metadata?.title?.trim();
  return (
    <div className="flex min-w-0 items-start gap-2.5">
      <span className="grid size-8 shrink-0 place-items-center overflow-hidden rounded-md bg-content/[0.07] text-xs font-semibold uppercase text-content/55">
        {icon ? (
          <img
            src={icon}
            alt=""
            draggable={false}
            className="size-5 object-contain"
            onError={() => setIconFailed(true)}
          />
        ) : (
          host.charAt(0)
        )}
      </span>
      <span className="min-w-0 flex-1">
        {state.status === "loading" ? (
          <span
            role="status"
            aria-label="Loading link preview"
            className="mt-0.5 block h-3.5 w-3/4 animate-pulse rounded bg-content/10 motion-reduce:animate-none"
          />
        ) : (
          <span className="line-clamp-2 text-[13px] font-semibold leading-snug text-content">
            {title || host}
          </span>
        )}
        <span className="mt-1 block truncate text-[11px] text-content/50">
          {state.status === "unavailable" ? `${host} · no preview` : url}
        </span>
      </span>
    </div>
  );
}

type ImageState =
  | { status: "loading" }
  | { status: "ready"; url: string }
  | { status: "unavailable" };

/**
 * Hover thumbnail for an image path written as inline code. The file is read
 * only when the card opens and released when it closes.
 */
export function ImagePathHoverPreview({
  path,
  children,
}: {
  path: string;
  children: ReactNode;
}) {
  return (
    <HoverCard
      width={272}
      label={`Preview of ${path}`}
      card={<ImageThumbnail path={path} />}
    >
      {children}
    </HoverCard>
  );
}

function ImageThumbnail({ path }: { path: string }) {
  const [state, setState] = useState<ImageState>({ status: "loading" });
  useEffect(() => {
    let cancelled = false;
    let created: string | null = null;
    readBinaryFile(path).then(
      (bytes) => {
        if (cancelled) return;
        const mime = sniffImageMime(bytes);
        if (!mime) {
          setState({ status: "unavailable" });
          return;
        }
        created = URL.createObjectURL(new Blob([bytes], { type: mime }));
        setState({ status: "ready", url: created });
      },
      () => {
        if (!cancelled) setState({ status: "unavailable" });
      },
    );
    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [path]);
  return (
    <span className="grid aspect-video w-full place-items-center overflow-hidden rounded-md bg-content/5">
      {state.status === "ready" ? (
        <img
          src={state.url}
          alt=""
          draggable={false}
          className="size-full object-contain"
        />
      ) : state.status === "loading" ? (
        <span
          role="status"
          aria-label="Loading image preview"
          className="size-full animate-pulse bg-content/10 motion-reduce:animate-none"
        />
      ) : (
        <span className="text-[11px] text-content/50">Can't preview this image</span>
      )}
    </span>
  );
}

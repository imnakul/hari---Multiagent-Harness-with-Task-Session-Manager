import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { readBinaryFile } from "../../../platform/tauri/fs";
import { Popover } from "../../../shared/ui/Popover";
import { sniffImageMime } from "../../files/model/filePreview";
import {
  collectWebLinks,
  fetchRichLinkPreview,
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
 * Hover card for a web link in a reply: the page's image, title and
 * description, fetched by the native host only once the user hovers, so a
 * reply full of links sends no requests by itself. The host refuses private
 * and local addresses.
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
      width={320}
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

function useRichLinkPreview(url: string, enabled: boolean): LinkState {
  const [state, setState] = useState<LinkState>({ status: "loading" });
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setState({ status: "loading" });
    fetchRichLinkPreview(url).then(
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
  }, [url, enabled]);
  return state;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function SiteLine({
  url,
  metadata,
}: {
  url: string;
  metadata: LinkPreviewMetadata | null;
}) {
  const [iconFailed, setIconFailed] = useState(false);
  const icon = iconFailed ? null : metadata?.faviconDataUrl;
  const host = hostOf(url);
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-content/50">
      {icon ? (
        <img
          src={icon}
          alt=""
          draggable={false}
          className="size-3.5 shrink-0 rounded-sm object-contain"
          onError={() => setIconFailed(true)}
        />
      ) : null}
      <span className="truncate">{metadata?.siteName?.trim() || host}</span>
    </span>
  );
}

function PreviewImage({ src, className }: { src: string; className: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <span
      className={`relative block shrink-0 overflow-hidden bg-content/5 after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:ring-1 after:ring-inset after:ring-content/10 ${className}`}
    >
      <img
        src={src}
        alt=""
        draggable={false}
        loading="lazy"
        className="size-full object-cover"
        onError={() => setFailed(true)}
      />
    </span>
  );
}

function TextSkeleton() {
  return (
    <span
      role="status"
      aria-label="Loading link preview"
      className="flex flex-col gap-1.5"
    >
      <span className="block h-3.5 w-3/4 animate-pulse rounded bg-content/10 motion-reduce:animate-none" />
      <span className="block h-3 w-full animate-pulse rounded bg-content/[0.07] motion-reduce:animate-none" />
    </span>
  );
}

function WebLinkCard({ url }: { url: string }) {
  const state = useRichLinkPreview(url, true);
  const metadata = state.status === "ready" ? state.metadata : null;
  const title = metadata?.title?.trim();
  const description = metadata?.description?.trim();
  return (
    <span className="flex min-w-0 flex-col gap-2">
      {metadata?.imageDataUrl ? (
        <PreviewImage
          src={metadata.imageDataUrl}
          className="aspect-[1.91/1] max-h-42 w-full rounded-md"
        />
      ) : null}
      <SiteLine url={url} metadata={metadata} />
      {state.status === "loading" ? (
        <TextSkeleton />
      ) : (
        <span className="flex min-w-0 flex-col gap-1">
          <span className="line-clamp-2 text-[13px] font-semibold leading-snug text-content">
            {title || hostOf(url)}
          </span>
          {description ? (
            <span className="line-clamp-2 text-xs leading-snug text-content/60">
              {description}
            </span>
          ) : null}
          {state.status === "unavailable" ? (
            <span className="text-[11px] text-content/45">No preview available</span>
          ) : null}
        </span>
      )}
    </span>
  );
}

export const INLINE_LINK_PREVIEW_LIMIT = 3;

/**
 * Cards under a finished reply for its first few web links, for the "Always"
 * link preview setting. Each card fetches only once it nears the viewport, and
 * a link whose page offers nothing to show gets no card.
 */
export function InlineLinkPreviews({ markdown }: { markdown: string }) {
  const links = useMemo(
    () => collectWebLinks(markdown, INLINE_LINK_PREVIEW_LIMIT),
    [markdown],
  );
  if (!links.length) return null;
  return (
    <div className="mt-2 flex flex-col gap-2">
      {links.map((link) => (
        <InlineLinkCard key={link.url} url={link.url} />
      ))}
    </div>
  );
}

function useNearViewport<T extends Element>(): [RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element || near) return;
    if (typeof IntersectionObserver === "undefined") {
      setNear(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setNear(true);
      },
      { rootMargin: "200px 0px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [near]);
  return [ref, near];
}

function InlineLinkCard({ url }: { url: string }) {
  const [ref, near] = useNearViewport<HTMLAnchorElement>();
  const state = useRichLinkPreview(url, near);
  const metadata = state.status === "ready" ? state.metadata : null;
  const title = metadata?.title?.trim();
  const description = metadata?.description?.trim();
  const empty =
    state.status === "unavailable" ||
    (metadata && !title && !description && !metadata.imageDataUrl);
  if (empty) return null;
  return (
    <a
      ref={ref}
      href={url}
      data-link-card={url}
      aria-label={title ? `${title} (${hostOf(url)})` : url}
      className="group/card flex min-h-[5.5rem] w-full max-w-[520px] overflow-hidden rounded-lg border border-content/10 bg-content/[0.03] text-left font-sans no-underline transition-colors duration-150 hover:border-content/15 hover:bg-content/[0.06] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      onClick={(event) => {
        event.preventDefault();
        void openUrl(url).catch((error) => {
          console.error("Failed to open web link:", error);
        });
      }}
    >
      <span className="flex min-w-0 flex-1 flex-col justify-center gap-1 px-3 py-2.5">
        <SiteLine url={url} metadata={metadata} />
        {state.status === "loading" ? (
          <TextSkeleton />
        ) : (
          <>
            <span className="truncate text-[13px] font-semibold leading-snug text-content">
              {title || hostOf(url)}
            </span>
            {description ? (
              <span className="line-clamp-3 text-xs leading-snug text-content/60">
                {description}
              </span>
            ) : null}
          </>
        )}
      </span>
      {/* The card grows with its text (site, title, up to three lines); the
          image column stretches to match instead of fixing the height. */}
      {metadata?.imageDataUrl ? (
        <PreviewImage
          src={metadata.imageDataUrl}
          className="w-32 self-stretch rounded-none border-l border-content/10"
        />
      ) : state.status === "loading" ? (
        <span className="block w-32 shrink-0 self-stretch animate-pulse border-l border-content/10 bg-content/[0.06] motion-reduce:animate-none" />
      ) : null}
    </a>
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

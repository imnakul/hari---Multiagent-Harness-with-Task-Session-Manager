import {
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { readBinaryFile } from "../../../platform/tauri/fs";
import { Globe } from "../../../shared/ui/icons";
import { Popover } from "../../../shared/ui/Popover";
import { sniffImageMime } from "../../files/model/filePreview";
import {
  fetchLinkPreviewMetadata,
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

/**
 * Fork (L-212): with Link previews set to Always, a web link in a chat shows
 * as a chip: the site's icon and, for a bare URL, the page's title (the site
 * name when the page has none). Only the title and icon are fetched, once the
 * link nears the screen; the full card still opens on hover.
 */
export function WebLinkChipLabel({
  url,
  bare,
  children,
}: {
  url: string;
  /** The link's text is its own URL, so the page title can replace it. */
  bare: boolean;
  children: ReactNode;
}) {
  const [ref, near] = useNearViewport<HTMLSpanElement>();
  const [metadata, setMetadata] = useState<LinkPreviewMetadata | null>(null);
  const [iconFailed, setIconFailed] = useState(false);
  useEffect(() => {
    if (!near) return;
    let cancelled = false;
    fetchLinkPreviewMetadata(url).then(
      (value) => {
        if (!cancelled) setMetadata(value);
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [url, near]);
  const icon = iconFailed ? null : metadata?.faviconDataUrl;
  return (
    <span
      ref={ref}
      data-link-chip={url}
      className="inline-flex max-w-[min(100%,28rem)] items-center gap-1 rounded-md bg-content/[0.06] px-1.5 align-[-0.25em] leading-normal"
    >
      {icon ? (
        <img
          src={icon}
          alt=""
          draggable={false}
          className="size-3.5 shrink-0 rounded-sm object-contain"
          onError={() => setIconFailed(true)}
        />
      ) : (
        <Globe aria-hidden className="size-3.5 shrink-0 text-content/45" />
      )}
      <span className="truncate">
        {bare ? metadata?.title?.trim() || hostOf(url) : children}
      </span>
    </span>
  );
}

/**
 * Fork (L-217): with Link previews set to Always, a web link alone on its line
 * shows as a page card in place: site, title, description and image. It loads
 * once it nears the screen, keeps one size while loading so the reply does not
 * jump, and falls back to the chip when the page has no preview.
 */
export function WebLinkCardLink({
  url,
  label,
}: {
  url: string;
  /** The link's own words; null for a bare URL. */
  label: string | null;
}) {
  const [ref, near] = useNearViewport<HTMLSpanElement>();
  const state = useRichLinkPreview(url, near);
  if (state.status === "unavailable") {
    return (
      <WebLinkChipLabel url={url} bare={label === null}>
        {label}
      </WebLinkChipLabel>
    );
  }
  const metadata = state.status === "ready" ? state.metadata : null;
  const title = metadata?.title?.trim() || label || hostOf(url);
  const description = metadata?.description?.trim();
  return (
    <span
      ref={ref}
      data-link-card={url}
      className="my-1 flex h-[5.5rem] w-[26rem] max-w-full overflow-hidden rounded-lg border border-stroke bg-content/[0.03] text-content transition-colors duration-100 ease-out hover:bg-content/[0.06]"
    >
      <span className="flex min-w-0 flex-1 flex-col justify-center gap-1 px-3 py-2">
        <SiteLine url={url} metadata={metadata} />
        {state.status === "loading" ? (
          <TextSkeleton />
        ) : (
          <>
            <span className="truncate text-[13px] font-semibold leading-snug">{title}</span>
            {description ? (
              <span className="line-clamp-2 text-xs leading-snug text-content/60">{description}</span>
            ) : null}
          </>
        )}
      </span>
      {metadata?.imageDataUrl ? (
        <PreviewImage src={metadata.imageDataUrl} className="h-full w-[7.5rem] rounded-r-[7px]" />
      ) : null}
    </span>
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

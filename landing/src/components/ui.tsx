import { Fragment, useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { ImageIcon, Moon, Play, Sun } from "lucide-react";
import type { Media } from "../data/types";
import { useTheme } from "../lib/theme";

/** "Every agent, *one* composer." → the starred word in the serif italic. */
export function Title({ text }: { text: string }) {
  const parts = text.split(/\*(.+?)\*/g);
  return (
    <>
      {parts.map((p, i) =>
        i % 2 ? (
          <em key={i} className="serif">
            {p}
          </em>
        ) : (
          <Fragment key={i}>{p}</Fragment>
        ),
      )}
    </>
  );
}

export function Logo({ size = 28 }: { size?: number }) {
  const base = import.meta.env.BASE_URL;
  return (
    <img
      className="logo"
      src={`${base}brand/hari-logo-${size > 64 ? 256 : 128}.png`}
      width={size}
      height={size}
      alt=""
      draggable={false}
    />
  );
}

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const next = theme === "dark" ? "light" : "dark";
  return (
    <button type="button" className="icon-btn theme-btn" onClick={toggle} aria-label={`Switch to ${next} theme`} title={`Switch to ${next} theme`}>
      <span className="swap" data-on={theme === "light" || undefined}>
        <Sun size={17} strokeWidth={1.8} />
      </span>
      <span className="swap" data-on={theme === "dark" || undefined}>
        <Moon size={17} strokeWidth={1.8} />
      </span>
    </button>
  );
}

/** Small mono label used above headings. */
export function Eyebrow({ children, num }: { children: ReactNode; num?: string }) {
  return (
    <p className="eyebrow">
      {num && <span className="eyebrow-num">{num}</span>}
      {children}
    </p>
  );
}

/**
 * A media frame. With `media` it shows the image or a muted looping video
 * that only plays while on screen. Without it, a designed placeholder that
 * reads as "screenshot goes here" rather than as a broken page.
 */
export function MediaSlot({
  media,
  caption,
  aspect = 16 / 10,
  icon,
  className = "",
  style,
}: {
  media?: Media;
  caption: string;
  aspect?: number;
  icon?: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  const base = import.meta.env.BASE_URL;
  const ratio = aspect >= 1 ? `${Math.round(aspect * 10) / 10}:1` : `1:${Math.round((1 / aspect) * 10) / 10}`;

  return (
    <figure className={`slot ${className}`} style={style}>
      <div className="slot-frame" style={{ aspectRatio: String(aspect) }}>
        {media?.type === "image" && (
          <img src={base + media.src} alt={media.alt} loading="lazy" decoding="async" width={media.width} height={media.height} />
        )}
        {media?.type === "video" && <AutoVideo src={base + media.src} poster={media.poster && base + media.poster} label={media.alt} />}
        {!media && (
          <div className="slot-ph">
            <span className="slot-mark tl" />
            <span className="slot-mark tr" />
            <span className="slot-mark bl" />
            <span className="slot-mark br" />
            <span className="slot-icon">{icon ?? <ImageIcon size={18} strokeWidth={1.6} />}</span>
            <span className="slot-meta">
              <Play size={10} strokeWidth={2} /> image or video · {ratio}
            </span>
          </div>
        )}
      </div>
      <figcaption className="slot-cap">{caption}</figcaption>
    </figure>
  );
}

function AutoVideo({ src, poster, label }: { src: string; poster?: string; label: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      v.controls = true; // show the poster and let people press play
      return;
    }
    const io = new IntersectionObserver(([e]) => (e.isIntersecting ? v.play().catch(() => {}) : v.pause()), {
      threshold: 0.25,
    });
    io.observe(v);
    return () => io.disconnect();
  }, []);
  return <video ref={ref} src={src} poster={poster} muted loop playsInline preload="metadata" aria-label={label} controls={false} />;
}

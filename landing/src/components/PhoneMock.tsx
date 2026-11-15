import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import {
  ArrowUp,
  Bluetooth,
  Camera,
  Check,
  Clipboard,
  Lock,
  Monitor,
  Moon,
  Music2,
  Paperclip,
  Power,
  RotateCcw,
  Volume2,
  Zap,
} from "lucide-react";
import { useWallpaperBackground } from "./Wallpaper";

const TABS = ["Sessions", "Share", "Control"] as const;

/**
 * The phone app, drawn. Tabs auto-advance while the phone is on screen
 * until the visitor picks one, then it is theirs.
 */
export function PhoneMock() {
  const [tab, setTab] = useState(0);
  const touched = useRef(false);
  const root = useRef<HTMLDivElement>(null);
  const bg = useWallpaperBackground();

  useEffect(() => {
    const el = root.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let timer: number | undefined;
    const io = new IntersectionObserver(([e]) => {
      window.clearInterval(timer);
      if (e.isIntersecting && !touched.current) {
        timer = window.setInterval(() => {
          if (touched.current) return window.clearInterval(timer);
          setTab((t) => (t + 1) % TABS.length);
        }, 4200);
      }
    }, { threshold: 0.5 });
    io.observe(el);
    return () => {
      io.disconnect();
      window.clearInterval(timer);
    };
  }, []);

  return (
    <div className="phone-show" ref={root}>
      <div className="phone">
        <div className="phone-screen">
          <div className="ph-wall" style={bg} />
          <div className="ph-status">
            <span>9:41</span>
            <span className="ph-island" />
            <span className="ph-status-r">
              <Zap size={10} /> 84%
            </span>
          </div>
          <div className="ph-stage">
            {TABS.map((t, i) => (
              <div
                key={t}
                className="ph-view"
                data-state={i === tab ? "on" : i < tab ? "before" : "after"}
                aria-hidden={i !== tab}
              >
                {i === 0 && <SessionsView />}
                {i === 1 && <ShareView />}
                {i === 2 && <ControlView />}
              </div>
            ))}
          </div>
        </div>
      </div>
      <Segmented
        value={tab}
        onChange={(i) => {
          touched.current = true;
          setTab(i);
        }}
      />
    </div>
  );
}

/** Segmented control with a clip-path highlight (one shape, no colour flicker). */
function Segmented({ value, onChange }: { value: number; onChange: (i: number) => void }) {
  const list = useRef<HTMLDivElement>(null);
  const [clip, setClip] = useState("inset(0 100% 0 0 round 999px)");

  useLayoutEffect(() => {
    const el = list.current;
    if (!el) return;
    const measure = () => {
      const btn = el.querySelectorAll<HTMLButtonElement>("button")[value];
      if (!btn) return;
      const l = btn.offsetLeft;
      const r = el.offsetWidth - (btn.offsetLeft + btn.offsetWidth);
      setClip(`inset(0 ${r}px 0 ${l}px round 999px)`);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [value]);

  return (
    <div className="seg glass" role="tablist" aria-label="Phone app screens">
      <div className="seg-list" ref={list}>
        {TABS.map((t, i) => (
          <button key={t} type="button" role="tab" aria-selected={value === i} onClick={() => onChange(i)}>
            {t}
          </button>
        ))}
      </div>
      <div className="seg-list seg-active" aria-hidden="true" style={{ clipPath: clip } as CSSProperties}>
        {TABS.map((t) => (
          <span key={t}>{t}</span>
        ))}
      </div>
    </div>
  );
}

function SessionsView() {
  return (
    <>
      <div className="ph-h">
        <span className="ph-h-t">hari-desktop</span>
        <span className="ph-badge">2 running</span>
      </div>
      <div className="ph-card">
        <div className="ph-card-t shimmer">Share bar over every app</div>
        <div className="ph-card-m">Claude · Working · 4 min</div>
      </div>
      <div className="ph-card ph-card-ask">
        <div className="ph-card-t">ConPTY idle flush</div>
        <div className="ph-card-m">Codex wants to run</div>
        <code className="ph-code">cargo test -p hari pty</code>
        <div className="ph-btns">
          <span className="ph-btn ph-btn-primary">Approve</span>
          <span className="ph-btn">Deny</span>
        </div>
      </div>
      <div className="ph-card">
        <div className="ph-card-t">Activity week view</div>
        <div className="ph-card-m">
          <Check size={10} /> Finished · Sonnet
        </div>
      </div>
      <div className="ph-composer">
        <span>Message hari-desktop…</span>
        <span className="ph-send">
          <ArrowUp size={12} />
        </span>
      </div>
    </>
  );
}

function ShareView() {
  return (
    <>
      <div className="ph-h">
        <span className="ph-h-t">Share</span>
        <span className="ph-badge ph-badge-ok">Connected</span>
      </div>
      <div className="ph-msgs">
        <div className="ph-msg ph-msg-in">
          <span className="ph-msg-k">From PC · Clipboard</span>
          https://localhost:1420/preview
        </div>
        <div className="ph-msg ph-msg-in ph-msg-img">
          <span className="ph-shot" />
          <span className="ph-msg-k">screenshot.png · 412 KB</span>
        </div>
        <div className="ph-msg ph-msg-out">
          Notes from the call: ship the bubble behind a setting
          <span className="ph-msg-k">Sent · on PC clipboard</span>
        </div>
      </div>
      <div className="ph-composer ph-composer-share">
        <Paperclip size={12} />
        <Clipboard size={12} />
        <span>Send to computer</span>
        <span className="ph-send">
          <ArrowUp size={12} />
        </span>
      </div>
    </>
  );
}

function ControlView() {
  const tiles = [
    { i: <Monitor size={14} />, t: "Monitor off" },
    { i: <Lock size={14} />, t: "Lock" },
    { i: <Moon size={14} />, t: "Hibernate" },
    { i: <Bluetooth size={14} />, t: "Bluetooth", on: true },
    { i: <Camera size={14} />, t: "Camera" },
    { i: <Zap size={14} />, t: "Minimal" },
    { i: <RotateCcw size={14} />, t: "Restart" },
    { i: <Power size={14} />, t: "Shut down" },
  ];
  return (
    <>
      <div className="ph-h">
        <span className="ph-h-t">Control</span>
        <span className="ph-badge ph-badge-ok">DESKTOP-HARI</span>
      </div>
      <div className="ph-stats">
        {[
          ["CPU", 0.18],
          ["GPU", 0.06],
          ["RAM", 0.52],
        ].map(([k, v]) => (
          <div key={k as string} className="ph-stat">
            <span>{k}</span>
            <b>{Math.round((v as number) * 100)}%</b>
            <i style={{ "--v": v } as CSSProperties} />
          </div>
        ))}
      </div>
      <div className="ph-media">
        <Music2 size={14} />
        <div>
          <div className="ph-card-t">Now playing</div>
          <div className="ph-card-m">Spotify · Lo-fi focus</div>
        </div>
        <Volume2 size={14} />
      </div>
      <div className="ph-tiles">
        {tiles.map((x) => (
          <div key={x.t} className="ph-tile" data-on={x.on || undefined}>
            {x.i}
            <span>{x.t}</span>
          </div>
        ))}
      </div>
    </>
  );
}

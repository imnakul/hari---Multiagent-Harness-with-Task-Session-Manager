import { useEffect, useRef, type CSSProperties } from "react";
import {
  ArrowUp,
  Bell,
  Check,
  Crosshair,
  FileCode2,
  Minus,
  Moon,
  Plus,
  Smartphone,
  Sparkles,
  Square,
  SquareTerminal,
  X,
} from "lucide-react";
import { useWallpaperBackground } from "./Wallpaper";
import { useStudio } from "../lib/studio";
import { Logo } from "./ui";

const W = 1200;
const H = 750;

/**
 * A drawn Hari window. It is laid out at a fixed 1200×750 and scaled to fit,
 * so it keeps the exact composition of a screenshot at every width.
 */
export function AppMock() {
  const outer = useRef<HTMLDivElement>(null);
  const { glass } = useStudio();
  const bg = useWallpaperBackground();

  useEffect(() => {
    const el = outer.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      el.style.setProperty("--s", String(e.contentRect.width / W));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const vars = {
    "--mg-fill": (0.16 + glass * 0.5).toFixed(3),
    "--mg-blur": `${Math.round(6 + glass * 30)}px`,
  } as CSSProperties;

  return (
    <div className="mock-outer" ref={outer} style={{ aspectRatio: `${W} / ${H}` }}>
      <div className="mock" style={{ width: W, height: H, ...vars }} role="img" aria-label="Hari window: two agent chats side by side over a wallpaper, with a sidebar of sessions and a usage bar.">
        <div className="m-wall" style={bg} />
        <TitleBar />
        <div className="m-body">
          <Sidebar />
          <div className="m-main">
            <ClaudePane />
            <CodexPane />
          </div>
        </div>
        <BottomBar />
      </div>
      <div className="mock-over" style={{ width: W, height: H }}>
        <ShareBarFloat />
      </div>
    </div>
  );
}

function TitleBar() {
  return (
    <div className="m-title">
      <div className="m-title-l">
        <Logo size={18} />
        <span className="m-title-name">Hari</span>
      </div>
      <div className="m-tabs">
        {["Chats", "Tasks", "Browser", "Whiteboard", "Activity"].map((t, i) => (
          <span key={t} className="m-tab" data-on={i === 0 || undefined}>
            {t}
          </span>
        ))}
      </div>
      <div className="m-title-r">
        <span className="m-ico">
          <Crosshair size={14} />
        </span>
        <span className="m-ico">
          <Smartphone size={14} />
        </span>
        <span className="m-ico m-bell">
          <Bell size={14} />
          <i />
        </span>
        <span className="m-winctl">
          <Minus size={13} />
          <Square size={11} />
          <X size={13} />
        </span>
      </div>
    </div>
  );
}

const SESSIONS = [
  { t: "Share bar over every app", m: "share-bar · Claude Opus", s: "work" },
  { t: "ConPTY idle flush", m: "main · Codex", s: "ask" },
  { t: "Zen dock polish", m: "zen · Antigravity", s: "work" },
  { t: "Activity week view", m: "activity · Claude Sonnet", s: "done" },
  { t: "Storage filters", m: "storage · OpenCode", s: "done" },
];

function Sidebar() {
  return (
    <aside className="m-side m-glass">
      <div className="m-projects">
        <span className="m-proj" data-on>
          H
        </span>
        <span className="m-proj m-proj-gold">M</span>
        <span className="m-proj m-proj-blue">W</span>
        <span className="m-proj m-proj-add">
          <Plus size={13} />
        </span>
      </div>
      <div className="m-views">
        {[
          ["Session Manager", "12"],
          ["Task Manager", "5"],
          ["Automations", "3"],
          ["Notes", ""],
        ].map(([v, c]) => (
          <div key={v} className="m-view">
            <span>{v}</span>
            {c && <span className="m-count">{c}</span>}
          </div>
        ))}
      </div>
      <div className="m-side-h">
        <span>hari-desktop</span>
        <span className="m-pill-run">2 running</span>
      </div>
      <div className="m-sessions">
        {SESSIONS.map((s, i) => (
          <div key={s.t} className="m-sess" data-on={i === 0 || undefined}>
            <span className={`m-dot m-dot-${s.s}`} />
            <div>
              <div className={s.s === "work" ? "m-sess-t shimmer" : "m-sess-t"}>{s.t}</div>
              <div className="m-sess-m">{s.m}</div>
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}

function ClaudePane() {
  return (
    <section className="m-pane m-glass" data-focus>
      <header className="m-pane-h">
        <span className="m-pane-t">Share bar over every app</span>
        <span className="m-chip">Claude Code · Interactive</span>
      </header>
      <div className="m-chat">
        <div className="m-user">Add a floating Share bar on Ctrl+Alt+H that stays above every app. Keep it see-through.</div>
        <p className="m-ai">
          Done. The bar is its own always-on-top window, so it survives focus changes, and it reuses the Share composer.
        </p>
        <div className="m-tools">
          <div className="m-tool">
            <Check size={12} /> Edited <code>src/share/ShareBar.tsx</code> <span className="m-add">+128</span>
            <span className="m-del">−4</span>
          </div>
          <div className="m-tool">
            <Check size={12} /> Edited <code>src-tauri/src/share_bar.rs</code> <span className="m-add">+86</span>
          </div>
          <div className="m-tool">
            <Check size={12} /> Ran <code>npm test</code> <span className="m-muted">1,284 passed</span>
          </div>
        </div>
        <div className="m-link">
          <span className="m-link-img" />
          <div>
            <div className="m-link-site">localhost:1420</div>
            <div className="m-link-t">Share bar preview</div>
            <div className="m-link-d">Drop a file, paste a link, or type. Sends to Hari on your phone.</div>
          </div>
        </div>
        <p className="m-ai">
          Next I'll add it to Settings → Shortcuts so the chord can be rebound<span className="m-caret" />
        </p>
      </div>
      <div className="m-composer">
        <div className="m-queue">1 queued · Steer</div>
        <div className="m-input">Ask anything. ! for a prompt, # for a task</div>
        <div className="m-comp-row">
          <span className="m-pill">Opus</span>
          <span className="m-pill">High</span>
          <span className="m-pill">
            <SquareTerminal size={11} />
          </span>
          <span className="m-spacer" />
          <span className="m-pill m-pill-ghost">
            <Sparkles size={11} />
          </span>
          <span className="m-send">
            <ArrowUp size={13} />
          </span>
        </div>
      </div>
    </section>
  );
}

function CodexPane() {
  return (
    <section className="m-pane m-glass">
      <header className="m-pane-h">
        <span className="m-pane-t">ConPTY idle flush</span>
        <span className="m-chip">Codex</span>
      </header>
      <div className="m-chat">
        <div className="m-user">Output stalls when the shell goes quiet. Find why.</div>
        <p className="m-ai">The reader only flushes on newline. A timed flush after 16 ms of quiet fixes it without extra paints.</p>
        <div className="m-files">
          <FileCode2 size={12} /> <code>src-tauri/src/pty.rs</code> <span className="m-add">+31</span>
          <span className="m-del">−9</span>
        </div>
        <div className="m-approve">
          <div className="m-approve-t">Codex wants to run</div>
          <code className="m-approve-c">cargo test -p hari pty</code>
          <div className="m-approve-b">
            <span className="m-btn m-btn-primary">Allow once</span>
            <span className="m-btn">Always</span>
            <span className="m-btn">Deny</span>
          </div>
        </div>
      </div>
      <div className="m-composer">
        <div className="m-input">Reply…</div>
        <div className="m-comp-row">
          <span className="m-pill">gpt</span>
          <span className="m-pill">Medium</span>
          <span className="m-spacer" />
          <span className="m-send">
            <ArrowUp size={13} />
          </span>
        </div>
      </div>
    </section>
  );
}

function BottomBar() {
  return (
    <div className="m-bottom">
      <div className="m-usage">
        <span className="m-u" data-on>
          <b>Claude</b> 64% left
          <i style={{ "--v": 0.64 } as CSSProperties} />
        </span>
        <span className="m-u">
          <b>Codex</b> 81% left
          <i style={{ "--v": 0.81 } as CSSProperties} />
        </span>
      </div>
      <div className="m-stats">
        <span>CPU 9%</span>
        <span>GPU 3%</span>
        <span className="m-fps">120 fps</span>
        <Moon size={12} />
        <SquareTerminal size={12} />
      </div>
    </div>
  );
}

function ShareBarFloat() {
  return (
    <div className="sharebar" aria-hidden="true">
      <div className="sharebar-h">
        <span>Share to phone</span>
        <span className="sharebar-sent">
          <Check size={11} /> Sent
        </span>
      </div>
      <div className="sharebar-body">
        <span className="sharebar-in">https://localhost:1420/preview</span>
        <span className="sharebar-send">
          <ArrowUp size={12} />
        </span>
      </div>
      <span className="sharebar-key">Ctrl Alt H</span>
    </div>
  );
}

import { useMemo, useState, type CSSProperties, type ReactElement } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Bot,
  BrainCircuit,
  Gauge,
  Layers,
  Monitor,
  Palette,
  Search,
  Smartphone,
  Wrench,
} from "lucide-react";
import { AppMock } from "../components/AppMock";
import { GlassStudio } from "../components/GlassStudio";
import { PhoneMock } from "../components/PhoneMock";
import { Eyebrow, Logo, MediaSlot, Title } from "../components/ui";
import { catalog } from "../data/catalog";
import { chapters, type Chapter } from "../data/chapters";
import { site } from "../data/site";
import { AREA_LABEL, type Area, type Media } from "../data/types";
import { updates } from "../data/updates";
import { formatDayMonth } from "../lib/reveal";
import { Link } from "../lib/router";

/** Set this to a screenshot or video of the real app to replace the drawn window. */
const HERO_MEDIA: Media | undefined = undefined;

const d = (ms: number) => ({ "--d": `${ms}ms` }) as CSSProperties;

const AREA_ICON: Record<Area, ReactElement> = {
  agents: <Bot size={18} strokeWidth={1.6} />,
  sessions: <Layers size={18} strokeWidth={1.6} />,
  workspace: <Monitor size={18} strokeWidth={1.6} />,
  toolkit: <Wrench size={18} strokeWidth={1.6} />,
  insight: <Gauge size={18} strokeWidth={1.6} />,
  phone: <Smartphone size={18} strokeWidth={1.6} />,
  craft: <Palette size={18} strokeWidth={1.6} />,
};

export function Home() {
  return (
    <>
      <Hero />
      <Replaces />
      <Stats />
      <Features />
      <Everything />
      <WhatsNew />
      <DownloadSection />
    </>
  );
}

/* ── Hero ─────────────────────────────────────────────── */

function Hero() {
  const latest = updates[0];
  return (
    <section className="hero" data-now>
      <div className="wrap hero-head">
        <Link to="/updates" className="hero-pill frost" data-reveal="fade" style={d(0)}>
          <span className="hero-pill-new">New</span>
          <span className="hero-pill-text">{latest.title}</span>
          <span className="hero-pill-date">{formatDayMonth(latest.date)}</span>
          <ArrowRight size={14} />
        </Link>
        <h1 className="hero-title" data-reveal="lead" style={d(40)}>
          One harness for <em className="serif">everything</em> you&nbsp;build.
        </h1>
        <p className="hero-sub" data-reveal style={d(160)}>
          Hari runs Claude Code, Codex, Antigravity and more side by side, then folds in the browser, whiteboard, tasks,
          notes, automations and a phone app that controls your PC. Over your own wallpaper, behind frosted glass.
        </p>
        <div className="hero-ctas" data-reveal style={d(240)}>
          <a className="btn btn-primary btn-lg" href={site.downloads.windows.href}>
            <WindowsGlyph />
            Download for Windows
          </a>
          <a className="btn btn-ghost btn-lg" href={site.downloads.android.href}>
            <Smartphone size={17} strokeWidth={1.8} />
            Get the Android app
          </a>
        </div>
        <p className="hero-meta" data-reveal="fade" style={d(320)}>
          <span>{site.stats.desktopMB} MB desktop</span>
          <span>{site.stats.phoneMB} MB phone</span>
          <span>Updates itself</span>
        </p>
      </div>

      <div className="wrap-wide stage" data-reveal="stage" style={d(380)}>
        {HERO_MEDIA ? <MediaSlot media={HERO_MEDIA} caption="Hari" /> : <AppMock />}
        <div className="stage-studio">
          <GlassStudio />
          <p className="stage-hint">Change the wallpaper. It is the whole page now.</p>
        </div>
      </div>

      <div className="wrap agents">
        <p className="agents-label">Drives the agents you already pay for</p>
        <ul className="agents-list">
          {site.agents.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function WindowsGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">
      <path d="M0 2.2 6.5 1.3v6.3H0zM7.3 1.2 16 0v7.6H7.3zM0 8.4h6.5v6.3L0 13.8zM7.3 8.4H16V16l-8.7-1.2z" />
    </svg>
  );
}

/* ── Before Hari ──────────────────────────────────────── */

const BEFORE = [
  ["Claude desktop", "Claude chats"],
  ["ChatGPT & Codex desktop", "Codex runs"],
  ["Antigravity", "Gemini agents"],
  ["A browser, always open", "Docs, previews, localhost"],
  ["A cross-device task app", "To-dos on phone and PC"],
  ["A notes app", "Specs and scratch"],
  ["A whiteboard", "Flows and sketches"],
  ["A phone-link app", "Clipboard and files across"],
  ["A time tracker", "Where the day went"],
];

function Replaces() {
  return (
    <section className="section" id="why">
      <div className="wrap">
        <div className="section-head" data-reveal>
          <Eyebrow>Before Hari</Eyebrow>
          <h2 className="h2">
            <Title text="It used to take *nine* apps." />
          </h2>
          <p className="lede">
            Claude in one window, Codex in another, Antigravity in a third. A browser that never closed, a task app on
            the phone, a whiteboard somewhere. Hari is what's left when all of that moves into one place.
          </p>
        </div>

        <div className="replace">
          <ol className="rep-list" data-reveal="group">
            {BEFORE.map(([name, why], i) => (
              <li key={name} className="rep-row frost" style={{ ...d(80 + i * 55), "--s": `${620 + i * 70}ms` } as CSSProperties}>
                <span className="rep-n">{String(i + 1).padStart(2, "0")}</span>
                <span className="rep-name">{name}</span>
                <span className="rep-why">{why}</span>
                <span className="rep-strike" />
              </li>
            ))}
          </ol>
          <div className="rep-card glass" data-reveal style={d(200)}>
            <Logo size={84} />
            <p className="rep-card-t">
              <Title text="One window. *One* phone." />
            </p>
            <p className="rep-card-b">Everything on the left, in a {site.stats.desktopMB} MB desktop app and a {site.stats.phoneMB} MB phone app, talking to each other.</p>
            <div className="rep-card-sizes">
              <span>
                <b>{site.stats.desktopMB}</b> MB
                <small>Windows</small>
              </span>
              <span>
                <b>{site.stats.phoneMB}</b> MB
                <small>Android</small>
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ── Numbers ──────────────────────────────────────────── */

function Stats() {
  const items = [
    [site.stats.features.toLocaleString("en"), "features logged"],
    [site.stats.commits.toLocaleString("en"), "commits"],
    [String(site.stats.days), "days of building"],
    [String(site.agents.length), "agent CLIs"],
  ];
  return (
    <section className="wrap stats-wrap">
      <dl className="stats glass" data-reveal>
        {items.map(([n, l]) => (
          <div key={l} className="stat">
            <dt>{l}</dt>
            <dd>{n}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/* ── Feature chapters ─────────────────────────────────── */

function Features() {
  return (
    <section className="section" id="features">
      <div className="wrap">
        <div className="section-head section-head-wide" data-reveal>
          <Eyebrow>Features</Eyebrow>
          <h2 className="h2 h2-xl">
            <Title text="Everything you reached for, *already open*." />
          </h2>
        </div>
        {chapters.map((c, i) => (c.id === "phone" ? <PhoneChapter key={c.id} c={c} n={i + 1} /> : <ChapterBlock key={c.id} c={c} n={i + 1} />))}
      </div>
    </section>
  );
}

function ChapterText({ c, n }: { c: Chapter; n: number }) {
  return (
    <div className="ch-text">
      <div data-reveal>
        <Eyebrow num={String(n).padStart(2, "0")}>{c.kicker}</Eyebrow>
        <h3 className="h2">
          <Title text={c.title} />
        </h3>
        <p className="lede">{c.lede}</p>
      </div>
      <ul className="ch-points" data-reveal="group">
        {c.points.map((p, i) => (
          <li key={p.title} style={d(100 + i * 50)}>
            <b>{p.title}</b>
            <span>{p.body}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ChapterBlock({ c, n }: { c: Chapter; n: number }) {
  return (
    <article className="chapter" id={c.id} data-flip={n % 2 === 0 || undefined}>
      <ChapterText c={c} n={n} />
      <div className="ch-media">
        {c.slots.map((s, i) => (
          <div key={s.caption} data-reveal="media" style={d(i * 90)}>
            <MediaSlot media={s.media} caption={s.caption} aspect={s.aspect} icon={AREA_ICON[c.id]} />
          </div>
        ))}
      </div>
    </article>
  );
}

function PhoneChapter({ c, n }: { c: Chapter; n: number }) {
  return (
    <article className="chapter chapter-phone" id={c.id}>
      <ChapterText c={c} n={n} />
      <div className="ch-phone" data-reveal="media">
        <PhoneMock />
      </div>
      <div className="ch-phone-shots">
        {c.slots.map((s, i) => (
          <div key={s.caption} data-reveal="media" style={d(i * 90)}>
            <MediaSlot media={s.media} caption={s.caption} aspect={s.aspect} icon={AREA_ICON.phone} />
          </div>
        ))}
      </div>
    </article>
  );
}

/* ── Everything in Hari ───────────────────────────────── */

const AREAS = Object.keys(AREA_LABEL) as Area[];

function Everything() {
  const [area, setArea] = useState<Area | "all">("all");
  const [q, setQ] = useState("");

  const items = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return catalog.filter(
      (it) =>
        (area === "all" || it.area === area) &&
        (!needle || it.name.toLowerCase().includes(needle) || it.line.toLowerCase().includes(needle)),
    );
  }, [area, q]);

  const counts = useMemo(() => {
    const m = new Map<Area, number>();
    catalog.forEach((c) => m.set(c.area, (m.get(c.area) ?? 0) + 1));
    return m;
  }, []);

  return (
    <section className="section" id="everything">
      <div className="wrap">
        <div className="section-head section-head-row" data-reveal>
          <div>
            <Eyebrow>Everything in Hari</Eyebrow>
            <h2 className="h2">
              <Title text="The *short* list." />
            </h2>
          </div>
          <p className="lede lede-sm">
            {catalog.length} of the {site.stats.features} features in the log. The rest are the small things you only notice
            when they are missing.
          </p>
        </div>

        <div className="cat-controls" data-reveal="fade">
          <div className="chips" role="radiogroup" aria-label="Filter by area">
            <button type="button" role="radio" aria-checked={area === "all"} className="chip" onClick={() => setArea("all")}>
              All <span className="chip-n">{catalog.length}</span>
            </button>
            {AREAS.map((a) => (
              <button key={a} type="button" role="radio" aria-checked={area === a} className="chip" onClick={() => setArea(a)}>
                {AREA_LABEL[a]} <span className="chip-n">{counts.get(a)}</span>
              </button>
            ))}
          </div>
          <label className="search frost">
            <Search size={15} strokeWidth={1.8} />
            <input type="search" placeholder="Search features" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search features" />
          </label>
        </div>

        <ul className="cat-grid" aria-live="polite">
          {items.map((it) => (
            <li key={it.area + it.name} className="cat-item frost">
              <span className="cat-ico">{AREA_ICON[it.area]}</span>
              <div>
                <p className="cat-name">
                  {it.name}
                  {it.isNew && <span className="badge-new">New</span>}
                </p>
                <p className="cat-line">{it.line}</p>
              </div>
            </li>
          ))}
          {items.length === 0 && (
            <li className="cat-empty">
              Nothing matches “{q}”. <button type="button" className="text-link" onClick={() => { setQ(""); setArea("all"); }}>Clear</button>
            </li>
          )}
        </ul>
      </div>
    </section>
  );
}

/* ── What's new ───────────────────────────────────────── */

function WhatsNew() {
  return (
    <section className="section" id="updates">
      <div className="wrap">
        <div className="section-head section-head-row" data-reveal>
          <div>
            <Eyebrow>What's new</Eyebrow>
            <h2 className="h2">
              <Title text="Shipping *most* days." />
            </h2>
          </div>
          <Link to="/updates" className="btn btn-ghost">
            Every update <ArrowRight size={15} />
          </Link>
        </div>
        <div className="upd-feature">
          {updates.slice(0, 3).map((u, i) => (
            <article key={u.title} className="upd-card glass" data-reveal style={d(i * 90)}>
              <MediaSlot media={u.media} caption={u.title} icon={<BrainCircuit size={18} strokeWidth={1.6} />} className="slot-bare" />
              <div className="upd-card-body">
                <p className="upd-date">
                  <time dateTime={u.date}>{formatDayMonth(u.date)}</time>
                  {u.version && <span>{u.version}</span>}
                </p>
                <h3>{u.title}</h3>
                <p>{u.summary}</p>
                <div className="tags">
                  {u.areas.map((a) => (
                    <span key={a} className="tag">
                      {AREA_LABEL[a]}
                    </span>
                  ))}
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── Download ─────────────────────────────────────────── */

export function DownloadSection() {
  return (
    <section className="section" id="download">
      <div className="wrap">
        <div className="section-head section-head-center" data-reveal>
          <Logo size={72} />
          <h2 className="h2 h2-xl">
            <Title text="Put it all in *one* place." />
          </h2>
          <p className="lede">Install on Windows, scan the pairing code with your phone, and both apps keep themselves up to date.</p>
        </div>
        <div className="dl-grid">
          <a className="dl-card glass" href={site.downloads.windows.href} data-reveal style={d(0)}>
            <span className="dl-ico">
              <WindowsGlyph />
            </span>
            <span className="dl-t">Hari for Windows</span>
            <span className="dl-m">
              {site.downloads.windows.note} · {site.stats.desktopMB} MB
            </span>
            <span className="dl-file">{site.downloads.windows.file}</span>
            <span className="dl-go">
              Download <ArrowUpRight size={15} />
            </span>
          </a>
          <a className="dl-card glass" href={site.downloads.android.href} data-reveal style={d(90)}>
            <span className="dl-ico">
              <Smartphone size={18} strokeWidth={1.8} />
            </span>
            <span className="dl-t">Hari for Android</span>
            <span className="dl-m">
              {site.downloads.android.note} · {site.stats.phoneMB} MB
            </span>
            <span className="dl-file">{site.downloads.android.file}</span>
            <span className="dl-go">
              Download <ArrowUpRight size={15} />
            </span>
          </a>
        </div>
        <p className="dl-note" data-reveal="fade">
          Hari uses the agent CLIs you have installed and signed in to. It does not sell tokens.
        </p>
      </div>
    </section>
  );
}

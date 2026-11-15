import type { CSSProperties } from "react";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { Eyebrow, Logo, Title } from "../components/ui";
import { site } from "../data/site";
import { formatDate } from "../lib/reveal";
import { Link } from "../lib/router";

type Beat = { date: string; who: "upstream" | "hari"; title: string; body: string };

/** Dates come from the MonoCode changelog and this repo's commit history. */
const BEATS: Beat[] = [
  {
    date: "2026-08-20",
    who: "upstream",
    title: "MonoCode 0.1.0 ships",
    body: "A clean GUI for coding agents. Its changelog reads: macOS (Apple Silicon) only. Linux, Windows and Intel Macs are out of scope.",
  },
  {
    date: "2026-09-03",
    who: "hari",
    title: "Day one: Hari runs on Windows",
    body: "The first five commits were native Acrylic glass, adjustable glass strength, typography and wallpapers that persist. The look came first.",
  },
  {
    date: "2026-09-05",
    who: "hari",
    title: "A real Windows terminal",
    body: "ConPTY terminals, no console flashes, child processes tied to the app, and importing existing Claude and Codex CLI sessions.",
  },
  {
    date: "2026-09-07",
    who: "upstream",
    title: "MonoCode mentions a Windows installer",
    body: "Version 0.1.36 is the first entry in MonoCode's changelog to mention a Windows installer, four days after Hari's first Windows build.",
  },
  {
    date: "2026-10-01",
    who: "hari",
    title: "Merging upstream, not drifting",
    body: "MonoCode 0.6.0 merged into the Windows branch, then 0.7, 0.8, 0.10, 0.14 and 0.16, each with a written preservation check of every Hari feature.",
  },
  {
    date: "2026-10-03",
    who: "hari",
    title: "Tasks and sessions get managers",
    body: "Task Manager and Session Manager land, and Hari stops being just a chat client.",
  },
  {
    date: "2026-10-20",
    who: "hari",
    title: "Focus, then everything else",
    body: "Focus mode, Session overview, Whiteboard, Browser and Zen mode ship within two weeks.",
  },
  {
    date: "2026-11-07",
    who: "hari",
    title: "The phone app gets its name",
    body: "The phone companion becomes Hari, with the peacock feather and flute on frosted glass, and the desktop installer follows.",
  },
  {
    date: "2026-11-15",
    who: "hari",
    title: `${site.stats.features} features in the log`,
    body: "Share bar, Share bubble, a control centre for the PC on the phone, and still shipping.",
  },
];

const d = (ms: number) => ({ "--d": `${ms}ms` }) as CSSProperties;

export function Story() {
  return (
    <>
      <section className="page-hero story-hero">
        <div className="wrap story-hero-in">
          <div data-reveal="lead">
            <Eyebrow>The story</Eyebrow>
            <h1 className="page-title">
              <Title text="Built because Windows was *waiting*." />
            </h1>
            <p className="lede">
              Hari began as a Windows build of MonoCode, an open-source GUI for coding agents. It became the one app we
              open in the morning and close at night.
            </p>
          </div>
          <div className="story-logo" data-reveal="fade" style={d(160)}>
            <Logo size={180} />
          </div>
        </div>
      </section>

      <section className="wrap prose-wrap">
        <div className="prose" data-reveal>
          <p>
            Our days ran across Claude's desktop app, ChatGPT and Codex, Antigravity, a browser that never closed and a task
            manager that had to work on the phone too. When MonoCode appeared, it was the cleanest way we had seen to run
            coding agents side by side. It was also Mac-only, and we work on Windows.
          </p>
          <p>
            So we built the Windows version. The first thing we did was not a feature: it was the glass. Native Acrylic,
            frosted panels, and your own wallpaper behind everything, because a tool you look at for ten hours a day should
            be something you like looking at. We learned later that someone else had started a Windows port too. Ours was
            already in daily use.
          </p>
          <p>
            Then we kept going. Every app we still alt-tabbed to became a reason to build it in: the browser, the whiteboard,
            notes, tasks, the activity tracker, the phone link. {site.stats.days} days and {site.stats.commits} commits later,
            Hari is the whole desk.
          </p>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <div className="section-head" data-reveal>
            <Eyebrow>Timeline</Eyebrow>
            <h2 className="h2">
              <Title text="From a missing build to a *whole* harness." />
            </h2>
          </div>
          <ol className="beats">
            {BEATS.map((b, i) => (
              <li key={b.date + b.title} className="beat" data-who={b.who} data-reveal style={d(Math.min(i, 3) * 40)}>
                <time className="beat-date" dateTime={b.date}>
                  {formatDate(b.date)}
                </time>
                <span className="beat-who">{b.who === "hari" ? "Hari" : "MonoCode"}</span>
                <span className="beat-dot" aria-hidden="true" />
                <div className="beat-body">
                  <h3>{b.title}</h3>
                  <p>{b.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <div className="section-head" data-reveal>
            <Eyebrow>The name</Eyebrow>
            <h2 className="h2">
              <Title text="Why *Hari*." />
            </h2>
          </div>
          <div className="name-grid">
            <div className="name-card glass" data-reveal>
              <p className="name-word">हरि</p>
              <p>
                Hari is a name of Krishna, from the Sanskrit root <i>hṛ</i>, to take away. The logo is his peacock feather
                and flute. It is a fitting name for an app whose job is to take nine others away.
              </p>
            </div>
            <ul className="principles">
              {[
                ["Glass is a feature", "If you look at it all day, how it looks is part of how it works."],
                ["One place, not nine", "If we keep alt-tabbing to something, it belongs inside."],
                ["Upstream first, credit always", "We merge MonoCode's releases and say where Hari comes from."],
              ].map(([t, b], i) => (
                <li key={t} className="principle frost" data-reveal style={d(i * 70)}>
                  <b>{t}</b>
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <div className="thanks glass" data-reveal>
            <Eyebrow>Thank you</Eyebrow>
            <h2 className="h2">
              <Title text="Standing on *MonoCode*." />
            </h2>
            <p>
              MonoCode by hardbeat920 and its contributors is the foundation under Hari: the harness, the providers, the
              session model and the phone link. It is released under the MIT licence, and Hari keeps its licence and notice.
              If you are on a Mac or Linux, go and use it.
            </p>
            <div className="thanks-ctas">
              <a className="btn btn-ghost" href={site.links.monocode} target="_blank" rel="noreferrer">
                MonoCode on GitHub <ArrowUpRight size={15} />
              </a>
              <Link to="/#features" className="btn btn-primary">
                See what Hari does <ArrowRight size={15} />
              </Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

import { useMemo, useState, type CSSProperties } from "react";
import { Sparkles } from "lucide-react";
import { Eyebrow, MediaSlot, Title } from "../components/ui";
import { AREA_LABEL, type Area } from "../data/types";
import { updates, type Update } from "../data/updates";
import { formatDayMonth, formatMonth } from "../lib/reveal";
import { DownloadSection } from "./Home";

const AREAS = Object.keys(AREA_LABEL) as Area[];

export function Updates() {
  const [area, setArea] = useState<Area | "all">("all");

  const months = useMemo(() => {
    const list = updates.filter((u) => area === "all" || u.areas.includes(area));
    const groups: { month: string; items: Update[] }[] = [];
    for (const u of list) {
      const m = u.date.slice(0, 7);
      const last = groups[groups.length - 1];
      if (last?.month === m) last.items.push(u);
      else groups.push({ month: m, items: [u] });
    }
    return groups;
  }, [area]);

  return (
    <>
      <section className="page-hero">
        <div className="wrap">
          <div data-reveal="lead">
            <Eyebrow>Changelog</Eyebrow>
            <h1 className="page-title">
              <Title text="What's *new* in Hari." />
            </h1>
            <p className="lede">
              Every feature that shipped, newest first, with pictures where we have them. The full engineering log lives
              in the repo as LOCAL-FEATURES.md.
            </p>
          </div>
          <div className="chips chips-page" role="radiogroup" aria-label="Filter by area" data-reveal="fade" style={{ "--d": "120ms" } as CSSProperties}>
            <button type="button" role="radio" aria-checked={area === "all"} className="chip" onClick={() => setArea("all")}>
              All
            </button>
            {AREAS.map((a) => (
              <button key={a} type="button" role="radio" aria-checked={area === a} className="chip" onClick={() => setArea(a)}>
                {AREA_LABEL[a]}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="wrap timeline">
        {months.map((g) => (
          <div key={g.month} className="tl-month">
            <h2 className="tl-month-h">
              <span>{formatMonth(g.month + "-01")}</span>
            </h2>
            <ol className="tl-list">
              {g.items.map((u) => (
                <li key={u.date + u.title} className="tl-item" data-reveal>
                  <div className="tl-date">
                    <time dateTime={u.date}>{formatDayMonth(u.date)}</time>
                    {u.version && <span className="tl-ver">{u.version}</span>}
                  </div>
                  <span className="tl-dot" aria-hidden="true" />
                  <article className="tl-card glass">
                    <div className="tl-body">
                      <h3>{u.title}</h3>
                      <p>{u.summary}</p>
                      {u.highlights && (
                        <ul className="tl-hl">
                          {u.highlights.map((h) => (
                            <li key={h}>{h}</li>
                          ))}
                        </ul>
                      )}
                      <div className="tags">
                        {u.areas.map((a) => (
                          <span key={a} className="tag">
                            {AREA_LABEL[a]}
                          </span>
                        ))}
                        {u.refs && <span className="tag tag-ref">{u.refs.join(" · ")}</span>}
                      </div>
                    </div>
                    <MediaSlot media={u.media} caption={u.title} icon={<Sparkles size={18} strokeWidth={1.6} />} className="slot-bare tl-media" />
                  </article>
                </li>
              ))}
            </ol>
          </div>
        ))}
        {months.length === 0 && <p className="cat-empty">No updates in this area yet.</p>}
      </section>

      <DownloadSection />
    </>
  );
}

import { useEffect } from "react";

/**
 * One observer for every [data-reveal] element on the page. Elements get
 * `data-in` once, the first time they come into view, and never animate again.
 * Stagger is set per element with style={{ "--d": "80ms" }}.
 */
export function useReveal(dep: unknown) {
  useEffect(() => {
    const els = document.querySelectorAll<HTMLElement>("[data-reveal]:not([data-in])");
    if (!("IntersectionObserver" in window)) {
      els.forEach((el) => el.setAttribute("data-in", ""));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.setAttribute("data-in", "");
            io.unobserve(e.target);
          }
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.12 },
    );
    // Above-the-fold hero pieces play on load instead of waiting for scroll.
    const now = Array.from(els).filter((el) => el.closest("[data-now]"));
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => now.forEach((el) => el.setAttribute("data-in", "")));
    });
    els.forEach((el) => !now.includes(el) && io.observe(el));
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [dep]);
}

const fmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const fmtDayMonth = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const fmtMonth = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

export const formatDate = (iso: string) => fmt.format(new Date(iso + "T00:00:00Z"));
export const formatDayMonth = (iso: string) => fmtDayMonth.format(new Date(iso + "T00:00:00Z"));
export const formatMonth = (iso: string) => fmtMonth.format(new Date(iso + "T00:00:00Z"));

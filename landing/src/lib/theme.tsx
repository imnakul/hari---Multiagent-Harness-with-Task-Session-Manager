import { useCallback, useEffect, useSyncExternalStore } from "react";

export type Theme = "light" | "dark";
const KEY = "hari-theme";
const EVENT = "hari:theme";
const mq = () => window.matchMedia("(prefers-color-scheme: dark)");

function resolved(): Theme {
  const set = document.documentElement.dataset.theme;
  if (set === "light" || set === "dark") return set;
  return mq().matches ? "dark" : "light";
}

function subscribe(cb: () => void) {
  const m = mq();
  m.addEventListener("change", cb);
  window.addEventListener(EVENT, cb);
  return () => {
    m.removeEventListener("change", cb);
    window.removeEventListener(EVENT, cb);
  };
}

/** The theme in effect: the visitor's pick, else the system's. */
export function useTheme() {
  const theme = useSyncExternalStore(subscribe, resolved, () => "light" as Theme);

  const setTheme = useCallback((t: Theme) => {
    document.documentElement.dataset.theme = t;
    try {
      localStorage.setItem(KEY, t);
    } catch {
      /* storage blocked: the choice still applies for this visit */
    }
    window.dispatchEvent(new Event(EVENT));
  }, []);

  // Keep the browser chrome colour in step with the page.
  useEffect(() => {
    const color = theme === "dark" ? "#06161a" : "#eef4f3";
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute("content", color));
  }, [theme]);

  return { theme, setTheme, toggle: () => setTheme(theme === "dark" ? "light" : "dark") };
}

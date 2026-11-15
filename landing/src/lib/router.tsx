import { useEffect, useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent } from "react";

/** A tiny History-API router: three pages don't need a library. */
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const NAV_EVENT = "hari:navigate";

function currentPath() {
  const p = window.location.pathname;
  const stripped = BASE && p.startsWith(BASE) ? p.slice(BASE.length) : p;
  return stripped.replace(/\/+$/, "") || "/";
}

function subscribe(cb: () => void) {
  window.addEventListener("popstate", cb);
  window.addEventListener(NAV_EVENT, cb);
  return () => {
    window.removeEventListener("popstate", cb);
    window.removeEventListener(NAV_EVENT, cb);
  };
}

export function usePath() {
  return useSyncExternalStore(subscribe, currentPath, () => "/");
}

export function href(to: string) {
  return BASE + to;
}

function scrollToHash(hash: string, smooth: boolean) {
  const id = hash.replace(/^#/, "");
  if (!id) return false;
  const el = document.getElementById(id);
  if (!el) return false;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ behavior: smooth && !reduce ? "smooth" : "auto", block: "start" });
  return true;
}

export function navigate(to: string) {
  const [path, hash = ""] = to.split("#");
  const target = path || currentPath();
  if (target === currentPath()) {
    if (hash) {
      history.replaceState(null, "", href(target) + "#" + hash);
      scrollToHash(hash, true);
    } else {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
    return;
  }
  history.pushState(null, "", href(target) + (hash ? "#" + hash : ""));
  window.dispatchEvent(new Event(NAV_EVENT));
}

/** After a page change, land on the hash target or the top. */
export function useScrollOnRoute(path: string) {
  useEffect(() => {
    const hash = window.location.hash;
    // Wait a frame so the new page has laid out.
    const raf = requestAnimationFrame(() => {
      if (!scrollToHash(hash, false)) window.scrollTo(0, 0);
    });
    return () => cancelAnimationFrame(raf);
  }, [path]);
}

type LinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & { to: string };

export function Link({ to, onClick, ...rest }: LinkProps) {
  const handle = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(to);
  };
  return <a href={href(to.startsWith("#") ? currentPath() + to : to)} onClick={handle} {...rest} />;
}

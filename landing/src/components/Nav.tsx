import { useEffect, useRef, useState } from "react";
import { Download, Menu, X } from "lucide-react";
import { Link, usePath } from "../lib/router";
import { Logo, ThemeToggle } from "./ui";

const LINKS = [
  { to: "/#features", label: "Features" },
  { to: "/#phone", label: "Phone" },
  { to: "/#everything", label: "Everything" },
  { to: "/updates", label: "What's new" },
  { to: "/story", label: "Story" },
];

export function Nav() {
  const path = usePath();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const sheet = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);

  useEffect(() => setOpen(false), [path]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onClick = (e: MouseEvent) => {
      if (!sheet.current?.parentElement?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onClick);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onClick);
    };
  }, [open]);

  const active = (to: string) => !to.includes("#") && path === to;

  return (
    <header className="nav" data-scrolled={scrolled || undefined}>
      <nav className="nav-inner glass" aria-label="Main">
        <Link to="/" className="nav-brand" aria-label="Hari home">
          <Logo size={26} />
          <span>Hari</span>
        </Link>
        <ul className="nav-links">
          {LINKS.map((l) => (
            <li key={l.to}>
              <Link to={l.to} aria-current={active(l.to) ? "page" : undefined}>
                {l.label}
              </Link>
            </li>
          ))}
        </ul>
        <div className="nav-actions">
          <ThemeToggle />
          <Link to="/#download" className="btn btn-primary btn-sm nav-cta">
            <Download size={15} strokeWidth={2} />
            <span>Download</span>
          </Link>
          <button
            type="button"
            className="icon-btn nav-menu-btn"
            aria-expanded={open}
            aria-controls="nav-sheet"
            aria-label={open ? "Close menu" : "Open menu"}
            onClick={() => setOpen((o) => !o)}
          >
            {open ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>
        <div id="nav-sheet" ref={sheet} className="nav-sheet glass" data-open={open || undefined} hidden={!open}>
          {LINKS.map((l) => (
            <Link key={l.to} to={l.to} onClick={() => setOpen(false)}>
              {l.label}
            </Link>
          ))}
        </div>
      </nav>
    </header>
  );
}

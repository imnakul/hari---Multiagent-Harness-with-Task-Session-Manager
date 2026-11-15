import { ArrowUpRight } from "lucide-react";
import { site } from "../data/site";
import { Link } from "../lib/router";
import { Logo } from "./ui";

export function Footer() {
  return (
    <footer className="footer">
      <div className="wrap">
        <div className="footer-credit glass">
          <div className="footer-credit-mark">
            <Logo size={44} />
          </div>
          <div>
            <p className="footer-credit-title">
              Hari is built on <a href={site.links.monocode} target="_blank" rel="noreferrer">MonoCode</a>.
            </p>
            <p className="footer-credit-body">
              MonoCode is the open-source GUI for coding agents by hardbeat920, released under the MIT licence.
              Hari started as its Windows build and grew from there: the glass, the phone app and{" "}
              {site.stats.features} logged features on top. Thank you to everyone who works on MonoCode.
            </p>
            <Link to="/story" className="text-link">
              Read how Hari started <ArrowUpRight size={14} />
            </Link>
          </div>
        </div>

        <div className="footer-grid">
          <div className="footer-brand">
            <Link to="/" className="nav-brand">
              <Logo size={26} />
              <span>Hari</span>
            </Link>
            <p>One harness for everything you build.</p>
          </div>
          <div>
            <p className="footer-h">Product</p>
            <Link to="/#features">Features</Link>
            <Link to="/#phone">Phone app</Link>
            <Link to="/#everything">Everything in Hari</Link>
            <Link to="/#download">Download</Link>
          </div>
          <div>
            <p className="footer-h">Project</p>
            <Link to="/updates">What's new</Link>
            <Link to="/story">Story</Link>
            <a href={site.links.github} target="_blank" rel="noreferrer">
              GitHub
            </a>
          </div>
          <div>
            <p className="footer-h">Credits</p>
            <a href={site.links.monocode} target="_blank" rel="noreferrer">
              MonoCode (MIT)
            </a>
            <span className="footer-muted">Agent names belong to their owners.</span>
          </div>
        </div>
        <p className="footer-base">
          <span>© {new Date().getFullYear()} Hari</span>
          <span className="footer-muted">Made on Windows, for people who build all day.</span>
        </p>
      </div>
    </footer>
  );
}

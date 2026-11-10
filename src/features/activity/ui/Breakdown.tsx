import type { ReactElement, ReactNode } from "react";
import { AppWindow, Folder, GitBranch, Globe } from "../../../shared/ui/icons";
import { formatDuration, type AwSummary, type ProjectSummary } from "../model/activity";

function Section({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
}): ReactElement {
  return (
    <section aria-label={title} className="flex min-w-0 flex-col">
      <header className="flex items-baseline justify-between px-1 pb-2">
        <h3 className="text-[11px] font-medium uppercase tracking-[0.08em] text-content/45">
          {title}
        </h3>
        {aside ? <span className="text-[11px] text-content/35">{aside}</span> : null}
      </header>
      {children}
    </section>
  );
}

/** Thin proportional bar. Width is data-driven, hence the inline style. */
function Bar({ ratio, color }: { ratio: number; color: string }): ReactElement {
  return (
    <span aria-hidden className="block h-1 overflow-hidden rounded-full bg-content/[0.06]">
      <span
        className={`block h-full rounded-full ${color} transition-[width] duration-500 ease-out`}
        style={{ width: `${Math.max(2, Math.min(100, ratio * 100))}%` }}
      />
    </span>
  );
}

/** Prompts and agent time per repo, busiest first. */
export function ProjectBreakdown({ projects }: { projects: ProjectSummary[] }): ReactElement {
  const max = Math.max(1, ...projects.map((p) => p.agentMs));
  return (
    <Section title="Projects" aside={projects.length > 0 ? `${projects.length}` : undefined}>
      {projects.length === 0 ? (
        <p className="px-1 text-[12px] text-content/40">No agent work logged.</p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {projects.map((project) => (
            <li
              key={project.cwd}
              title={project.cwd}
              className="motion-safe:animate-[zen-step-in_220ms_ease-out_both] rounded-md px-2 py-2 hover:bg-content/[0.04]"
            >
              <div className="flex items-center gap-2 text-[12.5px]">
                <Folder className="size-3.5 shrink-0 text-content/40" strokeWidth={1.75} />
                <span className="min-w-0 flex-1 truncate font-medium text-content">
                  {project.name}
                </span>
                <span className="shrink-0 tabular-nums text-content/70">
                  {formatDuration(project.agentMs)}
                </span>
              </div>
              <div className="mt-1.5 pl-[22px]">
                <Bar ratio={project.agentMs / max} color="bg-accent" />
              </div>
              <div className="mt-1.5 flex items-center gap-2 pl-[22px] text-[11px] text-content/40">
                <span className="tabular-nums">
                  {project.prompts} {project.prompts === 1 ? "prompt" : "prompts"}
                </span>
                {project.branches.length > 0 ? (
                  <span className="flex min-w-0 items-center gap-1">
                    <GitBranch className="size-3 shrink-0" strokeWidth={1.75} />
                    <span className="truncate">{project.branches.join(", ")}</span>
                  </span>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

/** Top focused apps from ActivityWatch (names only). */
export function AppsBreakdown({ aw }: { aw: AwSummary | null }): ReactElement | null {
  if (!aw?.available) return null;
  const max = Math.max(1, ...aw.apps.map((a) => a.ms));
  return (
    <Section title="Apps" aside="ActivityWatch">
      {aw.apps.length === 0 ? (
        <p className="px-1 text-[12px] text-content/40">No app time recorded.</p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {aw.apps.map((app) => (
            <li key={app.app} className="motion-safe:animate-[zen-step-in_220ms_ease-out_both] rounded-md px-2 py-1.5 hover:bg-content/[0.04]">
              <div className="flex items-center gap-2 text-[12px]">
                <AppWindow className="size-3.5 shrink-0 text-content/40" strokeWidth={1.75} />
                <span className="min-w-0 flex-1 truncate text-content/85">{app.app}</span>
                <span className="shrink-0 tabular-nums text-content/55">
                  {formatDuration(app.ms)}
                </span>
              </div>
              <div className="mt-1.5 pl-[22px]">
                <Bar ratio={app.ms / max} color="bg-content/35" />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

/**
 * Time per website from the ActivityWatch browser extension. Domains are what
 * the notes AI may see; the tab titles under each are shown here only.
 */
export function SitesBreakdown({ aw }: { aw: AwSummary | null }): ReactElement | null {
  if (!aw?.available) return null;
  const max = Math.max(1, ...aw.sites.map((site) => site.ms));
  return (
    <Section title="Sites" aside="Browser extension">
      {!aw.hasWeb ? (
        <p className="px-1 text-[12px] leading-snug text-content/40">
          Add the ActivityWatch browser extension (Chrome, Edge, Firefox) to see
          time per website and tab.
        </p>
      ) : aw.sites.length === 0 ? (
        <p className="px-1 text-[12px] text-content/40">No website time recorded.</p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {aw.sites.map((site) => (
            <li
              key={site.domain}
              className="motion-safe:animate-[zen-step-in_220ms_ease-out_both] rounded-md px-2 py-1.5 hover:bg-content/[0.04]"
            >
              <div className="flex items-center gap-2 text-[12px]">
                <Globe className="size-3.5 shrink-0 text-content/40" strokeWidth={1.75} />
                <span className="min-w-0 flex-1 truncate text-content/85">{site.domain}</span>
                <span className="shrink-0 tabular-nums text-content/55">
                  {formatDuration(site.ms)}
                </span>
              </div>
              <div className="mt-1.5 pl-[22px]">
                <Bar ratio={site.ms / max} color="bg-mention" />
              </div>
              {site.titles.length > 0 ? (
                <ul className="mt-1 flex flex-col pl-[22px]">
                  {site.titles.map((title) => (
                    <li key={title} title={title} className="truncate text-[11px] text-content/40">
                      {title}
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

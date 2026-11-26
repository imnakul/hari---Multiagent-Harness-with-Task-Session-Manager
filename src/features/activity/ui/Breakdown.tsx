import { useState, type ReactElement, type ReactNode } from "react";
import {
  AppWindow,
  ChevronRight,
  Folder,
  GitBranch,
  Globe,
  SmartPhone,
} from "../../../shared/ui/icons";
import { RevealHeight } from "../../../shared/ui/RevealHeight";
import {
  formatClock,
  formatDuration,
  type AwSummary,
  type PhoneSummaryData,
  type ProjectSummary,
} from "../model/activity";
import { loadCollapsed, saveCollapsed, type SectionId } from "../model/layout";

/**
 * A left-column section whose header folds it (fork, L-399). The fold is kept
 * per machine; folded, the header still shows the section's total.
 */
function Section({
  id,
  title,
  aside,
  total,
  children,
}: {
  id: SectionId;
  title: string;
  aside?: ReactNode;
  /** Shown beside the title while the section is folded. */
  total?: string;
  children: ReactNode;
}): ReactElement {
  const [collapsed, setCollapsed] = useState(() => loadCollapsed()[id]);
  const toggle = (): void => {
    setCollapsed(!collapsed);
    saveCollapsed(id, !collapsed);
  };
  return (
    <section aria-label={title} className="flex min-w-0 flex-col">
      <button
        type="button"
        aria-expanded={!collapsed}
        onClick={toggle}
        className="group flex w-full items-center gap-1 rounded-md px-1 pb-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <ChevronRight
          aria-hidden
          className={`size-3 shrink-0 text-content/35 transition-transform duration-150 ease-out group-hover:text-content/60 ${collapsed ? "" : "rotate-90"}`}
          strokeWidth={1.75}
        />
        <h3 className="text-[11px] font-medium uppercase tracking-[0.08em] text-content/45">
          {title}
        </h3>
        <span className="ml-auto text-[11px] tabular-nums text-content/35">
          {collapsed && total ? total : aside}
        </span>
      </button>
      <RevealHeight open={!collapsed}>{children}</RevealHeight>
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
    <Section
      id="projects"
      title="Projects"
      aside={projects.length > 0 ? `${projects.length}` : undefined}
      total={formatDuration(projects.reduce((sum, project) => sum + project.agentMs, 0))}
    >
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
    <Section
      id="apps"
      title="Apps"
      aside="ActivityWatch"
      total={formatDuration(aw.apps.reduce((sum, app) => sum + app.ms, 0))}
    >
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
    <Section
      id="sites"
      title="Sites"
      aside="Browser extension"
      total={formatDuration(aw.sites.reduce((sum, site) => sum + site.ms, 0))}
    >
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
            <SiteRow key={site.domain} site={site} max={max} />
          ))}
        </ul>
      )}
    </Section>
  );
}

/**
 * Fork (L-398): the phone's screen time from Hari: top apps, which phone it
 * came from and when it last synced.
 */
export function PhoneBreakdown({
  phone,
  loading,
  failed,
}: {
  phone: PhoneSummaryData | null;
  loading: boolean;
  failed: boolean;
}): ReactElement {
  const max = Math.max(1, ...(phone?.apps ?? []).map((row) => row.ms));
  const total = (phone?.apps ?? []).reduce((sum, row) => sum + row.ms, 0);
  const latest = Math.max(0, ...(phone?.devices ?? []).map((device) => device.lastSync));
  return (
    <Section id="phone" title="Phone" aside={phone?.devices[0]?.name} total={formatDuration(total)}>
      {loading && !phone ? (
        <p className="px-1 text-[12px] text-content/40">Loading phone time…</p>
      ) : failed || !phone ? (
        <p className="px-1 text-[12px] leading-snug text-content/40">
          Phone screen time is unavailable right now.
        </p>
      ) : !phone.available ? (
        <p className="px-1 text-[12px] leading-snug text-content/40">
          No phone has shared screen time yet. In Hari, turn on Settings → Share screen time with
          PC.
        </p>
      ) : phone.apps.length === 0 ? (
        <p className="px-1 text-[12px] text-content/40">No phone use in this period.</p>
      ) : (
        <>
          <ul className="flex flex-col gap-0.5">
            {phone.apps.slice(0, 10).map((row) => (
              <li
                key={row.app}
                className="motion-safe:animate-[zen-step-in_220ms_ease-out_both] rounded-md px-2 py-1.5 hover:bg-content/[0.04]"
              >
                <div className="flex items-center gap-2 text-[12px]">
                  <SmartPhone className="size-3.5 shrink-0 text-content/40" strokeWidth={1.75} />
                  <span className="min-w-0 flex-1 truncate text-content/85">{row.app}</span>
                  <span className="shrink-0 tabular-nums text-content/55">
                    {formatDuration(row.ms)}
                  </span>
                </div>
                <div className="mt-1.5 pl-[22px]">
                  <Bar ratio={row.ms / max} color="bg-mention" />
                </div>
              </li>
            ))}
          </ul>
          {latest > 0 ? (
            <p className="px-1 pt-1.5 text-[11px] text-content/35">
              Last synced {formatClock(latest)}
            </p>
          ) : null}
        </>
      )}
    </Section>
  );
}

type AwSite = AwSummary["sites"][number];

/**
 * One website. Its tab titles start folded (fork, L-282) so the list stays a
 * short ranking of sites; the row opens them.
 */
function SiteRow({ site, max }: { site: AwSite; max: number }): ReactElement {
  const [open, setOpen] = useState(false);
  const hasTabs = site.titles.length > 0;
  const summary = (
    <>
      <div className="flex items-center gap-2 text-[12px]">
        <Globe className="size-3.5 shrink-0 text-content/40" strokeWidth={1.75} />
        <span className="min-w-0 flex-1 truncate text-content/85">{site.domain}</span>
        {hasTabs ? (
          <span className="flex shrink-0 items-center gap-0.5 text-[11px] text-content/35">
            {site.titles.length} {site.titles.length === 1 ? "tab" : "tabs"}
            <ChevronRight
              aria-hidden
              className={`size-3 transition-transform duration-150 ease-out ${open ? "rotate-90" : ""}`}
              strokeWidth={1.75}
            />
          </span>
        ) : null}
        <span className="shrink-0 tabular-nums text-content/55">{formatDuration(site.ms)}</span>
      </div>
      <div className="mt-1.5 pl-[22px]">
        <Bar ratio={site.ms / max} color="bg-mention" />
      </div>
    </>
  );
  return (
    <li className="motion-safe:animate-[zen-step-in_220ms_ease-out_both] rounded-md hover:bg-content/[0.04]">
      {hasTabs ? (
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          className="block w-full rounded-md px-2 py-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {summary}
        </button>
      ) : (
        <div className="px-2 py-1.5">{summary}</div>
      )}
      {hasTabs && open ? (
        <ul className="flex flex-col px-2 pb-1.5 pl-[30px]">
          {site.titles.map((tab) => (
            <li
              key={tab.title}
              title={tab.title}
              className="flex items-center gap-2 text-[11px] text-content/40"
            >
              <span className="min-w-0 flex-1 truncate">{tab.title}</span>
              <span className="shrink-0 tabular-nums text-content/35">{formatDuration(tab.ms)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

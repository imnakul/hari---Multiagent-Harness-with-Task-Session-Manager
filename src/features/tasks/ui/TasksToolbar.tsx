import { useMemo, useRef, useState, type ReactNode } from "react";
import { pathKey, projectName } from "../../../shared/lib/paths";
import { Check, ListFilter, Search, X } from "../../../shared/ui/icons";
import { Popover } from "../../../shared/ui/Popover";
import {
  SearchableSelect,
  type SearchableSelectOption,
} from "../../../shared/ui/SearchableSelect";
import { normalizeNoteTags } from "../../notes/notes";
import { taskFacetCounts } from "../taskFacets";
import {
  TASK_STATUSES,
  TASK_STATUS_LABELS,
  type Task,
  type TaskFilters,
} from "../tasks";

const PERSONAL = "personal";

export function hasActiveFilters(filters: TaskFilters): boolean {
  return Boolean(
    filters.query?.trim() ||
    filters.statuses?.length ||
    filters.projectCwd !== undefined ||
    filters.projectCwds?.length ||
    filters.tags?.length,
  );
}

const FILTER_ROW =
  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] text-content/80 transition-colors duration-100 hover:bg-content/5 hover:text-content focus-visible:bg-content/5 focus-visible:outline-none";

/** Zen's one Filter button (L-230): Status and Project as checklists. */
function TaskFilterMenu({
  statusOptions,
  projectOptions,
  statuses,
  projects,
  active,
  onToggleStatus,
  onToggleProject,
  onClear,
}: {
  statusOptions: readonly SearchableSelectOption[];
  projectOptions: readonly SearchableSelectOption[];
  statuses: readonly string[];
  projects: readonly string[];
  active: boolean;
  onToggleStatus: (value: string) => void;
  onToggleProject: (value: string) => void;
  onClear: () => void;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const count = statuses.length + projects.length;
  const section = (
    title: string,
    options: readonly SearchableSelectOption[],
    selected: readonly string[],
    onToggle: (value: string) => void,
  ) => (
    <div role="group" aria-label={title} className="py-0.5">
      <div className="px-2 pt-1.5 pb-1 text-[11px] font-medium text-content/40">
        {title}
      </div>
      {options.map((option) => {
        const checked = selected.includes(option.value);
        return (
          <button
            key={option.value}
            type="button"
            role="menuitemcheckbox"
            aria-checked={checked}
            title={option.keywords}
            onClick={() => onToggle(option.value)}
            className={FILTER_ROW}
          >
            <span className="grid size-3.5 shrink-0 place-items-center">
              {checked ? (
                <Check aria-hidden className="size-3.5 text-accent" strokeWidth={2} />
              ) : null}
            </span>
            <span className="min-w-0 flex-1 truncate">{option.label}</span>
            {option.count !== undefined ? (
              <span className="shrink-0 text-[11px] tabular-nums text-content/40">
                {option.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
  return (
    <>
      <button
        ref={button}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Filter by status or project"
        onClick={() => setOpen((value) => !value)}
        className={`inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-[12px] transition-colors duration-150 ${
          open || active
            ? "bg-selection text-content"
            : "text-content/60 hover:bg-content/10 hover:text-content"
        }`}
      >
        <ListFilter aria-hidden className="size-3.5" strokeWidth={1.75} />
        Filter
        {count > 0 ? (
          <span className="tabular-nums text-[11px] opacity-70">{count}</span>
        ) : null}
      </button>
      {open ? (
        <Popover
          anchor={button}
          side="bottom"
          align="start"
          width={240}
          maxHeight={380}
          onDismiss={(reason) => {
            setOpen(false);
            if (reason === "escape") button.current?.focus();
          }}
          role="menu"
          aria-label="Filter tasks"
          className="flex flex-col overflow-hidden"
        >
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-none p-1">
            {section("Status", statusOptions, statuses, onToggleStatus)}
            <div aria-hidden className="mx-2 my-1 h-px bg-stroke" />
            {section("Project", projectOptions, projects, onToggleProject)}
          </div>
          {active ? (
            <div className="shrink-0 border-t border-stroke p-1">
              <button type="button" onClick={onClear} className={FILTER_ROW}>
                <X aria-hidden className="size-3.5 shrink-0 text-content/55" strokeWidth={1.75} />
                Clear filters
              </button>
            </div>
          ) : null}
        </Popover>
      ) : null}
    </>
  );
}

export function TasksToolbar({
  filters,
  tasks,
  projects,
  onChange,
  leading,
  center,
  boardBelow = false,
  trailing,
  wrap = false,
}: {
  /**
   * Zen's narrow panel (L-230): New task, Search and one Filter menu
   * (Status, Project), with `center` on a row of its own below.
   */
  wrap?: boolean;
  filters: TaskFilters;
  tasks: readonly Task[];
  projects: readonly string[];
  onChange: (filters: TaskFilters) => void;
  /** Primary actions shown before the filters (New task). */
  leading?: ReactNode;
  /** Shown centred in the free space between the filters and the view controls (Focus). */
  center?: ReactNode;
  /** The board's own 12px top padding follows: put the row's space above. */
  boardBelow?: boolean;
  /** View controls pinned to the right end of the row. */
  trailing?: ReactNode;
}) {
  const facets = useMemo(
    () => taskFacetCounts(tasks, filters),
    [tasks, filters],
  );
  const statusOptions = useMemo<SearchableSelectOption[]>(
    () => [
      { value: "", label: "All statuses", count: facets.anyStatus },
      ...TASK_STATUSES.map((status) => ({
        value: status,
        label: TASK_STATUS_LABELS[status],
        count: facets.status.get(status) ?? 0,
      })),
    ],
    [facets],
  );
  const projectOptions = useMemo<SearchableSelectOption[]>(
    () => [
      { value: "", label: "All projects", count: facets.anyProject },
      { value: PERSONAL, label: "Personal", count: facets.personal },
      ...projects.map((path) => ({
        value: path,
        label: projectName(path),
        keywords: path,
        count: facets.project.get(pathKey(path)) ?? 0,
      })),
    ],
    [projects, facets],
  );
  const tagOptions = useMemo<SearchableSelectOption[]>(
    () =>
      normalizeNoteTags(tasks.flatMap((task) => task.tags))
        .sort((a, b) => a.localeCompare(b))
        .map((tag) => ({
          value: tag,
          label: `#${tag}`,
          count: facets.tag.get(tag) ?? 0,
        })),
    [tasks, facets],
  );
  const searchInput = useRef<HTMLInputElement>(null);
  const [searchFocused, setSearchFocused] = useState(false);
  const searchOpen = searchFocused || (filters.query ?? "") !== "";
  const tags = filters.tags ?? [];
  const statuses = filters.statuses ?? [];
  const projectValues = (filters.projectCwds ?? []).map((cwd) =>
    cwd === null ? PERSONAL : cwd,
  );
  const toggle = <T,>(list: readonly T[], item: T): T[] =>
    list.includes(item) ? list.filter((entry) => entry !== item) : [...list, item];
  return (
    <>
      {/* px-3 matches the board's p-3 so the edges line up with its columns. */}
      <div
        className={`flex shrink-0 gap-1.5 px-3 ${
          wrap ? "min-h-10 flex-wrap py-1.5" : "h-10"
        } ${boardBelow ? "items-end" : "items-center"}`}
      >
        {leading}
        {/* Collapsed to an icon button; grows into the input on click, focus or
            while a query is set. Width animates because the pill must push the
            neighbouring filters aside. */}
        <div
          className={`relative flex h-7 shrink-0 items-center overflow-hidden rounded-md transition-[width,background-color] duration-200 ease-out motion-reduce:transition-none ${
            searchOpen ? "w-52 bg-content/5" : "w-7 hover:bg-content/10"
          }`}
        >
          <button
            type="button"
            aria-label="Search tasks"
            aria-expanded={searchOpen}
            tabIndex={searchOpen ? -1 : 0}
            onClick={() => {
              setSearchFocused(true);
              searchInput.current?.focus();
            }}
            className={`absolute left-0 top-0 flex size-7 items-center justify-center text-content/60 ${
              searchOpen ? "pointer-events-none" : ""
            }`}
          >
            <Search className="size-3 shrink-0 opacity-70" />
          </button>
          <input
            ref={searchInput}
            value={filters.query ?? ""}
            onChange={(event) =>
              onChange({ ...filters, query: event.target.value })
            }
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            placeholder="Filter tasks"
            aria-label="Filter tasks"
            tabIndex={searchOpen ? 0 : -1}
            spellCheck={false}
            autoComplete="off"
            className={`h-7 w-full rounded-md bg-transparent pl-7 pr-2 text-[12px] text-content outline-none transition-opacity duration-150 placeholder:text-content/40 motion-reduce:transition-none ${
              searchOpen ? "opacity-100" : "opacity-0"
            }`}
          />
        </div>
        {wrap ? (
          <TaskFilterMenu
            statusOptions={statusOptions.slice(1)}
            projectOptions={projectOptions.slice(1)}
            statuses={statuses}
            projects={projectValues}
            active={hasActiveFilters({ ...filters, query: undefined })}
            onToggleStatus={(value) => {
              const status = TASK_STATUSES.find((entry) => entry === value);
              if (!status) return;
              const next = toggle(statuses, status);
              onChange({
                ...filters,
                statuses: TASK_STATUSES.filter((entry) => next.includes(entry)),
              });
            }}
            onToggleProject={(value) => {
              const next = toggle(projectValues, value);
              onChange({
                ...filters,
                projectCwd: undefined,
                projectCwds: next.length
                  ? next.map((entry) => (entry === PERSONAL ? null : entry))
                  : undefined,
              });
            }}
            onClear={() => onChange({ query: filters.query })}
          />
        ) : null}
        {wrap ? null : (
        <>
        <SearchableSelect
          variant="pill"
          label="Status"
          value=""
          options={statusOptions}
          searchable={false}
          multiple={{
            values: statuses,
            summary: (count) => `${count} statuses`,
            onToggle: (value) => {
              const status = TASK_STATUSES.find((entry) => entry === value);
              if (!status) return;
              const next = toggle(statuses, status);
              // Keep the board's column order stable: statuses in default order.
              onChange({
                ...filters,
                statuses: TASK_STATUSES.filter((entry) => next.includes(entry)),
              });
            },
          }}
          onChange={() => onChange({ ...filters, statuses: [] })}
        />
        <SearchableSelect
          variant="pill"
          label="Project"
          value=""
          options={projectOptions}
          searchPlaceholder="Search projects…"
          multiple={{
            values: projectValues,
            summary: (count) => `${count} projects`,
            onToggle: (value) => {
              const next = toggle(projectValues, value);
              onChange({
                ...filters,
                projectCwd: undefined,
                projectCwds: next.length
                  ? next.map((entry) => (entry === PERSONAL ? null : entry))
                  : undefined,
              });
            },
          }}
          onChange={() =>
            onChange({ ...filters, projectCwd: undefined, projectCwds: undefined })
          }
        />
        <SearchableSelect
          variant="pill"
          label="Tag"
          value=""
          options={tagOptions}
          placeholder="Add tag filter…"
          searchPlaceholder="Search tags…"
          emptyLabel="No tags yet"
          onChange={(tag) =>
            onChange({ ...filters, tags: normalizeNoteTags([...tags, tag]) })
          }
        />
        {hasActiveFilters(filters) ? (
          <button
            type="button"
            onClick={() => onChange({})}
            className="h-7 shrink-0 rounded-md px-2 text-[12px] text-content/50 hover:bg-content/10 hover:text-content"
          >
            Reset
          </button>
        ) : null}
        </>
        )}
        {wrap ? null : (
          <div className="flex min-w-0 flex-1 justify-center px-2">
            {center}
          </div>
        )}
        {trailing ? (
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            {trailing}
          </div>
        ) : null}
      </div>
      {wrap && center ? (
        <div className="relative flex shrink-0 justify-center px-3 pb-1.5">
          {center}
        </div>
      ) : null}
      {tags.length ? (
        <div className="flex min-h-7 shrink-0 flex-wrap items-center gap-1.5 px-3 pb-1">
          {tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex h-6 max-w-48 items-center gap-1 rounded-md bg-content/8 pl-2 pr-1 text-[11px] text-content/70"
            >
              <span className="truncate">#{tag}</span>
              <button
                type="button"
                title={`Remove tag filter #${tag}`}
                aria-label={`Remove tag filter #${tag}`}
                onClick={() =>
                  onChange({
                    ...filters,
                    tags: tags.filter((item) => item !== tag),
                  })
                }
                className="grid size-4 shrink-0 place-items-center rounded text-content/40 hover:bg-content/10 hover:text-content"
              >
                <X className="size-2.5" strokeWidth={1.75} />
              </button>
            </span>
          ))}
          {tags.length >= 2 ? (
            <div
              role="group"
              aria-label="Tag matching"
              className="flex rounded-md border border-content/10 bg-content/10 p-0.5"
            >
              {(["all", "any"] as const).map((match) => {
                const selected = (filters.tagMatch ?? "all") === match;
                return (
                  <button
                    key={match}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => onChange({ ...filters, tagMatch: match })}
                    className={`rounded px-2 py-0.5 text-[11px] ${
                      selected
                        ? "bg-selection-strong text-content"
                        : "text-content/45 hover:text-content/80"
                    }`}
                  >
                    {match === "all" ? "Match all" : "Match any"}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

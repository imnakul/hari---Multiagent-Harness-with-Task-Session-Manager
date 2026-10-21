import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { LAYER } from "../../../shared/lib/layers";
import { projectKey, projectName } from "../../../shared/lib/paths";
import { ChevronDown, Search } from "../../../shared/ui/icons";
import {
  ExplorerMenu,
  type ExplorerMenuItem,
} from "../../files/ui/ExplorerMenu";
import { isHarnessId } from "../../sessions/model/models";
import { sessionDisplayTitle } from "../../sessions/model/session";
import type { RecentProject } from "../../projects/model/recents";
import { ProjectIcon, type ProjectMarks } from "../../projects/ui/ProjectMark";
import {
  BOARD_LANES,
  boardLane,
  type BoardCard,
  type BoardLane,
} from "../../session-board/sessionBoard";
import { boardModelLabel } from "../../session-board/ui/BoardSessionCard";

export type FocusPickItem = {
  id: string;
  label: string;
  /** Searched along with the label, e.g. the project name. */
  detail?: string;
  icon?: ReactNode;
  /** Items of one group must be next to each other. */
  group?: string;
  /** The chat's project, for the list's project filter (L-145). */
  project?: { key: string; cwd: string };
  /** The chat's model, shown when the list's "Model" toggle is on (L-145). */
  model?: string;
};

const SHOW_MODEL_KEY = "monocode.focusPickerShowModel.v1";

function loadShowModel(): boolean {
  try {
    return localStorage.getItem(SHOW_MODEL_KEY) === "1";
  } catch {
    return false;
  }
}

function saveShowModel(on: boolean): void {
  try {
    localStorage.setItem(SHOW_MODEL_KEY, on ? "1" : "0");
  } catch {
    // Storage unavailable: the choice still holds while the list is open.
  }
}

/** Distinct projects of the items, in the order they first appear, with the first item's icon. */
export function focusPickProjects(
  items: readonly FocusPickItem[],
): FocusPickProject[] {
  const projects = new Map<string, FocusPickProject>();
  for (const item of items) {
    if (!item.project) continue;
    const seen = projects.get(item.project.key);
    if (!seen)
      projects.set(item.project.key, { ...item.project, icon: item.icon });
    // One folder saved both plain and verbatim (`//?/E:/x`) shows the plain path.
    else if (seen.cwd.startsWith("//?/") && !item.project.cwd.startsWith("//?/"))
      projects.set(item.project.key, { ...seen, cwd: item.project.cwd });
  }
  return [...projects.values()];
}

/** Lanes Continue offers, in this order. In-progress chats join on their own. */
const CONTINUE_LANES: readonly BoardLane[] = [
  "needs_attention",
  "done",
  "draft",
];

/** Every recent project, newest first. */
export function focusProjectItems(
  recents: readonly RecentProject[],
  marks: ProjectMarks,
): FocusPickItem[] {
  return recents.map((recent) => ({
    id: recent.path,
    label: projectName(recent.path),
    detail: recent.path,
    icon: <ProjectIcon cwd={recent.path} {...marks} />,
  }));
}

/**
 * Session Manager cards not running and not already in the grid, one per
 * chat (its newest run), grouped Needs attention, Done, Draft.
 */
export function focusContinueItems(
  cards: readonly BoardCard[],
  inGrid: (sessionId: string) => boolean,
  marks: ProjectMarks,
): FocusPickItem[] {
  const newest = new Map<string, BoardCard>();
  for (const card of cards) {
    if (card.hiddenRunId === card.runId || inGrid(card.sessionId)) continue;
    const seen = newest.get(card.sessionId);
    if (!seen || card.updatedAt > seen.updatedAt)
      newest.set(card.sessionId, card);
  }
  const sorted = [...newest.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  return CONTINUE_LANES.flatMap((lane) =>
    sorted
      .filter((card) => boardLane(card) === lane)
      .map((card) => {
        const harness = isHarnessId(card.harness) ? card.harness : null;
        return {
          id: card.sessionId,
          label: harness
            ? sessionDisplayTitle(card.title, harness)
            : card.title,
          detail: projectName(card.cwd),
          icon: <ProjectIcon cwd={card.cwd} {...marks} />,
          group: BOARD_LANES[lane],
          project: { key: projectKey(card.cwd), cwd: card.cwd },
          model: card.model ? boardModelLabel(harness, card.model) : undefined,
        };
      }),
  );
}

type FocusPickProject = { key: string; cwd: string; icon?: ReactNode };

/** The menu id that clears the project filter. */
const ALL_PROJECTS = "";

/** A project's name, or its full path when another project shares the name. */
function focusProjectLabel(
  projects: readonly FocusPickProject[],
  key: string,
): string {
  const entry = projects.find((project) => project.key === key);
  if (!entry) return "";
  const name = projectName(entry.cwd);
  const clashes = projects.some(
    (other) => other.key !== key && projectName(other.cwd) === name,
  );
  return clashes ? entry.cwd : name;
}

/**
 * The project filter's menu (L-162, L-174): "All projects", then each
 * project with its icon, the current choice checked, as the Notes "File note
 * under…" menu lists them.
 */
export function focusProjectMenuItems(
  projects: readonly FocusPickProject[],
  value: string | null,
): ExplorerMenuItem[] {
  return [
    {
      kind: "item",
      id: ALL_PROJECTS,
      label: "All projects",
      checked: value === null,
    },
    { kind: "sep" },
    ...projects.map(
      (entry): ExplorerMenuItem => ({
        kind: "item",
        id: entry.key,
        label: focusProjectLabel(projects, entry.key),
        icon: entry.icon,
        checked: entry.key === value,
      }),
    ),
  ];
}

/**
 * The project filter's trigger, in the search row before "Model" (L-174).
 * Its menu floats over the popover the list sits in; Popover's dismiss stack
 * keeps a click or Escape in the menu from closing that popover too.
 */
function ProjectFilterMenu({
  projects,
  value,
  onChange,
  onClose,
}: {
  projects: readonly FocusPickProject[];
  value: string | null;
  onChange: (key: string | null) => void;
  /** The menu closed, picked or not, so focus can go back to the search. */
  onClose: () => void;
}): ReactNode {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const triggerId = useId();
  const selected = projects.find((entry) => entry.key === value);
  const close = () => {
    setMenu(null);
    onClose();
  };
  return (
    <>
      <button
        ref={trigger}
        type="button"
        data-focus-project-filter={triggerId}
        aria-haspopup="menu"
        aria-expanded={menu !== null}
        aria-label="Filter by project"
        title={selected?.cwd ?? "Filter by project"}
        onClick={() => {
          if (menu) {
            close();
            return;
          }
          const rect = trigger.current?.getBoundingClientRect();
          if (rect) setMenu({ x: rect.left, y: rect.bottom + 4 });
        }}
        className={`flex h-6 min-w-0 max-w-[45%] shrink items-center gap-1 rounded-md px-1.5 text-[11px] font-medium transition-[background-color,color,scale] duration-100 hover:bg-content/8 hover:text-content focus-visible:bg-content/8 focus-visible:outline-none active:scale-96 motion-reduce:active:scale-100 ${
          selected || menu ? "bg-content/8 text-content" : "text-content/50"
        }`}
      >
        {selected?.icon ? (
          <span aria-hidden className="grid size-3 shrink-0 place-items-center">
            {selected.icon}
          </span>
        ) : null}
        <span className="min-w-0 truncate">
          {selected ? focusProjectLabel(projects, selected.key) : "All projects"}
        </span>
        <ChevronDown
          aria-hidden
          className={`size-3 shrink-0 text-content/45 transition-transform duration-150 ease-out motion-reduce:transition-none ${
            menu ? "rotate-180" : ""
          }`}
          strokeWidth={1.75}
        />
      </button>
      {menu ? (
        <ExplorerMenu
          x={menu.x}
          y={menu.y}
          width={240}
          layer={LAYER.submenu}
          ignore={`[data-focus-project-filter="${triggerId}"]`}
          ariaLabel="Filter by project"
          header={
            <p className="px-2 py-1 text-[11px] text-content/50">
              Show chats from…
            </p>
          }
          items={focusProjectMenuItems(projects, value)}
          onPick={(id) => {
            onChange(id === ALL_PROJECTS ? null : id);
            close();
          }}
          onClose={close}
        />
      ) : null}
    </>
  );
}

/**
 * A search box over a list, with the combobox keyboard contract: arrows and
 * Home/End move, Enter picks. Escape is left to the surface around it.
 * Items from more than one project get a project dropdown to narrow the list
 * (L-162), and items with a model get a "Model" toggle that shows it on each
 * row (L-145).
 */
export function FocusSearchList({
  items,
  label,
  placeholder,
  emptyLabel,
  autoFocus = true,
  onPick,
  className = "",
}: {
  items: readonly FocusPickItem[];
  label: string;
  placeholder: string;
  emptyLabel: string;
  autoFocus?: boolean;
  onPick: (id: string) => void;
  className?: string;
}): ReactNode {
  const [query, setQuery] = useState("");
  const [projectFilter, setProjectFilter] = useState<string | null>(null);
  const [showModel, setShowModel] = useState(loadShowModel);
  const projects = useMemo(() => focusPickProjects(items), [items]);
  const hasModels = items.some((item) => item.model);
  // A project that left the list (its last chat was picked) clears the filter.
  const project =
    projectFilter && projects.some((entry) => entry.key === projectFilter)
      ? projectFilter
      : null;
  const [active, setActive] = useState(0);
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  const activeOption = useRef<HTMLButtonElement>(null);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const inProject = project
      ? items.filter((item) => item.project?.key === project)
      : items;
    if (!needle) return inProject;
    return inProject.filter((item) =>
      [item.label, item.detail ?? "", item.group ?? "", item.model ?? ""].some(
        (text) => text.toLowerCase().includes(needle),
      ),
    );
  }, [items, query, project]);
  const activeIndex = Math.min(active, Math.max(0, filtered.length - 1));

  useEffect(() => {
    if (autoFocus) input.current?.focus();
  }, [autoFocus]);
  useEffect(() => {
    activeOption.current?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const last = filtered.length - 1;
    const move = (index: number) => {
      event.preventDefault();
      setActive(Math.max(0, Math.min(last, index)));
    };
    if (event.key === "ArrowDown") move(activeIndex + 1);
    else if (event.key === "ArrowUp") move(activeIndex - 1);
    else if (event.key === "Home") move(0);
    else if (event.key === "End") move(last);
    else if (event.key === "Enter" && filtered[activeIndex]) {
      event.preventDefault();
      onPick(filtered[activeIndex].id);
    }
  };

  return (
    <div className={`flex min-h-0 flex-col ${className}`}>
      <label className="flex h-8 shrink-0 items-center gap-2 border-b border-stroke px-2.5 text-content/45 focus-within:text-content/70">
        <Search aria-hidden className="size-3.5 shrink-0" strokeWidth={1.75} />
        <input
          ref={input}
          role="combobox"
          aria-label={placeholder}
          aria-expanded="true"
          aria-autocomplete="list"
          aria-controls={listId}
          aria-activedescendant={
            filtered[activeIndex] ? `${listId}-${activeIndex}` : undefined
          }
          value={query}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          className="min-w-0 flex-1 bg-transparent text-[12px] text-content outline-none placeholder:text-content/35"
        />
        {projects.length > 1 ? (
          <ProjectFilterMenu
            projects={projects}
            value={project}
            onChange={(key) => {
              setProjectFilter(key);
              setActive(0);
            }}
            onClose={() => input.current?.focus()}
          />
        ) : null}
        {hasModels ? (
          <button
            type="button"
            aria-pressed={showModel}
            title="Show each chat's model"
            onClick={() => {
              const next = !showModel;
              saveShowModel(next);
              setShowModel(next);
            }}
            className={`-mr-1 flex h-6 shrink-0 items-center rounded-md px-1.5 text-[11px] font-medium transition-[background-color,color,scale] duration-100 hover:bg-content/8 hover:text-content focus-visible:bg-content/8 focus-visible:outline-none active:scale-96 motion-reduce:active:scale-100 ${
              showModel ? "bg-content/8 text-content" : "text-content/50"
            }`}
          >
            Model
          </button>
        ) : null}
      </label>
      <div
        id={listId}
        role="listbox"
        aria-label={label}
        className="min-h-0 flex-1 overflow-y-auto overscroll-none p-1"
      >
        {filtered.length > 0 ? (
          filtered.map((item, index) => {
            const highlighted = index === activeIndex;
            const heading =
              item.group && item.group !== filtered[index - 1]?.group
                ? item.group
                : null;
            return (
              <div key={item.id} role="presentation">
                {heading ? (
                  <div
                    role="presentation"
                    className="px-2 pt-2 pb-1 text-[11px] font-medium text-content/40"
                  >
                    {heading}
                  </div>
                ) : null}
                <button
                  ref={highlighted ? activeOption : undefined}
                  id={`${listId}-${index}`}
                  type="button"
                  role="option"
                  tabIndex={-1}
                  aria-selected={highlighted}
                  title={item.detail}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => onPick(item.id)}
                  className={`flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] leading-none transition-colors duration-100 ${
                    highlighted
                      ? "bg-selection text-content"
                      : "text-content/75 hover:bg-content/5 hover:text-content"
                  }`}
                >
                  {item.icon ? (
                    <span className="grid size-3.5 shrink-0 place-items-center">
                      {item.icon}
                    </span>
                  ) : null}
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  {showModel && item.model ? (
                    <span
                      title={item.model}
                      className="max-w-[35%] shrink-0 truncate rounded bg-content/6 px-1.5 py-0.5 text-[11px] text-content/60"
                    >
                      {item.model}
                    </span>
                  ) : null}
                  {item.group && item.detail && !project ? (
                    <span className="max-w-[40%] shrink-0 truncate text-[11px] text-content/40">
                      {item.detail}
                    </span>
                  ) : null}
                </button>
              </div>
            );
          })
        ) : (
          <p className="px-2 py-3 text-center text-[12px] text-content/45">
            {emptyLabel}
          </p>
        )}
      </div>
    </div>
  );
}

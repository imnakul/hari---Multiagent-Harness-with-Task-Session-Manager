import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { projectName } from "../../../shared/lib/paths";
import { Search } from "../../../shared/ui/icons";
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

export type FocusPickItem = {
  id: string;
  label: string;
  /** Searched along with the label, e.g. the project name. */
  detail?: string;
  icon?: ReactNode;
  /** Items of one group must be next to each other. */
  group?: string;
};

/** Lanes Continue offers, in this order. In-progress chats join on their own. */
const CONTINUE_LANES: readonly BoardLane[] = ["needs_attention", "done", "draft"];

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
      .map((card) => ({
        id: card.sessionId,
        label: isHarnessId(card.harness)
          ? sessionDisplayTitle(card.title, card.harness)
          : card.title,
        detail: projectName(card.cwd),
        icon: <ProjectIcon cwd={card.cwd} {...marks} />,
        group: BOARD_LANES[lane],
      })),
  );
}

/**
 * A search box over a list, with the combobox keyboard contract: arrows and
 * Home/End move, Enter picks. Escape is left to the surface around it.
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
  const [active, setActive] = useState(0);
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  const activeOption = useRef<HTMLButtonElement>(null);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((item) =>
      [item.label, item.detail ?? "", item.group ?? ""].some((text) =>
        text.toLowerCase().includes(needle),
      ),
    );
  }, [items, query]);
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
                  {item.group && item.detail ? (
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

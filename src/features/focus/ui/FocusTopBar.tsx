import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { MOD } from "../../../platform/tauri/platform";
import { Popover } from "../../../shared/ui/Popover";
import {
  ArrowDownCircle,
  ChevronDown,
  MessageMultiple,
  Plus,
} from "../../../shared/ui/icons";
import { FocusSearchList, type FocusPickItem } from "./FocusPicker";

type NewView = "menu" | "start" | "continue";

export type FocusNewActions = {
  projectItems: readonly FocusPickItem[];
  continueItems: readonly FocusPickItem[];
  onStartNew: (cwd: string) => void;
  onContinue: (sessionId: string) => void;
  /** Absent when no provider can import (Resume session, L-71). */
  onImport?: () => void;
};

const MENU_ROW =
  "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors duration-100 hover:bg-content/5 focus-visible:bg-content/5 focus-visible:outline-none";

/** The three ways to add a chat, as menu rows or the empty screen's cards. */
export const FOCUS_NEW_OPTIONS = [
  {
    id: "start",
    label: "Start new",
    description: "A new chat in any project",
    Icon: Plus,
  },
  {
    id: "continue",
    label: "Continue",
    description: "A chat that is done, waiting or drafted",
    Icon: MessageMultiple,
  },
  {
    id: "import",
    label: "Import",
    description: "Resume a conversation from a provider's CLI",
    Icon: ArrowDownCircle,
  },
] as const;

/** Moves focus between the menu's rows with the arrow keys and Home/End. */
function onMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
  const rows = [
    ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
      "[role=menuitem]:not([disabled])",
    ),
  ];
  const at = rows.findIndex((row) => row === document.activeElement);
  const go = (index: number) => {
    event.preventDefault();
    rows[(index + rows.length) % rows.length]?.focus();
  };
  if (event.key === "ArrowDown") go(at + 1);
  else if (event.key === "ArrowUp") go(at < 0 ? rows.length - 1 : at - 1);
  else if (event.key === "Home") go(0);
  else if (event.key === "End") go(rows.length - 1);
}

/**
 * "New" split button (L-123): the main half starts a chat in the focused
 * pane's project; the arrow offers Start new, Continue and Import, with the
 * project and chat lists opening in the same menu.
 */
export function FocusNewButton({
  onNewChat,
  ...actions
}: FocusNewActions & { onNewChat: () => void }): ReactNode {
  const [view, setView] = useState<NewView | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const arrow = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (view === "menu")
      menu.current?.querySelector<HTMLButtonElement>("[role=menuitem]")?.focus();
  }, [view]);

  const close = (restore: boolean) => {
    setView(null);
    if (restore) arrow.current?.focus();
  };
  const choose = (id: (typeof FOCUS_NEW_OPTIONS)[number]["id"]) => {
    if (id === "import") {
      close(false);
      actions.onImport?.();
      return;
    }
    setView(id);
  };

  return (
    <div
      ref={root}
      data-focus-new
      className="flex h-7 shrink-0 items-stretch overflow-hidden rounded-md bg-content/6 text-content/75"
    >
      <button
        type="button"
        title={`New chat (${MOD}T)`}
        data-tauri-drag-region="false"
        onClick={onNewChat}
        className="flex items-center gap-1.5 pr-2 pl-2 text-[12px] font-medium transition-[background-color,color,scale] duration-100 hover:bg-content/8 hover:text-content focus-visible:bg-content/8 focus-visible:outline-none active:scale-96 motion-reduce:active:scale-100"
      >
        <Plus aria-hidden className="size-3.5" strokeWidth={1.75} />
        New
      </button>
      <span aria-hidden className="my-1.5 w-px bg-content/12" />
      <button
        ref={arrow}
        type="button"
        aria-label="More ways to add a chat"
        title="Start new, Continue or Import"
        aria-haspopup="menu"
        aria-expanded={view !== null}
        data-tauri-drag-region="false"
        onClick={() => (view ? close(false) : setView("menu"))}
        className={`grid w-6 place-items-center transition-colors duration-100 hover:bg-content/8 hover:text-content focus-visible:bg-content/8 focus-visible:outline-none ${
          view ? "bg-content/8 text-content" : ""
        }`}
      >
        <ChevronDown
          aria-hidden
          className={`size-3 transition-transform duration-150 ease-out motion-reduce:transition-none ${
            view ? "rotate-180" : ""
          }`}
          strokeWidth={1.75}
        />
      </button>
      {view ? (
        <Popover
          anchor={root}
          side="bottom"
          align="start"
          width={view === "menu" ? 264 : 320}
          maxHeight={380}
          ignore="[data-focus-new]"
          onDismiss={(reason) => close(reason === "escape")}
          role={view === "menu" ? "menu" : "dialog"}
          aria-label={
            view === "menu"
              ? "Add a chat"
              : view === "start"
                ? "Start new in a project"
                : "Continue a chat"
          }
          className="flex flex-col overflow-hidden"
        >
          {view === "menu" ? (
            <div ref={menu} className="p-1" onKeyDown={onMenuKeyDown}>
              {FOCUS_NEW_OPTIONS.map(({ id, label, description, Icon }) => (
                <button
                  key={id}
                  type="button"
                  role="menuitem"
                  disabled={id === "import" && !actions.onImport}
                  onClick={() => choose(id)}
                  className={`${MENU_ROW} disabled:opacity-40`}
                >
                  <Icon
                    aria-hidden
                    className="size-3.5 shrink-0 text-content/55"
                    strokeWidth={1.75}
                  />
                  <span className="min-w-0">
                    <span className="block text-[13px] text-content">{label}</span>
                    <span className="block truncate text-[11px] text-content/45">
                      {description}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          ) : view === "start" ? (
            <FocusSearchList
              className="h-[320px]"
              items={actions.projectItems}
              label="Projects"
              placeholder="Search projects"
              emptyLabel="No projects"
              onPick={(cwd) => {
                close(false);
                actions.onStartNew(cwd);
              }}
            />
          ) : (
            <FocusSearchList
              className="h-[320px]"
              items={actions.continueItems}
              label="Chats"
              placeholder="Search chats"
              emptyLabel="No chats to continue"
              onPick={(id) => {
                close(false);
                actions.onContinue(id);
              }}
            />
          )}
        </Popover>
      ) : null}
    </div>
  );
}

/**
 * "+N more": chats that do not fit (past 8, or past the columns a narrow
 * window shows). Picking one trades it with the focused pane.
 */
export function FocusMoreButton({
  items,
  onPick,
}: {
  items: readonly FocusPickItem[];
  onPick: (sessionId: string) => void;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <div ref={root} data-focus-more className="flex h-7 shrink-0">
      <button
        ref={trigger}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${items.length} more chats`}
        title="Chats that do not fit on screen"
        data-tauri-drag-region="false"
        onClick={() => setOpen((value) => !value)}
        className={`rounded-md px-2 text-[12px] font-medium tabular-nums transition-[background-color,color,scale] duration-100 hover:bg-content/8 hover:text-content focus-visible:bg-content/8 focus-visible:outline-none active:scale-96 motion-reduce:active:scale-100 ${
          open ? "bg-content/8 text-content" : "text-content/60"
        }`}
      >
        +{items.length} more
      </button>
      {open ? (
        <Popover
          anchor={root}
          side="bottom"
          align="start"
          width={320}
          maxHeight={380}
          ignore="[data-focus-more]"
          onDismiss={(reason) => {
            setOpen(false);
            if (reason === "escape") trigger.current?.focus();
          }}
          role="dialog"
          aria-label="More chats"
          className="flex flex-col overflow-hidden"
        >
          <FocusSearchList
            className="max-h-[320px]"
            items={items}
            label="More chats"
            placeholder="Search chats"
            emptyLabel="No matching chats"
            onPick={(id) => {
              setOpen(false);
              onPick(id);
            }}
          />
        </Popover>
      ) : null}
    </div>
  );
}

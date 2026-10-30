import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ExplorerMenu,
  type ExplorerMenuItem,
} from "../../features/files/ui/ExplorerMenu";
import { ALT, MOD, SHIFT } from "../../platform/tauri/platform";
import { runUpdateFlow } from "../model/updater";
import { SharedHoverHighlight } from "../../features/sessions/ui/SharedHoverHighlight";
import { togglePerfDebug } from "../../shared/debug/perfDebug";
import {
  keybindingPressed,
  keybindingShortcutLabel,
  loadAutosave,
  MENU_BAR_TOGGLE_COMMAND,
  PERF_OVERLAY_COMMAND,
  loadKeybindingOverrides,
  saveAutosave,
  subscribeAutosave,
  subscribeKeybindings,
} from "../../features/settings/model/settings";

type MenuKey = "file" | "view" | "terminal";

const MENU_BAR_VISIBLE_KEY = "monocode.menuBarVisible";

/** The menu bar shows unless the user hid it with View: Toggle Menu Bar. */
function loadMenuBarVisible(): boolean {
  try {
    return localStorage.getItem(MENU_BAR_VISIBLE_KEY) !== "false";
  } catch {
    return true;
  }
}

function saveMenuBarVisible(visible: boolean): void {
  try {
    localStorage.setItem(MENU_BAR_VISIBLE_KEY, String(visible));
  } catch {
    /* storage unavailable: the choice just won't persist */
  }
}

type Props = {
  onNew: () => void;
  onNewTerminal?: () => void;
  onToggleTerminal?: () => void;
  onGoToFile?: () => void;
  onToggleSidebar: () => void;
  onToggleSessionSidebar: () => void;
  onShowSourceControl?: () => void;
  onCloseCurrentTab?: () => void;
  onCloseOtherTabs?: () => void;
  onCloseAllTabs?: () => void;
  onPickProject?: () => void;
  onFindInProject?: () => void;
  onSearch?: () => void;
  onOpenInbox?: () => void;
  onOpenNotes?: () => void;
  onOpenTasks?: () => void;
  onOpenWhiteboard?: () => void;
  onOpenKanban?: () => void;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  onZoomReset?: () => void;
};

export function MenuBar({
  onNew,
  onNewTerminal,
  onToggleTerminal,
  onGoToFile,
  onToggleSidebar,
  onToggleSessionSidebar,
  onShowSourceControl,
  onCloseCurrentTab,
  onCloseOtherTabs,
  onCloseAllTabs,
  onPickProject,
  onFindInProject,
  onSearch,
  onOpenInbox,
  onOpenNotes,
  onOpenTasks,
  onOpenWhiteboard,
  onOpenKanban,
  onZoomIn,
  onZoomOut,
  onZoomReset,
}: Props) {
  const [visible, setVisible] = useState(loadMenuBarVisible);
  const [activeMenu, setActiveMenu] = useState<MenuKey | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<{ x: number; y: number } | null>(
    null,
  );
  const [, refreshShortcuts] = useState(loadKeybindingOverrides);
  const [autosave, setAutosave] = useState(loadAutosave);
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(
    () =>
      subscribeKeybindings(() => refreshShortcuts(loadKeybindingOverrides())),
    [],
  );

  useEffect(
    () => subscribeAutosave(() => setAutosave(loadAutosave())),
    [],
  );

  const shortcut = (command: string, keys: string) =>
    keybindingShortcutLabel(command, keys) ?? undefined;

  const toggleVisible = useCallback(() => {
    setActiveMenu(null);
    setMenuAnchor(null);
    setVisible((current) => {
      saveMenuBarVisible(!current);
      return !current;
    });
  }, []);

  // View: Toggle Menu Bar (Alt+O by default, rebindable in Keybindings).
  // The listener stays mounted while the bar is hidden so it can come back.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || event.repeat) return;
      const defaultMatch =
        event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.shiftKey &&
        event.code === "KeyO";
      if (!keybindingPressed(MENU_BAR_TOGGLE_COMMAND, event, defaultMatch))
        return;
      event.preventDefault();
      toggleVisible();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggleVisible]);

  const openDropdown = useCallback((key: MenuKey, target: HTMLElement) => {
    const rect = target.getBoundingClientRect();
    setActiveMenu(key);
    setMenuAnchor({ x: rect.left, y: rect.bottom + 2 });
  }, []);

  const closeMenu = useCallback(() => {
    setActiveMenu(null);
    setMenuAnchor(null);
  }, []);

  const handlePick = useCallback(
    (id: string) => {
      closeMenu();

      switch (id) {
        case "new_tab":
          onNew();
          break;
        case "new_terminal":
          onNewTerminal?.();
          break;
        case "toggle_terminal":
          onToggleTerminal?.();
          break;
        case "new_window":
          void invoke("open_new_window").catch(() => {});
          break;
        case "open_project":
          onPickProject?.();
          break;
        case "open_search":
          onSearch?.();
          break;
        case "open_inbox":
          onOpenInbox?.();
          break;
        case "open_kanban":
          onOpenKanban?.();
          break;
        case "open_whiteboard":
          onOpenWhiteboard?.();
          break;
        case "open_tasks":
          onOpenTasks?.();
          break;
        case "open_notes":
          onOpenNotes?.();
          break;
        case "go_to_file":
          onGoToFile?.();
          break;
        case "find_in_project":
          onFindInProject?.();
          break;
        case "close_tab":
          onCloseCurrentTab?.();
          break;
        case "close_other_tabs":
          onCloseOtherTabs?.();
          break;
        case "close_all_tabs":
          onCloseAllTabs?.();
          break;
        case "toggle_autosave": {
          const next = saveAutosave(!loadAutosave());
          setAutosave(next);
          break;
        }
        case "toggle_sidebar":
          onToggleSidebar();
          break;
        case "toggle_menu_bar":
          toggleVisible();
          break;
        case "toggle_perf_overlay":
          togglePerfDebug();
          break;
        case "toggle_session_sidebar":
          onToggleSessionSidebar();
          break;
        case "open_model_picker":
          window.dispatchEvent(new Event("open_model_picker"));
          break;
        case "toggle_diff":
          onShowSourceControl?.();
          break;
        case "check_for_updates":
          void runUpdateFlow(true);
          break;
        case "zoom_in":
          onZoomIn?.();
          break;
        case "zoom_out":
          onZoomOut?.();
          break;
        case "zoom_reset":
          onZoomReset?.();
          break;
      }
    },
    [
      closeMenu,
      autosave,
      onCloseCurrentTab,
      onCloseOtherTabs,
      onCloseAllTabs,
      onFindInProject,
      onGoToFile,
      onNew,
      onNewTerminal,
      onToggleTerminal,
      onPickProject,
      onSearch,
      onOpenInbox,
      onOpenNotes,
      onOpenTasks,
      onOpenWhiteboard,
      onOpenKanban,
      onShowSourceControl,
      onToggleSidebar,
      onToggleSessionSidebar,
      onZoomIn,
      onZoomOut,
      onZoomReset,
      toggleVisible,
    ],
  );

  const getMenuItems = (key: MenuKey): ExplorerMenuItem[] => {
    switch (key) {
      case "file":
        return [
          {
            kind: "item",
            id: "new_tab",
            label: "New Tab",
            shortcut: shortcut("Tab: New", `${MOD}T`),
          },
          {
            kind: "item",
            id: "new_terminal",
            label: "New Terminal",
            shortcut: shortcut("Terminal: New", `${MOD}\``),
          },
          {
            kind: "item",
            id: "new_window",
            label: "New Window",
            shortcut: shortcut("App: New Window", `${MOD}${SHIFT}N`),
          },
          { kind: "sep" },
          {
            kind: "item",
            id: "toggle_autosave",
            label: "Autosave",
            checked: autosave,
          },
          { kind: "sep" },
          {
            kind: "item",
            id: "open_project",
            label: "Open Project…",
            shortcut: shortcut("App: Open Project", `${MOD}O`),
          },
          {
            kind: "item",
            id: "open_search",
            label: "Search…",
            shortcut: shortcut("App: Search", `${MOD}K`),
          },
          {
            kind: "item",
            id: "go_to_file",
            label: "Go to File…",
            shortcut: shortcut("App: Go to File", `${MOD}P`),
          },
          {
            kind: "item",
            id: "find_in_project",
            label: "Find in Files…",
            shortcut: shortcut("App: Find in Files", `${MOD}${SHIFT}F`),
          },
          { kind: "sep" },
          {
            kind: "item",
            id: "close_tab",
            label: "Close Pane",
            shortcut: shortcut("Pane: Close", `${MOD}W`),
          },
          {
            kind: "item",
            id: "close_other_tabs",
            label: "Close Other Tabs",
            shortcut: shortcut("Tab: Close Others", `${MOD}${ALT}T`),
          },
          {
            kind: "item",
            id: "close_all_tabs",
            label: "Close All Tabs",
            shortcut: shortcut("Tab: Close All", `${MOD}${SHIFT}W`),
          },
          { kind: "sep" },
          {
            kind: "item",
            id: "check_for_updates",
            label: "Check for Updates…",
          },
        ];
      case "view":
        return [
          {
            kind: "item",
            id: "toggle_sidebar",
            label: "Toggle Sidebar",
            shortcut: shortcut("App: Toggle Sidebar", `${MOD}B`),
          },
          {
            kind: "item",
            id: "toggle_session_sidebar",
            label: "Toggle Session Sidebar",
            shortcut: shortcut(
              "App: Toggle Session Sidebar",
              `${MOD}${SHIFT}B`,
            ),
          },
          {
            kind: "item",
            id: "toggle_menu_bar",
            label: "Hide Menu Bar",
            shortcut: shortcut(MENU_BAR_TOGGLE_COMMAND, `${ALT}O`),
          },
          {
            kind: "item",
            id: "toggle_perf_overlay",
            label: "Performance Overlay",
            shortcut: shortcut(PERF_OVERLAY_COMMAND, `${MOD}${ALT}${SHIFT}P`),
          },
          { kind: "item", id: "open_inbox", label: "Inbox" },
          ...(onOpenKanban ? [{ kind: "item" as const, id: "open_kanban", label: "Session Manager" }] : []),
          ...(onOpenTasks ? [{ kind: "item" as const, id: "open_tasks", label: "Task Manager" }] : []),
          ...(onOpenWhiteboard
            ? [{ kind: "item" as const, id: "open_whiteboard", label: "Whiteboard" }]
            : []),
          ...(onOpenNotes
            ? [{ kind: "item" as const, id: "open_notes", label: "Notes" }]
            : []),
          {
            kind: "item",
            id: "toggle_terminal",
            label: "Toggle Terminal",
            shortcut: shortcut("Terminal: Toggle Dock", `${MOD}J`),
          },
          {
            kind: "item",
            id: "open_model_picker",
            label: "Switch Model…",
            shortcut: shortcut("App: Switch Model", `${MOD}.`),
          },
          { kind: "item", id: "toggle_diff", label: "Toggle Changes" },
          { kind: "sep" },
          {
            kind: "item",
            id: "zoom_in",
            label: "Zoom In",
            shortcut: shortcut("View: Zoom In", `${MOD}+`),
          },
          {
            kind: "item",
            id: "zoom_out",
            label: "Zoom Out",
            shortcut: shortcut("View: Zoom Out", `${MOD}-`),
          },
          {
            kind: "item",
            id: "zoom_reset",
            label: "Reset Zoom",
            shortcut: shortcut("View: Reset Zoom", `${MOD}0`),
          },
        ];
      case "terminal":
        return [
          {
            kind: "item",
            id: "new_terminal",
            label: "New Terminal",
            shortcut: shortcut("Terminal: New", `${MOD}\``),
          },
          {
            kind: "item",
            id: "toggle_terminal",
            label: "Toggle Terminal",
            shortcut: shortcut("Terminal: Toggle Dock", `${MOD}J`),
          },
        ];
    }
  };


  const MENUS: { key: MenuKey; label: string }[] = [
    { key: "file", label: "File" },
    { key: "view", label: "View" },
    { key: "terminal", label: "Terminal" },
  ];

  if (!visible) return null;

  return (
    <div
      ref={barRef}
      className="flex h-7 shrink-0 items-center gap-0.5 border-b border-stroke bg-content/5 px-2 text-[12px]"
      data-tauri-drag-region="false"
    >
      <SharedHoverHighlight />
      {/* Only the menu titles: crossing their small gaps keeps the highlight
          gliding, while the empty bar beyond them still clears it. */}
      <div data-shared-hover-continuity className="flex items-center gap-0.5">
        {MENUS.map(({ key, label }) => {
          const isActive = activeMenu === key;
          return (
            <button
              key={key}
              type="button"
              data-shared-hover-item
              data-shared-hover-preserve={isActive ? "" : undefined}
              data-tauri-drag-region="false"
              onClick={(e) => {
                if (isActive) {
                  closeMenu();
                } else {
                  openDropdown(key, e.currentTarget);
                }
              }}
              onMouseEnter={(e) => {
                if (activeMenu && activeMenu !== key) {
                  openDropdown(key, e.currentTarget);
                }
              }}
              className={`rounded px-2 py-0.5 transition-colors ${
                isActive
                  ? "bg-selection-hover text-content"
                  : "text-content/70 hover:bg-content/10 hover:text-content"
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>

      {activeMenu && menuAnchor ? (
        <ExplorerMenu
          x={menuAnchor.x}
          y={menuAnchor.y}
          items={getMenuItems(activeMenu)}
          ariaLabel={`${activeMenu} menu`}
          onPick={handlePick}
          onClose={closeMenu}
        />
      ) : null}
    </div>
  );
}

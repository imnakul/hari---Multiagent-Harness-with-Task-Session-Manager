import type { JSX } from "react";
import { SharedHoverHighlight } from "../../sessions/ui/SharedHoverHighlight";
import { X } from "../../../shared/ui/icons";
import { sameProjectPath } from "../model/recents";
import { CurrentProjectIcon, useProjectLabel } from "./CurrentProjectIcon";

/**
 * Projects kept beside the inset sidebar's project name (L-130). Clicking one
 * switches to it; × or a middle-click removes it. The current project stays
 * in its place, marked selected, so switching never reorders the row.
 */
export function ProjectTabs({
  paths,
  currentPath,
  isBusy,
  onSelect,
  onClose,
  onContextMenu,
}: {
  paths: readonly string[];
  currentPath: string;
  isBusy: (path: string) => boolean;
  onSelect: (path: string) => void;
  onClose: (path: string) => void;
  onContextMenu?: (
    path: string,
    x: number,
    y: number,
    trigger: HTMLElement,
  ) => void;
}): JSX.Element | null {
  if (!paths.length) return null;
  return (
    <div
      role="group"
      aria-label="Project tabs"
      data-tauri-drag-region="false"
      className="relative ml-1 flex min-w-0 shrink items-center gap-0.5 overflow-x-auto scrollbar-none"
    >
      <SharedHoverHighlight />
      {paths.map((path) => (
        <ProjectTab
          key={path}
          path={path}
          current={sameProjectPath(path, currentPath)}
          busy={isBusy(path)}
          onSelect={onSelect}
          onClose={onClose}
          onContextMenu={onContextMenu}
        />
      ))}
    </div>
  );
}

function ProjectTab({
  path,
  current,
  busy,
  onSelect,
  onClose,
  onContextMenu,
}: {
  path: string;
  current: boolean;
  busy: boolean;
  onSelect: (path: string) => void;
  onClose: (path: string) => void;
  onContextMenu?: (
    path: string,
    x: number,
    y: number,
    trigger: HTMLElement,
  ) => void;
}): JSX.Element {
  const label = useProjectLabel(path);
  return (
    <div
      data-shared-hover-item
      data-shared-hover-preserve={current ? "" : undefined}
      className={`group/tab relative flex h-6 max-w-28 shrink-0 items-center rounded-md ${current ? "bg-content/8 text-content" : "text-content/60 hover:text-content focus-within:text-content"}`}
      onAuxClick={(event) => {
        if (event.button !== 1) return;
        event.preventDefault();
        onClose(path);
      }}
    >
      <button
        type="button"
        title={`${label}\n${path}`}
        aria-label={current ? label : `Switch to ${label}`}
        aria-current={current ? "true" : undefined}
        onClick={() => {
          if (!current) onSelect(path);
        }}
        onContextMenu={
          onContextMenu
            ? (event) => {
                event.preventDefault();
                event.stopPropagation();
                onContextMenu(
                  path,
                  event.clientX,
                  event.clientY,
                  event.currentTarget,
                );
              }
            : undefined
        }
        className="flex h-full min-w-0 items-center gap-1.5 rounded-md pl-1.5 pr-1 text-[12px] font-medium outline-none focus-visible:ring-1 focus-visible:ring-content/30"
      >
        <CurrentProjectIcon
          cwd={path}
          busy={busy}
          className="size-4"
          mascotClassName="size-2.5"
        />
        <span className="min-w-0 truncate">{label}</span>
      </button>
      <button
        type="button"
        aria-label={`Remove ${label} tab`}
        title="Remove tab"
        onClick={() => onClose(path)}
        className="mr-0.5 grid size-4 shrink-0 place-items-center rounded text-content/45 opacity-0 transition-opacity duration-100 hover:bg-content/10 hover:text-content focus-visible:opacity-100 group-hover/tab:opacity-100"
      >
        <X className="size-3" strokeWidth={1.75} />
      </button>
    </div>
  );
}

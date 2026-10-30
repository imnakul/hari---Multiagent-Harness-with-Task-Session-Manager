import { useEffect, useRef, useState, type ReactNode } from "react";
import { Popover } from "../../../shared/ui/Popover";
import {
  AiChat,
  Check,
  ChevronDown,
  Clean,
  Cursor,
  Download,
  FitScreen,
  FolderOpen,
  Grid,
  Hand,
  Lock,
  Magnet,
  MoreHorizontal,
  Pencil,
  Plus,
  SelectAll,
  SmilePlus,
  TextFont,
  Trash2,
  Unlock,
  Whiteboard,
  ZoomIn,
  ZoomOut,
} from "../../../shared/ui/icons";
import { sortedSheets, type WhiteboardSheet } from "../model/sheets";
import { WHITEBOARD_FONTS, whiteboardFont } from "../model/whiteboardFonts";

export type ExportKind = "png" | "svg" | "excalidraw";

const ICON_BUTTON =
  "flex size-7 shrink-0 items-center justify-center rounded-md transition-[background-color,color,transform] duration-100 ease-out hover:bg-content/10 hover:text-content active:scale-96 disabled:pointer-events-none disabled:opacity-35";
const MENU_ITEM =
  "flex h-8 w-full items-center gap-2 rounded-lg px-2 text-left text-[13px] text-content/80 hover:bg-content/10 hover:text-content disabled:opacity-40";

function ToolButton({
  label,
  pressed,
  disabled,
  onClick,
  children,
}: {
  label: string;
  pressed?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className={`${ICON_BUTTON} ${pressed ? "bg-content/10 text-accent" : "text-content/60"}`}
    >
      {children}
    </button>
  );
}

const Divider = () => <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-content/10" />;

function relativeTime(at: number, now = Date.now()): string {
  const minutes = Math.round((now - at) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(at).toLocaleDateString();
}

function SheetName({
  name,
  onRename,
}: {
  name: string;
  onRename: (name: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!editing) setValue(name);
  }, [name, editing]);
  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);
  const finish = (save: boolean) => {
    setEditing(false);
    if (save && value.trim() && value.trim() !== name) onRename(value);
    else setValue(name);
  };
  if (editing) {
    return (
      <input
        ref={input}
        value={value}
        maxLength={80}
        aria-label="Sheet name"
        onChange={(event) => setValue(event.target.value)}
        onBlur={() => finish(true)}
        onKeyDown={(event) => {
          if (event.key === "Enter") finish(true);
          if (event.key === "Escape") {
            event.stopPropagation();
            finish(false);
          }
        }}
        className="h-7 w-48 min-w-0 rounded-md border border-content/20 bg-content/5 px-2 text-[13px] text-content outline-none focus:border-accent/60"
      />
    );
  }
  return (
    <button
      type="button"
      title="Rename sheet (double-click)"
      onDoubleClick={() => setEditing(true)}
      onKeyDown={(event) => {
        if (event.key === "F2" || event.key === "Enter") setEditing(true);
      }}
      onClick={(event) => {
        if (event.detail === 0) setEditing(true);
      }}
      className="group flex h-7 min-w-0 max-w-[220px] items-center gap-1.5 rounded-md px-1.5 text-[13px] text-content hover:bg-content/10"
    >
      <span className="min-w-0 truncate">{name}</span>
      <Pencil
        aria-hidden
        className="size-3 shrink-0 text-content/0 transition-colors duration-100 group-hover:text-content/45"
        onClick={(event) => {
          event.stopPropagation();
          setEditing(true);
        }}
      />
    </button>
  );
}

export function WhiteboardTopBar({
  sheets,
  sheet,
  activeTool,
  fontId,
  grid,
  snap,
  zoom,
  chatOpen,
  ready,
  onOpenSheet,
  onNewSheet,
  onRename,
  onDeleteSheet,
  onRevealFolder,
  onTool,
  onToggleLock,
  onFont,
  onIcons,
  onGrid,
  onSnap,
  onZoom,
  onZoomReset,
  onFit,
  onSelectAll,
  onExport,
  onClear,
  onToggleChat,
  iconButtonRef,
}: {
  sheets: readonly WhiteboardSheet[];
  sheet: WhiteboardSheet | undefined;
  activeTool: string;
  fontId: number;
  grid: boolean;
  snap: boolean;
  zoom: number;
  chatOpen: boolean;
  /** The canvas is up; tools are off while a sheet loads or failed to. */
  ready: boolean;
  onOpenSheet: (id: string) => void;
  onNewSheet: () => void;
  onRename: (name: string) => void;
  onDeleteSheet: () => void;
  onRevealFolder: () => void;
  onTool: (tool: "selection" | "hand") => void;
  onToggleLock: () => void;
  onFont: (id: number) => void;
  onIcons: () => void;
  onGrid: () => void;
  onSnap: () => void;
  onZoom: (direction: 1 | -1) => void;
  onZoomReset: () => void;
  onFit: () => void;
  onSelectAll: () => void;
  onExport: (kind: ExportKind) => void;
  onClear: () => void;
  onToggleChat: () => void;
  iconButtonRef: React.RefObject<HTMLButtonElement | null>;
}) {
  const [menu, setMenu] = useState<"sheets" | "font" | "export" | "more" | null>(null);
  const sheetButton = useRef<HTMLButtonElement>(null);
  const fontButton = useRef<HTMLButtonElement>(null);
  const exportButton = useRef<HTMLButtonElement>(null);
  const moreButton = useRef<HTMLButtonElement>(null);
  const locked = !!sheet?.locked;
  const editable = ready && !locked;
  const font = whiteboardFont(fontId) ?? WHITEBOARD_FONTS[0]!;
  const close = () => setMenu(null);
  const toggle = (next: NonNullable<typeof menu>) => setMenu((open) => (open === next ? null : next));

  return (
    <div
      role="toolbar"
      aria-label="Whiteboard"
      className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto px-2 [scrollbar-width:none]"
    >
      <button
        ref={sheetButton}
        type="button"
        aria-label="Sheets"
        title="Sheets"
        aria-haspopup="menu"
        aria-expanded={menu === "sheets"}
        onClick={() => toggle("sheets")}
        className={`${ICON_BUTTON} w-auto gap-0.5 px-1 text-content/60`}
      >
        <Whiteboard aria-hidden className="size-3.5" />
        <ChevronDown aria-hidden className="size-3" />
      </button>
      {sheet ? <SheetName name={sheet.name} onRename={onRename} /> : null}
      <ToolButton label="New sheet" onClick={onNewSheet}>
        <Plus aria-hidden className="size-3.5" />
      </ToolButton>

      <Divider />
      <ToolButton
        label="Select (V)"
        pressed={activeTool === "selection"}
        disabled={!editable}
        onClick={() => onTool("selection")}
      >
        <Cursor aria-hidden className="size-3.5" />
      </ToolButton>
      <ToolButton
        label="Hand (H)"
        pressed={activeTool === "hand" || (ready && locked)}
        disabled={!ready}
        onClick={() => onTool("hand")}
      >
        <Hand aria-hidden className="size-3.5" />
      </ToolButton>
      <ToolButton
        label={locked ? "Unlock sheet" : "Lock sheet"}
        pressed={locked}
        disabled={!sheet}
        onClick={onToggleLock}
      >
        {locked ? <Lock aria-hidden className="size-3.5" /> : <Unlock aria-hidden className="size-3.5" />}
      </ToolButton>

      <Divider />
      <button
        ref={fontButton}
        type="button"
        aria-haspopup="menu"
        aria-expanded={menu === "font"}
        aria-label={`Font: ${font.label}`}
        title="Font for new and selected text"
        disabled={!editable}
        onClick={() => toggle("font")}
        className={`${ICON_BUTTON} w-auto gap-1.5 px-1.5 text-[12px] text-content/70`}
      >
        <TextFont aria-hidden className="size-3.5 shrink-0" />
        <span className="max-w-[96px] truncate" style={{ fontFamily: `"${font.family}"` }}>
          {font.label}
        </span>
        <ChevronDown aria-hidden className="size-3 shrink-0" />
      </button>
      <button
        ref={iconButtonRef}
        type="button"
        aria-label="Insert icon"
        title="Insert icon (Hugeicons)"
        disabled={!editable}
        onClick={onIcons}
        className={`${ICON_BUTTON} text-content/60`}
      >
        <SmilePlus aria-hidden className="size-3.5" />
      </button>

      <Divider />
      <ToolButton label="Grid" pressed={grid} disabled={!ready} onClick={onGrid}>
        <Grid aria-hidden className="size-3.5" />
      </ToolButton>
      <ToolButton label="Snap to objects" pressed={snap} disabled={!editable} onClick={onSnap}>
        <Magnet aria-hidden className="size-3.5" />
      </ToolButton>

      <Divider />
      <ToolButton label="Zoom out" disabled={!ready} onClick={() => onZoom(-1)}>
        <ZoomOut aria-hidden className="size-3.5" />
      </ToolButton>
      <button
        type="button"
        title="Reset zoom"
        aria-label={`Zoom ${Math.round(zoom * 100)}%, reset`}
        disabled={!ready}
        onClick={onZoomReset}
        className="h-7 w-12 shrink-0 rounded-md text-[12px] tabular-nums text-content/65 transition-colors duration-100 hover:bg-content/10 hover:text-content disabled:opacity-35"
      >
        {Math.round(zoom * 100)}%
      </button>
      <ToolButton label="Zoom in" disabled={!ready} onClick={() => onZoom(1)}>
        <ZoomIn aria-hidden className="size-3.5" />
      </ToolButton>
      <ToolButton label="Fit to content" disabled={!ready} onClick={onFit}>
        <FitScreen aria-hidden className="size-3.5" />
      </ToolButton>

      <span className="min-w-2 flex-1" />

      <button
        ref={exportButton}
        type="button"
        aria-haspopup="menu"
        aria-expanded={menu === "export"}
        disabled={!ready}
        onClick={() => toggle("export")}
        className={`${ICON_BUTTON} w-auto gap-1.5 px-2 text-[12px] text-content/70`}
      >
        <Download aria-hidden className="size-3.5" />
        Export
      </button>
      <button
        ref={moreButton}
        type="button"
        aria-label="More"
        title="More"
        aria-haspopup="menu"
        aria-expanded={menu === "more"}
        onClick={() => toggle("more")}
        className={`${ICON_BUTTON} text-content/60`}
      >
        <MoreHorizontal aria-hidden className="size-3.5" />
      </button>
      <ToolButton label={chatOpen ? "Hide agent" : "Show agent"} pressed={chatOpen} onClick={onToggleChat}>
        <AiChat aria-hidden className="size-3.5" />
      </ToolButton>

      {menu === "sheets" ? (
        <Popover
          anchor={sheetButton}
          side="bottom"
          align="start"
          gap={4}
          width={280}
          maxHeight={420}
          role="menu"
          aria-label="Sheets"
          onDismiss={close}
          className="flex flex-col p-1"
        >
          <div className="min-h-0 overflow-y-auto">
            {sortedSheets(sheets).map((item) => (
              <button
                key={item.id}
                type="button"
                role="menuitemradio"
                aria-checked={item.id === sheet?.id}
                onClick={() => {
                  close();
                  onOpenSheet(item.id);
                }}
                className={MENU_ITEM}
              >
                <span className="flex size-3.5 shrink-0 items-center justify-center">
                  {item.id === sheet?.id ? <Check aria-hidden className="size-3.5 text-accent" /> : null}
                </span>
                <span className="min-w-0 flex-1 truncate">{item.name}</span>
                {item.locked ? <Lock aria-hidden className="size-3 shrink-0 text-content/40" /> : null}
                <span className="shrink-0 text-[11px] tabular-nums text-content/40">
                  {relativeTime(item.updatedAt)}
                </span>
              </button>
            ))}
          </div>
          <div className="my-1 h-px shrink-0 bg-content/10" />
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              close();
              onNewSheet();
            }}
            className={MENU_ITEM}
          >
            <Plus aria-hidden className="size-3.5" />
            New sheet
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              close();
              onRevealFolder();
            }}
            className={MENU_ITEM}
          >
            <FolderOpen aria-hidden className="size-3.5" />
            Show in folder
          </button>
        </Popover>
      ) : null}

      {menu === "font" ? (
        <Popover
          anchor={fontButton}
          side="bottom"
          align="start"
          gap={4}
          width={220}
          maxHeight={420}
          role="menu"
          aria-label="Font"
          onDismiss={close}
          className="overflow-y-auto p-1"
        >
          {WHITEBOARD_FONTS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitemradio"
              aria-checked={item.id === fontId}
              onClick={() => {
                close();
                onFont(item.id);
              }}
              className={MENU_ITEM}
            >
              <span className="min-w-0 flex-1 truncate text-[15px]" style={{ fontFamily: `"${item.family}"` }}>
                {item.label}
              </span>
              {item.id === fontId ? <Check aria-hidden className="size-3.5 text-accent" /> : null}
            </button>
          ))}
        </Popover>
      ) : null}

      {menu === "export" ? (
        <Popover
          anchor={exportButton}
          side="bottom"
          align="end"
          gap={4}
          width={220}
          role="menu"
          aria-label="Export"
          onDismiss={close}
          className="p-1"
        >
          {(
            [
              ["png", "PNG image"],
              ["svg", "SVG image"],
              ["excalidraw", "Excalidraw file"],
            ] as const
          ).map(([kind, label]) => (
            <button
              key={kind}
              type="button"
              role="menuitem"
              onClick={() => {
                close();
                onExport(kind);
              }}
              className={MENU_ITEM}
            >
              <span className="min-w-0 flex-1">{label}</span>
              <span className="text-[11px] text-content/40">.{kind}</span>
            </button>
          ))}
        </Popover>
      ) : null}

      {menu === "more" ? (
        <Popover
          anchor={moreButton}
          side="bottom"
          align="end"
          gap={4}
          width={220}
          role="menu"
          aria-label="More"
          onDismiss={close}
          className="p-1"
        >
          <button
            type="button"
            role="menuitem"
            disabled={!editable}
            onClick={() => {
              close();
              onSelectAll();
            }}
            className={MENU_ITEM}
          >
            <SelectAll aria-hidden className="size-3.5" />
            <span className="flex-1">Select all</span>
            <span className="text-[11px] text-content/40">Ctrl A</span>
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={!editable}
            onClick={() => {
              close();
              onClear();
            }}
            className={MENU_ITEM}
          >
            <Clean aria-hidden className="size-3.5" />
            Clear canvas
          </button>
          <div className="my-1 h-px bg-content/10" />
          <button
            type="button"
            role="menuitem"
            disabled={!sheet}
            onClick={() => {
              close();
              onDeleteSheet();
            }}
            className={`${MENU_ITEM} text-red-300/90 hover:bg-red-500/15 hover:text-red-200`}
          >
            <Trash2 aria-hidden className="size-3.5" />
            Delete sheet
          </button>
        </Popover>
      ) : null}
    </div>
  );
}

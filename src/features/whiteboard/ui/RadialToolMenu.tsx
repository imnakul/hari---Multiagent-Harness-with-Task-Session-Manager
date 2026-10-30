import { useEffect, useRef, type KeyboardEvent } from "react";
import {
  ArrowUpRight,
  Circle,
  Cursor,
  Diamond,
  Eraser,
  Frame,
  Hand,
  Image,
  Line,
  PencilDraw,
  Square,
  TextTool,
  type IconComponent,
} from "../../../shared/ui/icons";

/** Excalidraw tool types offered in the wheel. */
export type WheelTool =
  | "selection"
  | "hand"
  | "rectangle"
  | "diamond"
  | "ellipse"
  | "arrow"
  | "line"
  | "freedraw"
  | "text"
  | "image"
  | "eraser"
  | "frame";

export const WHEEL_TOOLS: readonly { tool: WheelTool; label: string; key: string; Icon: IconComponent }[] = [
  { tool: "selection", label: "Select", key: "V", Icon: Cursor },
  { tool: "hand", label: "Hand", key: "H", Icon: Hand },
  { tool: "rectangle", label: "Rectangle", key: "R", Icon: Square },
  { tool: "diamond", label: "Diamond", key: "D", Icon: Diamond },
  { tool: "ellipse", label: "Ellipse", key: "O", Icon: Circle },
  { tool: "arrow", label: "Arrow", key: "A", Icon: ArrowUpRight },
  { tool: "line", label: "Line", key: "L", Icon: Line },
  { tool: "freedraw", label: "Draw", key: "P", Icon: PencilDraw },
  { tool: "text", label: "Text", key: "T", Icon: TextTool },
  { tool: "image", label: "Image", key: "9", Icon: Image },
  { tool: "eraser", label: "Eraser", key: "E", Icon: Eraser },
  { tool: "frame", label: "Frame", key: "F", Icon: Frame },
];

const RADIUS = 78;
const BUTTON = 40;
const SIZE = RADIUS * 2 + BUTTON + 8;

/**
 * A ring of drawing tools around the pointer (fork, L-194). Opened by a
 * right-click on the canvas; Shift + right-click keeps Excalidraw's own menu.
 */
export function RadialToolMenu({
  x,
  y,
  activeTool,
  onPick,
  onClose,
}: {
  x: number;
  y: number;
  activeTool: string;
  onPick: (tool: WheelTool) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    const start = WHEEL_TOOLS.findIndex((item) => item.tool === activeTool);
    buttons.current[Math.max(0, start)]?.focus({ preventScroll: true });
    const dismiss = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    const blur = () => onClose();
    window.addEventListener("pointerdown", dismiss, true);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("pointerdown", dismiss, true);
      window.removeEventListener("blur", blur);
    };
  }, [activeTool, onClose]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    const step =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : 0;
    if (step) {
      event.preventDefault();
      const current = buttons.current.findIndex((button) => button === document.activeElement);
      const next = (current + step + WHEEL_TOOLS.length) % WHEEL_TOOLS.length;
      buttons.current[next]?.focus({ preventScroll: true });
      return;
    }
    const match = WHEEL_TOOLS.find((item) => item.key.toLowerCase() === event.key.toLowerCase());
    if (match && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      onPick(match.tool);
    }
  };

  // Keep the whole wheel on screen.
  const left = Math.min(Math.max(x - SIZE / 2, 4), window.innerWidth - SIZE - 4);
  const top = Math.min(Math.max(y - SIZE / 2, 4), window.innerHeight - SIZE - 4);

  return (
    <div
      ref={ref}
      role="menu"
      aria-label="Drawing tools"
      data-whiteboard-wheel
      onKeyDown={onKeyDown}
      onContextMenu={(event) => {
        event.preventDefault();
        onClose();
      }}
      className="whiteboard-wheel fixed z-[60]"
      style={{ left, top, width: SIZE, height: SIZE }}
    >
      <div
        aria-hidden
        className="absolute rounded-full border border-content/10 bg-content/10 shadow-xl backdrop-blur-xl"
        style={{ inset: 0 }}
      />
      <div
        aria-hidden
        className="absolute rounded-full border border-content/10 bg-background-base/40"
        style={{ inset: SIZE / 2 - 22, width: 44, height: 44 }}
      />
      {WHEEL_TOOLS.map((item, index) => {
        const angle = (index / WHEEL_TOOLS.length) * Math.PI * 2 - Math.PI / 2;
        const cx = SIZE / 2 + Math.cos(angle) * RADIUS - BUTTON / 2;
        const cy = SIZE / 2 + Math.sin(angle) * RADIUS - BUTTON / 2;
        const active = item.tool === activeTool;
        return (
          <button
            key={item.tool}
            ref={(node) => {
              buttons.current[index] = node;
            }}
            type="button"
            role="menuitemradio"
            aria-checked={active}
            aria-label={`${item.label} (${item.key})`}
            title={`${item.label} — ${item.key}`}
            onClick={() => onPick(item.tool)}
            className={`group absolute flex items-center justify-center rounded-full outline-none transition-[background-color,color,transform] duration-150 ease-out hover:bg-content/15 hover:text-content focus-visible:bg-content/15 focus-visible:text-content focus-visible:ring-1 focus-visible:ring-accent/60 active:scale-96 ${
              active ? "bg-accent/20 text-accent" : "text-content/70"
            }`}
            style={{ left: cx, top: cy, width: BUTTON, height: BUTTON }}
          >
            <item.Icon aria-hidden className="size-[18px]" strokeWidth={1.5} />
          </button>
        );
      })}
    </div>
  );
}

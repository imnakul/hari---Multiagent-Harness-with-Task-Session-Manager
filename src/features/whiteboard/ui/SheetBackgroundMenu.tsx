import type { ReactNode } from "react";
import { SegmentedSwitch } from "../../../shared/ui/SegmentedSwitch";
import {
  DEFAULT_SHEET_BACKGROUND,
  isDefaultBackground,
  SHEET_FILL_SWATCHES,
  SHEET_PATTERN_LABELS,
  SHEET_PATTERNS,
  type SheetBackground,
  type SheetPattern,
} from "../model/sheetBackground";

const PATTERN_OPTIONS = SHEET_PATTERNS.map((id) => ({ id, label: SHEET_PATTERN_LABELS[id] }));
const SWATCH =
  "size-6 shrink-0 rounded-full border transition-transform duration-100 ease-out hover:scale-110 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70";

/** Fork (L-393): the sheet's pattern, fill colour and fill opacity. */
export function SheetBackgroundMenu({
  background,
  onChange,
}: {
  background: SheetBackground;
  onChange: (background: SheetBackground) => void;
}): ReactNode {
  const update = (patch: Partial<SheetBackground>) => onChange({ ...background, ...patch });
  const picked = background.color ?? "#ffffff";
  const custom = background.color !== null && !SHEET_FILL_SWATCHES.some((color) => color === background.color);

  return (
    <div className="flex flex-col gap-3 p-3 text-[12px] text-content/70">
      <section className="flex flex-col gap-1.5">
        <h3 className="text-[11px] font-medium text-content/50">Pattern</h3>
        <SegmentedSwitch<SheetPattern>
          ariaLabel="Sheet pattern"
          options={PATTERN_OPTIONS}
          value={background.pattern}
          onChange={(pattern) => update({ pattern })}
        />
      </section>

      <section className="flex flex-col gap-1.5">
        <h3 className="text-[11px] font-medium text-content/50">Fill</h3>
        <div role="radiogroup" aria-label="Sheet fill" className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            role="radio"
            aria-checked={background.color === null}
            aria-label="No fill (wallpaper shows through)"
            title="No fill"
            onClick={() => update({ color: null })}
            className={`${SWATCH} relative overflow-hidden ${background.color === null ? "border-accent" : "border-content/25"}`}
          >
            <span aria-hidden className="absolute left-1/2 top-[-2px] h-7 w-px origin-center rotate-45 bg-red-400/80" />
          </button>
          {SHEET_FILL_SWATCHES.map((color) => (
            <button
              key={color}
              type="button"
              role="radio"
              aria-checked={background.color === color}
              aria-label={`Fill ${color}`}
              title={color}
              onClick={() => update({ color })}
              className={`${SWATCH} ${background.color === color ? "border-accent ring-1 ring-accent/60" : "border-content/25"}`}
              style={{ backgroundColor: color }}
            />
          ))}
          <label
            title="Custom colour"
            className={`${SWATCH} cursor-pointer bg-[conic-gradient(red,yellow,lime,cyan,blue,magenta,red)] has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent/70 ${custom ? "border-accent ring-1 ring-accent/60" : "border-content/25"}`}
          >
            <input
              type="color"
              aria-label="Custom fill colour"
              value={picked}
              onChange={(event) => update({ color: event.target.value.toLowerCase() })}
              className="sr-only"
            />
          </label>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(background.opacity * 100)}
            disabled={background.color === null}
            aria-label="Fill opacity"
            className="sidebar-opacity-slider min-w-0 flex-1 disabled:opacity-40"
            onChange={(event) => update({ opacity: Number(event.target.value) / 100 })}
          />
          <span className="w-9 shrink-0 text-right tabular-nums text-content/80">
            {Math.round(background.opacity * 100)}%
          </span>
        </div>
      </section>

      <button
        type="button"
        disabled={isDefaultBackground(background)}
        onClick={() => onChange(DEFAULT_SHEET_BACKGROUND)}
        className="h-7 rounded-md text-[12px] text-content/70 transition-colors duration-100 hover:bg-content/10 hover:text-content disabled:opacity-40"
      >
        Reset to default
      </button>
    </div>
  );
}

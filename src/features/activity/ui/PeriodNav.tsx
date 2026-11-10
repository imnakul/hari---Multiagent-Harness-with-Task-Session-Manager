import { useRef, type ReactElement } from "react";
import { Calendar, ChevronLeft, ChevronRight, RefreshCw } from "../../../shared/ui/icons";
import {
  fromDateInputValue,
  periodLabel,
  toDateInputValue,
  type ActivityScope,
} from "../model/activity";

const SCOPES: { id: ActivityScope; label: string }[] = [
  { id: "day", label: "Day" },
  { id: "week", label: "Week" },
  { id: "month", label: "Month" },
];

const ICON_BUTTON =
  "grid size-7 place-items-center rounded-md text-content/55 transition-colors hover:bg-content/10 hover:text-content focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60 disabled:pointer-events-none disabled:opacity-30";

/**
 * Day / Week / Month switch, previous and next, a date picker to jump to any
 * day, Today, and Refresh. The picker never offers days after today.
 */
export function PeriodNav({
  anchor,
  scope,
  isLive,
  refreshing,
  onScope,
  onShift,
  onJump,
  onRefresh,
}: {
  anchor: Date;
  scope: ActivityScope;
  isLive: boolean;
  refreshing: boolean;
  onScope: (scope: ActivityScope) => void;
  onShift: (delta: number) => void;
  onJump: (date: Date) => void;
  onRefresh: () => void;
}): ReactElement {
  const picker = useRef<HTMLInputElement>(null);
  const today = toDateInputValue(new Date());
  const openPicker = (): void => {
    const input = picker.current;
    if (!input) return;
    // showPicker is missing on older WebViews; focusing still lets keyboard users type a date.
    if (typeof input.showPicker === "function") {
      try {
        input.showPicker();
        return;
      } catch {
        // Not allowed outside a user gesture in some engines; fall back to focus.
      }
    }
    input.focus();
  };

  return (
    <nav aria-label="Choose period" className="flex flex-wrap items-center gap-x-1 gap-y-2">
      <div
        role="radiogroup"
        aria-label="Period length"
        className="mr-2 flex rounded-md border border-stroke p-0.5"
      >
        {SCOPES.map((option) => (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={scope === option.id}
            onClick={() => onScope(option.id)}
            className={`h-6 rounded px-2.5 text-[12px] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60 ${
              scope === option.id
                ? "bg-content/10 font-medium text-content"
                : "text-content/55 hover:text-content"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
      <button type="button" aria-label={`Previous ${scope}`} className={ICON_BUTTON} onClick={() => onShift(-1)}>
        <ChevronLeft className="size-4" strokeWidth={1.75} />
      </button>
      <button
        type="button"
        aria-label={`Next ${scope}`}
        className={ICON_BUTTON}
        disabled={isLive}
        onClick={() => onShift(1)}
      >
        <ChevronRight className="size-4" strokeWidth={1.75} />
      </button>
      <h2 className="ml-1.5 text-[17px] font-semibold tracking-tight" aria-live="polite">
        {periodLabel(anchor, scope)}
      </h2>
      <div className="ml-auto flex items-center gap-1">
        <span className="relative">
          <button
            type="button"
            aria-label="Jump to a date"
            title="Jump to a date"
            className={ICON_BUTTON}
            onClick={openPicker}
          >
            <Calendar className="size-3.5" strokeWidth={1.75} />
          </button>
          <input
            ref={picker}
            type="date"
            aria-label="Date to show"
            max={today}
            value={toDateInputValue(anchor)}
            onChange={(event) => {
              const date = fromDateInputValue(event.target.value);
              if (date && toDateInputValue(date) <= today) onJump(date);
            }}
            className="pointer-events-none absolute inset-0 size-full opacity-0"
            tabIndex={-1}
          />
        </span>
        {isLive ? null : (
          <button
            type="button"
            onClick={() => onJump(new Date())}
            className="h-7 rounded-md px-2.5 text-[12px] text-content/60 transition-colors hover:bg-content/10 hover:text-content focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60"
          >
            {scope === "day" ? "Today" : scope === "week" ? "This week" : "This month"}
          </button>
        )}
        <button type="button" aria-label="Refresh" title="Refresh" className={ICON_BUTTON} onClick={onRefresh}>
          <RefreshCw
            className={`size-3.5 ${refreshing ? "motion-safe:animate-spin" : ""}`}
            strokeWidth={1.75}
          />
        </button>
      </div>
    </nav>
  );
}

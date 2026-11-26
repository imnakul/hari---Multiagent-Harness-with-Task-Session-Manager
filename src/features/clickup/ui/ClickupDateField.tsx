import { useRef, useState, type JSX } from "react";
import { DateTimePicker } from "../../../shared/ui/DateTimePicker";
import { Popover } from "../../../shared/ui/Popover";

const TRIGGER =
  "flex h-9 w-full items-center justify-between gap-2 rounded-md border border-content/10 bg-transparent px-2.5 text-left text-[13px] text-content outline-none transition-colors hover:border-content/20 focus-visible:border-content/25 disabled:opacity-50 active:scale-[0.99]";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** `2026-11-26` as `26 Nov 2026`; "" or a bad value as "". */
export function formatDateLabel(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return "";
  const month = MONTHS[Number(match[2]) - 1];
  return month ? `${Number(match[3])} ${month} ${match[1]}` : "";
}

/**
 * Fork (L-395): a glass date button that opens the app's calendar instead of
 * the browser's native date input. `value` and `min` are `YYYY-MM-DD`; an
 * empty `value` means no date.
 */
export function ClickupDateField({
  label,
  value,
  min,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  min?: string;
  disabled: boolean;
  onChange: (value: string) => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const text = formatDateLabel(value);
  return (
    <>
      <button
        ref={trigger}
        type="button"
        aria-label={`${label}: ${text || "No date"}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={disabled}
        className={TRIGGER}
        onClick={() => setOpen((current) => !current)}
      >
        <span className={text ? "" : "text-content/35"}>{text || "No date"}</span>
      </button>
      {open ? (
        <Popover
          anchor={trigger}
          side="bottom"
          align="start"
          width={288}
          aria-label={label}
          onDismiss={() => setOpen(false)}
        >
          <div className="flex flex-col gap-2 p-2">
            <DateTimePicker
              mode="date"
              autoFocus
              minDate={min || undefined}
              value={value ? `${value}T12:00` : ""}
              onChange={(next) => {
                onChange(next.slice(0, 10));
                setOpen(false);
              }}
            />
            {value ? (
              <button
                type="button"
                className="h-8 rounded-md text-[12.5px] text-content/65 transition-colors hover:bg-content/[0.06] hover:text-content active:scale-[0.98]"
                onClick={() => {
                  onChange("");
                  setOpen(false);
                }}
              >
                Clear
              </button>
            ) : null}
          </div>
        </Popover>
      ) : null}
    </>
  );
}

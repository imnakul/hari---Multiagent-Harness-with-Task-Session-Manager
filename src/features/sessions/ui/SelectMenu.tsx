import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { Check, ChevronDown } from "../../../shared/ui/icons";
import { Popover } from "../../../shared/ui/Popover";

export type SelectMenuOption = {
  value: string;
  label: string;
  disabled?: boolean;
  /** Hover text, e.g. why the option is disabled. */
  title?: string;
  /** Marks shown after the label, e.g. a model's Free pill or lock. */
  trailing?: ReactNode;
};

type Props = {
  label: string;
  value: string;
  options: readonly SelectMenuOption[];
  onChange: (value: string) => void;
  onOpen?: () => void;
  className?: string;
  menuWidth?: number;
  maxHeight?: number;
};

export function SelectMenu({
  label,
  value,
  options,
  onChange,
  onOpen,
  className = "w-44",
  menuWidth = 240,
  maxHeight = 360,
}: Props) {
  const root = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  const [active, setActive] = useState(selectedIndex);
  const current = options[selectedIndex] ?? options[0];

  useEffect(() => {
    if (!open) return;
    setActive(selectedIndex);
  }, [open, selectedIndex]);

  useEffect(() => {
    if (!open) return;
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const pick = (index: number) => {
    const option = options[index];
    if (!option || option.disabled) return;
    onChange(option.value);
    setOpen(false);
  };

  const move = (delta: number) => {
    if (options.length === 0) return;
    let next = active;
    for (let count = 0; count < options.length; count += 1) {
      next = (next + delta + options.length) % options.length;
      if (!options[next]?.disabled) break;
    }
    setActive(next);
  };
  const onMenuKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      move(1);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      move(-1);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      pick(active);
    }
  };

  return (
    <div ref={root} className={`relative shrink-0 ${className}`}>
      <button
        type="button"
        aria-label={`${label}: ${current?.label ?? value}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => {
          if (!open) onOpen?.();
          setOpen(!open);
        }}
        className={`flex h-7 w-full items-center gap-2 rounded-md border px-2 text-[12px] outline-none transition-colors ${
          open
            ? "border-content/20 bg-content/10 text-content"
            : "border-content/10 bg-content/5 text-content/85 hover:border-content/20 hover:bg-content/8 hover:text-content"
        }`}
      >
        <span className="min-w-0 flex-1 truncate text-left">
          {current?.label ?? value}
        </span>
        <ChevronDown
          className={`size-3.5 shrink-0 text-content/45 transition-transform ${open ? "rotate-180" : ""}`}
          strokeWidth={1.75}
        />
      </button>{" "}
      {open ? (
        <Popover
          anchor={root}
          side="bottom"
          align="end"
          width={menuWidth}
          maxHeight={maxHeight}
          autoFocus
          onDismiss={() => setOpen(false)}
          role="listbox"
          aria-label={label}
          tabIndex={-1}
          onKeyDown={onMenuKey}
          className="overflow-y-auto p-1"
        >
          {options.map((option, index) => {
            const selected = option.value === value;
            const highlighted = index === active;
            return (
              <button
                key={option.value}
                ref={highlighted ? activeRef : undefined}
                type="button"
                role="option"
                aria-selected={selected}
                aria-disabled={option.disabled || undefined}
                disabled={option.disabled}
                title={option.title}
                data-shared-hover-preserve={selected ? "" : undefined}
                onMouseEnter={() => setActive(index)}
                onClick={() => pick(index)}
                className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] ${
                  option.disabled
                    ? "cursor-default text-content/25"
                    : selected
                      ? "bg-content/10 text-content"
                      : "text-content/75 hover:text-content"
                }`}
              >
                {" "}
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
                {option.trailing}
                {selected ? (
                  <Check className="size-3.5 shrink-0" strokeWidth={2} />
                ) : null}
              </button>
            );
          })}
        </Popover>
      ) : null}
    </div>
  );
}

import { useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { IconComponent } from "./icons";

export type SegmentedOption<T extends string> = {
  id: T;
  label: string;
  icon?: IconComponent;
};

/**
 * Small tab-style switch (List | Table | Board, Task | Session). Arrow keys
 * move between options; only the selected option is in the tab order.
 *
 * Fork (L-306): the selected background is one shape that glides to the
 * option you pick (transform), instead of jumping between buttons. It lands
 * without gliding the first time and whenever the switch is resized.
 */
export function SegmentedSwitch<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
}): ReactNode {
  const refs = useRef(new Map<T, HTMLButtonElement>());
  const box = useRef<HTMLDivElement>(null);
  const placed = useRef(false);
  const [mark, setMark] = useState<{ x: number; width: number; glide: boolean } | null>(null);

  useLayoutEffect(() => {
    const container = box.current;
    const measure = (glide: boolean) => {
      const button = refs.current.get(value);
      if (!button) {
        placed.current = false;
        setMark(null);
        return;
      }
      setMark((current) =>
        current && current.x === button.offsetLeft && current.width === button.offsetWidth
          ? current
          : { x: button.offsetLeft, width: button.offsetWidth, glide },
      );
      placed.current = true;
    };
    measure(placed.current);
    if (!container || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => measure(false));
    observer.observe(container);
    return () => observer.disconnect();
  }, [value, options]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const delta =
      event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!delta) return;
    event.preventDefault();
    const index = options.findIndex((option) => option.id === value);
    const next = options[(index + delta + options.length) % options.length];
    if (!next) return;
    onChange(next.id);
    refs.current.get(next.id)?.focus();
  };
  return (
    <div
      ref={box}
      role="tablist"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
      className="relative flex shrink-0 rounded-md border border-content/10 bg-content/10 p-0.5"
    >
      {mark ? (
        <span
          aria-hidden
          style={{ width: mark.width, transform: `translateX(${mark.x}px)` }}
          className={`pointer-events-none absolute inset-y-0.5 left-0 rounded bg-selection-strong ${
            mark.glide
              ? "transition-[transform,width] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none"
              : ""
          }`}
        />
      ) : null}
      {options.map(({ id, label, icon: Icon }) => {
        const selected = value === id;
        return (
          <button
            key={id}
            ref={(element) => {
              if (element) refs.current.set(id, element);
              else refs.current.delete(id);
            }}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(id)}
            className={`relative inline-flex h-6 items-center gap-1 rounded px-2 font-sans text-[11px] transition-colors duration-100 ${
              selected
                ? `text-content ${mark ? "" : "bg-selection-strong"}`
                : "text-content/45 hover:text-content/80"
            }`}
          >
            {Icon ? (
              <Icon aria-hidden className="size-3" strokeWidth={1.75} />
            ) : null}
            {label}
          </button>
        );
      })}
    </div>
  );
}

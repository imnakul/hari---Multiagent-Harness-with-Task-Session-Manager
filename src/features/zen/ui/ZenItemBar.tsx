import type { ReactNode } from "react";
import { X } from "../../../shared/ui/icons";

/**
 * The thin bar over an item opened in Zen's bottom half (L-230): what it is,
 * any extra actions, and Close, which slides the half away.
 */
export function ZenItemBar({
  label,
  actions,
  onClose,
}: {
  label: ReactNode;
  actions?: ReactNode;
  onClose: () => void;
}): ReactNode {
  return (
    <div className="flex h-8 shrink-0 items-center gap-1 border-b border-stroke pl-3 pr-1.5">
      <div className="flex min-w-0 flex-1 items-center gap-2 truncate text-[12px] text-content/55">
        {label}
      </div>
      {actions}
      <button
        type="button"
        title="Close"
        aria-label="Close"
        onClick={onClose}
        className="grid size-6 shrink-0 place-items-center rounded-md text-content/45 hover:bg-content/10 hover:text-content"
      >
        <X className="size-3.5" strokeWidth={1.75} />
      </button>
    </div>
  );
}

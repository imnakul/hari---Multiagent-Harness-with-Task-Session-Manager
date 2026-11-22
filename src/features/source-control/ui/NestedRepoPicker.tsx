import { useRef, useState, type JSX, type KeyboardEvent } from "react";
import type { NestedRepo } from "../../../platform/tauri/fs";
import { pathKey } from "../../../shared/lib/paths";
import { Popover } from "../../../shared/ui/Popover";
import { Check, ChevronsUpDown } from "../../../shared/ui/icons";

function RepoDot({ color }: { color?: string }): JSX.Element | null {
  if (!color) return null;
  return <span aria-hidden className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />;
}

/**
 * Fork (L-377): for a project folder holding several repositories, the one
 * Changes, History and the Workspace chooser work on. Sits beside the
 * Workspace chooser in the sidebar header and looks like it.
 *
 * @param colors Each repo's colour by path key; absent when repo colours are off.
 * @param onOpen Runs as the menu opens (looks for newly cloned repos).
 */
export function NestedRepoPicker({
  repos,
  value,
  colors,
  onChange,
  onOpen,
}: {
  repos: readonly NestedRepo[];
  value: string;
  colors?: ReadonlyMap<string, string>;
  onChange: (path: string) => void;
  onOpen?: () => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const options = useRef<(HTMLButtonElement | null)[]>([]);
  const current = repos.find((repo) => pathKey(repo.path) === pathKey(value)) ?? repos[0];

  const show = () => {
    onOpen?.();
    setOpen(true);
  };
  const pick = (path: string) => {
    onChange(path);
    setOpen(false);
    anchor.current?.focus();
  };
  const moveFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const list = options.current.filter((node): node is HTMLButtonElement => !!node);
    const at = list.findIndex((node) => node === document.activeElement);
    const step = event.key === "ArrowDown" ? 1 : -1;
    list[(at + step + list.length) % list.length]?.focus();
  };

  return (
    <>
      <button
        ref={anchor}
        type="button"
        data-tauri-drag-region="false"
        aria-label={`Repository: ${current?.name ?? "none"}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={current?.path}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={(event) => {
          if (open || event.key !== "ArrowDown") return;
          event.preventDefault();
          show();
        }}
        className="flex h-6.5 min-w-0 max-w-40 shrink items-center gap-1.5 rounded-md px-1.5 text-sm font-medium leading-tight transition-transform hover:bg-content/8 active:scale-[0.97] aria-expanded:bg-content/8 motion-reduce:transition-none"
      >
        <RepoDot color={current ? colors?.get(pathKey(current.path)) : undefined} />
        <span className="min-w-0 truncate">{current?.name ?? "Repository"}</span>
        <ChevronsUpDown className="size-3.5 shrink-0 text-content/45" />
      </button>
      {open ? (
        <Popover
          anchor={anchor}
          side="bottom"
          align="start"
          width={220}
          maxHeight={320}
          autoFocus
          onDismiss={() => setOpen(false)}
          onKeyDown={moveFocus}
          className="flex flex-col overflow-hidden"
        >
          <div className="px-3 pb-1 pt-2 text-[11px] font-medium text-content/45">Repository</div>
          <div
            role="listbox"
            aria-label="Repository"
            className="min-h-0 flex-1 overflow-y-auto overscroll-none p-1.5 pt-0"
          >
            {repos.map((repo, index) => {
              const selected = !!current && pathKey(repo.path) === pathKey(current.path);
              return (
                <button
                  key={repo.path}
                  ref={(node) => {
                    options.current[index] = node;
                  }}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  title={repo.path}
                  onClick={() => pick(repo.path)}
                  className={`flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] outline-none hover:bg-content/8 focus-visible:bg-content/8 ${
                    selected ? "bg-selection text-content" : "text-content/80"
                  }`}
                >
                  <RepoDot color={colors?.get(pathKey(repo.path))} />
                  <span className="min-w-0 flex-1 truncate">{repo.name}</span>
                  {selected ? <Check className="size-3.5 shrink-0" /> : null}
                </button>
              );
            })}
          </div>
        </Popover>
      ) : null}
    </>
  );
}

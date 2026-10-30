import { createElement, memo, useDeferredValue, useEffect, useMemo, useState } from "react";
import { Popover, type PopoverAnchor } from "../../../shared/ui/Popover";
import { LoaderCircle, Search } from "../../../shared/ui/icons";
import { loadIconCatalog, searchIcons, type CatalogIcon } from "./iconCatalog";

const Glyph = memo(function Glyph({ icon }: { icon: CatalogIcon }) {
  return createElement(
    "svg",
    {
      viewBox: "0 0 24 24",
      fill: "none",
      width: 20,
      height: 20,
      "aria-hidden": true,
    },
    icon.nodes.map(([tag, attrs], index) =>
      createElement(tag, { ...attrs, strokeWidth: 1.5, key: index }),
    ),
  );
});

/** Search every free Hugeicons glyph and drop one on the sheet (fork, L-194). */
export function IconLibraryPicker({
  anchor,
  onPick,
  onClose,
}: {
  anchor: PopoverAnchor;
  onPick: (icon: CatalogIcon) => void;
  onClose: () => void;
}) {
  const [icons, setIcons] = useState<CatalogIcon[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const deferred = useDeferredValue(query);

  useEffect(() => {
    let live = true;
    loadIconCatalog().then(
      (list) => live && setIcons(list),
      (cause: unknown) => live && setError(cause instanceof Error ? cause.message : String(cause)),
    );
    return () => {
      live = false;
    };
  }, []);

  const results = useMemo(() => (icons ? searchIcons(icons, deferred) : []), [icons, deferred]);

  return (
    <Popover
      anchor={anchor}
      side="bottom"
      align="end"
      gap={6}
      width={340}
      maxHeight={420}
      role="dialog"
      aria-label="Icon library"
      onDismiss={onClose}
      className="flex flex-col p-2"
    >
      <label className="flex h-8 shrink-0 items-center gap-2 rounded-lg border border-content/10 bg-content/5 px-2 text-[13px] focus-within:border-content/25">
        <Search aria-hidden className="size-3.5 shrink-0 text-content/45" />
        <input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && results[0]) onPick(results[0]);
          }}
          placeholder="Search Hugeicons"
          aria-label="Search icons"
          className="min-w-0 flex-1 bg-transparent text-content outline-none placeholder:text-content/35"
        />
      </label>
      <div className="mt-2 min-h-0 flex-1 overflow-y-auto">
        {error ? (
          <p role="alert" className="px-2 py-6 text-center text-[12px] text-red-300/90">
            Couldn't load the icons: {error}
          </p>
        ) : !icons ? (
          <p
            role="status"
            className="flex items-center justify-center gap-2 py-6 text-[12px] text-content/50"
          >
            <LoaderCircle aria-hidden className="size-3.5 animate-spin" />
            Loading icons…
          </p>
        ) : results.length === 0 ? (
          <p role="status" className="py-6 text-center text-[12px] text-content/50">
            No icons match "{deferred}".
          </p>
        ) : (
          <div role="list" className="grid grid-cols-8 gap-0.5">
            {results.map((icon) => (
              <button
                key={icon.name}
                type="button"
                role="listitem"
                title={icon.label}
                aria-label={icon.label}
                onClick={() => onPick(icon)}
                className="flex aspect-square items-center justify-center rounded-md text-content/75 transition-colors duration-100 hover:bg-content/10 hover:text-content focus-visible:bg-content/10 focus-visible:outline-none"
              >
                <Glyph icon={icon} />
              </button>
            ))}
          </div>
        )}
      </div>
      {icons ? (
        <p className="mt-1.5 shrink-0 px-1 text-[11px] tabular-nums text-content/40">
          {deferred.trim()
            ? `${results.length}${results.length >= 240 ? "+" : ""} matches`
            : `${icons.length.toLocaleString()} free icons`}{" "}
          · uses the current stroke colour
        </p>
      ) : null}
    </Popover>
  );
}

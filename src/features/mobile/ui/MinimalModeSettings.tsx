import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState, type JSX } from "react";
import { Popover } from "../../../shared/ui/Popover";
import { AppWindow, Plus, X } from "../../../shared/ui/icons";
import { parseMinimalSettings, type MinimalApp, type MinimalSettings } from "../model/mobilePc";

const SMALL =
  "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] text-content/60 transition-[background-color,color,transform] duration-100 hover:bg-selection hover:text-content active:scale-[0.96] disabled:pointer-events-none disabled:opacity-40";

const message = (reason: unknown): string =>
  reason instanceof Error ? reason.message : typeof reason === "string" ? reason : "Something went wrong";

/**
 * Fork (Hari, L-318): the apps Minimal mode (from Hari's Control tab) asks to
 * close. Picked from the apps with a window open now, by program, so every
 * window of that program closes; Minimal opens them again when it turns off.
 */
export function MinimalModeSettings(): JSX.Element {
  const [settings, setSettings] = useState<MinimalSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [picking, setPicking] = useState(false);
  const addButton = useRef<HTMLButtonElement>(null);

  const load = async (): Promise<void> => {
    setSettings(parseMinimalSettings(await invoke<unknown>("mobile_pc_minimal_list")));
  };

  useEffect(() => {
    let disposed = false;
    invoke<unknown>("mobile_pc_minimal_list")
      .then((raw) => {
        if (!disposed) setSettings(parseMinimalSettings(raw));
      })
      .catch((reason: unknown) => {
        if (!disposed) setError(message(reason));
      });
    return () => {
      disposed = true;
    };
  }, []);

  const change = async (command: string, args: Record<string, unknown>): Promise<void> => {
    setBusy(true);
    setError("");
    try {
      await invoke<unknown>(command, args);
      await load();
    } catch (reason) {
      setError(message(reason));
    } finally {
      setBusy(false);
    }
  };

  const openPicker = (): void => {
    setPicking(true);
    // The list of open apps is read again each time it opens.
    void load().catch((reason: unknown) => setError(message(reason)));
  };

  const add = (app: MinimalApp): void => {
    setPicking(false);
    void change("mobile_pc_minimal_add", { exe: app.exe, name: app.name });
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-end justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-[13px] font-medium text-content">
            Minimal mode{settings?.active ? <span className="ml-2 text-[11.5px] font-normal text-accent">On now</span> : null}
          </h3>
          <p className="mt-1 text-[12px] leading-relaxed text-content/45">
            From Hari’s Control tab: Best power efficiency, monitor off, and these apps asked to close (they can ask
            to save). Tapping it again brings them back.
          </p>
        </div>
        <button
          ref={addButton}
          type="button"
          className={`${SMALL} shrink-0`}
          disabled={busy || settings === null}
          aria-expanded={picking}
          onClick={openPicker}
        >
          <Plus className="size-3.5" strokeWidth={1.75} /> Add app…
        </button>
      </div>
      {picking && settings ? (
        <Popover anchor={addButton} side="bottom" align="end" width={300} onDismiss={() => setPicking(false)}>
          <div className="max-h-72 overflow-y-auto p-1.5">
            {settings.running.length === 0 ? (
              <p className="px-2.5 py-3 text-[12px] text-content/45">
                No other apps have a window open. Open the app, then add it here.
              </p>
            ) : (
              <ul aria-label="Apps with a window open">
                {settings.running.map((app) => (
                  <li key={app.exe}>
                    <button
                      type="button"
                      onClick={() => add(app)}
                      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-[background-color] duration-100 hover:bg-selection"
                    >
                      <AppWindow className="size-4 shrink-0 text-content/40" strokeWidth={1.75} aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] text-content">{app.name}</span>
                        <span className="block truncate text-[11.5px] text-content/45">{app.title ?? app.exe}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Popover>
      ) : null}
      {settings === null ? (
        error ? null : (
          <div aria-busy="true" aria-label="Loading apps" className="h-12 animate-pulse rounded-xl bg-content/5" />
        )
      ) : settings.apps.length === 0 ? (
        <p className="rounded-xl border border-dashed border-content/15 px-4 py-4 text-center text-[12px] text-content/45">
          No apps. Minimal mode only changes power mode and the monitor.
        </p>
      ) : (
        <ul className="divide-y divide-stroke overflow-hidden rounded-xl border border-stroke">
          {settings.apps.map((app) => (
            <li key={app.exe} className="flex items-center gap-3 px-4 py-2.5">
              <AppWindow className="size-4 shrink-0 text-content/40" strokeWidth={1.75} aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] text-content">{app.name}</div>
                <div className="truncate text-[11.5px] text-content/45">{app.exe}</div>
              </div>
              <button
                type="button"
                disabled={busy}
                aria-label={`Remove ${app.name}`}
                title="Don't close it in Minimal mode"
                onClick={() => void change("mobile_pc_minimal_remove", { exe: app.exe })}
                className="rounded p-1.5 text-content/40 transition-[background-color,color] duration-100 hover:bg-selection hover:text-content disabled:opacity-40"
              >
                <X className="size-3.5" strokeWidth={1.75} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {error ? (
        <p role="alert" className="text-[12px] text-red-400">
          {error}
        </p>
      ) : null}
    </div>
  );
}

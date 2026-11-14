import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useEffect, useState, type JSX } from "react";
import { AppWindow, Plus, RotateCcw, X } from "../../../shared/ui/icons";
import { parsePhoneApps, type PhoneApp } from "../model/mobilePc";

const SMALL =
  "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] text-content/60 transition-[background-color,color,transform] duration-100 hover:bg-selection hover:text-content active:scale-[0.96] disabled:pointer-events-none disabled:opacity-40";

const message = (reason: unknown): string =>
  reason instanceof Error ? reason.message : typeof reason === "string" ? reason : "Something went wrong";

/**
 * Fork (Hari, L-280): the apps Hari's Computer screen may open, close,
 * minimize, maximize and restart on this computer. Only these; running apps
 * outside the list can still be closed from the phone's running-apps list.
 */
export function PhoneAppsSettings(): JSX.Element {
  const [apps, setApps] = useState<PhoneApp[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let disposed = false;
    invoke<unknown>("mobile_pc_apps_list")
      .then((raw) => {
        if (!disposed) setApps(parsePhoneApps(raw));
      })
      .catch((reason: unknown) => {
        if (!disposed) setError(message(reason));
      });
    return () => {
      disposed = true;
    };
  }, []);

  const change = async (command: string, args?: Record<string, unknown>) => {
    setBusy(true);
    setError("");
    try {
      setApps(parsePhoneApps(await invoke<unknown>(command, args)));
    } catch (reason) {
      setError(message(reason));
    } finally {
      setBusy(false);
    }
  };

  const add = async () => {
    const picked = await openDialog({
      multiple: false,
      directory: false,
      title: "Choose a program for your phone",
      filters: [{ name: "Programs", extensions: ["exe"] }],
    });
    if (typeof picked === "string") await change("mobile_pc_apps_add", { path: picked });
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-end justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-[13px] font-medium text-content">Apps your phone can control</h3>
          <p className="mt-1 text-[12px] leading-relaxed text-content/45">
            Hari’s Computer screen can open, close, minimize, maximize and restart these.
          </p>
        </div>
        <div className="flex shrink-0 gap-1">
          <button
            type="button"
            className={SMALL}
            disabled={busy || apps === null}
            title="Back to Hari, Claude, ChatGPT and Antigravity"
            onClick={() => void change("mobile_pc_apps_reset")}
          >
            <RotateCcw className="size-3.5" strokeWidth={1.75} /> Reset
          </button>
          <button
            type="button"
            className={SMALL}
            disabled={busy || apps === null}
            onClick={() => void add().catch((reason: unknown) => setError(message(reason)))}
          >
            <Plus className="size-3.5" strokeWidth={1.75} /> Add app…
          </button>
        </div>
      </div>
      {apps === null ? (
        error ? null : (
          <div aria-busy="true" aria-label="Loading apps" className="h-12 animate-pulse rounded-xl bg-content/5" />
        )
      ) : apps.length === 0 ? (
        <p className="rounded-xl border border-dashed border-content/15 px-4 py-4 text-center text-[12px] text-content/45">
          No apps. Add a program, or Reset to the usual ones.
        </p>
      ) : (
        <ul className="divide-y divide-stroke overflow-hidden rounded-xl border border-stroke">
          {apps.map((app) => (
            <li key={app.id} className="flex items-center gap-3 px-4 py-2.5">
              <AppWindow className="size-4 shrink-0 text-content/40" strokeWidth={1.75} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] text-content">{app.name}</div>
                <div className="truncate text-[11.5px] text-content/45" title={app.detail}>
                  {app.detail}
                </div>
              </div>
              <button
                type="button"
                disabled={busy}
                aria-label={`Remove ${app.name}`}
                title="Remove from the phone"
                onClick={() => void change("mobile_pc_apps_remove", { id: app.id })}
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

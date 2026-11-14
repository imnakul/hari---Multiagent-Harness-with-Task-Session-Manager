import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState, useSyncExternalStore, type ReactElement } from "react";
import {
  getHarnessAvailabilitySnapshot,
  isHarnessAvailable,
  subscribeHarnessAvailability,
} from "../../../integrations/harness/core/availabilityState";
import { Toggle } from "../../../shared/ui/Toggle";
import { modelsFor } from "../../sessions/model/models";
import { asideAccounts } from "../hooks/useAsideLink";
import { ASIDE_HARNESSES, asideProviders } from "../model/asideModels";
import { parseLinkStatus, parsePort, type LinkStatus } from "../model/asideSettings";

const input =
  "w-24 rounded-lg border border-content/15 bg-content/3 px-3 py-2 text-[13px] tabular-nums outline-none focus:border-content/35";
const button =
  "rounded-lg bg-selection px-3 py-2 text-[13px] font-medium transition-transform duration-100 hover:bg-selection-hover active:scale-96 disabled:opacity-40 disabled:active:scale-100";

function statusLine(status: LinkStatus): { text: string; tone: "ok" | "warn" | "muted" } {
  if (!status.enabled) return { text: "Off. Ask Aside can’t reach MonoCode.", tone: "muted" };
  if (!status.listening)
    return { text: status.status || "Not listening. Try another port.", tone: "warn" };
  if (!status.attached)
    return { text: "Listening, but no MonoCode window is open to answer.", tone: "warn" };
  return { text: `Listening on 127.0.0.1:${status.port}`, tone: "ok" };
}

const TONE = { ok: "text-emerald-500", warn: "text-amber-500", muted: "text-content/45" } as const;

/** Fork (L-274): lets Aside's "Ask Aside" panel use MonoCode's CLI models. */
export function AsideLinkSettings(): ReactElement {
  const [status, setStatus] = useState<LinkStatus | null>(null);
  const [port, setPort] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useSyncExternalStore(
    subscribeHarnessAvailability,
    getHarnessAvailabilitySnapshot,
    getHarnessAvailabilitySnapshot,
  );
  const harnesses = ASIDE_HARNESSES.map((entry) => entry.harness).filter(isHarnessAvailable);

  useEffect(() => {
    let disposed = false;
    let initial = true;
    const load = async () => {
      try {
        const next = parseLinkStatus(await invoke<unknown>("aside_link_status"));
        if (disposed) return;
        if (initial) setPort(String(next.port));
        initial = false;
        setStatus(next);
      } catch (reason) {
        if (!disposed) setError(String(reason));
      }
    };
    void load();
    const timer = setInterval(() => void load(), 3000);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, []);

  const act = async (action: () => Promise<string | void>) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const message = await action();
      if (message) setNotice(message);
      setStatus(parseLinkStatus(await invoke<unknown>("aside_link_status")));
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  };

  const portValue = parsePort(port);
  const portError = port.trim() && portValue === null ? "Use a port from 1024 to 65535." : "";
  const providers = asideProviders(harnesses, modelsFor, asideAccounts);
  const modelCount = Object.values(providers).reduce((sum, entry) => sum + entry.models.length, 0);
  const line = status ? statusLine(status) : null;

  const addModels = () =>
    act(async () => {
      const result = await invoke<{ accounts: number }>("aside_link_write_models", { providers });
      const accounts = result.accounts === 1 ? "your Aside account" : `${result.accounts} Aside accounts`;
      return `Added ${modelCount} models to ${accounts}. Pick a model under “hari-…” in Ask Aside.`;
    });

  return (
    <div data-setting-id="aside-link" className="flex flex-col gap-5 border-t border-stroke pt-8">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-[13px] font-semibold text-content">Aside browser</h2>
          <p className="mt-1 text-[12px] leading-relaxed text-pretty text-content/45">
            Use Claude Code, Command Code and Antigravity from Aside’s Ask Aside panel. Each Aside
            chat runs here as a conversation in the CLI project.
          </p>
        </div>
        <Toggle
          label="Answer Ask Aside from MonoCode"
          on={status?.enabled ?? false}
          disabled={!status || busy}
          onChange={(enabled) => void act(() => invoke("aside_link_configure", { enabled }).then(() => undefined))}
        />
      </div>

      {line ? (
        <p role="status" className={`text-[12px] ${TONE[line.tone]}`}>
          {line.text}
        </p>
      ) : (
        <div aria-busy="true" aria-label="Loading Aside status" className="h-4 w-48 animate-pulse rounded bg-content/5" />
      )}

      {status?.enabled ? (
        harnesses.length === 0 ? (
          <div className="rounded-xl border border-dashed border-content/15 px-5 py-6 text-center text-[13px] text-content/45">
            Install Claude Code, Command Code or Antigravity CLI to offer models to Aside.
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-stroke px-4 py-4">
            <div className="min-w-0 text-[12px] leading-relaxed text-content/55">
              {modelCount} models from{" "}
              {ASIDE_HARNESSES.filter((entry) => harnesses.includes(entry.harness))
                .map((entry) => entry.name.replace("Hari · ", ""))
                .join(", ")}
              . Add them again after changing the port, installing a CLI or adding a Claude account.
            </div>
            <button
              type="button"
              className={`${button} shrink-0`}
              disabled={busy || !status.listening || modelCount === 0}
              onClick={() => void addModels()}
            >
              Add models to Aside
            </button>
          </div>
        )
      ) : null}

      {error ? (
        <p role="alert" className="whitespace-pre-wrap break-words rounded-lg bg-red-500/5 p-3 text-[12px] leading-relaxed text-red-400">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="text-[13px] text-emerald-500">
          {notice}
        </p>
      ) : null}

      {status ? (
        <details className="text-[12px] text-content/45">
          <summary className="cursor-pointer">Connection details</summary>
          <div className="mt-4 flex flex-col gap-3 leading-relaxed">
            <p>
              MonoCode answers only on this computer (127.0.0.1) and only requests carrying the key it
              wrote into Aside’s models.json.
            </p>
            <label className="flex flex-col gap-1.5 text-content/65">
              Port
              <span className="flex gap-2">
                <input
                  type="text"
                  inputMode="numeric"
                  className={input}
                  value={port}
                  aria-invalid={portError ? true : undefined}
                  aria-describedby={portError ? "aside-link-port-error" : undefined}
                  onChange={(event) => setPort(event.target.value)}
                />
                <button
                  type="button"
                  className={`${button} shrink-0`}
                  disabled={busy || portValue === null || portValue === status.port}
                  onClick={() =>
                    void act(async () => {
                      await invoke("aside_link_configure", { enabled: status.enabled, port: portValue });
                      return "Port saved. Use “Add models to Aside” so Aside uses it.";
                    })
                  }
                >
                  Save
                </button>
              </span>
            </label>
            {portError ? (
              <p id="aside-link-port-error" role="alert" className="text-red-400">
                {portError}
              </p>
            ) : null}
            <p className="break-all">Chats are kept in {status.projectPath}</p>
          </div>
        </details>
      ) : null}
    </div>
  );
}

import { invoke } from "@tauri-apps/api/core";
import { useState } from "react";
import { Paperclip, Trash2, X } from "../../../shared/ui/icons";
import {
  consoleNote,
  networkNote,
  shortUrl,
  textualMime,
  type ConsoleRow,
  type NetworkRow,
} from "../model/browserContext";
import {
  attachNote,
  clearDevtools,
  showNotice,
  type BrowserTab,
} from "../model/browserTabs";

const LEVEL_TONE: Record<ConsoleRow["level"], string> = {
  error: "text-red-300",
  warn: "text-amber-200",
  info: "text-content/80",
  log: "text-content/80",
  debug: "text-content/50",
};

/**
 * Fork (L-207): the page's console and network requests. Nothing here goes
 * to a chat on its own; clicking a row adds just that row as a chip.
 */
export function BrowserDevtools({
  tab,
  onClose,
}: {
  tab: BrowserTab;
  onClose: () => void;
}) {
  const [pane, setPane] = useState<"console" | "network">("console");
  const [errorsOnly, setErrorsOnly] = useState(false);
  const rows =
    pane === "console"
      ? tab.console.filter((row) => !errorsOnly || row.level === "error" || row.level === "warn")
      : tab.network.filter((row) => !errorsOnly || row.error || (row.status ?? 0) >= 400);

  const attachConsole = (row: ConsoleRow) =>
    attachNote(`Console ${row.level}`, row.text.split("\n")[0], consoleNote(row, tab.url));

  const attachRequest = async (row: NetworkRow) => {
    let body: { body: string; base64Encoded?: boolean } | null = null;
    if (row.done && !row.error && textualMime(row.mimeType)) {
      try {
        body = await invoke("browser_response_body", { tab: tab.id, requestId: row.id });
      } catch {
        showNotice("The response body is no longer available; added the request only");
      }
    }
    attachNote(`${row.method} ${row.status ?? ""}`.trim(), shortUrl(row.url, 60), networkNote(row, body));
  };

  return (
    <div className="flex h-56 shrink-0 flex-col border-t border-stroke bg-surface text-[12px]">
      <div className="flex h-8 shrink-0 items-center gap-1 border-b border-stroke px-2">
        {(["console", "network"] as const).map((name) => (
          <button
            key={name}
            type="button"
            aria-pressed={pane === name}
            onClick={() => setPane(name)}
            className={`rounded-md px-2 py-0.5 capitalize transition-colors duration-100 ${
              pane === name ? "bg-content/10 text-content" : "text-content/55 hover:text-content"
            }`}
          >
            {name}
            <span className="ml-1 tabular-nums text-content/40">
              {name === "console" ? tab.console.length : tab.network.length}
            </span>
          </button>
        ))}
        <label className="ml-2 flex items-center gap-1 text-content/55">
          <input
            type="checkbox"
            checked={errorsOnly}
            onChange={(event) => setErrorsOnly(event.target.checked)}
            className="accent-accent"
          />
          Problems only
        </label>
        <span className="ml-auto truncate text-[11px] text-content/40">Click a row to add it to the chat</span>
        <button
          type="button"
          aria-label={`Clear ${pane}`}
          title={`Clear ${pane}`}
          onClick={() => clearDevtools(tab.id, pane)}
          className="grid size-6 place-items-center rounded-md text-content/50 hover:bg-content/10 hover:text-content"
        >
          <Trash2 aria-hidden className="size-3.5" />
        </button>
        <button
          type="button"
          aria-label="Close console and network"
          title="Close"
          onClick={onClose}
          className="grid size-6 place-items-center rounded-md text-content/50 hover:bg-content/10 hover:text-content"
        >
          <X aria-hidden className="size-3.5" />
        </button>
      </div>
      <ol role="list" className="min-h-0 flex-1 overflow-auto py-0.5 font-mono text-[11.5px]">
        {rows.length === 0 ? (
          <li className="px-3 py-3 font-sans text-content/45">
            {pane === "console" ? "No console messages yet." : "No requests yet. Reload to see the page's requests."}
          </li>
        ) : pane === "console" ? (
          (rows as ConsoleRow[]).map((row, index) => (
            <li key={index}>
              <button
                type="button"
                title="Add to chat"
                onClick={() => attachConsole(row)}
                className="group flex w-full items-start gap-2 px-3 py-1 text-left hover:bg-content/5"
              >
                <span className={`w-10 shrink-0 ${LEVEL_TONE[row.level]}`}>{row.level}</span>
                <span className={`line-clamp-3 min-w-0 flex-1 whitespace-pre-wrap break-words ${LEVEL_TONE[row.level]}`}>
                  {row.text}
                </span>
                {row.source ? (
                  <span className="max-w-[35%] shrink-0 truncate text-content/35">{shortUrl(row.source, 80)}</span>
                ) : null}
                <Paperclip aria-hidden className="size-3.5 shrink-0 text-content/40 opacity-0 group-hover:opacity-100" />
              </button>
            </li>
          ))
        ) : (
          (rows as NetworkRow[]).map((row) => (
            <li key={row.id}>
              <button
                type="button"
                title="Add to chat"
                onClick={() => void attachRequest(row)}
                className="group flex w-full items-center gap-2 px-3 py-1 text-left hover:bg-content/5"
              >
                <span className="w-12 shrink-0 text-content/60">{row.method}</span>
                <span
                  className={`w-10 shrink-0 tabular-nums ${
                    row.error || (row.status ?? 0) >= 400 ? "text-red-300" : "text-content/60"
                  }`}
                >
                  {row.error ? "fail" : (row.status ?? "…")}
                </span>
                <span className="min-w-0 flex-1 truncate text-content/80">{shortUrl(row.url, 300)}</span>
                <span className="w-16 shrink-0 truncate text-content/35">{row.type ?? ""}</span>
                <Paperclip aria-hidden className="size-3.5 shrink-0 text-content/40 opacity-0 group-hover:opacity-100" />
              </button>
            </li>
          ))
        )}
      </ol>
    </div>
  );
}

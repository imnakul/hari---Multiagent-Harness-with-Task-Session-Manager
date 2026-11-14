import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import { copyText } from "../../../platform/tauri/clipboard";
import { openPathWithDefaultApp, revealPath } from "../../../platform/tauri/fs";
import { Popover } from "../../../shared/ui/Popover";
import { Bell, BellOff, Copy, ExternalLink, FolderOpen, Paperclip, Send, SmartPhone, Trash2, X } from "../../../shared/ui/icons";
import { openWebLink } from "../../browser/model/openWebLink";
import { formatFileSize } from "../../files/model/filePreview";
import { relativeAge } from "../../notifications/ui/NotificationBell";
import {
  parseShareList,
  shareCaption,
  SHARE_CHANGE_EVENT,
  SHARE_OPEN_EVENT,
  type ShareEntry,
  type ShareList,
} from "../model/mobileShare";
import {
  mergePhoneStats,
  parsePhoneStatsList,
  parsePhoneStatsRow,
  PHONE_STATS_EVENT,
  PHONE_STATS_FRESH_MS,
  phoneStatsParts,
  type PhoneStatsRow,
} from "../model/mobilePc";

const BUTTON =
  "flex w-10 items-center justify-center text-content/60 transition-colors hover:bg-content/10 hover:text-content";
const SMALL =
  "inline-flex h-7 items-center gap-1.5 rounded-md border border-content/10 px-2 text-[12px] text-content/75 transition-[background-color,color,transform] duration-100 hover:bg-content/10 hover:text-content active:scale-[0.96] disabled:pointer-events-none disabled:opacity-45";
const ICON =
  "grid size-6 place-items-center rounded-md text-content/50 transition-[background-color,color,transform] duration-100 hover:bg-content/10 hover:text-content active:scale-[0.94]";
/** Newest arrival the user has seen in Share, for the title-bar dot. */
const SEEN_KEY = "monocode.share.seenAt";

function readSeen(): number {
  const value = Number(localStorage.getItem(SEEN_KEY) ?? 0);
  return Number.isFinite(value) ? value : 0;
}

const message = (reason: unknown): string =>
  reason instanceof Error ? reason.message : typeof reason === "string" ? reason : "Something went wrong";

function ShareRow({
  entry,
  onError,
}: {
  entry: ShareEntry;
  onError: (error: string) => void;
}): JSX.Element {
  const [copied, setCopied] = useState(false);
  const run = (action: () => Promise<void>) => void action().catch((reason: unknown) => onError(message(reason)));
  const path = entry.path;
  return (
    <li className="group relative rounded-lg px-2.5 py-2 transition-colors duration-100 hover:bg-content/[0.05]">
      <span className="flex items-center gap-1.5 pr-14 text-[11px]">
        <span className="truncate font-medium text-content/55">{shareCaption(entry)}</span>
        <span className="ml-auto shrink-0 text-content/40">{relativeAge(entry.at)}</span>
      </span>
      {entry.kind === "file" ? (
        <span className="mt-0.5 flex min-w-0 items-baseline gap-1.5 text-[12.5px] text-content">
          <span className="truncate">{entry.name}</span>
          {entry.size !== undefined ? (
            <span className="shrink-0 text-[11px] tabular-nums text-content/45">{formatFileSize(entry.size)}</span>
          ) : null}
        </span>
      ) : (
        <span className="mt-0.5 line-clamp-3 whitespace-pre-wrap break-words text-[12.5px] text-content">
          {entry.text}
        </span>
      )}
      <span className="absolute right-1.5 top-1.5 flex gap-0.5 opacity-0 transition-opacity duration-100 group-hover:opacity-100 group-focus-within:opacity-100">
        {entry.kind !== "file" && entry.text !== undefined ? (
          <button
            type="button"
            title={copied ? "Copied" : "Copy"}
            aria-label="Copy text"
            onClick={() =>
              run(async () => {
                await copyText(entry.text ?? "");
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1200);
              })
            }
            className={ICON}
          >
            <Copy className="size-3.5" strokeWidth={1.75} />
          </button>
        ) : null}
        {entry.kind === "link" && entry.text ? (
          <button
            type="button"
            title="Open link"
            aria-label="Open link"
            onClick={() => openWebLink(entry.text?.trim() ?? "")}
            className={ICON}
          >
            <ExternalLink className="size-3.5" strokeWidth={1.75} />
          </button>
        ) : null}
        {path ? (
          <>
            <button
              type="button"
              title="Open"
              aria-label={`Open ${entry.name ?? "file"}`}
              onClick={() => run(() => openPathWithDefaultApp(path))}
              className={ICON}
            >
              <ExternalLink className="size-3.5" strokeWidth={1.75} />
            </button>
            <button
              type="button"
              title="Show in folder"
              aria-label={`Show ${entry.name ?? "file"} in folder`}
              onClick={() => run(() => revealPath(path))}
              className={ICON}
            >
              <FolderOpen className="size-3.5" strokeWidth={1.75} />
            </button>
          </>
        ) : null}
        <button
          type="button"
          title="Remove from history (the file stays)"
          aria-label="Remove from history"
          onClick={() => run(() => invoke<void>("mobile_share_remove", { ids: [entry.id] }))}
          className={ICON}
        >
          <X className="size-3.5" strokeWidth={1.75} />
        </button>
      </span>
    </li>
  );
}

/** Asks again before the phone's minute of stats runs out. */
const PHONE_STATS_POLL_MS = 45_000;
/** The phone's own limit on Find my phone. */
const RING_FOR_MS = 2 * 60_000;

/**
 * Fork (Hari, L-280): the paired phones' battery, heat, storage and network,
 * and Find my phone. Stats are asked for while Share is open; the phone sends
 * them every few seconds for a minute after each ask.
 */
function PhoneStatus({ onError }: { onError: (error: string) => void }): JSX.Element | null {
  const [phones, setPhones] = useState<PhoneStatsRow[]>([]);
  const [ringing, setRinging] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let disposed = false;
    const ask = () => {
      setNow(Date.now());
      invoke<unknown>("mobile_pc_phone_stats")
        .then((raw) => {
          if (disposed) return;
          // Keep a live update that arrived after the computer read its copy.
          setPhones((current) =>
            parsePhoneStatsList(raw).map((row) => {
              const live = current.find((old) => old.peer === row.peer);
              return live && (live.at ?? 0) > (row.at ?? 0) ? live : row;
            }),
          );
        })
        .catch((reason: unknown) => console.warn("Share: could not load phone stats", reason));
    };
    ask();
    const timer = window.setInterval(ask, PHONE_STATS_POLL_MS);
    const ticker = window.setInterval(() => setNow(Date.now()), 5_000);
    const updates = listen<unknown>(PHONE_STATS_EVENT, (event) => {
      const row = parsePhoneStatsRow(event.payload);
      if (row && !disposed) setPhones((current) => mergePhoneStats(current, row));
    });
    return () => {
      disposed = true;
      window.clearInterval(timer);
      window.clearInterval(ticker);
      void updates.then((unlisten) => unlisten());
    };
  }, []);

  // The phone stops by itself after two minutes.
  useEffect(() => {
    if (!ringing) return;
    const timer = window.setTimeout(() => setRinging(false), RING_FOR_MS);
    return () => window.clearTimeout(timer);
  }, [ringing]);

  if (phones.length === 0) return null;

  const ring = (start: boolean) => {
    invoke<void>("mobile_pc_ring", { start })
      .then(() => setRinging(start))
      .catch((reason: unknown) => onError(message(reason)));
  };

  return (
    <div className="shrink-0 space-y-1.5 border-b border-stroke px-3 py-2.5">
      {phones.map((phone) => {
        const parts = phone.stats ? phoneStatsParts(phone.stats) : [];
        const old = phone.at === undefined || now - phone.at > PHONE_STATS_FRESH_MS;
        return (
          <div key={phone.peer} className="flex min-w-0 items-baseline gap-2 text-[12px]">
            <span className="shrink-0 font-medium text-content/80">{phone.name}</span>
            <span className={`truncate tabular-nums ${old ? "text-content/35" : "text-content/55"}`}>
              {parts.length === 0
                ? "Waiting for the phone…"
                : `${parts.join(" · ")}${old && phone.at !== undefined ? ` · ${relativeAge(phone.at)}` : ""}`}
            </span>
          </div>
        );
      })}
      <button
        type="button"
        title={ringing ? "Stop the ringing" : "Ring the phone at full volume, even on silent"}
        onClick={() => ring(!ringing)}
        className={ringing ? `${SMALL} border-accent/40 bg-accent/15 text-content hover:bg-accent/25` : SMALL}
      >
        {ringing ? (
          <BellOff className="size-3.5" strokeWidth={1.75} />
        ) : (
          <Bell className="size-3.5" strokeWidth={1.75} />
        )}
        {ringing ? "Stop ringing" : "Find my phone"}
      </button>
    </div>
  );
}

/**
 * Fork (Hari, L-279): title-bar Share with the paired phone. Send text, a
 * link, the clipboard or files; the history lists both ways. Arrivals put a
 * dot on the icon until Share is opened.
 */
export function ShareButton(): JSX.Element {
  const [list, setList] = useState<ShareList>({ items: [], phones: 0 });
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [seenAt, setSeenAt] = useState(readSeen);
  const trigger = useRef<HTMLButtonElement>(null);

  const load = useCallback(() => {
    invoke<unknown>("mobile_share_list")
      .then((raw) => setList(parseShareList(raw)))
      .catch((reason: unknown) => console.warn("Share: could not load the history", reason));
  }, []);

  useEffect(() => {
    load();
    const changes = listen(SHARE_CHANGE_EVENT, load);
    const opens = listen(SHARE_OPEN_EVENT, () => {
      if (document.hasFocus()) setOpen(true);
    });
    return () => {
      void changes.then((unlisten) => unlisten());
      void opens.then((unlisten) => unlisten());
    };
  }, [load]);

  const newestIn = list.items.find((entry) => entry.direction === "in")?.at ?? 0;
  const unseen = newestIn > seenAt;

  useEffect(() => {
    if (!open || newestIn <= seenAt) return;
    localStorage.setItem(SEEN_KEY, String(newestIn));
    setSeenAt(newestIn);
  }, [open, newestIn, seenAt]);

  const close = () => {
    setOpen(false);
    setError(null);
  };

  const attempt = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (reason) {
      setError(message(reason));
    } finally {
      setBusy(false);
    }
  };

  const sendDraft = (clipboard: boolean) =>
    attempt(async () => {
      await invoke<void>("mobile_share_send_text", { text: draft, clipboard });
      setDraft("");
    });

  const sendFiles = () =>
    attempt(async () => {
      const picked = await openDialog({ multiple: true, directory: false, title: "Send to your phone" });
      const paths = Array.isArray(picked) ? picked : typeof picked === "string" ? [picked] : [];
      if (paths.length) await invoke<void>("mobile_share_send_files", { paths });
    });

  const paired = list.phones > 0;
  const hasDraft = draft.trim().length > 0;

  return (
    <>
      <button
        ref={trigger}
        type="button"
        title="Share with your phone"
        aria-label={unseen ? "Share with your phone, new items" : "Share with your phone"}
        aria-expanded={open}
        aria-haspopup="dialog"
        data-tauri-drag-region="false"
        onClick={() => (open ? close() : setOpen(true))}
        className={`relative ${BUTTON}`}
      >
        <SmartPhone className="size-3.5" strokeWidth={1.75} />
        {unseen ? (
          <span className="absolute right-[13px] top-[calc(50%-8px)] size-1.5 rounded-full bg-accent" />
        ) : null}
      </button>
      {open ? (
        <Popover
          anchor={trigger}
          side="bottom"
          align="end"
          gap={4}
          width={360}
          maxHeight={540}
          role="dialog"
          aria-label="Share with your phone"
          onDismiss={close}
          className="flex flex-col overflow-hidden"
        >
          <div className="flex h-9 shrink-0 items-center gap-2 border-b border-stroke pl-3 pr-1.5">
            <span className="text-[12.5px] font-medium text-content">Share with your phone</span>
            {list.items.length > 0 ? (
              <button
                type="button"
                title="Clear history (files stay)"
                aria-label="Clear Share history"
                onClick={() => void attempt(() => invoke<void>("mobile_share_remove", { ids: null }))}
                className={`ml-auto ${ICON}`}
              >
                <Trash2 className="size-3.5" strokeWidth={1.75} />
              </button>
            ) : null}
          </div>
          {paired ? <PhoneStatus onError={setError} /> : null}
          {paired ? (
            <div className="shrink-0 space-y-2 border-b border-stroke p-2.5">
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && hasDraft && !busy) {
                    event.preventDefault();
                    void sendDraft(false);
                  }
                }}
                rows={3}
                aria-label="Text or a link for your phone"
                placeholder="Text or a link for your phone"
                className="block w-full resize-none rounded-md border border-content/10 bg-content/[0.03] px-2 py-1.5 text-[12.5px] text-content placeholder:text-content/40 focus:border-accent/60 focus:outline-none"
              />
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  disabled={busy}
                  title="Put this computer's clipboard on the phone's clipboard"
                  onClick={() => void attempt(() => invoke<void>("mobile_share_send_clipboard"))}
                  className={SMALL}
                >
                  <Copy className="size-3.5" strokeWidth={1.75} />
                  Send clipboard
                </button>
                <button type="button" disabled={busy} onClick={() => void sendFiles()} className={SMALL}>
                  <Paperclip className="size-3.5" strokeWidth={1.75} />
                  Files…
                </button>
                <button
                  type="button"
                  disabled={busy || !hasDraft}
                  title="Put this text on the phone's clipboard"
                  onClick={() => void sendDraft(true)}
                  className={`ml-auto ${SMALL}`}
                >
                  To clipboard
                </button>
                <button
                  type="button"
                  disabled={busy || !hasDraft}
                  title="Send (Ctrl+Enter)"
                  onClick={() => void sendDraft(false)}
                  className={`${SMALL} border-accent/40 bg-accent/15 text-content hover:bg-accent/25`}
                >
                  <Send className="size-3.5" strokeWidth={1.75} />
                  Send
                </button>
              </div>
              {error ? (
                <p role="alert" className="text-[11.5px] text-red-400">
                  {error}
                </p>
              ) : null}
            </div>
          ) : (
            <p className="shrink-0 border-b border-stroke px-3 py-3 text-[12px] text-content/60">
              Pair Hari on your phone (Settings → Mobile) to send text, links, the clipboard and files
              both ways.
            </p>
          )}
          {list.items.length === 0 ? (
            <p className="px-3 py-6 text-center text-[12px] text-content/45">
              Nothing shared yet. Files from the phone go to Downloads\Hari.
            </p>
          ) : (
            <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto p-1">
              {list.items.map((entry) => (
                <ShareRow key={entry.id} entry={entry} onError={setError} />
              ))}
            </ul>
          )}
          {!paired && error ? (
            <p role="alert" className="shrink-0 px-3 pb-2 text-[11.5px] text-red-400">
              {error}
            </p>
          ) : null}
        </Popover>
      ) : null}
    </>
  );
}

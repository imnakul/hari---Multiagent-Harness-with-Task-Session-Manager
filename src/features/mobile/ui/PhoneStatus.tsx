import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useState, type JSX } from "react";
import { Bell, BellOff } from "../../../shared/ui/icons";
import { relativeAge } from "../../notifications/ui/NotificationBell";
import {
  mergePhoneStats,
  parsePhoneStatsList,
  parsePhoneStatsRow,
  PHONE_STATS_EVENT,
  PHONE_STATS_FRESH_MS,
  phoneStatsParts,
  type PhoneStatsRow,
} from "../model/mobilePc";

export const SHARE_SMALL_BUTTON =
  "inline-flex h-7 items-center gap-1.5 rounded-md border border-content/10 px-2 text-[12px] text-content/75 transition-[background-color,color,transform] duration-100 hover:bg-content/10 hover:text-content active:scale-[0.96] disabled:pointer-events-none disabled:opacity-45";

/** Asks again before the phone's minute of stats runs out. */
const PHONE_STATS_POLL_MS = 45_000;
/** The phone's own limit on Find my phone. */
const RING_FOR_MS = 2 * 60_000;

export const shareErrorMessage = (reason: unknown): string =>
  reason instanceof Error ? reason.message : typeof reason === "string" ? reason : "Something went wrong";

/**
 * Fork (Hari, L-280): the paired phones' battery, heat, storage and network,
 * and Find my phone. Stats are asked for while Share is open; the phone sends
 * them every few seconds for a minute after each ask.
 */
export function PhoneStatus({ onError }: { onError: (error: string) => void }): JSX.Element | null {
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
      .catch((reason: unknown) => onError(shareErrorMessage(reason)));
  };

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1.5">
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
        className={
          ringing
            ? `${SHARE_SMALL_BUTTON} border-accent/40 bg-accent/15 text-content hover:bg-accent/25`
            : SHARE_SMALL_BUTTON
        }
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

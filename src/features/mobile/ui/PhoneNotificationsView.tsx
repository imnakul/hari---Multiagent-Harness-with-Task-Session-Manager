import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type JSX } from "react";
import { BellOff, LoaderCircle, X } from "../../../shared/ui/icons";
import { Toggle } from "../../../shared/ui/Toggle";
import { loadPhoneBanners, savePhoneBanners, subscribePhoneBanners } from "../model/phoneBanners";
import {
  looksLikeCode,
  maskCodes,
  noticeTime,
  parsePhoneNotices,
  PHONE_NOTIFICATIONS_EVENT,
  type PhoneNotice,
  type PhoneNotices,
} from "../model/phoneNotifications";
import { SHARE_SMALL_BUTTON, shareErrorMessage } from "./PhoneStatus";

type Load = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; list: PhoneNotices };

/** Fork (L-384): how long a notice a banner pointed at stays highlighted. */
const HIGHLIGHT_MS = 2000;

/**
 * Fork (Hari, L-325): the paired phone's notifications. What's on the phone
 * now, then what left it in the last day. Dismissing one clears it on the
 * phone too. One-time codes stay dotted out until clicked.
 */
export function PhoneNotificationsView({
  onError,
  focusKey = null,
}: {
  onError: (error: string) => void;
  /** Fork (L-384): a notice to scroll into view and highlight, from a clicked phone banner. */
  focusKey?: string | null;
}): JSX.Element {
  const banners = useSyncExternalStore(subscribePhoneBanners, loadPhoneBanners, () => false);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-stroke px-3 py-2 text-[12.5px] text-content/70">
        <span className="min-w-0 flex-1">Show as desktop notifications</span>
        <Toggle label="Show as desktop notifications" on={banners} onChange={savePhoneBanners} />
      </div>
      <PhoneNotificationsBody onError={onError} focusKey={focusKey} />
    </div>
  );
}

function PhoneNotificationsBody({
  onError,
  focusKey,
}: {
  onError: (error: string) => void;
  focusKey: string | null;
}): JSX.Element {
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [revealed, setRevealed] = useState<ReadonlySet<string>>(() => new Set());
  const [now, setNow] = useState(() => Date.now());
  const latest = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);
  const [highlighted, setHighlighted] = useState<string | null>(null);

  const refresh = useCallback(() => {
    const ask = ++latest.current;
    invoke<unknown>("mobile_phone_notifications_list")
      .then((raw) => {
        if (ask !== latest.current) return;
        const list = parsePhoneNotices(raw);
        setLoad(
          list
            ? { kind: "ready", list }
            : { kind: "error", message: "This computer couldn't read the phone's notifications." },
        );
        setNow(Date.now());
      })
      .catch((reason: unknown) => {
        if (ask === latest.current) setLoad({ kind: "error", message: shareErrorMessage(reason) });
      });
  }, []);

  useEffect(() => {
    refresh();
    const unlisten = listen(PHONE_NOTIFICATIONS_EVENT, refresh);
    const clock = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => {
      window.clearInterval(clock);
      void unlisten.then((stop) => stop()).catch(() => {});
    };
  }, [refresh]);

  // L-384: a clicked banner scrolls its notice into view and marks it; if it is gone, the view just opens.
  const ready = load.kind === "ready";
  useEffect(() => {
    if (!focusKey || !ready) return;
    const target = [...(listRef.current?.querySelectorAll<HTMLElement>("[data-notice-key]") ?? [])].find(
      (element) => element.dataset.noticeKey === focusKey,
    );
    if (!target) return;
    target.scrollIntoView({ block: "nearest" });
    setHighlighted(focusKey);
    const timer = window.setTimeout(() => setHighlighted(null), HIGHLIGHT_MS);
    return () => window.clearTimeout(timer);
  }, [focusKey, ready]);

  const dismiss = (key: string) => {
    // Gone at once; the list event brings it back if the computer refused.
    setLoad((current) =>
      current.kind === "ready"
        ? {
            kind: "ready",
            list: {
              ...current.list,
              onPhone: current.list.onPhone.filter((notice) => notice.key !== key),
              earlier: current.list.earlier.filter((notice) => notice.key !== key),
            },
          }
        : current,
    );
    invoke<void>("mobile_phone_notification_dismiss", { key }).catch((reason: unknown) => {
      onError(shareErrorMessage(reason));
      refresh();
    });
  };
  const clearEarlier = () => {
    invoke<void>("mobile_phone_notifications_clear").catch((reason: unknown) => onError(shareErrorMessage(reason)));
  };
  const reveal = (key: string) => setRevealed((current) => new Set(current).add(key));

  if (load.kind === "loading")
    return (
      <p role="status" className="mt-10 flex items-center justify-center gap-2 text-[12.5px] text-content/55">
        <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
        Loading notifications…
      </p>
    );
  if (load.kind === "error")
    return (
      <div role="alert" className="mx-auto mt-10 max-w-xs px-3 text-center text-[12.5px] text-content/60">
        <p>{load.message}</p>
        <button type="button" onClick={refresh} className={`mt-3 ${SHARE_SMALL_BUTTON}`}>
          Try again
        </button>
      </div>
    );

  const { list } = load;
  if (!list.paired || !list.receiving || list.stalled)
    return (
      <div className="mx-auto mt-10 max-w-xs px-3 text-center text-[12.5px] text-content/55">
        <BellOff className="mx-auto mb-3 size-6 text-content/30" strokeWidth={1.5} aria-hidden />
        {!list.paired ? (
          <p>Pair Hari on your phone (Settings → Mobile) to see its notifications here.</p>
        ) : list.stalled ? (
          // L-334: Android left the phone's notification reader stopped (often after an update).
          <p>
            Your phone's notification reader isn't running. Open Hari on the phone to restart it. If they still
            don't show, turn Hari's Notification access off and on in the phone's settings.
          </p>
        ) : (
          // Nothing since this computer started: the phone may just not have sent yet.
          <p>
            No notifications from the phone yet. If they don't appear, open Hari → Settings → Share → Notifications
            on computer on the phone and turn on Send to computer.
          </p>
        )}
      </div>
    );

  const row = (notice: PhoneNotice, onPhone: boolean) => (
    <NoticeRow
      key={notice.key}
      notice={notice}
      icon={list.icons[notice.package]}
      time={noticeTime(notice.postedAt, now)}
      masked={looksLikeCode(notice) && !revealed.has(notice.key)}
      highlighted={highlighted === notice.key}
      onPhone={onPhone}
      onReveal={() => reveal(notice.key)}
      onDismiss={() => dismiss(notice.key)}
    />
  );

  return (
    <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto py-1">
      <h4 className="px-3 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-content/45">On phone</h4>
      {list.onPhone.length ? (
        <ul>{list.onPhone.map((notice) => row(notice, true))}</ul>
      ) : (
        <p className="px-3 py-3 text-[12.5px] text-content/45">No notifications on the phone.</p>
      )}
      {list.earlier.length ? (
        <>
          <div className="flex items-center px-3 pb-1 pt-4">
            <h4 className="flex-1 text-[11px] font-medium uppercase tracking-wide text-content/45">Earlier</h4>
            <button type="button" onClick={clearEarlier} className={SHARE_SMALL_BUTTON}>
              Clear
            </button>
          </div>
          <ul className="opacity-80">{list.earlier.map((notice) => row(notice, false))}</ul>
        </>
      ) : null}
    </div>
  );
}

function NoticeRow({
  notice,
  icon,
  time,
  masked,
  highlighted,
  onPhone,
  onReveal,
  onDismiss,
}: {
  notice: PhoneNotice;
  icon: string | undefined;
  time: string;
  masked: boolean;
  highlighted: boolean;
  onPhone: boolean;
  onReveal: () => void;
  onDismiss: () => void;
}): JSX.Element {
  const title = masked ? maskCodes(notice.title) : notice.title;
  const body = masked ? maskCodes(notice.text) : notice.text;
  return (
    <li
      data-notice-key={notice.key}
      className={`group flex min-w-0 items-start gap-2.5 px-3 py-2 transition-colors duration-300 hover:bg-content/[0.04] ${
        highlighted ? "bg-accent/15" : ""
      }`}
    >
      {icon ? (
        <img src={`data:image/png;base64,${icon}`} alt="" className="mt-0.5 size-6 shrink-0 rounded-md" />
      ) : (
        <span
          aria-hidden
          className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-md bg-content/10 text-[11px] font-medium text-content/60"
        >
          {notice.app.slice(0, 1).toUpperCase()}
        </span>
      )}
      <div className="min-w-0 flex-1 text-[12.5px]">
        <div className="flex min-w-0 items-baseline gap-1.5 text-[11.5px] text-content/45">
          <span className="min-w-0 truncate">{notice.app}</span>
          <span className="shrink-0 tabular-nums">· {time}</span>
        </div>
        {title ? <p className="truncate font-medium text-content">{title}</p> : null}
        {body ? <p className="line-clamp-3 whitespace-pre-line break-words text-content/70">{body}</p> : null}
        {masked ? (
          <button type="button" onClick={onReveal} className="mt-0.5 text-[11.5px] text-accent hover:underline">
            Show code
          </button>
        ) : null}
      </div>
      <button
        type="button"
        title={onPhone ? "Dismiss here and on the phone" : "Remove"}
        aria-label={onPhone ? `Dismiss ${notice.app} notification` : `Remove ${notice.app} notification`}
        onClick={onDismiss}
        className="grid size-6 shrink-0 place-items-center rounded-md text-content/40 opacity-0 transition-[opacity,background-color,color] duration-100 hover:bg-content/10 hover:text-content focus-visible:opacity-100 group-hover:opacity-100"
      >
        <X className="size-3.5" strokeWidth={1.75} aria-hidden />
      </button>
    </li>
  );
}
